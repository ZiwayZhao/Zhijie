import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, StringConstraints, field_validator


class UploadRequest(BaseModel):
    """Client requests a presigned URL to upload a file."""
    filename: Annotated[str, StringConstraints(min_length=1, max_length=500)]
    content_type: Annotated[str, StringConstraints(min_length=1, max_length=100)]
    file_size: int  # bytes
    title: Annotated[str, StringConstraints(min_length=1, max_length=500)]
    description: str | None = None
    material_type: str = "pdf"
    semester: str | None = None
    course_id: uuid.UUID | None = None

    @field_validator("file_size")
    @classmethod
    def validate_file_size(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("file_size must be greater than 0")
        return v


class UploadResponse(BaseModel):
    """Returns presigned URL + material ID."""
    material_id: uuid.UUID
    upload_url: str
    s3_key: str


class MaterialResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    course_id: uuid.UUID | None
    filename: str
    content_type: str
    file_size: int
    title: str
    description: str | None
    material_type: str
    semester: str | None
    analysis_status: str
    download_count: int
    created_at: datetime
    download_url: str | None = None  # populated on request

    model_config = {"from_attributes": True}


class MaterialList(BaseModel):
    items: list[MaterialResponse]
    total: int
