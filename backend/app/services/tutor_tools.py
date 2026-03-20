"""Tutor MVP tools — get_specialist, get_quiz.

Each tool does direct DB queries and returns a unified TutorToolResult.
No tool calls other tools. Each has a 15s implicit timeout at the caller.
"""

import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.disassembly import (
    DisassemblyModule,
    DisassemblyTask,
    QuizData,
    SpecialistOutput,
)
from app.schemas.tutor import TutorToolError, TutorToolResult
from app.services.s3_client import get_s3_client
from app.core.config import settings

logger = logging.getLogger(__name__)

MAX_SPECIALIST_CHARS = 6000
MAX_QUIZ_QUESTIONS = 5


# ── Helpers ──────────────────────────────────────────────────────

async def _find_completed_task(
    db: AsyncSession,
    material_id: uuid.UUID,
    user_id: uuid.UUID,
) -> DisassemblyTask | None:
    """Find the latest completed task for a material owned by user."""
    result = await db.execute(
        select(DisassemblyTask)
        .where(
            DisassemblyTask.material_id == material_id,
            DisassemblyTask.user_id == user_id,
            DisassemblyTask.status == "completed",
        )
        .order_by(DisassemblyTask.created_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _load_specialist_markdown(s3_key: str) -> str | None:
    """Load specialist markdown from S3."""
    try:
        s3 = get_s3_client()
        resp = s3.get_object(Bucket=settings.s3_bucket_name, Key=s3_key)
        return resp["Body"].read().decode("utf-8")
    except Exception as e:
        logger.warning("Failed to load specialist markdown from S3: %s", e)
        return None


def _normalize_module_name(name: str) -> str:
    """Normalize module name for fuzzy matching."""
    return name.strip().lower().replace(" ", "").replace("_", "")


async def _find_module_by_hint(
    db: AsyncSession,
    task_id: uuid.UUID,
    module_hint: str,
) -> DisassemblyModule | None:
    """Find a module by fuzzy matching on name."""
    modules = (
        await db.execute(
            select(DisassemblyModule)
            .where(DisassemblyModule.task_id == task_id)
            .order_by(DisassemblyModule.sort_order)
        )
    ).scalars().all()

    hint_norm = _normalize_module_name(module_hint)
    for m in modules:
        if hint_norm in _normalize_module_name(m.name):
            return m
    return None


# ── get_specialist ───────────────────────────────────────────────

async def get_specialist(
    db: AsyncSession,
    material_id: uuid.UUID,
    user_id: uuid.UUID,
    module_id: uuid.UUID | None = None,
    module_hint: str | None = None,
) -> TutorToolResult:
    """Fetch specialist lecture notes for a module.

    Priority: module_id > module_hint > first module by sort_order.
    Returns truncated markdown + metadata.
    """
    scope = {"material_id": str(material_id)}

    # 1. Find completed task
    task = await _find_completed_task(db, material_id, user_id)
    if not task:
        return TutorToolResult(
            ok=False,
            tool_name="get_specialist",
            scope=scope,
            error=TutorToolError(
                code="NO_ANALYSIS",
                message="该材料尚未完成分析，请先在工具面板运行分析。",
            ),
        )

    # 2. Resolve module
    target_module: DisassemblyModule | None = None

    if module_id:
        target_module = (
            await db.execute(
                select(DisassemblyModule).where(
                    DisassemblyModule.id == module_id,
                    DisassemblyModule.task_id == task.id,
                )
            )
        ).scalar_one_or_none()
    elif module_hint:
        target_module = await _find_module_by_hint(db, task.id, module_hint)

    # Fallback: first module
    if not target_module:
        target_module = (
            await db.execute(
                select(DisassemblyModule)
                .where(DisassemblyModule.task_id == task.id)
                .order_by(DisassemblyModule.sort_order)
                .limit(1)
            )
        ).scalar_one_or_none()

    if not target_module:
        return TutorToolResult(
            ok=False,
            tool_name="get_specialist",
            scope=scope,
            error=TutorToolError(
                code="NO_MODULES",
                message="分析结果中没有找到模块。",
            ),
        )

    scope["module_id"] = str(target_module.id)
    scope["module_name"] = target_module.name

    # 3. Load specialist output
    spec = (
        await db.execute(
            select(SpecialistOutput).where(
                SpecialistOutput.module_id == target_module.id,
            )
        )
    ).scalar_one_or_none()

    if not spec:
        return TutorToolResult(
            ok=False,
            tool_name="get_specialist",
            scope=scope,
            error=TutorToolError(
                code="NO_SPECIALIST",
                message=f"模块「{target_module.name}」暂无精讲内容。",
            ),
        )

    # Load markdown from S3
    markdown = ""
    if spec.markdown_s3_key:
        markdown = await _load_specialist_markdown(spec.markdown_s3_key) or ""

    # Truncate for context window
    if len(markdown) > MAX_SPECIALIST_CHARS:
        markdown = markdown[:MAX_SPECIALIST_CHARS] + "\n\n…（内容过长，已截断）"

    return TutorToolResult(
        ok=True,
        tool_name="get_specialist",
        scope=scope,
        data={
            "module_name": target_module.name,
            "module_description": target_module.description or "",
            "exam_weight": target_module.exam_weight,
            "page_range": f"{target_module.page_range_start}-{target_module.page_range_end}",
            "markdown": markdown,
            "summary": spec.summary or "",
            "key_concepts": list(spec.key_concepts or []),
            "exam_traps": list(spec.exam_traps or []),
        },
    )


# ── get_quiz ─────────────────────────────────────────────────────

async def get_quiz(
    db: AsyncSession,
    material_id: uuid.UUID,
    user_id: uuid.UUID,
    module_id: uuid.UUID | None = None,
    module_hint: str | None = None,
) -> TutorToolResult:
    """Fetch quiz questions for a material (read-only, no scoring).

    If module_hint is provided, filters by source_module_name.
    Otherwise returns first MAX_QUIZ_QUESTIONS questions (stable order).
    """
    scope = {"material_id": str(material_id)}

    # 1. Find completed task
    task = await _find_completed_task(db, material_id, user_id)
    if not task:
        return TutorToolResult(
            ok=False,
            tool_name="get_quiz",
            scope=scope,
            error=TutorToolError(
                code="NO_ANALYSIS",
                message="该材料尚未完成分析，请先在工具面板运行分析。",
            ),
        )

    # 2. Load quiz data
    quiz = (
        await db.execute(
            select(QuizData).where(QuizData.task_id == task.id)
        )
    ).scalar_one_or_none()

    if not quiz or not quiz.questions:
        return TutorToolResult(
            ok=False,
            tool_name="get_quiz",
            scope=scope,
            error=TutorToolError(
                code="NO_QUIZ",
                message="该材料暂无测验题目。",
            ),
        )

    questions = quiz.questions  # JSONB list[dict]
    module_matched = False
    selection_mode = "all"

    # 3. Filter by module if hint provided
    resolved_hint = module_hint
    if module_id and not module_hint:
        # Resolve module_id to name for filtering
        mod = (
            await db.execute(
                select(DisassemblyModule.name).where(
                    DisassemblyModule.id == module_id,
                )
            )
        ).scalar_one_or_none()
        if mod:
            resolved_hint = mod

    if resolved_hint:
        hint_norm = _normalize_module_name(resolved_hint)
        filtered = [
            q for q in questions
            if "source_module_name" in q
            and hint_norm in _normalize_module_name(q["source_module_name"])
        ]
        if filtered:
            questions = filtered
            module_matched = True
            selection_mode = "module_filtered"

    # 4. Limit to MAX_QUIZ_QUESTIONS (stable order, no random)
    questions = questions[:MAX_QUIZ_QUESTIONS]

    scope["questions_count"] = len(questions)

    return TutorToolResult(
        ok=True,
        tool_name="get_quiz",
        scope=scope,
        data={
            "questions": questions,
            "questions_count": len(questions),
            "total_available": quiz.total_questions,
            "module_matched": module_matched,
            "selection_mode": selection_mode,
        },
    )


# ── Tool Registry ───────────────────────────────────────────────

TOOL_REGISTRY = {
    "get_specialist": get_specialist,
    "get_quiz": get_quiz,
}


async def run_tool(
    tool_name: str,
    db: AsyncSession,
    material_id: uuid.UUID,
    user_id: uuid.UUID,
    module_id: uuid.UUID | None = None,
    module_hint: str | None = None,
) -> TutorToolResult:
    """Execute a tool by name. Returns TutorToolResult (never raises)."""
    func = TOOL_REGISTRY.get(tool_name)
    if not func:
        return TutorToolResult(
            ok=False,
            tool_name=tool_name,
            error=TutorToolError(
                code="UNKNOWN_TOOL",
                message=f"Unknown tool: {tool_name}",
            ),
        )
    try:
        return await func(
            db=db,
            material_id=material_id,
            user_id=user_id,
            module_id=module_id,
            module_hint=module_hint,
        )
    except Exception as e:
        logger.exception("Tool %s failed: %s", tool_name, e)
        return TutorToolResult(
            ok=False,
            tool_name=tool_name,
            error=TutorToolError(
                code="TOOL_ERROR",
                message=f"工具执行失败: {str(e)[:200]}",
                retryable=True,
            ),
        )
