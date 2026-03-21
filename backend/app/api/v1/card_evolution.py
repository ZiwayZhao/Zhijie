"""Card evolution API — LLM-driven flashcard improvement.

POST /flashcards/evolve: Given a trigger + note, generate evolved content.
"""

import logging

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.core.security import get_current_user
from app.models.user import User
from app.services.llm_client import get_llm_client, LLMError

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/flashcards", tags=["flashcards"])

EVOLUTION_MODEL = "z-ai/glm-4.7-flash"  # Fast, cheap


# ── Schemas ──────────────────────────────────────────────────────

class EvolveRequest(BaseModel):
    trigger_type: str  # consecutive-again | high-lapse-rate | slow-response
    note_front: str
    note_back: str
    note_tags: list[str] = []


class SplitCard(BaseModel):
    front: str
    back: str


class EvolveResponse(BaseModel):
    action: str  # split | rewrite | add-hint
    split_cards: list[SplitCard] | None = None
    rewritten_front: str | None = None
    rewritten_back: str | None = None
    hint: str | None = None


# ── Prompts ──────────────────────────────────────────────────────

SPLIT_PROMPT = """你是一个闪卡优化助手。学生反复忘记以下闪卡，说明内容太复杂。
请将它拆分为 2-3 张更简单的子卡片，每张只考查一个知识点。

原卡正面：{front}
原卡背面：{back}
标签：{tags}

要求：
- 每张子卡的正面是一个清晰的问题
- 背面是简洁的答案（不超过2句话）
- 用中文，学术术语保留原文"""

REWRITE_PROMPT = """你是一个闪卡优化助手。以下闪卡的遗忘率很高，可能是问法不好。
请改写正面和背面，换一种更容易理解和记忆的表述方式。

原卡正面：{front}
原卡背面：{back}
标签：{tags}

要求：
- 换一种问法，但考查同样的知识点
- 背面可以增加助记方法或类比
- 用中文，学术术语保留原文"""

HINT_PROMPT = """你是一个闪卡优化助手。学生回答以下闪卡的速度很慢。
请生成一个简短的记忆提示，帮助学生更快回忆答案。

原卡正面：{front}
原卡背面：{back}
标签：{tags}

要求：
- 提示不超过30字
- 不要直接给出答案
- 可以用助记、首字母缩写、类比等方式"""


# ── Endpoint ─────────────────────────────────────────────────────

@router.post("/evolve", response_model=EvolveResponse)
async def evolve_card(
    body: EvolveRequest,
    _user: User = Depends(get_current_user),
):
    """Generate LLM-driven card evolution based on trigger type."""
    llm = get_llm_client()
    tags_str = ", ".join(body.note_tags) if body.note_tags else "无"

    try:
        if body.trigger_type == "consecutive-again":
            # Split into sub-cards
            prompt = SPLIT_PROMPT.format(
                front=body.note_front, back=body.note_back, tags=tags_str,
            )
            result = await llm.structured_output(
                model=EVOLUTION_MODEL,
                system="你是闪卡优化助手，输出严格的JSON。",
                messages=[{"role": "user", "content": prompt}],
                response_schema=_SplitResponse,
                prompt_version="evolve_split_v1",
                max_tokens=512,
            )
            return EvolveResponse(
                action="split",
                split_cards=[
                    SplitCard(front=c.front, back=c.back)
                    for c in result.data.cards[:3]
                ],
            )

        elif body.trigger_type == "high-lapse-rate":
            # Rewrite
            prompt = REWRITE_PROMPT.format(
                front=body.note_front, back=body.note_back, tags=tags_str,
            )
            result = await llm.structured_output(
                model=EVOLUTION_MODEL,
                system="你是闪卡优化助手，输出严格的JSON。",
                messages=[{"role": "user", "content": prompt}],
                response_schema=_RewriteResponse,
                prompt_version="evolve_rewrite_v1",
                max_tokens=256,
            )
            return EvolveResponse(
                action="rewrite",
                rewritten_front=result.data.front,
                rewritten_back=result.data.back,
            )

        else:
            # slow-response → add hint
            prompt = HINT_PROMPT.format(
                front=body.note_front, back=body.note_back, tags=tags_str,
            )
            result = await llm.structured_output(
                model=EVOLUTION_MODEL,
                system="你是闪卡优化助手，输出严格的JSON。",
                messages=[{"role": "user", "content": prompt}],
                response_schema=_HintResponse,
                prompt_version="evolve_hint_v1",
                max_tokens=128,
            )
            return EvolveResponse(
                action="add-hint",
                hint=result.data.hint,
            )

    except LLMError as e:
        logger.warning("Card evolution LLM error: %s", e)
        # Fallback: return simple local transformation
        if body.trigger_type == "consecutive-again":
            return EvolveResponse(
                action="split",
                split_cards=[SplitCard(
                    front=f"{body.note_front}（简化版）",
                    back=body.note_back,
                )],
            )
        elif body.trigger_type == "high-lapse-rate":
            return EvolveResponse(
                action="rewrite",
                rewritten_front=f"请用自己的话解释：{body.note_front}",
                rewritten_back=body.note_back,
            )
        else:
            return EvolveResponse(
                action="add-hint",
                hint=f"提示：与「{body.note_tags[0] if body.note_tags else '本知识点'}」相关",
            )


# ── Internal Pydantic models for LLM structured output ──────────

class _SplitCard(BaseModel):
    front: str
    back: str

class _SplitResponse(BaseModel):
    cards: list[_SplitCard]

class _RewriteResponse(BaseModel):
    front: str
    back: str

class _HintResponse(BaseModel):
    hint: str
