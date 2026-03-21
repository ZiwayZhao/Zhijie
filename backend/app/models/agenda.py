"""Agenda models — todo items and exam config persistence.

Tables:
  - agenda_todos: user-created learning tasks
  - exam_profile_records: exam profile per user+course (replaces in-memory dict)
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AgendaTodo(Base):
    """User-created learning task."""

    __tablename__ = "agenda_todos"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Client-generated ID for idempotent sync
    client_id: Mapped[str] = mapped_column(String(100), nullable=False)

    title: Mapped[str] = mapped_column(String(500), nullable=False)
    completed: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false",
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
    )

    __table_args__ = (
        UniqueConstraint("user_id", "client_id", name="uq_todo_user_client"),
    )


class ExamProfileRecord(Base):
    """Persisted exam profile — replaces in-memory _exam_profiles dict."""

    __tablename__ = "exam_profiles"
    __table_args__ = (
        UniqueConstraint("user_id", "course_id", name="uq_exam_profile_user_course"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    course_id: Mapped[str] = mapped_column(String(200), nullable=False)

    # Exam metadata
    exam_date: Mapped[str | None] = mapped_column(String(10), nullable=True)
    duration_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_open_book: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    calculator_allowed: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    total_points: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="100",
    )

    # Question distribution as JSONB array
    question_distribution: Mapped[list] = mapped_column(
        JSONB, nullable=False, server_default="[]",
    )

    source: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="default",
    )  # default | user_input | exam_analysis
    analyzed_exam_s3_key: Mapped[str | None] = mapped_column(
        String(1000), nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
    )
