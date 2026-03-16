"""AI rewrite course descriptions to platform standard format.

Idempotent: only processes courses with content_status='raw'.
Never touches reviewed/published courses.

Usage:
    cd backend
    PYTHONPATH=. python -m app.cli.rewrite_courses
    PYTHONPATH=. python -m app.cli.rewrite_courses --limit 10 --dry-run
    PYTHONPATH=. python -m app.cli.rewrite_courses --force  # re-process ai_rewritten
"""

import argparse
import asyncio
import logging

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import async_session_factory
from app.models.course import Course
from app.services.content_rewriter import rewrite_batch

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s  %(message)s",
)
logger = logging.getLogger(__name__)


async def rewrite(
    *,
    limit: int | None = None,
    force: bool = False,
    dry_run: bool = False,
    concurrency: int = 5,
    batch_size: int = 20,
) -> None:
    """Rewrite raw course descriptions using AI.

    Args:
        limit: Max courses to process.
        force: Also re-process 'ai_rewritten' courses.
        dry_run: Don't write to DB, just log what would be done.
        concurrency: Max concurrent LLM calls.
        batch_size: DB commit batch size.
    """
    # Determine which statuses to process (R-04: idempotent)
    statuses = ["raw"]
    if force:
        statuses.append("ai_rewritten")
        logger.info("Force mode: will re-process ai_rewritten courses")

    async with async_session_factory() as db:
        # Count eligible courses
        count_stmt = (
            select(func.count())
            .select_from(Course)
            .where(Course.content_status.in_(statuses))
        )
        total = (await db.execute(count_stmt)).scalar() or 0
        logger.info("Found %d courses eligible for rewriting", total)

        if total == 0:
            logger.info("Nothing to rewrite")
            return

        # Fetch courses in batches — always offset=0 since processed
        # rows leave the result set (status changes from raw) (DATA-02)
        effective_limit = min(limit or total, total)
        processed = 0
        succeeded = 0
        failed = 0

        while processed < effective_limit:
            stmt = (
                select(Course)
                .where(Course.content_status.in_(statuses))
                .order_by(Course.created_at)
                .limit(batch_size)
            )
            result = await db.execute(stmt)
            courses = result.scalars().all()

            if not courses:
                break

            # Prepare batch input
            course_dicts = []
            for c in courses:
                # Use raw_description if available, fallback to description
                raw = c.raw_description or c.description or ""
                course_dicts.append({
                    "id": str(c.id),
                    "name": c.name,
                    "raw_description": raw,
                    "university": c.university,
                    "category": c.category.name if c.category else None,
                })

            if dry_run:
                for cd in course_dicts:
                    logger.info(
                        "[DRY RUN] Would rewrite: %s (%d chars)",
                        cd["name"],
                        len(cd["raw_description"]),
                    )
                processed += len(course_dicts)
                continue

            # Call AI rewriter
            results = await rewrite_batch(
                course_dicts,
                concurrency=concurrency,
            )

            # Apply results to DB
            course_map = {str(c.id): c for c in courses}
            for course_id, rewritten in results:
                course = course_map.get(course_id)
                if course is None:
                    continue

                if rewritten is None:
                    # Mark as failed so we can retry later
                    course.content_status = "rewrite_failed"
                    failed += 1
                    continue

                course.platform_description = rewritten.platform_description
                course.learning_objectives = rewritten.learning_objectives
                course.target_audience = rewritten.target_audience
                course.content_status = "ai_rewritten"
                # Merge AI-generated tags with existing
                existing_tags = set(course.tags or [])
                new_tags = set(rewritten.tags)
                course.tags = sorted(existing_tags | new_tags)
                succeeded += 1

            await db.commit()
            processed += len(courses)
            logger.info(
                "Batch committed: %d/%d processed (%d ok, %d failed)",
                processed, effective_limit, succeeded, failed,
            )

    logger.info(
        "Rewrite complete: %d processed, %d succeeded, %d failed",
        processed, succeeded, failed,
    )


def main():
    parser = argparse.ArgumentParser(
        description="AI rewrite course descriptions",
    )
    parser.add_argument("--limit", type=int, help="Max courses to process")
    parser.add_argument("--force", action="store_true",
                        help="Re-process ai_rewritten courses")
    parser.add_argument("--dry-run", action="store_true",
                        help="Don't write to DB")
    parser.add_argument("--concurrency", type=int, default=5,
                        help="Max concurrent LLM calls (default: 5)")
    parser.add_argument("--batch-size", type=int, default=20,
                        help="DB commit batch size (default: 20)")
    args = parser.parse_args()

    asyncio.run(rewrite(
        limit=args.limit,
        force=args.force,
        dry_run=args.dry_run,
        concurrency=args.concurrency,
        batch_size=args.batch_size,
    ))


if __name__ == "__main__":
    main()
