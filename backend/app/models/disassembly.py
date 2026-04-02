"""Disassembly pipeline models — 3-Agent material analysis.

Tables:
  - disassembly_tasks: pipeline execution tracking
  - disassembly_modules: Cartographer output (module plan)
  - module_dependencies: module prerequisite relationships
  - specialist_outputs: per-module lecture notes
  - quiz_data: Examiner output (MCQ)
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class DisassemblyTask(Base):
    """A single pipeline execution for one material."""

    __tablename__ = "disassembly_tasks"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending','running','completed','failed','cancelled')",
            name="ck_dtask_status",
        ),
        CheckConstraint(
            "phase IN ('init','parsing','cartographer','specialist','knowledge-cards','examiner','done')",
            name="ck_dtask_phase",
        ),
        UniqueConstraint("run_id", name="uq_dtask_run_id"),
        Index(
            "idx_dtask_material_active",
            "material_id",
            unique=True,
            postgresql_where=text("status IN ('pending', 'running')"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
    )
    material_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("materials.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Lifecycle state (independent of phase)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="pending",
    )
    # Current pipeline phase
    phase: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="init",
    )
    # Progress within current phase: 0.000 - 1.000
    progress: Mapped[float] = mapped_column(
        Numeric(4, 3), nullable=False, server_default="0.000",
    )

    # Error tracking
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_phase: Mapped[str | None] = mapped_column(String(20), nullable=True)
    attempt: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")

    # Parsed PDF reference (large text stored in S3, not DB)
    pdf_page_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    parsed_s3_key: Mapped[str | None] = mapped_column(String(1000), nullable=True)

    # Celery task tracking
    celery_task_id: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Intent & exam context (Phase C — exam quiz integration)
    intent: Mapped[str | None] = mapped_column(String(20), nullable=True)
    exam_profile_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    reference_material_ids: Mapped[list | None] = mapped_column(JSONB, nullable=True)

    # Config snapshot for reproducibility
    config_json: Mapped[dict | None] = mapped_column(JSONB, server_default="{}")

    # Audit
    run_id: Mapped[str] = mapped_column(String(64), nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
    )


class DisassemblyModule(Base):
    """A module identified by the Cartographer agent."""

    __tablename__ = "disassembly_modules"
    __table_args__ = (
        CheckConstraint(
            "exam_weight IN ('high','medium','low')",
            name="ck_dmodule_exam_weight",
        ),
        CheckConstraint(
            "page_range_start >= 1 AND page_range_end >= page_range_start",
            name="ck_dmodule_page_range",
        ),
        UniqueConstraint("task_id", "sort_order", name="uq_dmodule_task_sort"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
    )
    task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("disassembly_tasks.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    page_range_start: Mapped[int] = mapped_column(Integer, nullable=False)
    page_range_end: Mapped[int] = mapped_column(Integer, nullable=False)
    exam_weight: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="medium",
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
    )


class ModuleDependency(Base):
    """Prerequisite relationship between modules."""

    __tablename__ = "module_dependencies"
    __table_args__ = (
        CheckConstraint(
            "module_id != depends_on_id",
            name="ck_moddep_no_self_ref",
        ),
    )

    module_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("disassembly_modules.id", ondelete="CASCADE"),
        primary_key=True,
    )
    depends_on_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("disassembly_modules.id", ondelete="CASCADE"),
        primary_key=True,
    )


class SpecialistOutput(Base):
    """Per-module lecture notes generated by the Specialist agent."""

    __tablename__ = "specialist_outputs"
    __table_args__ = (
        UniqueConstraint("module_id", name="uq_specialist_module"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
    )
    module_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("disassembly_modules.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Content reference (large markdown stored in S3)
    markdown_s3_key: Mapped[str] = mapped_column(String(1000), nullable=False)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    key_concepts: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default="{}",
    )
    exam_traps: Mapped[list[str] | None] = mapped_column(
        ARRAY(Text), server_default="{}",
    )
    self_test_questions: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    # Quality audit
    prompt_version: Mapped[str] = mapped_column(String(20), nullable=False)
    model_used: Mapped[str] = mapped_column(String(50), nullable=False)
    input_tokens: Mapped[int] = mapped_column(Integer, nullable=False)
    output_tokens: Mapped[int] = mapped_column(Integer, nullable=False)
    latency_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    run_id: Mapped[str] = mapped_column(String(64), nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
    )


class QuizData(Base):
    """Examiner output — structured MCQ assessment."""

    __tablename__ = "quiz_data"
    __table_args__ = (
        UniqueConstraint("task_id", name="uq_quiz_task"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
    )
    task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("disassembly_tasks.id", ondelete="CASCADE"),
        nullable=False,
    )

    schema_version: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="1",
    )
    questions: Mapped[list] = mapped_column(JSONB, nullable=False)  # list[MCQuestion dict]
    total_questions: Mapped[int] = mapped_column(Integer, nullable=False)
    source_module_ids: Mapped[list[uuid.UUID]] = mapped_column(
        ARRAY(UUID(as_uuid=True)), nullable=False,
    )

    # Quality audit
    prompt_version: Mapped[str] = mapped_column(String(20), nullable=False)
    model_used: Mapped[str] = mapped_column(String(50), nullable=False)
    input_tokens: Mapped[int] = mapped_column(Integer, nullable=False)
    output_tokens: Mapped[int] = mapped_column(Integer, nullable=False)
    latency_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    run_id: Mapped[str] = mapped_column(String(64), nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
    )
