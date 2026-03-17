"""Course & category browsing API — public (no JWT required)."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.course import Course, CourseCategory, CourseMaterialSource
from app.schemas.course import (
    CategoryListResponse,
    CategoryResponse,
    CourseListResponse,
    CourseMaterialSourceResponse,
    CourseResponse,
)

router = APIRouter(prefix="/courses", tags=["courses"])


@router.get("", response_model=CourseListResponse)
async def list_courses(
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    category: str | None = Query(None, description="Category slug filter"),
    search: str | None = Query(None, min_length=1, max_length=100, description="Search in name/description"),
    language: str | None = Query(None),
    difficulty: int | None = Query(None, ge=1, le=5),
    sort: str | None = Query(None, description="Sort: name, popular, newest"),
):
    """List courses with pagination, filtering, and search.

    Public endpoint: only returns published courses (and raw/ai_rewritten
    during dev for backward compatibility — remove filter once editorial
    pipeline is operational).
    """
    stmt = select(Course).where(
        Course.content_status.in_(("raw", "ai_rewritten", "reviewed", "published"))
    )

    # Category filter
    if category:
        cat_stmt = select(CourseCategory.id).where(
            CourseCategory.slug == category
        )
        cat_result = await db.execute(cat_stmt)
        cat_id = cat_result.scalar_one_or_none()
        if cat_id is None:
            return CourseListResponse(
                items=[], total=0, page=page, page_size=page_size
            )
        stmt = stmt.where(Course.category_id == cat_id)

    # Search filter (escape backslash first, then LIKE wildcards)
    if search:
        escaped = (
            search.replace("\\", "\\\\")
            .replace("%", "\\%")
            .replace("_", "\\_")
        )
        pattern = f"%{escaped}%"
        stmt = stmt.where(
            Course.name.ilike(pattern, escape="\\")
            | Course.description.ilike(pattern, escape="\\")
            | Course.platform_description.ilike(pattern, escape="\\")
            | Course.university.ilike(pattern, escape="\\")
        )

    # Language filter
    if language:
        stmt = stmt.where(Course.language == language)

    # Difficulty filter
    if difficulty:
        stmt = stmt.where(Course.difficulty == difficulty)

    # Count
    count_stmt = select(func.count()).select_from(stmt.subquery())
    total = (await db.execute(count_stmt)).scalar() or 0

    # Sort
    if sort == "popular":
        stmt = stmt.order_by(Course.student_count.desc(), Course.name)
    elif sort == "newest":
        stmt = stmt.order_by(Course.created_at.desc())
    else:
        stmt = stmt.order_by(Course.name)

    # Paginate
    offset = (page - 1) * page_size
    stmt = stmt.offset(offset).limit(page_size)
    result = await db.execute(stmt)
    courses = result.scalars().all()

    items = []
    for c in courses:
        resp = CourseResponse.model_validate(c)
        if c.category:
            resp.category_name = c.category.name
            resp.category_slug = c.category.slug
        items.append(resp)

    return CourseListResponse(
        items=items, total=total, page=page, page_size=page_size
    )


@router.get("/categories", response_model=CategoryListResponse)
async def list_categories(
    db: AsyncSession = Depends(get_db),
):
    """List all course categories with course counts."""
    # Get categories with course counts
    stmt = (
        select(
            CourseCategory,
            func.count(Course.id).label("course_count"),
        )
        .outerjoin(Course, Course.category_id == CourseCategory.id)
        .group_by(CourseCategory.id)
        .order_by(CourseCategory.sort_order, CourseCategory.name)
    )
    result = await db.execute(stmt)
    rows = result.all()

    items = []
    for cat, count in rows:
        resp = CategoryResponse.model_validate(cat)
        resp.course_count = count
        items.append(resp)

    return CategoryListResponse(items=items, total=len(items))


@router.get("/{slug}", response_model=CourseResponse)
async def get_course(
    slug: str,
    db: AsyncSession = Depends(get_db),
):
    """Get a single course by slug (SEC-04: same filter as list)."""
    _visible = ("raw", "ai_rewritten", "reviewed", "published")
    stmt = select(Course).where(
        Course.slug == slug,
        Course.content_status.in_(_visible),
    )
    result = await db.execute(stmt)
    course = result.scalar_one_or_none()

    if course is None:
        raise HTTPException(status_code=404, detail="Course not found")

    resp = CourseResponse.model_validate(course)
    if course.category:
        resp.category_name = course.category.name
        resp.category_slug = course.category.slug
    return resp


@router.get("/{slug}/resources")
async def list_course_resources(
    slug: str,
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    content_type: str | None = Query(None, description="Filter by content type (pdf, video, page)"),
):
    """List external material sources for a course (OCW PDFs, etc.)."""
    # Find course by slug
    course_stmt = select(Course.id).where(Course.slug == slug)
    course_result = await db.execute(course_stmt)
    course_id = course_result.scalar_one_or_none()
    if course_id is None:
        raise HTTPException(status_code=404, detail="Course not found")

    # Build query
    stmt = select(CourseMaterialSource).where(
        CourseMaterialSource.course_id == course_id
    )
    if content_type:
        stmt = stmt.where(CourseMaterialSource.content_type == content_type)

    # Count
    count_stmt = select(func.count()).select_from(stmt.subquery())
    total = (await db.execute(count_stmt)).scalar() or 0

    # Paginate
    offset = (page - 1) * page_size
    stmt = stmt.order_by(
        CourseMaterialSource.content_feature,
        CourseMaterialSource.title,
    ).offset(offset).limit(page_size)
    result = await db.execute(stmt)
    sources = result.scalars().all()

    items = [CourseMaterialSourceResponse.model_validate(s) for s in sources]
    return {"items": items, "total": total, "page": page, "page_size": page_size}
