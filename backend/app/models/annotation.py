"""PDF annotation models — highlight and comment persistence.

Tables:
  - pdf_annotations: per-material highlight data (JSONB for react-pdf-highlighter format)
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class PDFAnnotation(Base):
    """A single PDF highlight/annotation."""

    __tablename__ = "pdf_annotations"

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

    # Unique client-generated ID for idempotent sync
    client_id: Mapped[str] = mapped_column(
        String(100), nullable=False,
    )

    # react-pdf-highlighter data (stored as JSONB for flexibility)
    highlight_data: Mapped[dict] = mapped_column(
        JSONB, nullable=False,
    )  # { type, content, position, color, comment, ... }

    color: Mapped[str | None] = mapped_column(String(20), nullable=True)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
    )

    __table_args__ = (
        UniqueConstraint("user_id", "material_id", "client_id",
                         name="uq_annotation_user_material_client"),
    )
