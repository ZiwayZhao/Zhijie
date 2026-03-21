"""Student learning profile models — BKT knowledge tracing.

Tables:
  - student_profiles: per-user learning profile (goal, streak, study time)
  - module_masteries: per-module mastery state (BKT probability)
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class StudentProfile(Base):
    """Per-user learning profile — drives all adaptive decisions."""

    __tablename__ = "student_profiles"
    __table_args__ = (
        UniqueConstraint("user_id", name="uq_student_profile_user"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Learning intent
    goal: Mapped[str | None] = mapped_column(
        String(20), nullable=True,
    )  # learn | exam | review

    # Aggregate stats
    total_study_minutes: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0",
    )
    streak_days: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0",
    )
    last_active_date: Mapped[str | None] = mapped_column(
        String(10), nullable=True,
    )  # ISO date YYYY-MM-DD

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
    )


class ModuleMastery(Base):
    """Per-module BKT mastery state."""

    __tablename__ = "module_masteries"
    __table_args__ = (
        UniqueConstraint("profile_id", "module_id", name="uq_mastery_profile_module"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
    )
    profile_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("student_profiles.id", ondelete="CASCADE"),
        nullable=False,
    )

    module_id: Mapped[str] = mapped_column(String(200), nullable=False)
    module_name: Mapped[str] = mapped_column(String(500), nullable=False)
    course_id: Mapped[str] = mapped_column(String(200), nullable=False)

    mastery: Mapped[float] = mapped_column(
        Float, nullable=False, server_default="0.3",
    )  # 0.0 - 1.0 BKT probability

    total_attempts: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0",
    )
    correct_attempts: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0",
    )

    last_updated: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
    )
