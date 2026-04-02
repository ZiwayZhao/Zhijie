"""Tutor MVP schemas — request/response DTOs and LLM structured output models.

SSE event protocol:
  session.started    → UI creates session, locks input
  plan.completed     → UI shows intent card
  tool.result        → UI renders tool result card
  answer.delta       → UI appends streamed text
  answer.completed   → UI unlocks input
  error              → UI shows error banner
  session.completed  → UI marks session end
"""

import uuid
from typing import Literal

from pydantic import BaseModel, Field, field_validator

MAX_HISTORY_TURNS = 20


# ── Chat Message ─────────────────────────────────────────────────

class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


# ── Request ──────────────────────────────────────────────────────

class TutorChatRequest(BaseModel):
    """POST /api/v1/chat/tutor body."""
    material_id: uuid.UUID
    module_id: uuid.UUID | None = None  # None = global scope
    user_message: str = Field(min_length=1, max_length=2000)
    conversation_history: list[ChatMessage] = []

    @field_validator("conversation_history")
    @classmethod
    def limit_history(cls, v: list[ChatMessage]) -> list[ChatMessage]:
        return v[-MAX_HISTORY_TURNS:] if len(v) > MAX_HISTORY_TURNS else v


# ── Plan Output (structured_output schema) ───────────────────────

class TutorPlanOutput(BaseModel):
    """LLM planning result — decides intent and tool calls.

    Used with LLMClient.structured_output() for the Plan phase.
    """
    intent: Literal["explain", "quiz", "answer_direct"]
    reasoning: str = Field(
        description="Brief reasoning for the chosen intent (1-2 sentences)",
    )
    tools_to_call: list[Literal["get_specialist", "get_quiz"]] = Field(
        default_factory=list,
        description="Which tools to invoke. Empty for answer_direct.",
        max_length=2,
    )
    module_hint: str | None = Field(
        default=None,
        description="Module name hint extracted from user query, for tool filtering",
    )


# ── Multi-Step Plan (Wave 1 QueryLoop) ──────────────────────────

class TutorPlanStep(BaseModel):
    """One step in a multi-step plan."""
    step_id: int = Field(description="Step number, 1-indexed")
    intent: Literal["explain", "quiz", "answer_direct"]
    tools_to_call: list[Literal["get_specialist", "get_quiz"]] = Field(
        default_factory=list, max_length=2,
    )
    module_hint: str | None = None
    description: str = Field(
        default="",
        description="What this step accomplishes, e.g. '讲解视图概念'",
    )


class TutorMultiStepPlan(BaseModel):
    """Multi-step plan for complex queries. Max 3 steps."""
    steps: list[TutorPlanStep] = Field(max_length=3)
    reasoning: str = Field(
        description="Overall reasoning for the plan",
    )
    is_multi_step: bool = Field(
        default=False,
        description="True if query requires more than 1 step",
    )


# ── Tool Result ──────────────────────────────────────────────────

class TutorToolError(BaseModel):
    code: str
    message: str
    retryable: bool = False


class TutorToolResult(BaseModel):
    """Unified tool return structure."""
    ok: bool
    tool_name: str
    scope: dict = Field(default_factory=dict)
    data: dict = Field(default_factory=dict)
    error: TutorToolError | None = None


# ── SSE Event Payloads ───────────────────────────────────────────

class SessionStartedEvent(BaseModel):
    session_id: str
    material_id: str
    module_id: str | None = None
    available_tools: list[str]


class PlanCompletedEvent(BaseModel):
    intent: str
    reasoning: str
    tools_to_call: list[str]


class ToolResultEvent(BaseModel):
    tool_name: str
    ok: bool
    data: dict = Field(default_factory=dict)
    error: TutorToolError | None = None


class AnswerDeltaEvent(BaseModel):
    content: str


class AnswerCompletedEvent(BaseModel):
    total_tokens: int = 0


class ErrorEvent(BaseModel):
    message: str
    phase: str = "unknown"


class SessionCompletedEvent(BaseModel):
    session_id: str
