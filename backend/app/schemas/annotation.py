"""PDF annotation sync schemas."""

from pydantic import BaseModel, Field


class AnnotationItem(BaseModel):
    """Single annotation for sync."""
    client_id: str  # Frontend-generated ID (e.g., "hl-1234-abcd")
    highlight_data: dict  # Full react-pdf-highlighter Highlight object
    color: str | None = None
    comment: str | None = None


class AnnotationSyncRequest(BaseModel):
    """Batch annotation sync (frontend → backend)."""
    annotations: list[AnnotationItem] = Field(default=[], max_length=500)


class AnnotationSyncResponse(BaseModel):
    """Sync result."""
    created: int = 0
    updated: int = 0
    total: int = 0


class AnnotationListResponse(BaseModel):
    """List annotations for a material."""
    material_id: str
    annotations: list[AnnotationItem] = []
    total: int = 0
