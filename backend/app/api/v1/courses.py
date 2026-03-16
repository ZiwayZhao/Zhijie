"""Course & category browsing API — public (no JWT required)."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.course import Course, CourseCategory
from app.schemas.course import (
    CategoryListResponse,
    CategoryResponse,
    CourseListResponse,
    CourseResponse,
)

router = APIRouter(prefix="/courses", tags=["courses"])


@router.get("", response_model=CourseListResponse)
async def list_courses(
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    category: str | None = Query(None, description="Category slug filter"),
    search: str | None = Query(None, description="Search in name/description"),
    language: str | None = Query(None),
    difficulty: int | None = Query(None, ge=1, le=5),
):
    """List courses with pagination, filtering, and search."""
    stmt = select(Course)

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

    # Search filter
    if search:
        pattern = f"%{search}%"
        stmt = stmt.where(
            Course.name.ilike(pattern)
            | Course.description.ilike(pattern)
            | Course.university.ilike(pattern)
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

    # Paginate
    offset = (page - 1) * page_size
    stmt = stmt.order_by(Course.name).offset(offset).limit(page_size)
    result = await db.execute(stmt)
    courses = result.scalars().all()

    items = []
    for c in courses:
        resp = CourseResponse.model_validate(c)
        if c.category:
            resp.category_name = c.category.name
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
    """Get a single course by slug."""
    stmt = select(Course).where(Course.slug == slug)
    result = await db.execute(stmt)
    course = result.scalar_one_or_none()

    if course is None:
        raise HTTPException(status_code=404, detail="Course not found")

    resp = CourseResponse.model_validate(course)
    if course.category:
        resp.category_name = course.category.name
    return resp
