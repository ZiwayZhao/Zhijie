"""SSE ticket models — short-lived auth tokens for EventSource connections.

Replaces raw JWT in query parameter with ephemeral, single-purpose tickets.

Tables:
  - sse_tickets: short-lived auth tokens for SSE streams
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class SSETicket(Base):
    """Short-lived ticket for authenticating EventSource connections."""

    __tablename__ = "sse_tickets"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )

    # What resource this ticket grants access to
    resource_type: Mapped[str] = mapped_column(
        String(30), nullable=False,
    )  # pipeline | tutor
    resource_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False,
    )

    # Token (stored as hash, like refresh tokens)
    token_hash: Mapped[str] = mapped_column(
        Text, nullable=False, unique=True,
    )

    # Expiry (short-lived: 15 minutes)
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False,
    )

    # Audit
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(500), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
    )
