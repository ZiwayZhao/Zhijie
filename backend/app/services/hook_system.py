"""PostToolUse Hook System — quality assurance built into the tool pipeline.

Hooks run after tool execution and can:
- Validate/enrich tool results
- Log quality metrics
- Trigger follow-up actions (e.g. auto-generate flashcards after specialist)

Hook types:
- PostToolUse: runs after a specific tool completes
- PostSession: runs when a tutor session ends

Usage:
    registry = HookRegistry()
    registry.register_post_tool("get_specialist", VerifyCoverageHook())
    results = await registry.run_post_tool_hooks("get_specialist", tool_result)
"""

from __future__ import annotations

import logging
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)


# ── Data Types ─────────────────────────────────────────────────────


@dataclass
class HookResult:
    """Result returned by each hook after execution."""

    hook_name: str
    success: bool
    message: str = ""
    data: dict[str, Any] | None = None


# ── Abstract Base Classes ──────────────────────────────────────────


class PostToolHook(ABC):
    """Abstract base for post-tool-use hooks.

    Subclasses must set `name` and implement `execute()`.
    Hooks receive the tool result and an optional context dict,
    and return a HookResult indicating success/failure + any data.
    """

    name: str

    @abstractmethod
    async def execute(
        self, tool_name: str, tool_result: dict[str, Any], context: dict[str, Any]
    ) -> HookResult:
        """Run the hook logic.

        Args:
            tool_name: Which tool just ran (e.g. "get_specialist").
            tool_result: The tool's TutorToolResult serialized to dict.
            context: Arbitrary context (session_id, user_id, timing, etc.).

        Returns:
            HookResult with success status and optional enrichment data.
        """


class PostSessionHook(ABC):
    """Abstract base for post-session hooks.

    Runs when a tutor session ends, receiving aggregated session data.
    """

    name: str

    @abstractmethod
    async def execute(self, session_data: dict[str, Any]) -> HookResult:
        """Run hook logic on session-level data.

        Args:
            session_data: Aggregated session info (messages, tool calls, timing).

        Returns:
            HookResult with success status and optional data.
        """


# ── Hook Registry ──────────────────────────────────────────────────


class HookRegistry:
    """Central registry for post-tool and post-session hooks.

    Hooks are registered per tool name. When a tool completes,
    all hooks registered for that tool are executed sequentially.
    Individual hook failures are caught and logged — they never
    crash the main pipeline.
    """

    def __init__(self) -> None:
        self._post_tool: dict[str, list[PostToolHook]] = {}
        self._post_session: list[PostSessionHook] = []

    def register_post_tool(self, tool_name: str, hook: PostToolHook) -> None:
        """Register a hook to run after a specific tool completes."""
        if tool_name not in self._post_tool:
            self._post_tool[tool_name] = []
        self._post_tool[tool_name].append(hook)
        logger.debug("Registered post-tool hook '%s' for tool '%s'", hook.name, tool_name)

    def register_post_session(self, hook: PostSessionHook) -> None:
        """Register a hook to run when a session ends."""
        self._post_session.append(hook)
        logger.debug("Registered post-session hook '%s'", hook.name)

    async def run_post_tool_hooks(
        self,
        tool_name: str,
        tool_result: dict[str, Any],
        context: dict[str, Any] | None = None,
    ) -> list[HookResult]:
        """Run all hooks registered for the given tool.

        Hooks run sequentially. Each hook failure is logged but does not
        prevent subsequent hooks from running.

        Returns:
            List of HookResult from each hook (including failures).
        """
        hooks = self._post_tool.get(tool_name, [])
        if not hooks:
            return []

        ctx = context or {}
        results: list[HookResult] = []

        for hook in hooks:
            try:
                result = await hook.execute(tool_name, tool_result, ctx)
                results.append(result)
                if not result.success:
                    logger.warning(
                        "Post-tool hook '%s' reported failure for '%s': %s",
                        hook.name,
                        tool_name,
                        result.message,
                    )
            except Exception as exc:
                logger.exception(
                    "Post-tool hook '%s' crashed for tool '%s': %s",
                    hook.name,
                    tool_name,
                    exc,
                )
                results.append(
                    HookResult(
                        hook_name=hook.name,
                        success=False,
                        message=f"Hook crashed: {str(exc)[:200]}",
                    )
                )

        return results

    async def run_post_session_hooks(
        self, session_data: dict[str, Any]
    ) -> list[HookResult]:
        """Run all post-session hooks.

        Same error isolation as post-tool hooks.
        """
        results: list[HookResult] = []

        for hook in self._post_session:
            try:
                result = await hook.execute(session_data)
                results.append(result)
                if not result.success:
                    logger.warning(
                        "Post-session hook '%s' reported failure: %s",
                        hook.name,
                        result.message,
                    )
            except Exception as exc:
                logger.exception(
                    "Post-session hook '%s' crashed: %s", hook.name, exc
                )
                results.append(
                    HookResult(
                        hook_name=hook.name,
                        success=False,
                        message=f"Hook crashed: {str(exc)[:200]}",
                    )
                )

        return results


# ── Concrete Hooks ─────────────────────────────────────────────────


class AIOutputTagHook(PostToolHook):
    """Tag all AI analytical conclusions with "AI推测" label.

    D2 requirement: any AI-generated analysis or inference in tool
    results must be clearly labeled so users know it is not
    authoritative source material.
    """

    name = "ai_output_tag"

    # Keys in tool_result.data whose values are AI-generated text
    _TAGGABLE_FIELDS = ("summary", "exam_traps", "key_concepts")

    async def execute(
        self, tool_name: str, tool_result: dict[str, Any], context: dict[str, Any]
    ) -> HookResult:
        data = tool_result.get("data", {})
        if not data or not tool_result.get("ok", False):
            return HookResult(
                hook_name=self.name,
                success=True,
                message="Skipped: no data or tool failed",
            )

        tagged_count = 0
        for field_name in self._TAGGABLE_FIELDS:
            value = data.get(field_name)
            if isinstance(value, str) and value and not value.startswith("[AI推测]"):
                data[field_name] = f"[AI推测] {value}"
                tagged_count += 1
            elif isinstance(value, list):
                for i, item in enumerate(value):
                    if isinstance(item, str) and item and not item.startswith("[AI推测]"):
                        value[i] = f"[AI推测] {item}"
                        tagged_count += 1

        return HookResult(
            hook_name=self.name,
            success=True,
            message=f"Tagged {tagged_count} AI-generated fields",
            data={"tagged_count": tagged_count},
        )


class CoverageCheckHook(PostToolHook):
    """After get_specialist, check if key concepts are adequately covered.

    Validates that the specialist output contains key_concepts and that
    the markdown content references them. Reports coverage gaps.
    """

    name = "coverage_check"

    async def execute(
        self, tool_name: str, tool_result: dict[str, Any], context: dict[str, Any]
    ) -> HookResult:
        if not tool_result.get("ok", False):
            return HookResult(
                hook_name=self.name,
                success=True,
                message="Skipped: tool failed",
            )

        data = tool_result.get("data", {})
        key_concepts: list[str] = data.get("key_concepts", [])
        markdown: str = data.get("markdown", "")

        if not key_concepts:
            return HookResult(
                hook_name=self.name,
                success=True,
                message="No key concepts declared — coverage check skipped",
                data={"coverage_ratio": None, "missing": []},
            )

        # Simple substring check: is each concept mentioned in the markdown?
        markdown_lower = markdown.lower()
        missing: list[str] = []
        for concept in key_concepts:
            # Strip AI tag prefix if present
            clean = concept.replace("[AI推测] ", "").strip().lower()
            if clean and clean not in markdown_lower:
                missing.append(concept)

        total = len(key_concepts)
        covered = total - len(missing)
        ratio = covered / total if total > 0 else 1.0

        return HookResult(
            hook_name=self.name,
            success=ratio >= 0.5,  # warn if <50% coverage
            message=(
                f"Coverage: {covered}/{total} concepts found in markdown"
                + (f" — missing: {missing}" if missing else "")
            ),
            data={
                "coverage_ratio": round(ratio, 2),
                "covered": covered,
                "total": total,
                "missing": missing,
            },
        )


class QualityLogHook(PostToolHook):
    """Log tool execution quality metrics.

    Captures timing, result size, and basic health indicators.
    Useful for monitoring tool performance over time.
    """

    name = "quality_log"

    async def execute(
        self, tool_name: str, tool_result: dict[str, Any], context: dict[str, Any]
    ) -> HookResult:
        ok = tool_result.get("ok", False)
        data = tool_result.get("data", {})
        error = tool_result.get("error")

        # Compute result size metrics
        metrics: dict[str, Any] = {
            "tool_name": tool_name,
            "ok": ok,
            "data_keys": list(data.keys()) if data else [],
        }

        # Timing from context (caller should set context["start_time"])
        start_time = context.get("start_time")
        if start_time is not None:
            elapsed_ms = round((time.time() - start_time) * 1000)
            metrics["elapsed_ms"] = elapsed_ms

        # Content size
        if "markdown" in data:
            metrics["markdown_chars"] = len(data["markdown"])
        if "questions" in data:
            metrics["questions_count"] = len(data["questions"])

        # Error info
        if error:
            metrics["error_code"] = error.get("code", "unknown") if isinstance(error, dict) else getattr(error, "code", "unknown")

        logger.info("Tool quality metrics: %s", metrics)

        return HookResult(
            hook_name=self.name,
            success=True,
            message=f"Logged metrics for {tool_name}",
            data=metrics,
        )


# ── Default Registry Factory ──────────────────────────────────────

_hook_registry: HookRegistry | None = None


def get_hook_registry() -> HookRegistry:
    """Return the global hook registry, creating it on first call.

    Registers all built-in hooks with their target tools.
    """
    global _hook_registry  # noqa: PLW0603
    if _hook_registry is not None:
        return _hook_registry

    registry = HookRegistry()

    # AI output tagging — applies to all tools with AI-generated content
    ai_tag = AIOutputTagHook()
    registry.register_post_tool("get_specialist", ai_tag)

    # Coverage check — only for specialist
    registry.register_post_tool("get_specialist", CoverageCheckHook())

    # Quality logging — all tools
    quality = QualityLogHook()
    registry.register_post_tool("get_specialist", quality)
    registry.register_post_tool("get_quiz", quality)

    _hook_registry = registry
    return _hook_registry
