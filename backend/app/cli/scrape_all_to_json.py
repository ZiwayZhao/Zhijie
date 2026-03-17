"""Standalone scraper: fetch ALL MIT OCW courses + content files → JSON.

No database dependency. Saves raw API data to data/ocw_courses.json and
data/ocw_content_files.json for backup and offline processing.

Usage:
    cd backend
    PYTHONPATH=. python -m app.cli.scrape_all_to_json
    PYTHONPATH=. python -m app.cli.scrape_all_to_json --limit 100
    PYTHONPATH=. python -m app.cli.scrape_all_to_json --with-content-files --concurrency 3
"""

import argparse
import asyncio
import json
import logging
import os
from dataclasses import asdict
from pathlib import Path

from app.services.ocw_scraper import (
    scrape_ocw_courses,
    scrape_ocw_content_files,
    OCWCourse,
    OCWContentFile,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s  %(message)s",
)
logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data"


async def scrape_to_json(
    *,
    limit: int | None = None,
    department: str | None = None,
    topic: str | None = None,
    with_content_files: bool = False,
    concurrency: int = 3,
    rate_limit: float = 0.8,
) -> None:
    """Fetch OCW courses and optionally content files, save to JSON."""
    DATA_DIR.mkdir(exist_ok=True)

    # --- Phase 1: Fetch all courses ---
    logger.info("Starting OCW course scrape (limit=%s, dept=%s)", limit, department)
    courses = await scrape_ocw_courses(
        department=department,
        topic=topic,
        limit=limit,
        rate_limit=rate_limit,
    )
    logger.info("Fetched %d courses from MIT Learn API", len(courses))

    # Save courses
    courses_path = DATA_DIR / "ocw_courses.json"
    courses_data = [asdict(c) for c in courses]
    courses_path.write_text(
        json.dumps(courses_data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    logger.info("Saved %d courses to %s", len(courses), courses_path)

    if not with_content_files:
        _print_summary(courses, [])
        return

    # --- Phase 2: Fetch content files for each course (parallel batches) ---
    logger.info("Fetching content files for %d courses (concurrency=%d)...",
                len(courses), concurrency)

    semaphore = asyncio.Semaphore(concurrency)
    all_files: dict[int, list[dict]] = {}

    async def fetch_files(course: OCWCourse) -> tuple[int, list[OCWContentFile]]:
        async with semaphore:
            files = await scrape_ocw_content_files(
                course.ocw_id,
                file_types=None,  # ALL types
                rate_limit=rate_limit,
            )
            return course.ocw_id, files

    # Process in chunks to avoid overwhelming the API
    chunk_size = concurrency * 2
    total_files = 0
    for i in range(0, len(courses), chunk_size):
        chunk = courses[i:i + chunk_size]
        tasks = [fetch_files(c) for c in chunk]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        for result in results:
            if isinstance(result, Exception):
                logger.warning("Content file fetch failed: %s", result)
                continue
            ocw_id, files = result
            if files:
                all_files[ocw_id] = [asdict(f) for f in files]
                total_files += len(files)

        done = min(i + chunk_size, len(courses))
        logger.info("Content files progress: %d/%d courses, %d files total",
                    done, len(courses), total_files)

    # Save content files
    files_path = DATA_DIR / "ocw_content_files.json"
    files_path.write_text(
        json.dumps(all_files, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    logger.info("Saved content files for %d courses (%d files) to %s",
                len(all_files), total_files, files_path)

    _print_summary(courses, list(all_files.values()))


def _print_summary(courses: list[OCWCourse], file_groups: list[list[dict]]) -> None:
    """Print a summary of scraped data."""
    logger.info("=" * 60)
    logger.info("SCRAPE SUMMARY")
    logger.info("=" * 60)
    logger.info("Courses: %d", len(courses))

    # Department breakdown
    depts: dict[str, int] = {}
    for c in courses:
        dept = c.department or "Unknown"
        depts[dept] = depts.get(dept, 0) + 1
    logger.info("Departments: %d", len(depts))
    for dept, count in sorted(depts.items(), key=lambda x: -x[1])[:10]:
        logger.info("  %s: %d courses", dept, count)

    if file_groups:
        total = sum(len(g) for g in file_groups)
        # File type breakdown
        types: dict[str, int] = {}
        for group in file_groups:
            for f in group:
                ext = f.get("file_extension", "unknown")
                types[ext] = types.get(ext, 0) + 1
        logger.info("Content files: %d total", total)
        for ext, count in sorted(types.items(), key=lambda x: -x[1]):
            logger.info("  %s: %d", ext, count)

    logger.info("=" * 60)


def main():
    parser = argparse.ArgumentParser(
        description="Scrape MIT OCW to JSON (no DB required)")
    parser.add_argument("--limit", type=int,
                        help="Max courses to fetch")
    parser.add_argument("--department", help="MIT department ID filter")
    parser.add_argument("--topic", help="Topic name filter")
    parser.add_argument("--with-content-files", action="store_true",
                        help="Also fetch ALL content file listings per course")
    parser.add_argument("--concurrency", type=int, default=3,
                        help="Parallel content file fetches (default: 3)")
    parser.add_argument("--rate-limit", type=float, default=0.8,
                        help="Seconds between API calls (default: 0.8)")
    args = parser.parse_args()

    asyncio.run(scrape_to_json(
        limit=args.limit,
        department=args.department,
        topic=args.topic,
        with_content_files=args.with_content_files,
        concurrency=args.concurrency,
        rate_limit=args.rate_limit,
    ))


if __name__ == "__main__":
    main()
