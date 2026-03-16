"""MIT OpenCourseWare scraper via MIT Learn API.

Fetches course metadata and content file listings from the public
MIT Learn API (api.learn.mit.edu). Does NOT download actual files —
only stores metadata and URLs for later processing.

Usage:
    from app.services.ocw_scraper import scrape_ocw_courses, scrape_ocw_content_files
"""

import asyncio
import logging
import random
import re
from dataclasses import dataclass, field
from html import unescape

import httpx
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

API_BASE = "https://api.learn.mit.edu/api/v1"

# Only allow requests to these domains
_ALLOWED_DOMAINS = {"api.learn.mit.edu", "ocw.mit.edu"}

# Safety caps
_MAX_COURSES = 5000
_MAX_CONTENT_FILES_PER_COURSE = 500
_MAX_RESPONSE_BYTES = 5 * 1024 * 1024  # 5 MB
_REQUEST_TIMEOUT = 30


# --- Pydantic models for API response validation (OCW-6) ---

class OCWDepartment(BaseModel):
    department_id: str = ""
    name: str = ""

class OCWTopic(BaseModel):
    id: int = 0
    name: str = ""
    parent: int | None = None

class OCWCourseNumber(BaseModel):
    value: str = ""
    listing_type: str = ""

class OCWCourseDetail(BaseModel):
    course_numbers: list[OCWCourseNumber] = Field(default_factory=list)

class OCWInstructor(BaseModel):
    full_name: str = ""

class OCWRun(BaseModel):
    semester: str | None = None
    year: int | None = None
    instructors: list[OCWInstructor] = Field(default_factory=list)
    level: list[dict] = Field(default_factory=list)

class OCWImage(BaseModel):
    url: str | None = None

class OCWSchool(BaseModel):
    name: str = ""

class OCWDeptWithSchool(BaseModel):
    department_id: str = ""
    name: str = ""
    school: OCWSchool | None = None

class OCWApiCourse(BaseModel):
    """Validates a single course from the MIT Learn API."""
    id: int
    readable_id: str = ""
    title: str = ""
    description: str = ""
    url: str = ""
    course_feature: list[str] = Field(default_factory=list)
    course: OCWCourseDetail | None = None
    departments: list[OCWDeptWithSchool] = Field(default_factory=list)
    topics: list[OCWTopic] = Field(default_factory=list)
    runs: list[OCWRun] = Field(default_factory=list)
    image: OCWImage | None = None
    completeness: float | None = None
    free: bool = True

class OCWApiContentFile(BaseModel):
    """Validates a single content file from the MIT Learn API."""
    id: int
    title: str = ""
    url: str = ""
    content_type: str = ""
    file_type: str = ""
    file_extension: str = ""
    content_feature_type: list[str] = Field(default_factory=list)


# --- Output dataclasses ---

@dataclass
class OCWCourse:
    """Parsed MIT OCW course metadata."""
    ocw_id: int
    readable_id: str
    title: str
    description: str  # HTML stripped to plain text
    url: str
    department: str
    school: str
    course_number: str
    level: str  # "undergraduate" | "graduate" | ""
    semester: str  # "Fall 2011"
    instructors: list[str] = field(default_factory=list)
    topics: list[str] = field(default_factory=list)
    course_features: list[str] = field(default_factory=list)
    image_url: str | None = None
    completeness: float | None = None
    content_files: list["OCWContentFile"] = field(default_factory=list)


@dataclass
class OCWContentFile:
    """Parsed MIT OCW content file metadata."""
    content_id: int
    title: str
    url: str  # resource page URL
    content_type: str  # pdf, video, page
    file_extension: str
    content_feature: str  # "Lecture Notes", "Exams", etc.


# --- HTML sanitization ---

_TAG_RE = re.compile(r"<[^>]+>")


def _strip_html(html: str) -> str:
    """Strip HTML tags and decode entities → plain text."""
    text = _TAG_RE.sub("", html)
    text = unescape(text)
    return text.strip()


def _validate_url_domain(url: str) -> bool:
    """Check that URL points to an allowed domain."""
    try:
        from urllib.parse import urlparse
        parsed = urlparse(url)
        return parsed.hostname in _ALLOWED_DOMAINS
    except Exception:
        return False


# --- Core parsing ---

def _parse_course(raw: OCWApiCourse) -> OCWCourse:
    """Convert validated API response to OCWCourse dataclass."""
    # Extract department + school
    dept_name = ""
    school_name = ""
    if raw.departments:
        dept_name = raw.departments[0].name
        if raw.departments[0].school:
            school_name = raw.departments[0].school.name

    # Extract course number
    course_number = ""
    if raw.course and raw.course.course_numbers:
        primary = [cn for cn in raw.course.course_numbers
                   if cn.listing_type == "primary"]
        if primary:
            course_number = primary[0].value
        elif raw.course.course_numbers:
            course_number = raw.course.course_numbers[0].value

    # Extract run info (latest run)
    semester = ""
    instructors: list[str] = []
    level = ""
    if raw.runs:
        run = raw.runs[0]
        parts = []
        if run.semester:
            parts.append(run.semester)
        if run.year:
            parts.append(str(run.year))
        semester = " ".join(parts)
        instructors = [i.full_name for i in run.instructors if i.full_name]
        if run.level:
            level = run.level[0].get("code", "")

    # Extract topics (leaf names only)
    topics = [t.name for t in raw.topics if t.name]

    # Image URL
    image_url = raw.image.url if raw.image else None

    return OCWCourse(
        ocw_id=raw.id,
        readable_id=raw.readable_id,
        title=raw.title,
        description=_strip_html(raw.description),
        url=raw.url,
        department=dept_name,
        school=school_name,
        course_number=course_number,
        level=level,
        semester=semester,
        instructors=instructors,
        topics=topics,
        course_features=raw.course_feature,
        image_url=image_url,
        completeness=raw.completeness,
    )


def _parse_content_file(raw: OCWApiContentFile) -> OCWContentFile:
    """Convert validated API content file to OCWContentFile."""
    feature = raw.content_feature_type[0] if raw.content_feature_type else ""
    return OCWContentFile(
        content_id=raw.id,
        title=raw.title,
        url=raw.url,
        content_type=raw.content_type,
        file_extension=raw.file_extension,
        content_feature=feature,
    )


# --- API fetching ---

async def _fetch_page(
    client: httpx.AsyncClient,
    url: str,
    params: dict | None = None,
) -> dict | None:
    """Fetch a single API page with streaming size check (SEC-01)."""
    if not _validate_url_domain(url):
        logger.warning("Blocked request to non-allowed domain: %s", url)
        return None
    try:
        async with client.stream(
            "GET", url, params=params, timeout=_REQUEST_TIMEOUT,
        ) as resp:
            if resp.status_code == 429:
                logger.warning("Rate limited by MIT API, waiting 30s...")
                await asyncio.sleep(30)
                return None
            resp.raise_for_status()

            # Stream body with size cap to prevent memory exhaustion
            chunks: list[bytes] = []
            total = 0
            async for chunk in resp.aiter_bytes(chunk_size=65536):
                total += len(chunk)
                if total > _MAX_RESPONSE_BYTES:
                    logger.warning("Response too large (>%d bytes): %s",
                                   _MAX_RESPONSE_BYTES, url)
                    return None
                chunks.append(chunk)

            import json as _json
            return _json.loads(b"".join(chunks))
    except httpx.HTTPStatusError as e:
        logger.warning("HTTP %d for %s: %s", e.response.status_code, url, e)
        return None
    except httpx.HTTPError as e:
        logger.warning("Request failed for %s: %s", url, e)
        return None


async def scrape_ocw_courses(
    *,
    department: str | None = None,
    topic: str | None = None,
    limit: int | None = None,
    rate_limit: float = 1.0,
) -> list[OCWCourse]:
    """Fetch courses from MIT Learn API.

    Args:
        department: Filter by department ID (e.g., "18" for Mathematics).
        topic: Filter by topic name (e.g., "Mathematics").
        limit: Max courses to fetch (default: all, capped at _MAX_COURSES).
        rate_limit: Seconds between requests (default: 1.0).

    Returns:
        List of OCWCourse dataclasses.
    """
    max_courses = min(limit or _MAX_COURSES, _MAX_COURSES)
    courses: list[OCWCourse] = []

    async with httpx.AsyncClient(
        timeout=_REQUEST_TIMEOUT,
        follow_redirects=False,
    ) as client:
        offset = 0
        page_size = 100

        while len(courses) < max_courses:
            params: dict = {
                "platform": "ocw",
                "resource_type": "course",
                "limit": page_size,
                "offset": offset,
            }
            if department:
                params["department"] = department
            if topic:
                params["topic"] = topic

            data = await _fetch_page(
                client,
                f"{API_BASE}/learning_resources/",
                params=params,
            )
            if data is None:
                logger.warning("Failed to fetch page at offset %d", offset)
                break

            results = data.get("results", [])
            if not results:
                break

            for raw in results:
                try:
                    validated = OCWApiCourse.model_validate(raw)
                    courses.append(_parse_course(validated))
                except Exception as e:
                    logger.warning("Failed to parse course: %s", e)
                    continue

                if len(courses) >= max_courses:
                    break

            offset += page_size
            # Rate limit with jitter (OCW-2)
            jitter = random.uniform(0, rate_limit * 0.3)
            await asyncio.sleep(rate_limit + jitter)

    logger.info("Scraped %d OCW courses", len(courses))
    return courses


async def scrape_ocw_content_files(
    resource_id: int,
    *,
    file_types: list[str] | None = None,
    rate_limit: float = 1.0,
    client: httpx.AsyncClient | None = None,
) -> list[OCWContentFile]:
    """Fetch content files for a specific OCW course.

    Args:
        resource_id: MIT Learn API resource ID.
        file_types: Filter by file extension (e.g., [".pdf"]).
        rate_limit: Seconds between requests.
        client: Optional shared httpx client.

    Returns:
        List of OCWContentFile dataclasses.
    """
    own_client = client is None
    c = client or httpx.AsyncClient(
        timeout=_REQUEST_TIMEOUT,
        follow_redirects=False,
    )
    files: list[OCWContentFile] = []

    try:
        offset = 0
        page_size = 100

        while len(files) < _MAX_CONTENT_FILES_PER_COURSE:
            params: dict = {
                "resource_id": str(resource_id),
                "platform": "ocw",
                "limit": page_size,
                "offset": offset,
            }
            if file_types:
                # API supports single file_extension filter
                params["file_extension"] = file_types[0]

            data = await _fetch_page(
                c,
                f"{API_BASE}/contentfiles/",
                params=params,
            )
            if data is None:
                break

            results = data.get("results", [])
            if not results:
                break

            for raw in results:
                try:
                    validated = OCWApiContentFile.model_validate(raw)
                    cf = _parse_content_file(validated)
                    # Filter by multiple file types if needed
                    if file_types and cf.file_extension not in file_types:
                        continue
                    files.append(cf)
                except Exception as e:
                    logger.warning("Failed to parse content file: %s", e)
                    continue

                if len(files) >= _MAX_CONTENT_FILES_PER_COURSE:
                    break

            offset += page_size
            jitter = random.uniform(0, rate_limit * 0.3)
            await asyncio.sleep(rate_limit + jitter)

    finally:
        if own_client:
            await c.aclose()

    return files
