"""Disassembly pipeline schemas — shared contract between API ↔ Frontend.

Includes:
  - Request/Response DTOs
  - SSE event schema
  - Business error codes
"""

import enum
import uuid
from datetime import datetime

from typing import Any

from pydantic import BaseModel, Field

from app.schemas.knowledge_card import KnowledgeCardResponse


# ── Business Error Codes ──────────────────────────────────────────

class DisassemblyErrorCode(str, enum.Enum):
    """Machine-readable error codes for the disassembly pipeline."""
    MATERIAL_NOT_PDF = "MATERIAL_NOT_PDF"
    MATERIAL_NOT_CONFIRMED = "MATERIAL_NOT_CONFIRMED"
    MATERIAL_NOT_FOUND = "MATERIAL_NOT_FOUND"
    ANALYSIS_ALREADY_RUNNING = "ANALYSIS_ALREADY_RUNNING"
    PIPELINE_TIMEOUT = "PIPELINE_TIMEOUT"
    LLM_ERROR = "LLM_ERROR"
    PARSING_ERROR = "PARSING_ERROR"
    TASK_NOT_FOUND = "TASK_NOT_FOUND"
    MODULE_NOT_FOUND = "MODULE_NOT_FOUND"
    TASK_NOT_COMPLETED = "TASK_NOT_COMPLETED"


class DisassemblyError(BaseModel):
    """Structured error response."""
    code: DisassemblyErrorCode
    detail: str


# ── Request DTOs ──────────────────────────────────────────────────

class StartAnalysisRequest(BaseModel):
    """POST /disassembly/start body."""
    material_id: uuid.UUID
    intent: str | None = None  # 'learn' | 'exam' | 'review'
    exam_profile: dict | None = None  # ExamProfile as dict (avoid circular import)
    reference_material_ids: list[uuid.UUID] = Field(default_factory=list)


class CancelAnalysisRequest(BaseModel):
    """POST /disassembly/{task_id}/cancel — no body needed."""
    pass


# ── Task Status ───────────────────────────────────────────────────

class TaskStatusResponse(BaseModel):
    """GET /disassembly/{task_id}/status (also initial SSE payload)."""
    task_id: uuid.UUID = Field(alias="id", serialization_alias="task_id")
    material_id: uuid.UUID
    status: str = Field(description="pending | running | completed | failed | cancelled")
    phase: str = Field(description="init | parsing | cartographer | specialist | knowledge-cards | examiner | done")
    progress: float = Field(ge=0.0, le=1.0)
    attempt: int = 1
    error_message: str | None = None
    error_phase: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    created_at: datetime

    model_config = {"from_attributes": True, "populate_by_name": True}


class StartAnalysisResponse(BaseModel):
    """POST /disassembly/start response."""
    task_id: uuid.UUID
    status: str
    phase: str


# ── SSE Events ────────────────────────────────────────────────────

class SSEProgressEvent(BaseModel):
    """Redis Pub/Sub + SSE event payload."""
    task_id: uuid.UUID
    phase: str
    progress: float = Field(ge=0.0, le=1.0)
    message: str
    detail: dict | None = None  # e.g. {"completed": 3, "total": 7} for specialist


class SSECompleteEvent(BaseModel):
    """Sent when pipeline finishes successfully."""
    task_id: uuid.UUID
    phase: str = "done"
    progress: float = 1.0
    message: str = "分析完成"
    module_count: int
    quiz_count: int


class SSEErrorEvent(BaseModel):
    """Sent on pipeline failure."""
    task_id: uuid.UUID
    phase: str
    progress: float
    error_code: DisassemblyErrorCode
    message: str


# ── Module DTOs ───────────────────────────────────────────────────

class ModuleSummary(BaseModel):
    """Brief module info for result listing."""
    id: uuid.UUID
    name: str
    description: str | None
    page_range_start: int
    page_range_end: int
    exam_weight: str
    sort_order: int
    has_specialist: bool = False

    model_config = {"from_attributes": True}


class ModuleDependencyResponse(BaseModel):
    module_id: uuid.UUID
    depends_on_id: uuid.UUID


class ModuleDetailResponse(BaseModel):
    """GET /disassembly/{task_id}/module/{module_id}."""
    id: uuid.UUID
    name: str
    description: str | None
    page_range_start: int
    page_range_end: int
    exam_weight: str
    sort_order: int
    specialist: "SpecialistResponse | None" = None
    dependencies: list[ModuleDependencyResponse] = []

    model_config = {"from_attributes": True}


class SpecialistResponse(BaseModel):
    """Specialist output for a single module."""
    id: uuid.UUID
    module_id: uuid.UUID
    markdown_content: str  # fetched from S3 on demand
    summary: str | None
    key_concepts: list[str]
    exam_traps: list[str]
    self_test_questions: list[dict] | None
    model_used: str
    prompt_version: str

    model_config = {"from_attributes": True}


# ── Quiz DTOs ─────────────────────────────────────────────────────

class MCQOption(BaseModel):
    """A single quiz option."""
    text: str
    index: int


class MCQuestion(BaseModel):
    """A single multiple-choice question."""
    question: str
    options: list[str] = Field(min_length=2, max_length=6)
    correct_index: int = Field(ge=0)
    explanation: str
    source_module_name: str
    source_page: int | None = None
    difficulty: str = "medium"  # easy | medium | hard


class QuizResponse(BaseModel):
    """GET /disassembly/{task_id}/result quiz section.

    DB stores questions as JSONB list.
    schema_version=1: v1 MCQ-only (MCQuestion shape)
    schema_version=2: v2 multi-type (question_type, blanks, steps, etc.)
    We pass questions through as raw dicts so v2 fields are preserved.
    The frontend discriminates via hasV2Questions().
    """
    id: uuid.UUID
    task_id: uuid.UUID
    schema_version: int = 1
    questions: list[dict[str, Any]]
    total_questions: int
    model_used: str
    prompt_version: str

    model_config = {"from_attributes": True}


# ── Full Result ───────────────────────────────────────────────────

class DisassemblyResultResponse(BaseModel):
    """GET /disassembly/{task_id}/result — complete analysis output."""
    task: TaskStatusResponse
    modules: list[ModuleSummary]
    quiz: QuizResponse | None = None
    knowledge_cards: KnowledgeCardResponse | None = None


# Forward ref resolution
ModuleDetailResponse.model_rebuild()
