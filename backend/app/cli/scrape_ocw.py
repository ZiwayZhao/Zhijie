"""Scrape MIT OpenCourseWare and upsert into database.

Usage:
    cd backend
    PYTHONPATH=. python -m app.cli.scrape_ocw
    PYTHONPATH=. python -m app.cli.scrape_ocw --department 18 --limit 50
    PYTHONPATH=. python -m app.cli.scrape_ocw --with-content-files
"""

import argparse
import asyncio
import logging
import re
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import async_session_factory
from app.models.course import (
    Course, CourseCategory, CourseMaterialSource,
)
from app.services.ocw_scraper import (
    OCWCourse, OCWContentFile,
    scrape_ocw_courses, scrape_ocw_content_files,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s  %(message)s",
)
logger = logging.getLogger(__name__)

# Mapping from MIT department names to existing category slugs
_DEPT_TO_CATEGORY_SLUG = {
    "Mathematics": "fundamental-mathematics",
    "Electrical Engineering and Computer Science": "data-structures-and-algorithms",
    "Physics": "fundamental-mathematics",
    "Brain and Cognitive Sciences": "artificial-intelligence",
    "Mechanical Engineering": "computer-architecture",
}


def _slugify(text: str) -> str:
    """Generate URL-safe slug from text."""
    text = text.lower().strip()
    text = text.replace("c++", "cpp")
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-") or "misc"


async def _find_or_create_category(
    db: AsyncSession,
    dept_name: str,
) -> uuid.UUID:
    """Find existing category or create one from MIT department name."""
    # Try known mapping first
    mapped_slug = _DEPT_TO_CATEGORY_SLUG.get(dept_name)
    if mapped_slug:
        stmt = select(CourseCategory).where(CourseCategory.slug == mapped_slug)
        existing = (await db.execute(stmt)).scalar_one_or_none()
        if existing:
            return existing.id

    # Try slugified department name
    slug = _slugify(dept_name)
    stmt = select(CourseCategory).where(CourseCategory.slug == slug)
    existing = (await db.execute(stmt)).scalar_one_or_none()
    if existing:
        return existing.id

    # Create new category
    cat = CourseCategory(
        id=uuid.uuid4(),
        name=dept_name,
        slug=slug,
        sort_order=999,  # append at end
    )
    db.add(cat)
    await db.flush()
    logger.info("Created category: %s (%s)", dept_name, slug)
    return cat.id


def _make_slug(ocw: OCWCourse) -> str:
    """Generate slug from OCW course data."""
    # Prefer course number (e.g., "18-06sc")
    if ocw.course_number:
        slug = _slugify(ocw.course_number)
        if slug and slug != "misc":
            return f"mit-{slug}"

    # Fallback to title
    slug = _slugify(ocw.title)
    if len(slug) > 80:
        slug = slug[:80].rstrip("-")
    return slug


async def _upsert_course(
    db: AsyncSession,
    ocw: OCWCourse,
    category_id: uuid.UUID,
) -> tuple[Course, bool]:
    """Upsert a single OCW course. Returns (course, is_new)."""
    # Check for existing by source_id
    stmt = select(Course).where(
        Course.source_platform == "mit_ocw",
        Course.source_id == str(ocw.ocw_id),
    )
    existing = (await db.execute(stmt)).scalar_one_or_none()

    if existing:
        # Update raw fields only — never touch platform_description
        # of reviewed/published courses (R-10)
        existing.raw_description = ocw.description
        existing.last_scraped_at = datetime.now(timezone.utc)
        if existing.content_status not in ("reviewed", "published"):
            existing.university = "MIT"
            existing.instructor = "; ".join(ocw.instructors[:5])
            existing.department = ocw.department
            existing.school = ocw.school
            existing.semester = ocw.semester
            existing.level = ocw.level
            existing.image_url = ocw.image_url
            existing.completeness = ocw.completeness
            existing.source_url = ocw.url
            existing.tags = [_slugify(t) for t in ocw.topics[:10]]
        return existing, False

    # Create new course
    slug = _make_slug(ocw)
    # Append random suffix to avoid slug collisions (RACE-01 safe)
    slug_check = select(Course).where(Course.slug == slug)
    if (await db.execute(slug_check)).scalar_one_or_none():
        slug = f"{slug}-{uuid.uuid4().hex[:6]}"

    course = Course(
        id=uuid.uuid4(),
        slug=slug,
        name=ocw.title,
        category_id=category_id,
        university="MIT",
        instructor="; ".join(ocw.instructors[:5]),
        language="en",
        description=ocw.description,
        raw_description=ocw.description,
        content_status="raw",
        source_platform="mit_ocw",
        source_id=str(ocw.ocw_id),
        source_url=ocw.url,
        department=ocw.department,
        school=ocw.school,
        semester=ocw.semester,
        level=ocw.level,
        image_url=ocw.image_url,
        completeness=ocw.completeness,
        license="CC BY-NC-SA 4.0",
        tags=[_slugify(t) for t in ocw.topics[:10]],
        website_url=ocw.url,
    )
    db.add(course)

    # Handle IntegrityError from concurrent inserts (RACE-02)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        # Re-fetch the existing row created by a concurrent process
        existing = (await db.execute(stmt)).scalar_one_or_none()
        if existing:
            return existing, False
        raise

    return course, True


async def _upsert_content_files(
    db: AsyncSession,
    course_id: uuid.UUID,
    files: list[OCWContentFile],
) -> int:
    """Upsert content files for a course. Returns count of new files.

    Pre-fetches existing IDs to avoid N+1 queries (PERF-01).
    """
    # Batch fetch existing ocw_content_ids for this course
    existing_stmt = (
        select(CourseMaterialSource.ocw_content_id)
        .where(CourseMaterialSource.course_id == course_id)
    )
    result = await db.execute(existing_stmt)
    existing_ids = {row[0] for row in result if row[0] is not None}

    created = 0
    for cf in files:
        if cf.content_id in existing_ids:
            continue

        source = CourseMaterialSource(
            id=uuid.uuid4(),
            course_id=course_id,
            title=cf.title,
            source_url=cf.url,
            content_type=cf.content_type or "file",
            content_feature=cf.content_feature,
            file_extension=cf.file_extension,
            ocw_content_id=cf.content_id,
            license="CC BY-NC-SA 4.0",
            attribution="MIT OpenCourseWare, CC BY-NC-SA 4.0",
        )
        db.add(source)
        created += 1

    return created


async def scrape(
    *,
    department: str | None = None,
    topic: str | None = None,
    limit: int | None = None,
    with_content_files: bool = False,
    rate_limit: float = 1.0,
    batch_size: int = 50,
) -> None:
    """Main scraping workflow with batch commits (RG-1)."""
    logger.info("Starting MIT OCW scrape (dept=%s, limit=%s)", department, limit)

    # Fetch all courses from API
    courses = await scrape_ocw_courses(
        department=department,
        topic=topic,
        limit=limit,
        rate_limit=rate_limit,
    )
    logger.info("Fetched %d courses from API", len(courses))

    total_created = 0
    total_updated = 0
    total_files = 0

    # Process in batches with separate transactions (RG-1)
    for batch_start in range(0, len(courses), batch_size):
        batch = courses[batch_start:batch_start + batch_size]

        async with async_session_factory() as db:
            try:
                for ocw in batch:
                    category_id = await _find_or_create_category(
                        db, ocw.department or "Other",
                    )
                    course, is_new = await _upsert_course(db, ocw, category_id)
                    if is_new:
                        total_created += 1
                    else:
                        total_updated += 1

                    if with_content_files:
                        files = await scrape_ocw_content_files(
                            ocw.ocw_id,
                            file_types=[".pdf"],
                            rate_limit=rate_limit,
                        )
                        new_files = await _upsert_content_files(
                            db, course.id, files,
                        )
                        total_files += new_files

                await db.commit()
                batch_end = min(batch_start + batch_size, len(courses))
                logger.info(
                    "Committed batch %d-%d/%d",
                    batch_start + 1, batch_end, len(courses),
                )
            except Exception:
                await db.rollback()
                logger.exception(
                    "Batch %d-%d failed, rolling back",
                    batch_start + 1,
                    min(batch_start + batch_size, len(courses)),
                )

    logger.info(
        "OCW scrape complete: %d created, %d updated, %d content files",
        total_created, total_updated, total_files,
    )


def main():
    parser = argparse.ArgumentParser(description="Scrape MIT OCW courses")
    parser.add_argument("--department", help="MIT department ID (e.g., 18)")
    parser.add_argument("--topic", help="Topic name filter")
    parser.add_argument("--limit", type=int, help="Max courses to fetch")
    parser.add_argument("--with-content-files", action="store_true",
                        help="Also fetch PDF content file listings")
    parser.add_argument("--rate-limit", type=float, default=1.0,
                        help="Seconds between API calls (default: 1.0)")
    parser.add_argument("--batch-size", type=int, default=50,
                        help="DB commit batch size (default: 50)")
    args = parser.parse_args()

    asyncio.run(scrape(
        department=args.department,
        topic=args.topic,
        limit=args.limit,
        with_content_files=args.with_content_files,
        rate_limit=args.rate_limit,
        batch_size=args.batch_size,
    ))


if __name__ == "__main__":
    main()
