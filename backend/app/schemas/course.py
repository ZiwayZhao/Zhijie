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
    """Public course response — only shows published-ready fields."""

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
    platform_description: str = ""
    learning_objectives: list[str] | None = None
    target_audience: str | None = None
    prerequisites: str | None = None
    website_url: str | None = None
    video_url: str | None = None
    csdiy_source: str = ""
    tags: list[str] = []
    student_count: int = 0
    material_count: int = 0
    source_platform: str = "csdiy"
    level: str | None = None
    semester: str | None = None
    department: str | None = None
    image_url: str | None = None
    created_at: datetime | None = None

    model_config = {"from_attributes": True}


class AdminCourseResponse(CourseResponse):
    """Admin course response — includes content pipeline fields."""

    raw_description: str = ""
    content_status: str = "raw"
    source_id: str | None = None
    source_url: str | None = None
    school: str | None = None
    syllabus: dict | None = None
    completeness: float | None = None
    license: str | None = None
    last_scraped_at: datetime | None = None
    updated_at: datetime | None = None


class CourseListResponse(BaseModel):
    items: list[CourseResponse]
    total: int
    page: int
    page_size: int


class CategoryListResponse(BaseModel):
    items: list[CategoryResponse]
    total: int


class CourseMaterialSourceResponse(BaseModel):
    id: uuid.UUID
    course_id: uuid.UUID
    title: str
    source_url: str
    content_type: str
    content_feature: str | None = None
    file_extension: str | None = None
    download_url: str | None = None
    downloaded: bool = False
    license: str | None = None
    attribution: str | None = None
    created_at: datetime | None = None

    model_config = {"from_attributes": True}
