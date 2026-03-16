import uuid
from datetime import datetime

from pydantic import BaseModel


class CategoryResponse(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    sort_order: int
    parent_id: uuid.UUID | None = None
    course_count: int = 0

    model_config = {"from_attributes": True}


class CourseResponse(BaseModel):
    id: uuid.UUID
    category_id: uuid.UUID
    category_name: str = ""
    category_slug: str = ""
    name: str
    slug: str
    university: str | None = None
    instructor: str | None = None
    language: str = "en"
    programming_lang: str | None = None
    difficulty: int = 3
    estimated_hours: int | None = None
    description: str = ""
    prerequisites: str | None = None
    website_url: str | None = None
    video_url: str | None = None
    csdiy_source: str = ""
    tags: list[str] = []
    student_count: int = 0
    material_count: int = 0
    created_at: datetime | None = None

    model_config = {"from_attributes": True}


class CourseListResponse(BaseModel):
    items: list[CourseResponse]
    total: int
    page: int
    page_size: int


class CategoryListResponse(BaseModel):
    items: list[CategoryResponse]
    total: int
