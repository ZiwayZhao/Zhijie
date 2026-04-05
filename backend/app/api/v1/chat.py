"""Chat endpoints — Socratic dialogue + Knowledge Q&A (SSE streaming)."""

import json
import logging
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sse_starlette.sse import EventSourceResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.db.session import get_db
from app.models.disassembly import (
    DisassemblyModule,
    DisassemblyTask,
    SpecialistOutput,
)
from app.models.user import User
from app.services.llm_client import get_llm_client
from app.services.s3_client import get_s3_client
from app.core.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["chat"])

# ── Models ────────────────────────────────────────────────────────

CHAT_MODEL = "glm-4.7"
MAX_CONTEXT_CHARS = 8000
MAX_HISTORY_TURNS = 20  # Prevent excessive context

VALID_ROLES = {"user", "assistant"}


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class SocraticChatRequest(BaseModel):
    module_id: str
    module_name: str
    user_message: str
    scaffold_level: Literal["full", "moderate", "minimal"] = "moderate"
    mastery: float = 0.3
    conversation_history: list[ChatMessage] = []
    specialist_context: str = ""

    @field_validator("conversation_history")
    @classmethod
    def limit_history(cls, v: list[ChatMessage]) -> list[ChatMessage]:
        return v[-MAX_HISTORY_TURNS:] if len(v) > MAX_HISTORY_TURNS else v

    @field_validator("mastery")
    @classmethod
    def clamp_mastery(cls, v: float) -> float:
        return max(0.0, min(1.0, v))


class KnowledgeQARequest(BaseModel):
    material_id: uuid.UUID
    question: str
    conversation_history: list[ChatMessage] = []

    @field_validator("conversation_history")
    @classmethod
    def limit_history(cls, v: list[ChatMessage]) -> list[ChatMessage]:
        return v[-MAX_HISTORY_TURNS:] if len(v) > MAX_HISTORY_TURNS else v


# ── Scaffold instructions ─────────────────────────────────────────

_SCAFFOLD = {
    "full": "手把手引导：分解问题为更小步骤，使用类比和生活例子，多鼓励",
    "moderate": "讨论模式：追问深度，要求学生用自己的话总结，给出方向性提示",
    "minimal": "挑战模式：提出反例，要求跨概念关联，尽量少提示",
}

SOCRATIC_SYSTEM = """你是一位苏格拉底式 AI 教练，辅导大学生学习。

核心原则：
- 永远不直接给答案，用提问引导学生自己发现
- 每次回复最多提出 1-2 个引导性问题
- 认可在前纠正在后
- 禁止说"很好的问题！"

当前脚手架等级：{scaffold_level}
{scaffold_instructions}

当前模块：{module_name}
学生掌握度：{mastery}%

知识背景：
{specialist_context}

回复要求：
- 控制在 200 字以内
- 使用中文回复
- 可以用 LaTeX 公式（$行内$ 或 $$独立$$）
"""

KNOWLEDGE_QA_SYSTEM = """你是一位耐心的大学课程助教，基于给定的课程材料回答学生问题。

规则：
- 只基于提供的材料内容回答，不编造信息
- 如果材料中没有相关内容，诚实说明
- 可以用 LaTeX 公式（$行内$ 或 $$独立$$）
- 使用中文回复
- 回复控制在 300 字以内

课程材料内容：
{specialist_context}
"""


# ── Helpers ───────────────────────────────────────────────────────

def _truncate(text: str, max_chars: int = MAX_CONTEXT_CHARS) -> str:
    """Truncate text to max characters to prevent token overflow."""
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + "\n\n…（内容过长，已截断）"


async def _stream_sse(system: str, messages: list[dict]):
    """Shared SSE generator for both chat endpoints."""
    client = get_llm_client()
    total_tokens = 0
    try:
        async for token in client.stream_text(
            model=CHAT_MODEL,
            system=system,
            messages=messages,
            max_tokens=2048,
        ):
            total_tokens += 1
            yield {
                "event": "token",
                "data": json.dumps({"content": token}, ensure_ascii=False),
            }
        yield {
            "event": "done",
            "data": json.dumps(
                {"content": "", "total_tokens": total_tokens},
                ensure_ascii=False,
            ),
        }
    except Exception as e:
        logger.exception("Chat stream error: %s", e)
        yield {
            "event": "error",
            "data": json.dumps(
                {"message": str(e)[:200]}, ensure_ascii=False,
            ),
        }


# ── POST /chat/socratic ──────────────────────────────────────────

@router.post("/socratic")
async def socratic_chat(
    body: SocraticChatRequest,
    user: User = Depends(get_current_user),
):
    """SSE stream for Socratic dialogue."""
    mastery_pct = round(body.mastery * 100, 1)
    system = SOCRATIC_SYSTEM.format(
        scaffold_level=body.scaffold_level,
        scaffold_instructions=_SCAFFOLD[body.scaffold_level],
        module_name=body.module_name,
        mastery=mastery_pct,
        specialist_context=_truncate(body.specialist_context),
    )

    history = [m.model_dump() for m in body.conversation_history]
    messages = history + [
        {"role": "user", "content": body.user_message},
    ]

    return EventSourceResponse(_stream_sse(system, messages))


# ── POST /chat/knowledge-qa ──────────────────────────────────────

@router.post("/knowledge-qa")
async def knowledge_qa(
    body: KnowledgeQARequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """SSE stream for knowledge Q&A based on material specialist outputs."""
    # 1. Find completed task for this material
    task = (
        await db.execute(
            select(DisassemblyTask)
            .where(
                DisassemblyTask.material_id == body.material_id,
                DisassemblyTask.status == "completed",
            )
            .order_by(DisassemblyTask.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()

    if not task:
        raise HTTPException(
            status_code=404,
            detail="No completed analysis found for this material",
        )

    # 2. Load all specialist outputs for this task's modules
    modules = (
        await db.execute(
            select(DisassemblyModule.id)
            .where(DisassemblyModule.task_id == task.id)
            .order_by(DisassemblyModule.sort_order)
        )
    ).scalars().all()

    specialist_parts: list[str] = []
    total_chars = 0
    for module_id in modules:
        if total_chars >= MAX_CONTEXT_CHARS:
            break
        spec = (
            await db.execute(
                select(SpecialistOutput).where(
                    SpecialistOutput.module_id == module_id
                )
            )
        ).scalar_one_or_none()
        if not spec:
            continue

        md = spec.markdown_content
        if not md and spec.markdown_s3_key:
            try:
                s3 = get_s3_client()
                resp = s3.get_object(
                    Bucket=settings.s3_bucket_name,
                    Key=spec.markdown_s3_key,
                )
                md = resp["Body"].read().decode("utf-8")
            except Exception as e:
                logger.warning("Failed to fetch specialist markdown: %s", e)
                continue
        if md:
            remaining = MAX_CONTEXT_CHARS - total_chars
            specialist_parts.append(md[:remaining])
            total_chars += len(md[:remaining])

    if not specialist_parts:
        raise HTTPException(
            status_code=404,
            detail="No specialist content available for this material",
        )

    specialist_context = "\n\n---\n\n".join(specialist_parts)
    system = KNOWLEDGE_QA_SYSTEM.format(
        specialist_context=specialist_context,
    )

    history = [m.model_dump() for m in body.conversation_history]
    messages = history + [
        {"role": "user", "content": body.question},
    ]

    return EventSourceResponse(_stream_sse(system, messages))
