"""Seed database with courses from csdiy.wiki.

Usage:
    cd backend
    PYTHONPATH=. python -m app.cli.seed_courses
"""

import asyncio
import logging
import re
import sys
import uuid

from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import async_session_factory
from app.models.course import Course, CourseCategory
from app.services.course_scraper import (
    ParsedCourse,
    scrape_all_courses,
    _slugify,
    CATEGORY_EN,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s  %(message)s",
)
logger = logging.getLogger(__name__)


async def _upsert_categories(
    db: AsyncSession,
    categories_map: dict[str, list[str]],
) -> dict[str, uuid.UUID]:
    """Upsert categories and sub-categories, return (cat, subcat)→id map.

    Keys use composite (cat_name, subcat_name) tuples to avoid
    collisions when different parent categories share subcategory names.
    Top-level categories use (cat_name, None) as key.
    """
    cat_id_map: dict[tuple[str, str | None], uuid.UUID] = {}
    sort_order = 0
    for cat_name in categories_map:
        slug = _slugify(cat_name)
        stmt = select(CourseCategory).where(CourseCategory.slug == slug)
        existing = (await db.execute(stmt)).scalar_one_or_none()
        if existing:
            cat_id_map[(cat_name, None)] = existing.id
        else:
            cat = CourseCategory(
                id=uuid.uuid4(), name=cat_name,
                slug=slug, sort_order=sort_order,
            )
            db.add(cat)
            cat_id_map[(cat_name, None)] = cat.id
            logger.info("Created category: %s (%s)", cat_name, slug)
        sort_order += 1

        for subcat_name in categories_map[cat_name]:
            sub_slug = f"{slug}-{_slugify(subcat_name)}"
            stmt = select(CourseCategory).where(CourseCategory.slug == sub_slug)
            existing = (await db.execute(stmt)).scalar_one_or_none()
            if existing:
                cat_id_map[(cat_name, subcat_name)] = existing.id
            else:
                sub = CourseCategory(
                    id=uuid.uuid4(), name=subcat_name, slug=sub_slug,
                    sort_order=sort_order, parent_id=cat_id_map[(cat_name, None)],
                )
                db.add(sub)
                cat_id_map[(cat_name, subcat_name)] = sub.id
                logger.info("  Sub-category: %s (%s)", subcat_name, sub_slug)
            sort_order += 1

    await db.flush()
    return cat_id_map


def _apply_course_fields(target: Course, pc: ParsedCourse, category_id: uuid.UUID):
    """Copy ParsedCourse fields onto a Course ORM instance."""
    target.name = pc.name
    target.university = pc.university
    target.instructor = pc.instructor
    target.language = pc.language
    target.programming_lang = pc.programming_lang
    target.difficulty = pc.difficulty
    target.estimated_hours = pc.estimated_hours
    target.description = pc.description
    target.prerequisites = pc.prerequisites
    target.website_url = pc.website_url
    target.video_url = pc.video_url
    target.csdiy_source = pc.md_path
    target.tags = pc.tags
    target.category_id = category_id


async def _upsert_courses(
    db: AsyncSession,
    courses: list[ParsedCourse],
    cat_id_map: dict[tuple[str, str | None], uuid.UUID],
) -> tuple[int, int]:
    """Upsert courses, return (created, updated) counts."""
    created = updated = 0
    seen_slugs: set[str] = set()
    for pc in courses:
        # Use composite key: (category, subcategory) → fallback to (category, None)
        category_id = (
            cat_id_map.get((pc.category, pc.subcategory))
            or cat_id_map.get((pc.category, None))
        )
        if category_id is None:
            logger.warning("No category for course: %s", pc.name)
            continue

        slug = _make_course_slug(pc)
        if slug in seen_slugs:
            slug = f"{slug}-{_slugify(pc.category)}"
        if slug in seen_slugs:
            slug = f"{slug}-{uuid.uuid4().hex[:6]}"
        seen_slugs.add(slug)

        stmt = select(Course).where(Course.slug == slug)
        existing = (await db.execute(stmt)).scalar_one_or_none()
        if existing:
            _apply_course_fields(existing, pc, category_id)
            updated += 1
        else:
            course = Course(id=uuid.uuid4(), slug=slug)
            _apply_course_fields(course, pc, category_id)
            db.add(course)
            await db.flush()
            created += 1

    return created, updated


async def seed(clear: bool = False):
    """Scrape csdiy.wiki and write to database."""
    categories_map, courses = await scrape_all_courses()

    async with async_session_factory() as db:
        try:
            if clear:
                logger.info("Clearing existing course data...")
                # Delete children first (Course FK → CourseCategory)
                await db.execute(delete(Course))
                await db.execute(delete(CourseCategory))
                await db.flush()

            cat_id_map = await _upsert_categories(db, categories_map)
            created, updated = await _upsert_courses(db, courses, cat_id_map)
            await db.commit()
            logger.info(
                "Done! Created %d, updated %d courses (%d categories)",
                created, updated, len(cat_id_map),
            )
        except Exception:
            await db.rollback()
            logger.exception("Seed failed, transaction rolled back")
            raise


def _make_course_slug(pc: ParsedCourse) -> str:
    """Generate a unique slug for a course."""
    name = pc.name
    match = re.search(
        r"[A-Z]{1,}[\s-]?\d+[A-Z]?(?:[./]\d+[A-Z]?)*(?:-\d+)?", name,
    )
    if match:
        code = match.group(0).strip().lower().replace(" ", "")
        code = re.sub(r"[/.]", "-", code)
        return code
    slug = _slugify(name)
    if len(slug) > 80:
        slug = slug[:80].rstrip("-")
    return slug


async def main():
    clear = "--clear" in sys.argv
    if clear:
        logger.info("Will CLEAR existing data before seeding")
    await seed(clear=clear)


if __name__ == "__main__":
    asyncio.run(main())
