"""Pydantic schemas for Gaoling Life API."""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints


# ── Post schemas ──────────────────────────────────────────────────

CategoryType = Literal["sport", "medical", "lecture", "dining", "study"]
SourceFilter = Literal["all", "official", "personal"]
SortType = Literal["time", "hot"]


class PostCreate(BaseModel):
    title: Annotated[str, StringConstraints(min_length=1, max_length=500)]
    summary: Annotated[str, StringConstraints(min_length=1, max_length=2000)]
    category: CategoryType
    images: list[str] = Field(default_factory=list)
    cover_image: str | None = None


class PostResponse(BaseModel):
    id: int
    title: str
    summary: str
    category: str
    is_official: bool
    status: str
    likes: int
    view_count: int
    author_name: str | None
    cover_image: str | None
    images: list[str]
    source_url: str | None
    publish_time: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class PostListResponse(BaseModel):
    items: list[PostResponse]
    total: int
    page: int
    page_size: int


# ── Chat (RAG) schemas ───────────────────────────────────────────

class ChatRequest(BaseModel):
    message: Annotated[str, StringConstraints(min_length=1, max_length=1000)]
    category: CategoryType | None = None
    session_id: str | None = None


class CitedPost(BaseModel):
    post_id: int
    citation_index: int
    excerpt: str | None = None


class ChatResponse(BaseModel):
    success: bool
    answer: str | None = None
    sorted_post_ids: list[int] | None = None
    cited_posts: list[CitedPost] | None = None
    session_id: str | None = None
    error: str | None = None


# ── Crawl schemas ────────────────────────────────────────────────

class CrawlResponse(BaseModel):
    success: bool
    new_posts: int = 0
    updated_posts: int = 0
    message: str = ""
