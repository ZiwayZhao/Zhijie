"""Tutor session sync schemas."""

from pydantic import BaseModel, Field


class TutorMessageItem(BaseModel):
    """Single tutor message."""
    id: str
    role: str  # user | assistant | system
    content: str = Field(max_length=50000)
    timestamp: int  # ms
    plan: dict | None = None
    tool_results: list[dict] | None = None


class TutorSessionSync(BaseModel):
    """Sync payload (frontend → backend)."""
    messages: list[TutorMessageItem] = Field(default=[], max_length=50)


class TutorSessionResponse(BaseModel):
    """Session returned from backend."""
    material_id: str
    messages: list[TutorMessageItem] = []
    message_count: int = 0
    last_activity_at: str | None = None
