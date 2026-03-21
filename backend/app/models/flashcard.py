"""Flashcard models — FSRS v6 scheduling state.

Tables:
  - flashcard_notes: card content (front/back/tags/source)
  - flashcard_cards: FSRS scheduling state per card
  - flashcard_review_logs: every review event for analytics
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class FlashcardNote(Base):
    """Flashcard content definition — one note can have one card."""

    __tablename__ = "flashcard_notes"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    course_id: Mapped[str] = mapped_column(String(200), nullable=False)

    # Content
    card_type: Mapped[str] = mapped_column(
        String(30), nullable=False, server_default="basic",
    )  # basic | cloze | reverse | image-occlusion
    front: Mapped[str] = mapped_column(Text, nullable=False)
    back: Mapped[str] = mapped_column(Text, nullable=False)
    extra: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Metadata
    tags: Mapped[list[str]] = mapped_column(
        ARRAY(String(100)), nullable=False, server_default="{}",
    )
    generated_by: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="ai",
    )  # ai | user | ai-evolved

    # Source tracking
    source_material_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    source_module_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    source_page: Mapped[int | None] = mapped_column(Integer, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
    )


class FlashcardCard(Base):
    """FSRS scheduling state for a flashcard."""

    __tablename__ = "flashcard_cards"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
    )
    note_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("flashcard_notes.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )

    # FSRS v6 state
    due: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(),
    )
    stability: Mapped[float] = mapped_column(
        Float, nullable=False, server_default="0",
    )
    difficulty: Mapped[float] = mapped_column(
        Float, nullable=False, server_default="0",
    )
    state: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="new",
    )  # new | learning | review | relearning
    reps: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0",
    )
    lapses: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0",
    )

    # Self-evolution tracking
    consecutive_again: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0",
    )
    consecutive_easy: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0",
    )
    average_response_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # ts-fsrs full Card JSON (for exact state restoration)
    fsrs_card_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
    )


class FlashcardReviewLog(Base):
    """Individual review event — immutable audit trail."""

    __tablename__ = "flashcard_review_logs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
    )
    card_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("flashcard_cards.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )

    rating: Mapped[int] = mapped_column(
        Integer, nullable=False,
    )  # 1=Again, 2=Hard, 3=Good, 4=Easy
    response_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # ts-fsrs ReviewLog JSON (for exact state restoration)
    fsrs_log_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    reviewed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(),
    )
