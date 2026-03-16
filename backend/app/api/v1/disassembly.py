"""Disassembly pipeline REST API + SSE endpoints."""

import asyncio
import json
import logging
import uuid

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sse_starlette.sse import EventSourceResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import get_db
from app.core.security import get_current_user
from app.models.disassembly import (
    DisassemblyModule,
    DisassemblyTask,
    QuizData,
    SpecialistOutput,
)
from app.models.material import Material
from app.models.user import User
from app.schemas.disassembly import (
    DisassemblyErrorCode,
    DisassemblyResultResponse,
    MCQuestion,
    ModuleDetailResponse,
    ModuleDependencyResponse,
    ModuleSummary,
    QuizResponse,
    SpecialistResponse,
    SSEProgressEvent,
    StartAnalysisRequest,
    StartAnalysisResponse,
    TaskStatusResponse,
)
from app.services.s3_client import get_s3_client
from app.workers.pipeline_worker import run_pipeline

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/disassembly", tags=["disassembly"])

SSE_TIMEOUT_SECONDS = 600  # 10 minutes


# ── Helpers ───────────────────────────────────────────────────────

async def _get_task_or_404(
    task_id: uuid.UUID,
    user: User,
    db: AsyncSession,
) -> DisassemblyTask:
    """Load task, verify ownership."""
    task = await db.get(DisassemblyTask, task_id)
    if not task or task.user_id != user.id:
        raise HTTPException(
            status_code=404,
            detail={
                "code": DisassemblyErrorCode.TASK_NOT_FOUND,
                "detail": "Task not found",
            },
        )
    return task


# ── POST /disassembly/start ──────────────────────────────────────

@router.post("/start", response_model=StartAnalysisResponse, status_code=201)
async def start_analysis(
    body: StartAnalysisRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Start material analysis pipeline."""
    # Check material exists and belongs to user
    material = await db.get(Material, body.material_id)
    if not material or material.user_id != user.id:
        raise HTTPException(
            status_code=404,
            detail={
                "code": DisassemblyErrorCode.MATERIAL_NOT_FOUND,
                "detail": "Material not found",
            },
        )

    # Check material is PDF
    if material.content_type != "application/pdf":
        raise HTTPException(
            status_code=400,
            detail={
                "code": DisassemblyErrorCode.MATERIAL_NOT_PDF,
                "detail": "Only PDF materials can be analyzed",
            },
        )

    # Check no running task for this material
    # Race condition prevented by partial unique index (idx_dtask_material_active)
    running = (await db.execute(
        select(DisassemblyTask.id)
        .where(
            DisassemblyTask.material_id == body.material_id,
            DisassemblyTask.status.in_(["pending", "running"]),
        )
    )).scalar_one_or_none()

    if running:
        raise HTTPException(
            status_code=409,
            detail={
                "code": DisassemblyErrorCode.ANALYSIS_ALREADY_RUNNING,
                "detail": "Analysis already in progress for this material",
            },
        )

    # Create task (partial unique index prevents concurrent duplicates)
    run_id = uuid.uuid4().hex
    task = DisassemblyTask(
        material_id=body.material_id,
        user_id=user.id,
        run_id=run_id,
    )
    db.add(task)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail={
                "code": DisassemblyErrorCode.ANALYSIS_ALREADY_RUNNING,
                "detail": "Analysis already in progress for this material (concurrent request)",
            },
        )
    await db.refresh(task)

    # Trigger Celery worker
    celery_result = run_pipeline.delay(str(task.id))
    task.celery_task_id = celery_result.id
    await db.commit()

    return StartAnalysisResponse(
        task_id=task.id,
        status=task.status,
        phase=task.phase,
    )


# ── GET /disassembly/{task_id}/status (SSE) ──────────────────────

@router.get("/tasks/{task_id}/status")
async def task_status_sse(
    task_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """SSE stream for pipeline progress.

    First sends current DB state, then subscribes to Redis Pub/Sub for real-time updates.
    """
    task = await _get_task_or_404(task_id, user, db)

    async def event_generator():
        # 1. Send current DB state immediately
        initial = TaskStatusResponse.model_validate(task)
        yield {
            "event": "status",
            "data": initial.model_dump_json(),
        }

        # If already terminal, stop
        if task.status in ("completed", "failed", "cancelled"):
            return

        # 2. Subscribe to Redis Pub/Sub
        redis_client = aioredis.from_url(settings.redis_url, decode_responses=True)
        pubsub = redis_client.pubsub()
        channel = f"pipeline:{task_id}"

        try:
            await pubsub.subscribe(channel)

            deadline = asyncio.get_event_loop().time() + SSE_TIMEOUT_SECONDS
            while asyncio.get_event_loop().time() < deadline:
                message = await pubsub.get_message(
                    ignore_subscribe_messages=True,
                    timeout=5.0,
                )
                if message and message["type"] == "message":
                    data = json.loads(message["data"])
                    yield {
                        "event": "progress",
                        "data": json.dumps(data),
                    }
                    # Check for terminal events
                    phase = data.get("phase", "")
                    status = data.get("status", "")
                    if phase == "done" or status in ("completed", "failed", "cancelled"):
                        break
                else:
                    # Heartbeat to keep connection alive
                    yield {"event": "heartbeat", "data": ""}

        finally:
            await pubsub.unsubscribe(channel)
            await pubsub.close()
            await redis_client.close()

    return EventSourceResponse(event_generator())


# ── GET /disassembly/{task_id}/result ─────────────────────────────

@router.get("/tasks/{task_id}/result", response_model=DisassemblyResultResponse)
async def task_result(
    task_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Get complete analysis result (only when completed)."""
    task = await _get_task_or_404(task_id, user, db)

    if task.status != "completed":
        raise HTTPException(
            status_code=400,
            detail={
                "code": DisassemblyErrorCode.TASK_NOT_COMPLETED,
                "detail": f"Task status is '{task.status}', not 'completed'",
            },
        )

    # Load modules
    modules = (await db.execute(
        select(DisassemblyModule)
        .where(DisassemblyModule.task_id == task_id)
        .order_by(DisassemblyModule.sort_order)
    )).scalars().all()

    # Check which have specialist outputs
    module_summaries = []
    for m in modules:
        has_spec = (await db.execute(
            select(SpecialistOutput.id).where(SpecialistOutput.module_id == m.id)
        )).scalar_one_or_none()
        module_summaries.append(ModuleSummary(
            id=m.id,
            name=m.name,
            description=m.description,
            page_range_start=m.page_range_start,
            page_range_end=m.page_range_end,
            exam_weight=m.exam_weight,
            sort_order=m.sort_order,
            has_specialist=has_spec is not None,
        ))

    # Load quiz
    quiz_row = (await db.execute(
        select(QuizData).where(QuizData.task_id == task_id)
    )).scalar_one_or_none()

    quiz = None
    if quiz_row:
        quiz = QuizResponse(
            id=quiz_row.id,
            task_id=quiz_row.task_id,
            schema_version=quiz_row.schema_version,
            questions=[MCQuestion.model_validate(q) for q in quiz_row.questions],
            total_questions=quiz_row.total_questions,
            model_used=quiz_row.model_used,
            prompt_version=quiz_row.prompt_version,
        )

    return DisassemblyResultResponse(
        task=TaskStatusResponse.model_validate(task),
        modules=module_summaries,
        quiz=quiz,
    )


# ── GET /disassembly/{task_id}/module/{module_id} ─────────────────

@router.get("/tasks/{task_id}/module/{module_id}", response_model=ModuleDetailResponse)
async def module_detail(
    task_id: uuid.UUID,
    module_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Get single module with specialist markdown (fetched from S3)."""
    task = await _get_task_or_404(task_id, user, db)

    module = await db.get(DisassemblyModule, module_id)
    if not module or module.task_id != task_id:
        raise HTTPException(
            status_code=404,
            detail={
                "code": DisassemblyErrorCode.MODULE_NOT_FOUND,
                "detail": "Module not found",
            },
        )

    # Load specialist output
    spec_row = (await db.execute(
        select(SpecialistOutput).where(SpecialistOutput.module_id == module_id)
    )).scalar_one_or_none()

    specialist = None
    if spec_row:
        # Fetch markdown from S3
        try:
            s3 = get_s3_client()
            response = s3.get_object(
                Bucket=settings.s3_bucket_name,
                Key=spec_row.markdown_s3_key,
            )
            markdown_content = response["Body"].read().decode("utf-8")
        except Exception as e:
            logger.error("Failed to fetch specialist markdown: %s", e)
            markdown_content = "(Failed to load lecture notes)"

        specialist = SpecialistResponse(
            id=spec_row.id,
            module_id=spec_row.module_id,
            markdown_content=markdown_content,
            summary=spec_row.summary,
            key_concepts=list(spec_row.key_concepts),
            exam_traps=list(spec_row.exam_traps or []),
            self_test_questions=spec_row.self_test_questions,
            model_used=spec_row.model_used,
            prompt_version=spec_row.prompt_version,
        )

    # Load dependencies
    from app.models.disassembly import ModuleDependency
    deps = (await db.execute(
        select(ModuleDependency).where(ModuleDependency.module_id == module_id)
    )).scalars().all()

    return ModuleDetailResponse(
        id=module.id,
        name=module.name,
        description=module.description,
        page_range_start=module.page_range_start,
        page_range_end=module.page_range_end,
        exam_weight=module.exam_weight,
        sort_order=module.sort_order,
        specialist=specialist,
        dependencies=[
            ModuleDependencyResponse(module_id=d.module_id, depends_on_id=d.depends_on_id)
            for d in deps
        ],
    )


# ── GET /materials/{material_id}/analysis ─────────────────────────

@router.get("/materials/{material_id}/latest", response_model=TaskStatusResponse | None)
async def latest_analysis(
    material_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Get the latest analysis task for a material."""
    task = (await db.execute(
        select(DisassemblyTask)
        .where(
            DisassemblyTask.material_id == material_id,
            DisassemblyTask.user_id == user.id,
        )
        .order_by(DisassemblyTask.created_at.desc())
        .limit(1)
    )).scalar_one_or_none()

    if not task:
        return None

    return TaskStatusResponse.model_validate(task)


# ── POST /disassembly/{task_id}/cancel ────────────────────────────

@router.post("/tasks/{task_id}/cancel")
async def cancel_analysis(
    task_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Cancel a running analysis task."""
    task = await _get_task_or_404(task_id, user, db)

    if task.status not in ("pending", "running"):
        raise HTTPException(
            status_code=400,
            detail={"detail": f"Cannot cancel task with status '{task.status}'"},
        )

    # Revoke Celery task
    if task.celery_task_id:
        from app.workers.celery_app import celery
        celery.control.revoke(task.celery_task_id, terminate=True)

    task.status = "cancelled"
    await db.commit()

    return {"status": "cancelled", "task_id": str(task_id)}
