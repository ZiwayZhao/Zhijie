"""GaolingLifePost model — campus life posts (official crawled + user-submitted)."""

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean, DateTime, ForeignKey, Integer,
    String, Text, func,
)
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class GaolingLifePost(Base):
    __tablename__ = "gaoling_life_posts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    category: Mapped[str] = mapped_column(
        String(20), nullable=False, index=True,
        comment="sport | medical | lecture | dining | study",
    )
    is_official: Mapped[bool] = mapped_column(Boolean, default=True)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="published",
        comment="draft | pending | published | rejected",
    )
    likes: Mapped[int] = mapped_column(Integer, default=0)
    view_count: Mapped[int] = mapped_column(Integer, default=0)
    author_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    cover_image: Mapped[str | None] = mapped_column(String(500), nullable=True)
    images: Mapped[list[str] | None] = mapped_column(
        ARRAY(String), server_default="{}", nullable=True,
    )
    source_url: Mapped[str | None] = mapped_column(
        String(500), unique=True, nullable=True,
    )
    publish_time: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
    )
