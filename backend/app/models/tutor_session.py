"""Tutor session models — chat history persistence.

Tables:
  - tutor_sessions: per-material conversation history (JSONB messages)
"""

import uuid
from datetime import datetime

from sqlalchemy import (
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


class TutorSession(Base):
    """Chat history for AI tutor — one session per user+material pair."""

    __tablename__ = "tutor_sessions"
    __table_args__ = (
        UniqueConstraint("user_id", "material_id", name="uq_tutor_session_user_material"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    material_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("materials.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Messages stored as JSONB array (max 50 per session)
    messages: Mapped[list] = mapped_column(
        JSONB, nullable=False, server_default="[]",
    )  # [{id, role, content, timestamp, plan?, toolResults?}]

    message_count: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0",
    )

    last_activity_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
    )
