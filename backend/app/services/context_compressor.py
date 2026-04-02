"""Two-layer context compression for tutor chat history.

Layer 1 — Snip: replace old tool results with one-line summaries (no LLM).
Layer 2 — Auto: LLM-compress history into structured summary when budget exceeded.

Usage:
    compressor = ContextCompressor(max_context_tokens=24000)
    result = await compressor.maybe_compress(messages)
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Literal

from app.services.llm_client import get_llm_client, LLMError

logger = logging.getLogger(__name__)

# Cheap model for compression summaries
COMPRESS_MODEL = "z-ai/glm-4.7-flash"

AUTO_COMPRESS_PROMPT = """你是一个对话压缩助手。请将以下AI辅导对话历史压缩为结构化摘要。

保留以下信息：
1. 已讲解的知识点及学生掌握情况
2. 已解决的困惑
3. 未解决的困惑或待讨论话题
4. 当前学习到的位置（模块/章节）
5. 重要的学习偏好或发现

输出格式：
### 已覆盖知识点
- ...
### 已解决困惑
- ...
### 待讨论
- ...
### 当前位置
..."""


@dataclass
class CompressionResult:
    """Outcome of a compression attempt."""
    messages: list[dict]
    tokens_before: int
    tokens_after: int
    trigger: Literal["snip", "auto", "none"]
    summary: str | None = None


# Tool-result pattern: === get_specialist 结果 ===
_TOOL_RESULT_RE = re.compile(
    r"===\s*(get_specialist|get_quiz)\s*(?:结果|失败)\s*===",
)
_HEADING_RE = re.compile(r"^#+\s*(.+)", re.MULTILINE)


def _snip_summary(content: str) -> str:
    """Generate a one-line summary for a tool result block."""
    # Detect which tool
    tool_match = _TOOL_RESULT_RE.search(content)
    tool_name = tool_match.group(1) if tool_match else "tool"

    # Try to extract a title from the content
    heading = _HEADING_RE.search(content)
    title = heading.group(1).strip()[:40] if heading else ""

    char_count = len(content)
    if title:
        return f"[已获取 {tool_name} 结果: {title}, 约{char_count}字]"
    return f"[已获取 {tool_name} 结果, 约{char_count}字]"


class ContextCompressor:
    """Two-layer context compression for tutor conversations."""

    def __init__(
        self,
        max_context_tokens: int = 24_000,
        snip_after_turns: int = 5,
        compression_threshold: float = 0.85,
        keep_recent_turns: int = 2,
    ):
        self.max_context_tokens = max_context_tokens
        self.snip_after_turns = snip_after_turns
        self.compression_threshold = compression_threshold
        self.keep_recent_turns = keep_recent_turns

    @staticmethod
    def estimate_tokens(messages: list[dict]) -> int:
        """Rough estimate: 1 token ~ 2 Chinese chars or 4 English chars."""
        total_chars = sum(len(m.get("content", "")) for m in messages)
        return total_chars // 2

    def snip_old_tool_results(self, messages: list[dict]) -> list[dict]:
        """Layer 1: Replace tool-result content in old assistant messages."""
        if not messages:
            return messages

        # Count turns from the end (each user+assistant pair = 1 turn)
        total = len(messages)
        # Keep the last N turns intact (snip_after_turns * 2 messages)
        keep_count = self.snip_after_turns * 2
        cutoff_idx = max(0, total - keep_count)

        result: list[dict] = []
        for i, msg in enumerate(messages):
            if i < cutoff_idx and msg.get("role") == "assistant":
                content = msg.get("content", "")
                if _TOOL_RESULT_RE.search(content):
                    result.append({
                        **msg,
                        "content": _snip_summary(content),
                    })
                    continue
            result.append(msg)

        return result

    async def auto_compress(
        self, messages: list[dict],
    ) -> CompressionResult:
        """Layer 2: LLM-compress old history, keep recent turns intact."""
        tokens_before = self.estimate_tokens(messages)

        # Split: old messages to compress vs. recent to keep
        keep_count = self.keep_recent_turns * 2
        if len(messages) <= keep_count:
            # Not enough messages to compress
            return CompressionResult(
                messages=messages,
                tokens_before=tokens_before,
                tokens_after=tokens_before,
                trigger="none",
            )

        old_messages = messages[:-keep_count]
        recent_messages = messages[-keep_count:]

        # Build compression input
        history_text = "\n".join(
            f"[{m.get('role', '?')}]: {m.get('content', '')}"
            for m in old_messages
        )

        # Cap the history text sent to the compression model
        if len(history_text) > 12_000:
            history_text = history_text[:12_000] + "\n…（已截断）"

        summary: str | None = None
        try:
            llm = get_llm_client()
            chunks: list[str] = []
            async for chunk in llm.stream_text(
                model=COMPRESS_MODEL,
                system=AUTO_COMPRESS_PROMPT,
                messages=[{"role": "user", "content": history_text}],
                max_tokens=800,
                max_retries=1,
            ):
                chunks.append(chunk)
            summary = "".join(chunks)
        except (LLMError, Exception) as exc:
            logger.warning(
                "Auto compression LLM failed (%s), falling back to truncation",
                exc,
            )

        if summary:
            compressed = [
                {
                    "role": "assistant",
                    "content": f"[对话摘要]\n{summary}",
                },
                *recent_messages,
            ]
        else:
            # Fallback: simple truncation — keep only recent messages
            compressed = list(recent_messages)

        tokens_after = self.estimate_tokens(compressed)
        return CompressionResult(
            messages=compressed,
            tokens_before=tokens_before,
            tokens_after=tokens_after,
            trigger="auto",
            summary=summary,
        )

    async def maybe_compress(
        self, messages: list[dict],
    ) -> CompressionResult:
        """Main entry: apply Layer 1 (free), then Layer 2 if still over budget."""
        if not messages:
            return CompressionResult(
                messages=messages,
                tokens_before=0,
                tokens_after=0,
                trigger="none",
            )

        tokens_before = self.estimate_tokens(messages)

        # Layer 1: Snip old tool results (always, zero cost)
        snipped = self.snip_old_tool_results(messages)
        tokens_after_snip = self.estimate_tokens(snipped)

        budget_threshold = int(
            self.max_context_tokens * self.compression_threshold
        )

        if tokens_after_snip <= budget_threshold:
            trigger = "snip" if tokens_after_snip < tokens_before else "none"
            return CompressionResult(
                messages=snipped,
                tokens_before=tokens_before,
                tokens_after=tokens_after_snip,
                trigger=trigger,
            )

        # Layer 2: Auto compress via LLM
        logger.info(
            "Context exceeds budget (tokens≈%d > threshold=%d), "
            "triggering auto compression",
            tokens_after_snip,
            budget_threshold,
        )
        result = await self.auto_compress(snipped)
        result.tokens_before = tokens_before  # Report original size
        return result
