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


async def seed(clear: bool = False):
    """Scrape csdiy.wiki and write to database."""
    categories_map, courses = await scrape_all_courses()

    async with async_session_factory() as db:
        if clear:
            logger.info("Clearing existing course data...")
            await db.execute(delete(Course))
            await db.execute(delete(CourseCategory))
            await db.flush()

        # Upsert categories
        cat_id_map: dict[str, uuid.UUID] = {}
        sort_order = 0
        for cat_name in categories_map:
            slug = _slugify(cat_name)
            stmt = select(CourseCategory).where(CourseCategory.slug == slug)
            existing = (await db.execute(stmt)).scalar_one_or_none()
            if existing:
                cat_id_map[cat_name] = existing.id
                logger.info("Category exists: %s", cat_name)
            else:
                cat = CourseCategory(
                    id=uuid.uuid4(),
                    name=cat_name,
                    slug=slug,
                    sort_order=sort_order,
                )
                db.add(cat)
                cat_id_map[cat_name] = cat.id
                logger.info("Created category: %s (%s)", cat_name, slug)
            sort_order += 1

            # Create sub-categories
            for subcat_name in categories_map[cat_name]:
                sub_slug = f"{slug}-{_slugify(subcat_name)}"
                stmt = select(CourseCategory).where(
                    CourseCategory.slug == sub_slug
                )
                existing = (await db.execute(stmt)).scalar_one_or_none()
                if existing:
                    cat_id_map[subcat_name] = existing.id
                else:
                    sub = CourseCategory(
                        id=uuid.uuid4(),
                        name=subcat_name,
                        slug=sub_slug,
                        sort_order=sort_order,
                        parent_id=cat_id_map[cat_name],
                    )
                    db.add(sub)
                    cat_id_map[subcat_name] = sub.id
                    logger.info(
                        "  Sub-category: %s (%s)", subcat_name, sub_slug
                    )
                sort_order += 1

        await db.flush()

        # Upsert courses (one by one to handle slug collisions)
        created = 0
        updated = 0
        seen_slugs: set[str] = set()
        for pc in courses:
            # Determine category: use subcategory if exists
            cat_key = pc.subcategory or pc.category
            category_id = cat_id_map.get(cat_key) or cat_id_map.get(pc.category)
            if category_id is None:
                logger.warning("No category for course: %s", pc.name)
                continue

            slug = _make_course_slug(pc)
            # Handle slug collision within this batch
            if slug in seen_slugs:
                slug = f"{slug}-{_slugify(pc.category)}"
            if slug in seen_slugs:
                slug = f"{slug}-{uuid.uuid4().hex[:6]}"
            seen_slugs.add(slug)

            stmt = select(Course).where(Course.slug == slug)
            existing = (await db.execute(stmt)).scalar_one_or_none()

            if existing:
                # Update fields
                existing.name = pc.name
                existing.university = pc.university
                existing.instructor = pc.instructor
                existing.language = pc.language
                existing.programming_lang = pc.programming_lang
                existing.difficulty = pc.difficulty
                existing.estimated_hours = pc.estimated_hours
                existing.description = pc.description
                existing.prerequisites = pc.prerequisites
                existing.website_url = pc.website_url
                existing.video_url = pc.video_url
                existing.csdiy_source = pc.md_path
                existing.tags = pc.tags
                existing.category_id = category_id
                updated += 1
            else:
                course = Course(
                    id=uuid.uuid4(),
                    category_id=category_id,
                    name=pc.name,
                    slug=slug,
                    university=pc.university,
                    instructor=pc.instructor,
                    language=pc.language,
                    programming_lang=pc.programming_lang,
                    difficulty=pc.difficulty,
                    estimated_hours=pc.estimated_hours,
                    description=pc.description,
                    prerequisites=pc.prerequisites,
                    website_url=pc.website_url,
                    video_url=pc.video_url,
                    csdiy_source=pc.md_path,
                    tags=pc.tags,
                )
                db.add(course)
                await db.flush()
                created += 1

        await db.commit()
        logger.info(
            "Done! Created %d, updated %d courses (%d categories)",
            created, updated, len(cat_id_map),
        )


def _make_course_slug(pc: ParsedCourse) -> str:
    """Generate a unique slug for a course."""
    name = pc.name
    # Match full course codes like "CS61B", "15-445", "6.S081", "18.01/18.02"
    # Pattern: letters+digits with possible dots/dashes/slashes
    match = re.search(r"[A-Z]{1,}[\s-]?\d+[A-Z]?(?:[./]\d+[A-Z]?)*(?:-\d+)?", name)
    if match:
        code = match.group(0).strip().lower().replace(" ", "")
        # Replace special chars with dashes
        code = re.sub(r"[/.]", "-", code)
        return code

    # Fall back to slugified full name
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
