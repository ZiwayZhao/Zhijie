from __future__ import annotations

"""Student learning profile — selfReport + aiInference + memory layers."""

import uuid
from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class StudentProfile(Base):
    """Per-user per-material learning profile.

    Separates selfReport (student's own assessment) from
    aiInference (AI's assessment from quiz/interaction data).

    selfReport examples:
        {"covered_chapters": ["Ch.1", "Ch.2"], "weak_areas": ["树结构"],
         "exam_date": "2026-07-15", "confidence": "medium"}

    aiInference examples:
        {"mastery": {"JOIN": 70, "NULL": 40},
         "confusion_pairs": [["Natural Join", "Equijoin"]],
         "avg_quiz_score": 0.65}
    """

    __tablename__ = "student_profiles"
    __table_args__ = (
        UniqueConstraint("user_id", "material_id", name="uq_student_profile"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    material_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("materials.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # selfReport — student's own assessment (always respected)
    self_report: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default="{}",
    )

    # aiInference — AI's assessment from interactions (can be overridden)
    ai_inference: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default="{}",
    )

    # Session memories — accumulated from SessionMemoryExtractor
    session_memories: Mapped[list] = mapped_column(
        JSONB, nullable=False, server_default="[]",
    )

    # Learning mode preference (learn_deep / exam_prep / review / quick_qa)
    preferred_mode: Mapped[str | None] = mapped_column(
        String(30), nullable=True,
    )

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
    )
