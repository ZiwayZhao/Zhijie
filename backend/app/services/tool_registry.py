"""Unified Tool Registry — class-based tool system with mode awareness.

Wraps existing tool functions (tutor_tools.py) into a registry that supports:
- Mode-based tool filtering (learn_deep, exam_prep, review, quick_qa)
- LLM-friendly tool descriptions for function calling
- Scope classification (read vs write)
- Singleton access via get_tool_registry()

Backward compatible: existing run_tool() in tutor_tools.py continues to work.
This module provides the forward-looking registry for the planner/executor.
"""

from __future__ import annotations

import logging
import uuid
from abc import ABC, abstractmethod
from typing import TYPE_CHECKING, Literal

from app.schemas.tutor import TutorToolError, TutorToolResult
from app.services.prompt_builder import TutorMode

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


# ── Mode-Tool Matrix ────────────────────────────────────────────

MODE_TOOL_MATRIX: dict[TutorMode, list[str]] = {
    TutorMode.LEARN_DEEP: ["get_specialist", "get_quiz", "search_course_content"],
    TutorMode.EXAM_PREP: ["get_specialist", "get_quiz", "extract_key_points"],
    TutorMode.REVIEW: ["get_quiz", "generate_flashcards"],
    TutorMode.QUICK_QA: ["get_specialist", "search_course_content"],
}

# Tools that require a completed disassembly analysis to be useful
_REQUIRES_ANALYSIS = {"get_specialist", "get_quiz", "extract_key_points"}


# ── Base Class ──────────────────────────────────────────────────


class TutorTool(ABC):
    """Abstract base for all tutor tools.

    Subclasses must set class-level attributes and implement execute().
    """

    name: str
    description: str
    llm_description: str
    scope: Literal["read", "write"]
    categories: list[str]

    def available_for_mode(self, mode: TutorMode) -> bool:
        """Check if this tool is available in the given learning mode."""
        allowed = MODE_TOOL_MATRIX.get(mode, [])
        return self.name in allowed

    @abstractmethod
    async def execute(
        self,
        *,
        db: AsyncSession,
        material_id: uuid.UUID,
        user_id: uuid.UUID,
        module_id: uuid.UUID | None = None,
        module_hint: str | None = None,
        **kwargs: object,
    ) -> TutorToolResult:
        """Run the tool and return a unified result (never raises)."""


# ── Concrete Tools ──────────────────────────────────────────────


class GetSpecialistTool(TutorTool):
    """Fetch specialist lecture notes for a module."""

    name = "get_specialist"
    description = (
        "获取模块的精讲笔记（Specialist Markdown），包含概念讲解、"
        "关键知识点、考试陷阱等。支持按 module_id 或 module_hint 定位模块。"
    )
    llm_description = (
        "Retrieve specialist lecture notes for a specific module. "
        "Returns markdown content, key concepts, and exam traps."
    )
    scope: Literal["read", "write"] = "read"
    categories = ["material", "explain"]

    async def execute(
        self,
        *,
        db: AsyncSession,
        material_id: uuid.UUID,
        user_id: uuid.UUID,
        module_id: uuid.UUID | None = None,
        module_hint: str | None = None,
        **kwargs: object,
    ) -> TutorToolResult:
        from app.services.tutor_tools import get_specialist

        return await get_specialist(
            db=db,
            material_id=material_id,
            user_id=user_id,
            module_id=module_id,
            module_hint=module_hint,
        )


class GetQuizTool(TutorTool):
    """Fetch quiz questions for a material or module."""

    name = "get_quiz"
    description = (
        "获取材料/模块的测验题目（MCQ），用于检测学生掌握程度。"
        "支持按模块筛选，返回结构化题目列表。"
    )
    llm_description = (
        "Retrieve quiz questions (MCQ) for a material or module. "
        "Returns structured question list with options and answers."
    )
    scope: Literal["read", "write"] = "read"
    categories = ["material", "quiz", "exam"]

    async def execute(
        self,
        *,
        db: AsyncSession,
        material_id: uuid.UUID,
        user_id: uuid.UUID,
        module_id: uuid.UUID | None = None,
        module_hint: str | None = None,
        **kwargs: object,
    ) -> TutorToolResult:
        from app.services.tutor_tools import get_quiz

        return await get_quiz(
            db=db,
            material_id=material_id,
            user_id=user_id,
            module_id=module_id,
            module_hint=module_hint,
        )


# ── Registry ────────────────────────────────────────────────────


class ToolRegistry:
    """Central registry for tutor tools.

    Provides lookup by name, mode-based filtering, and LLM description
    generation for the planning prompt.
    """

    def __init__(self) -> None:
        self._tools: dict[str, TutorTool] = {}

    def register(self, tool: TutorTool) -> None:
        """Register a tool instance. Overwrites if name already exists."""
        if tool.name in self._tools:
            logger.warning("Overwriting tool registration: %s", tool.name)
        self._tools[tool.name] = tool

    def get(self, name: str) -> TutorTool | None:
        """Get a tool by name, or None if not registered."""
        return self._tools.get(name)

    def get_tools_for_mode(self, mode: TutorMode) -> list[TutorTool]:
        """Return all registered tools available for the given mode."""
        allowed_names = MODE_TOOL_MATRIX.get(mode, [])
        return [
            self._tools[name]
            for name in allowed_names
            if name in self._tools
        ]

    def get_available_tools(
        self, mode: TutorMode, has_analysis: bool = True
    ) -> list[str]:
        """Return tool names available for the mode, filtered by analysis state.

        If has_analysis is False, tools that require a completed disassembly
        (get_specialist, get_quiz, etc.) are excluded.
        """
        tools = self.get_tools_for_mode(mode)
        if not has_analysis:
            tools = [t for t in tools if t.name not in _REQUIRES_ANALYSIS]
        return [t.name for t in tools]

    def get_tool_descriptions(self, tool_names: list[str]) -> str:
        """Format tool descriptions for injection into the LLM planning prompt.

        Returns a numbered list of tool names + their llm_description.
        """
        lines: list[str] = []
        for i, name in enumerate(tool_names, 1):
            tool = self._tools.get(name)
            if tool:
                lines.append(f"{i}. **{tool.name}** — {tool.llm_description}")
        return "\n".join(lines) if lines else "（当前无可用工具）"

    async def execute(
        self,
        name: str,
        *,
        db: AsyncSession,
        material_id: uuid.UUID,
        user_id: uuid.UUID,
        module_id: uuid.UUID | None = None,
        module_hint: str | None = None,
        **kwargs: object,
    ) -> TutorToolResult:
        """Execute a tool by name. Returns TutorToolResult (never raises)."""
        tool = self._tools.get(name)
        if not tool:
            return TutorToolResult(
                ok=False,
                tool_name=name,
                error=TutorToolError(
                    code="UNKNOWN_TOOL",
                    message=f"Unknown tool: {name}",
                ),
            )
        try:
            return await tool.execute(
                db=db,
                material_id=material_id,
                user_id=user_id,
                module_id=module_id,
                module_hint=module_hint,
                **kwargs,
            )
        except Exception as e:
            logger.exception("Tool %s failed: %s", name, e)
            return TutorToolResult(
                ok=False,
                tool_name=name,
                error=TutorToolError(
                    code="TOOL_ERROR",
                    message=f"工具执行失败: {str(e)[:200]}",
                    retryable=True,
                ),
            )

    @property
    def registered_names(self) -> list[str]:
        """List all registered tool names."""
        return list(self._tools.keys())


# ── Module-level Singleton ──────────────────────────────────────

_registry: ToolRegistry | None = None


def get_tool_registry() -> ToolRegistry:
    """Return the global tool registry, creating it on first call.

    Registers all built-in tools. Thread-safe for typical async usage
    (single event loop).
    """
    global _registry  # noqa: PLW0603
    if _registry is not None:
        return _registry

    registry = ToolRegistry()
    registry.register(GetSpecialistTool())
    registry.register(GetQuizTool())

    _registry = registry
    return _registry
