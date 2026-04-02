"""Session Memory Extractor — automatic extraction of learning session memories.

Extracts structured knowledge-tracking data from tutor conversations using LLM.
Inspired by Claude Code's dual-condition memory model:
  - Initial extraction at ~8K tokens
  - Incremental every ~4K additional tokens or 3 Socratic exchanges
  - Topic transition detection

Usage:
    extractor = SessionMemoryExtractor()
    if extractor.should_extract(messages, last_extraction_tokens=0):
        memory = await extractor.extract(messages, session_id, material_id)
        student_ctx = extractor.to_student_context(memory)
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field

from pydantic import BaseModel, Field

from app.services.llm_client import get_llm_client, LLMError

logger = logging.getLogger(__name__)

# Use the same cheap model as context_compressor
EXTRACT_MODEL = "z-ai/glm-4.7-flash"

# ── Trigger thresholds ──────────────────────────────────────────

INITIAL_EXTRACT_TOKENS = 8_000       # First extraction at ~8K tokens
INCREMENTAL_EXTRACT_TOKENS = 4_000   # Then every ~4K additional
SOCRATIC_EXCHANGE_TRIGGER = 3        # Or every 3 Socratic exchanges


# ── Pydantic schema for LLM structured output ──────────────────

class ExtractedMemory(BaseModel):
    """Pydantic schema for LLM extraction — used with structured_output."""
    covered_knowledge_points: list[str] = Field(
        default_factory=list,
        description="本次对话中讨论过的知识点列表",
    )
    mastery_estimates: dict[str, int] = Field(
        default_factory=dict,
        description="知识点名称 -> 估计掌握度 0-100，如 {\"JOIN\": 70, \"NULL\": 40}",
    )
    resolved_confusions: list[str] = Field(
        default_factory=list,
        description="已经解决的困惑列表",
    )
    unresolved_confusions: list[str] = Field(
        default_factory=list,
        description="尚未解决的困惑列表",
    )
    confusion_pairs: list[list[str]] = Field(
        default_factory=list,
        description="学生容易混淆的概念对，如 [[\"Natural Join\", \"Equijoin\"]]",
    )
    current_module: str | None = Field(
        default=None,
        description="学生当前学习到的模块/章节名称",
    )
    teaching_summary: str = Field(
        default="",
        description="1-2句话总结本次教学会话内容",
    )


# ── Dataclass for internal use ──────────────────────────────────

@dataclass
class SessionMemory:
    """Extracted memory from a learning session."""
    session_id: str
    material_id: str

    # Knowledge tracking
    covered_kps: list[str] = field(default_factory=list)
    mastery_updates: dict[str, int] = field(default_factory=dict)

    # Confusion tracking
    resolved_confusions: list[str] = field(default_factory=list)
    unresolved_confusions: list[str] = field(default_factory=list)
    confusion_pairs: list[tuple[str, str]] = field(default_factory=list)

    # Context
    current_module: str | None = None
    teaching_context: str = ""

    # Meta
    extracted_at: float = 0.0
    token_count: int = 0


# ── Extraction prompt ───────────────────────────────────────────

EXTRACTION_SYSTEM_PROMPT = """你是一个学习分析助手。请分析以下AI辅导对话，提取结构化的学习记忆。

分析维度：
1. **知识点覆盖**：对话中讨论了哪些知识点？列出具体名称。
2. **掌握度估计**：根据学生的回答质量，估计每个知识点的掌握度（0-100%）。
   - 0-30%: 完全不了解或严重错误
   - 30-50%: 有模糊印象但不准确
   - 50-70%: 基本理解但有细节错误
   - 70-90%: 较好掌握，偶有小错
   - 90-100%: 完全掌握，能举一反三
3. **已解决困惑**：学生提出的问题中，哪些已经得到满意解答？
4. **未解决困惑**：哪些问题学生仍然困惑或未完全理解？
5. **易混淆概念**：学生是否表现出对某些概念对的混淆？
6. **当前位置**：学生现在学到哪个模块/章节？
7. **教学总结**：用1-2句话总结本次教学进展。

请严格基于对话内容分析，不要臆测。如果某个维度在对话中没有体现，留空即可。"""


# ── Extractor ───────────────────────────────────────────────────

def _estimate_tokens(messages: list[dict]) -> int:
    """Rough token estimate: 1 token ~ 2 Chinese chars or 4 English chars."""
    total_chars = sum(len(m.get("content", "")) for m in messages)
    return total_chars // 2


def _count_socratic_exchanges(messages: list[dict]) -> int:
    """Count question-answer pairs where assistant asks a question.

    A Socratic exchange = assistant message ending with '？' followed by
    a user response.
    """
    count = 0
    for i, msg in enumerate(messages):
        if msg.get("role") != "assistant":
            continue
        content = msg.get("content", "").strip()
        if not content.endswith("？") and not content.endswith("?"):
            continue
        # Check if next message is user response
        if i + 1 < len(messages) and messages[i + 1].get("role") == "user":
            count += 1
    return count


class SessionMemoryExtractor:
    """Extract structured memories from tutor conversation history.

    Triggers (dual-condition model):
    - Initial: when conversation reaches ~8K tokens
    - Incremental: every ~4K additional tokens or 3 Socratic exchanges
    - Always callable manually via extract()
    """

    def should_extract(
        self,
        messages: list[dict],
        last_extraction_tokens: int,
        last_extraction_exchanges: int = 0,
    ) -> bool:
        """Check if extraction should be triggered.

        Args:
            messages: Current conversation messages.
            last_extraction_tokens: Token count at last extraction (0 = never extracted).
            last_extraction_exchanges: Socratic exchange count at last extraction.

        Returns:
            True if extraction should run.
        """
        if not messages:
            return False

        current_tokens = _estimate_tokens(messages)

        # Initial extraction
        if last_extraction_tokens == 0:
            return current_tokens >= INITIAL_EXTRACT_TOKENS

        # Incremental: token delta
        token_delta = current_tokens - last_extraction_tokens
        if token_delta >= INCREMENTAL_EXTRACT_TOKENS:
            return True

        # Incremental: Socratic exchange count
        current_exchanges = _count_socratic_exchanges(messages)
        exchange_delta = current_exchanges - last_extraction_exchanges
        if exchange_delta >= SOCRATIC_EXCHANGE_TRIGGER:
            return True

        return False

    async def extract(
        self,
        messages: list[dict],
        session_id: str,
        material_id: str,
    ) -> SessionMemory:
        """Extract memory from conversation messages using LLM.

        Args:
            messages: Conversation messages [{role, content}, ...].
            session_id: Session identifier.
            material_id: Material identifier.

        Returns:
            SessionMemory with extracted data. On LLM failure, returns
            a minimal memory with just token count.
        """
        current_tokens = _estimate_tokens(messages)

        # Build conversation text for extraction
        history_lines: list[str] = []
        for msg in messages:
            role = msg.get("role", "unknown")
            content = msg.get("content", "")
            label = "学生" if role == "user" else "老师"
            history_lines.append(f"[{label}]: {content}")

        history_text = "\n".join(history_lines)
        # Cap input to avoid excessive cost on the cheap model
        if len(history_text) > 16_000:
            history_text = history_text[-16_000:]

        try:
            llm = get_llm_client()
            result = await llm.structured_output(
                model=EXTRACT_MODEL,
                system=EXTRACTION_SYSTEM_PROMPT,
                messages=[{"role": "user", "content": history_text}],
                response_schema=ExtractedMemory,
                prompt_version="session_memory_v1",
                max_tokens=2048,
                max_retries=2,
            )
            extracted: ExtractedMemory = result.data

            # Convert confusion_pairs from list[list[str]] to list[tuple[str, str]]
            pairs: list[tuple[str, str]] = []
            for pair in extracted.confusion_pairs:
                if len(pair) == 2:
                    pairs.append((pair[0], pair[1]))

            return SessionMemory(
                session_id=session_id,
                material_id=material_id,
                covered_kps=extracted.covered_knowledge_points,
                mastery_updates=extracted.mastery_estimates,
                resolved_confusions=extracted.resolved_confusions,
                unresolved_confusions=extracted.unresolved_confusions,
                confusion_pairs=pairs,
                current_module=extracted.current_module,
                teaching_context=extracted.teaching_summary,
                extracted_at=time.time(),
                token_count=current_tokens,
            )

        except (LLMError, Exception) as exc:
            logger.warning(
                "Session memory extraction failed (%s), returning minimal memory",
                exc,
            )
            return SessionMemory(
                session_id=session_id,
                material_id=material_id,
                extracted_at=time.time(),
                token_count=current_tokens,
            )

    def to_student_context(self, memory: SessionMemory) -> "StudentContext":
        """Convert extracted memory into StudentContext for prompt injection.

        Returns a StudentContext dataclass that can be passed to
        TutorPromptBuilder.build(student_ctx=...).
        """
        from app.services.prompt_builder import StudentContext

        # Format mastery summary
        mastery_lines: list[str] = []
        for kp, pct in memory.mastery_updates.items():
            mastery_lines.append(f"- {kp}: {pct}%")
        mastery_summary = "\n".join(mastery_lines) if mastery_lines else ""

        # Format AI inference from confusion data
        inference_parts: list[str] = []
        if memory.unresolved_confusions:
            items = "、".join(memory.unresolved_confusions[:5])
            inference_parts.append(f"仍困惑于：{items}")
        if memory.confusion_pairs:
            pair_strs = [f"{a} vs {b}" for a, b in memory.confusion_pairs[:3]]
            inference_parts.append(f"易混淆概念：{'、'.join(pair_strs)}")
        ai_inference = "；".join(inference_parts) if inference_parts else ""

        # Format confusion records
        confusion_lines: list[str] = []
        if memory.resolved_confusions:
            confusion_lines.append("已解决：" + "、".join(memory.resolved_confusions[:5]))
        if memory.unresolved_confusions:
            confusion_lines.append("未解决：" + "、".join(memory.unresolved_confusions[:5]))
        confusion_records = "\n".join(confusion_lines) if confusion_lines else ""

        return StudentContext(
            mastery_summary=mastery_summary,
            ai_inference=ai_inference,
            confusion_records=confusion_records,
        )


# ── Persistence helpers ─────────────────────────────────────────

def memory_to_dict(memory: SessionMemory) -> dict:
    """Serialize SessionMemory for JSON storage (e.g. JSONB column)."""
    return {
        "session_id": memory.session_id,
        "material_id": memory.material_id,
        "covered_kps": memory.covered_kps,
        "mastery_updates": memory.mastery_updates,
        "resolved_confusions": memory.resolved_confusions,
        "unresolved_confusions": memory.unresolved_confusions,
        "confusion_pairs": [list(pair) for pair in memory.confusion_pairs],
        "current_module": memory.current_module,
        "teaching_context": memory.teaching_context,
        "extracted_at": memory.extracted_at,
        "token_count": memory.token_count,
    }


def memory_from_dict(data: dict) -> SessionMemory:
    """Deserialize SessionMemory from JSON storage."""
    pairs_raw = data.get("confusion_pairs", [])
    pairs: list[tuple[str, str]] = []
    for pair in pairs_raw:
        if isinstance(pair, (list, tuple)) and len(pair) == 2:
            pairs.append((pair[0], pair[1]))

    return SessionMemory(
        session_id=data.get("session_id", ""),
        material_id=data.get("material_id", ""),
        covered_kps=data.get("covered_kps", []),
        mastery_updates=data.get("mastery_updates", {}),
        resolved_confusions=data.get("resolved_confusions", []),
        unresolved_confusions=data.get("unresolved_confusions", []),
        confusion_pairs=pairs,
        current_module=data.get("current_module"),
        teaching_context=data.get("teaching_context", ""),
        extracted_at=data.get("extracted_at", 0.0),
        token_count=data.get("token_count", 0),
    )
