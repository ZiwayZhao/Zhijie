"""User LLM settings — per-user API key and model configuration.

Each user can configure their own LLM provider, so the pipeline
uses their key instead of the system default.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class UserLLMSettings(Base):
    __tablename__ = "user_llm_settings"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
        index=True,
    )
    llm_provider: Mapped[str] = mapped_column(
        String(50), nullable=False, default="system",
        comment="system | openrouter | tencent | openai | custom",
    )
    llm_base_url: Mapped[str | None] = mapped_column(
        Text, nullable=True,
        comment="Custom OpenAI-compatible base URL",
    )
    llm_api_key_encrypted: Mapped[str | None] = mapped_column(
        Text, nullable=True,
        comment="Fernet-encrypted API key",
    )
    llm_model: Mapped[str | None] = mapped_column(
        String(100), nullable=True,
        comment="Preferred model name, e.g. hunyuan-turbos, gpt-4o",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
    )
