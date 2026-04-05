"""Celery worker for the 3-Agent material analysis pipeline.

Orchestrates: PDF parsing → Cartographer → Specialist → Examiner
Each phase is idempotent (checks for existing results before executing).
Progress is persisted to DB + published to Redis Pub/Sub for SSE.
"""

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone

import redis
from celery import Task
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import async_session_factory
from app.models.disassembly import (
    DisassemblyModule,
    DisassemblyTask,
    ModuleDependency,
    QuizData,
    SpecialistOutput,
)
from app.models.knowledge_card import KnowledgeCardData
from app.services.llm_client import LLMError, get_llm_client, get_llm_client_for_user
from app.services.pdf_parser import PDFParseError, load_parsed_pages, parse_pdf_async
from app.services.pipeline.cartographer import CartographerResult, run_cartographer
from app.services.pipeline.examiner import (
    ExaminerModuleInput,
    extract_formulas_and_examples,
    run_examiner_v2_iterative,
)
from app.services.pipeline.knowledge_cards import (
    KnowledgeCardModuleInput,
    run_knowledge_cards,
)
from app.services.pipeline.specialist import (
    SpecialistResult,
    run_specialist,
    upload_specialist_markdown,
)
from app.workers.celery_app import celery

logger = logging.getLogger(__name__)


def _get_redis():
    """Get a sync Redis client for Pub/Sub."""
    return redis.Redis.from_url(settings.redis_url, decode_responses=True)


def _publish_progress(
    redis_client,
    task_id: str,
    phase: str,
    progress: float,
    message: str,
    detail: dict | None = None,
    *,
    status: str | None = None,
):
    """Publish a progress event to Redis Pub/Sub channel."""
    event = {
        "task_id": task_id,
        "phase": phase,
        "progress": progress,
        "message": message,
    }
    if detail:
        event["detail"] = detail
    if status:
        event["status"] = status
    try:
        redis_client.publish(f"pipeline:{task_id}", json.dumps(event))
    except Exception as e:
        logger.warning("Failed to publish progress: %s", e)


async def _update_task(
    session: AsyncSession,
    task_id: uuid.UUID,
    **kwargs,
):
    """Update task fields atomically."""
    kwargs["updated_at"] = datetime.now(timezone.utc)
    await session.execute(
        update(DisassemblyTask)
        .where(DisassemblyTask.id == task_id)
        .values(**kwargs)
    )
    await session.commit()


async def _run_pipeline_async(task_id_str: str):
    """Async implementation of the 4-phase pipeline."""
    task_id = uuid.UUID(task_id_str)
    run_id = uuid.uuid4().hex
    redis_client = _get_redis()

    async with async_session_factory() as session:
        # Load task
        task = await session.get(DisassemblyTask, task_id)
        if not task:
            logger.error("Task %s not found", task_id)
            return

        if task.status == "cancelled":
            logger.info("Task %s was cancelled, skipping", task_id)
            return

        # Use per-user LLM settings if available
        llm, _user_model = await get_llm_client_for_user(task.user_id)
        if _user_model:
            logger.info("Using user-preferred model: %s", _user_model)

        # Mark as running
        await _update_task(
            session, task_id,
            status="running",
            phase="parsing",
            progress=0.0,
            run_id=run_id,
            started_at=datetime.now(timezone.utc),
        )

        # Load material for metadata
        from app.models.material import Material
        material = await session.get(Material, task.material_id)
        if not material:
            await _update_task(
                session, task_id,
                status="failed",
                error_phase="parsing",
                error_message="Material not found",
            )
            return

        try:
            # ── Phase 1: PARSING ──────────────────────────────
            _publish_progress(redis_client, task_id_str, "parsing", 0.1, "正在解析 PDF...")

            # Idempotent: check if already parsed
            if task.parsed_s3_key:
                logger.info("Phase 1 skip: already parsed (%s)", task.parsed_s3_key)
                parsed = load_parsed_pages(task.parsed_s3_key)
            else:
                parsed = await parse_pdf_async(material.s3_key, task_id_str)
                parsed_key = f"parsed/{task_id_str}/pages.json"
                await _update_task(
                    session, task_id,
                    parsed_s3_key=parsed_key,
                    pdf_page_count=parsed.total_pages,
                )

            await _update_task(session, task_id, phase="cartographer", progress=0.25)
            _publish_progress(redis_client, task_id_str, "cartographer", 0.25, "正在分析课件结构...")

            # ── Phase 2: CARTOGRAPHER ─────────────────────────
            # Idempotent: check if modules exist
            existing_modules = (await session.execute(
                select(DisassemblyModule).where(DisassemblyModule.task_id == task_id)
            )).scalars().all()

            if existing_modules:
                logger.info("Phase 2 skip: %d modules already exist", len(existing_modules))
                # Reconstruct CartographerResult from DB
                from app.services.pipeline.cartographer import ModulePlan
                plan = CartographerResult(
                    modules=[
                        ModulePlan(
                            name=m.name,
                            description=m.description or "",
                            page_range_start=m.page_range_start,
                            page_range_end=m.page_range_end,
                            exam_weight=m.exam_weight,
                            depends_on=[],
                        )
                        for m in sorted(existing_modules, key=lambda x: x.sort_order)
                    ],
                    course_topic=material.title,
                    difficulty_level="intermediate",
                )
            else:
                cart_result = await run_cartographer(
                    parsed=parsed,
                    material_name=material.title,
                    material_type=material.material_type,
                    llm=llm,
                    run_id=run_id,
                )
                plan: CartographerResult = cart_result.data

                # Save modules to DB
                module_objects = []
                for i, mod in enumerate(plan.modules):
                    db_module = DisassemblyModule(
                        task_id=task_id,
                        name=mod.name,
                        description=mod.description,
                        page_range_start=mod.page_range_start,
                        page_range_end=mod.page_range_end,
                        exam_weight=mod.exam_weight,
                        sort_order=i,
                    )
                    session.add(db_module)
                    module_objects.append(db_module)

                await session.flush()  # Get module IDs

                # Save dependencies (sort_order → UUID)
                for i, mod in enumerate(plan.modules):
                    for dep_idx in mod.depends_on:
                        if 0 <= dep_idx < len(module_objects) and dep_idx != i:
                            session.add(ModuleDependency(
                                module_id=module_objects[i].id,
                                depends_on_id=module_objects[dep_idx].id,
                            ))

                await session.commit()

            await _update_task(session, task_id, phase="specialist", progress=0.40)
            _publish_progress(
                redis_client, task_id_str, "specialist", 0.40,
                f"正在生成 {len(plan.modules)} 个模块精讲...",
                {"completed": 0, "total": len(plan.modules)},
            )

            # ── Phase 3: SPECIALIST ───────────────────────────
            # Reload modules from DB for IDs
            db_modules = (await session.execute(
                select(DisassemblyModule)
                .where(DisassemblyModule.task_id == task_id)
                .order_by(DisassemblyModule.sort_order)
            )).scalars().all()

            # Check which modules already have specialist output (idempotent)
            existing_specialists = set()
            for m in db_modules:
                exists = (await session.execute(
                    select(SpecialistOutput.id).where(SpecialistOutput.module_id == m.id)
                )).scalar_one_or_none()
                if exists:
                    existing_specialists.add(m.sort_order)

            if len(existing_specialists) == len(db_modules):
                logger.info("Phase 3 skip: all specialist outputs exist")
            else:
                completed_count = len(existing_specialists)

                async def on_module_done(completed: int, total: int):
                    nonlocal completed_count
                    completed_count = completed + len(existing_specialists)
                    progress = 0.40 + (completed_count / len(db_modules)) * 0.40
                    clamped = min(progress, 0.80)
                    # Persist progress to DB (reconnection safety)
                    await _update_task(session, task_id, progress=clamped)
                    _publish_progress(
                        redis_client, task_id_str, "specialist",
                        clamped,
                        f"正在生成模块 {completed_count}/{len(db_modules)} 精讲...",
                        {"completed": completed_count, "total": len(db_modules)},
                    )

                async def on_module_result(idx: int, spec_llm_result):
                    """Save each specialist output immediately on completion."""
                    if idx in existing_specialists:
                        return
                    spec: SpecialistResult = spec_llm_result.data
                    db_module = db_modules[idx]

                    # Upload markdown to S3
                    s3_key = await upload_specialist_markdown(
                        task_id_str, str(db_module.id), spec.lecture_markdown,
                    )

                    session.add(SpecialistOutput(
                        module_id=db_module.id,
                        markdown_s3_key=s3_key,
                        summary=spec.summary,
                        key_concepts=spec.key_concepts,
                        exam_traps=spec.exam_traps,
                        self_test_questions=[
                            {"question": q.question, "answer": q.answer}
                            for q in spec.self_test_questions
                        ],
                        prompt_version=spec_llm_result.prompt_version,
                        model_used=spec_llm_result.model,
                        input_tokens=spec_llm_result.input_tokens,
                        output_tokens=spec_llm_result.output_tokens,
                        latency_ms=spec_llm_result.latency_ms,
                        run_id=spec_llm_result.run_id,
                    ))
                    # Commit immediately so partial results survive failures
                    await session.commit()
                    logger.info("Specialist output saved for module %d (%s)", idx, db_module.name)

                await run_specialist(
                    parsed=parsed,
                    plan=plan,
                    llm=llm,
                    run_id=run_id,
                    on_module_complete=on_module_done,
                    on_module_result=on_module_result,
                )

            # ── Phase 3.5: KNOWLEDGE CARDS ────────────────────
            await _update_task(session, task_id, phase="knowledge-cards", progress=0.82)
            _publish_progress(redis_client, task_id_str, "knowledge-cards", 0.82, "正在生成知识卡片...")

            # Idempotent: check if knowledge cards exist
            existing_cards = (await session.execute(
                select(KnowledgeCardData.id).where(KnowledgeCardData.task_id == task_id)
            )).scalar_one_or_none()

            if existing_cards:
                logger.info("Phase 3.5 skip: knowledge cards already exist")
            else:
                # Build inputs from specialist outputs
                all_specs_for_cards = (await session.execute(
                    select(SpecialistOutput)
                    .join(DisassemblyModule)
                    .where(DisassemblyModule.task_id == task_id)
                    .order_by(DisassemblyModule.sort_order)
                )).scalars().all()

                card_inputs: list[tuple[int, KnowledgeCardModuleInput]] = []
                for i, spec_out in enumerate(all_specs_for_cards):
                    # Get module name from DB
                    card_module = (await session.execute(
                        select(DisassemblyModule.name)
                        .where(DisassemblyModule.id == spec_out.module_id)
                    )).scalar_one()

                    formulas = None
                    if spec_out.markdown_s3_key:
                        try:
                            from app.services.s3_client import get_s3_client as _get_s3
                            s3 = _get_s3()
                            obj = s3.get_object(
                                Bucket=settings.s3_bucket_name,
                                Key=spec_out.markdown_s3_key,
                            )
                            md_text = obj["Body"].read().decode("utf-8")
                            formulas = extract_formulas_and_examples(md_text)
                            if not formulas:
                                formulas = None
                        except Exception as e:
                            logger.warning(
                                "Failed to extract formulas for cards from %s: %s",
                                spec_out.markdown_s3_key, e,
                            )

                    card_inputs.append((i, KnowledgeCardModuleInput(
                        module_name=card_module,
                        summary=spec_out.summary or "",
                        key_concepts=list(spec_out.key_concepts),
                        exam_traps=list(spec_out.exam_traps or []),
                        formulas_and_examples=formulas,
                    )))

                cards_result = await run_knowledge_cards(
                    specialist_inputs=card_inputs,
                    llm=llm,
                    run_id=f"{run_id}_cards",
                )

                cards_data = cards_result.data
                session.add(KnowledgeCardData(
                    task_id=task_id,
                    material_id=task.material_id,
                    cards=[c.model_dump() for c in cards_data.cards],
                    formula_sheet=cards_data.formula_sheet_markdown,
                    error_taxonomy=cards_data.error_taxonomy_markdown,
                    model_used=cards_result.model,
                    prompt_version=cards_result.prompt_version,
                    input_tokens=cards_result.input_tokens,
                    output_tokens=cards_result.output_tokens,
                    latency_ms=cards_result.latency_ms,
                    run_id=cards_result.run_id,
                ))
                await session.commit()

            await _update_task(session, task_id, phase="examiner", progress=0.88)
            _publish_progress(redis_client, task_id_str, "examiner", 0.88, "正在生成测验题...")

            # ── Phase 4: EXAMINER ─────────────────────────────
            # Idempotent: check if quiz exists
            existing_quiz = (await session.execute(
                select(QuizData.id).where(QuizData.task_id == task_id)
            )).scalar_one_or_none()

            if existing_quiz:
                logger.info("Phase 4 skip: quiz already exists")
            else:
                # Build specialist results for examiner input
                all_specs = (await session.execute(
                    select(SpecialistOutput)
                    .join(DisassemblyModule)
                    .where(DisassemblyModule.task_id == task_id)
                    .order_by(DisassemblyModule.sort_order)
                )).scalars().all()

                spec_data = []
                for i, spec_out in enumerate(all_specs):
                    # Download specialist markdown from S3 to extract formulas
                    formulas = None
                    if spec_out.markdown_s3_key:
                        try:
                            from app.services.s3_client import get_s3_client
                            s3 = get_s3_client()
                            obj = s3.get_object(
                                Bucket=settings.s3_bucket_name,
                                Key=spec_out.markdown_s3_key,
                            )
                            md_text = obj["Body"].read().decode("utf-8")
                            formulas = extract_formulas_and_examples(md_text)
                            if not formulas:
                                formulas = None
                        except Exception as e:
                            logger.warning(
                                "Failed to extract formulas from %s: %s",
                                spec_out.markdown_s3_key, e,
                            )

                    spec_data.append((i, ExaminerModuleInput(
                        summary=spec_out.summary or "",
                        key_concepts=list(spec_out.key_concepts),
                        exam_traps=list(spec_out.exam_traps or []),
                        formulas_and_examples=formulas,
                    )))

                # Parse exam profile from task if available
                from app.schemas.exam_profile import ExamProfile

                exam_profile = None
                if task.exam_profile_json:
                    try:
                        exam_profile = ExamProfile(**task.exam_profile_json)
                    except Exception as e:
                        logger.warning("Failed to parse exam_profile: %s", e)

                # Auto-infer default exam profile when none was provided
                if exam_profile is None:
                    course_name = None
                    try:
                        from app.models.material import Material
                        from app.models.course import Course

                        mat_course_id = (await session.execute(
                            select(Material.course_id)
                            .where(Material.id == task.material_id)
                        )).scalar_one_or_none()

                        if mat_course_id:
                            course = (await session.execute(
                                select(Course.name)
                                .where(Course.id == mat_course_id)
                            )).scalar_one_or_none()
                            if course:
                                course_name = course  # scalar = name string
                    except Exception as e:
                        logger.warning("Failed to query course name for default exam profile: %s", e)

                    course_type = course_name or "humanities"
                    exam_profile = ExamProfile.default_for_course_type(course_type)
                    logger.info(
                        "Using default exam profile for course_type=%r (course_name=%r): %d question types",
                        course_type, course_name,
                        len(exam_profile.question_distribution),
                    )

                exam_result = await run_examiner_v2_iterative(
                    plan=plan,
                    specialist_results=spec_data,
                    llm=llm,
                    run_id=run_id,
                    exam_profile=exam_profile,
                    rounds=3,
                )

                exam_data = exam_result.data
                session.add(QuizData(
                    task_id=task_id,
                    questions=[q.model_dump() for q in exam_data.questions],
                    total_questions=len(exam_data.questions),
                    schema_version=2,
                    source_module_ids=[m.id for m in db_modules],
                    prompt_version=exam_result.prompt_version,
                    model_used=exam_result.model,
                    input_tokens=exam_result.input_tokens,
                    output_tokens=exam_result.output_tokens,
                    latency_ms=exam_result.latency_ms,
                    run_id=exam_result.run_id,
                ))
                await session.commit()

            # ── DONE ──────────────────────────────────────────
            await _update_task(
                session, task_id,
                status="completed",
                phase="done",
                progress=1.0,
                completed_at=datetime.now(timezone.utc),
            )
            _publish_progress(redis_client, task_id_str, "done", 1.0, "分析完成",
                             status="completed")
            logger.info("Pipeline completed for task %s", task_id_str)

        except (PDFParseError, LLMError) as e:
            logger.error("Pipeline failed at phase %s: %s", task.phase, e)
            # Get current phase from DB (may have been updated)
            await session.refresh(task)
            await _update_task(
                session, task_id,
                status="failed",
                error_phase=task.phase,
                error_message=str(e),
            )
            _publish_progress(
                redis_client, task_id_str, task.phase, float(task.progress),
                f"分析失败: {e}",
                status="failed",
            )

        except Exception as e:
            logger.exception("Unexpected pipeline error for task %s", task_id_str)
            await session.refresh(task)
            await _update_task(
                session, task_id,
                status="failed",
                error_phase=task.phase or "unknown",
                error_message=f"Unexpected error: {type(e).__name__}: {e}",
            )
            _publish_progress(
                redis_client, task_id_str, task.phase or "unknown", 0.0,
                "分析异常终止",
                status="failed",
            )

        finally:
            redis_client.close()


@celery.task(
    bind=True,
    name="pipeline.run",
    max_retries=2,
    soft_time_limit=3600,  # 60 min for large materials (JSON fallback retries are slow)
    time_limit=3660,
)
def run_pipeline(self: Task, task_id: str):
    """Celery entry point — runs the async pipeline in a fresh event loop.

    We dispose the SQLAlchemy engine pool before each run to avoid
    "Future attached to a different loop" errors when asyncio.run()
    creates a new event loop.
    """
    from app.db.session import engine
    try:
        # Dispose stale connections from any previous event loop
        asyncio.get_event_loop_policy().get_event_loop()
    except RuntimeError:
        pass
    finally:
        asyncio.run(_dispose_and_run(task_id))


async def _dispose_and_run(task_id: str):
    """Dispose engine pool (to clear old-loop connections), then run pipeline."""
    from app.db.session import engine
    await engine.dispose()
    await _run_pipeline_async(task_id)


