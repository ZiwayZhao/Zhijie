import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger, Boolean, CheckConstraint, DateTime,
    ForeignKey, Index, Integer, Numeric, SmallInteger,
    String, Text, UniqueConstraint, func,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

# Valid content_status values for courses
CONTENT_STATUS_VALUES = ("raw", "ai_rewritten", "reviewed", "published",
                         "rejected", "archived", "draft", "rewrite_failed")
# Valid source_platform values
SOURCE_PLATFORM_VALUES = ("csdiy", "mit_ocw", "manual", "stanford", "coursera")


class CourseCategory(Base):
    __tablename__ = "course_categories"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(200), nullable=False, unique=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("course_categories.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Relationships
    parent: Mapped["CourseCategory | None"] = relationship(
        "CourseCategory", remote_side="CourseCategory.id", lazy="selectin"
    )
    courses: Mapped[list["Course"]] = relationship(
        "Course", back_populates="category", lazy="selectin"
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class Course(Base):
    __tablename__ = "courses"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    category_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("course_categories.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(500), nullable=False)
    slug: Mapped[str] = mapped_column(String(500), nullable=False, unique=True)
    university: Mapped[str | None] = mapped_column(String(200), nullable=True)
    instructor: Mapped[str | None] = mapped_column(String(200), nullable=True)
    language: Mapped[str] = mapped_column(String(10), nullable=False, default="en")
    programming_lang: Mapped[str | None] = mapped_column(String(50), nullable=True)
    difficulty: Mapped[int] = mapped_column(SmallInteger, default=3)
    estimated_hours: Mapped[int | None] = mapped_column(Integer, nullable=True)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    prerequisites: Mapped[str | None] = mapped_column(Text, nullable=True)
    website_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    video_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    csdiy_source: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    tags: Mapped[list[str]] = mapped_column(
        ARRAY(String(100)), nullable=False, server_default="{}"
    )
    student_count: Mapped[int] = mapped_column(Integer, default=0)
    material_count: Mapped[int] = mapped_column(Integer, default=0)

    # --- New fields (Sprint 3.5): content pipeline + multi-source ---
    raw_description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    platform_description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    content_status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="raw",
    )
    learning_objectives: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    target_audience: Mapped[str | None] = mapped_column(Text, nullable=True)
    syllabus: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    source_platform: Mapped[str] = mapped_column(
        String(50), nullable=False, default="csdiy",
    )
    source_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    source_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    semester: Mapped[str | None] = mapped_column(String(20), nullable=True)
    level: Mapped[str | None] = mapped_column(String(20), nullable=True)
    school: Mapped[str | None] = mapped_column(String(200), nullable=True)
    department: Mapped[str | None] = mapped_column(String(200), nullable=True)
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    completeness: Mapped[float | None] = mapped_column(
        Numeric(3, 2), nullable=True,
    )
    license: Mapped[str | None] = mapped_column(String(50), nullable=True)
    last_scraped_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), onupdate=func.now(),
    )

    # Relationships
    category: Mapped["CourseCategory"] = relationship(
        "CourseCategory", back_populates="courses", lazy="selectin"
    )
    material_sources: Mapped[list["CourseMaterialSource"]] = relationship(
        "CourseMaterialSource", back_populates="course", lazy="noload",
        cascade="all, delete-orphan",
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    __table_args__ = (
        CheckConstraint(
            f"content_status IN {CONTENT_STATUS_VALUES}",
            name="ck_courses_content_status",
        ),
        Index("ix_courses_content_status", "content_status"),
        Index("ix_courses_source_platform", "source_platform"),
        UniqueConstraint(
            "source_platform", "source_id",
            name="uq_courses_source",
        ),
        CheckConstraint(
            "completeness IS NULL OR (completeness >= 0 AND completeness <= 1)",
            name="ck_courses_completeness_range",
        ),
    )


class CourseMaterialSource(Base):
    """External material reference for a course (e.g., MIT OCW PDFs)."""

    __tablename__ = "course_material_sources"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    course_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("courses.id", ondelete="CASCADE"),
        nullable=False,
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    source_url: Mapped[str] = mapped_column(Text, nullable=False)
    content_type: Mapped[str] = mapped_column(
        String(50), nullable=False,
    )  # pdf, video, page, assignment, exam, notes
    content_feature: Mapped[str | None] = mapped_column(
        String(100), nullable=True,
    )  # "Lecture Notes", "Problem Sets", etc.
    file_extension: Mapped[str | None] = mapped_column(String(10), nullable=True)
    ocw_content_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    download_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    downloaded: Mapped[bool] = mapped_column(Boolean, default=False)
    s3_key: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    file_size: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    license: Mapped[str | None] = mapped_column(String(50), nullable=True)
    attribution: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Relationships
    course: Mapped["Course"] = relationship(
        "Course", back_populates="material_sources",
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    __table_args__ = (
        Index("ix_cms_course", "course_id"),
        Index("ix_cms_course_type", "course_id", "content_type"),
        Index("ix_cms_not_downloaded", "downloaded",
              postgresql_where="downloaded = false"),
        UniqueConstraint(
            "course_id", "ocw_content_id",
            name="uq_cms_ocw_content",
        ),
    )
