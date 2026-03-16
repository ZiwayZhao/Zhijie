"""Scrape csdiy.wiki (PKUFlyingPig/cs-self-learning) course data.

Parses mkdocs.yml for category structure, then fetches each course
Markdown file from GitHub raw to extract metadata.
"""

import logging
import re
import uuid
from dataclasses import dataclass, field
from urllib.parse import quote

import asyncio

import httpx
import yaml

logger = logging.getLogger(__name__)

RAW_BASE = (
    "https://raw.githubusercontent.com"
    "/PKUFlyingPig/cs-self-learning/master"
)
MKDOCS_URL = f"{RAW_BASE}/mkdocs.yml"

# Categories to skip (not actual courses)
SKIP_CATEGORIES = {"前言", "如何使用这本书", "一个仅供参考的CS学习规划", "好书推荐", "后记"}

# English names for categories (from mkdocs i18n nav_translations)
CATEGORY_EN = {
    "必学工具": "Productivity Toolkit",
    "数学基础": "Fundamental Mathematics",
    "数学进阶": "Advanced Mathematics",
    "编程入门": "Fundamental Programming",
    "电子基础": "Fundamental Electronics",
    "数据结构与算法": "Data Structures and Algorithms",
    "软件工程": "Software Engineering",
    "计算机系统基础": "Computer Systems Principles",
    "体系结构": "Computer Architecture",
    "操作系统": "Operating Systems",
    "并行与分布式系统": "Distributed Systems",
    "计算机系统安全": "Computer Security",
    "计算机网络": "Computer Networking",
    "数据库系统": "Database Systems",
    "编译原理": "Compilers",
    "编程语言设计与分析": "Programming Language Design and Analysis",
    "计算机图形学": "Computer Graphics",
    "Web开发": "Web Development",
    "数据科学": "Data Science",
    "人工智能": "Artificial Intelligence",
    "机器学习": "Machine Learning",
    "机器学习系统": "Machine Learning Systems",
    "深度学习": "Deep Learning",
    "深度生成模型": "Deep Generative Models",
    "机器学习进阶": "Advanced Machine Learning",
}


def _slugify(text: str) -> str:
    """Generate URL-safe slug from text."""
    # Use English name if available
    en = CATEGORY_EN.get(text)
    if en:
        text = en
    # Replace C++ before lowering
    text = text.replace("C++", "cpp").replace("c++", "cpp")
    slug = text.lower().strip()
    # Remove Chinese chars (replace with pinyin-like approximation)
    slug = re.sub(r"[\u4e00-\u9fff]+", lambda m: _chinese_to_ascii(m.group()), slug)
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    slug = slug.strip("-")
    return slug or "misc"


# Simple Chinese → ASCII mapping for common subcategory names
_ZH_MAP = {
    "语言": "lang",
    "函数式": "functional",
    "翻墙": "gfw",
    "日常学习工作流": "workflow",
    "实用工具箱": "toolbox",
    "毕业论文": "thesis",
    "信息检索": "info-retrieval",
    "大语言模型": "llm",
    "学习路线图": "roadmap",
}


def _chinese_to_ascii(text: str) -> str:
    """Convert common Chinese strings to ASCII for slugs."""
    for zh, en in _ZH_MAP.items():
        text = text.replace(zh, en)
    # If still has Chinese, just remove it
    text = re.sub(r"[\u4e00-\u9fff]+", "", text)
    return text


@dataclass
class ParsedCourse:
    """Intermediate representation of a scraped course."""

    name: str
    md_path: str  # relative path under docs/
    category: str  # Chinese category name
    subcategory: str | None = None
    university: str | None = None
    instructor: str | None = None
    language: str = "en"
    programming_lang: str | None = None
    difficulty: int = 3
    estimated_hours: int | None = None
    description: str = ""
    prerequisites: str | None = None
    website_url: str | None = None
    video_url: str | None = None
    tags: list[str] = field(default_factory=list)


def _count_stars(text: str) -> int:
    """Count star emojis to determine difficulty."""
    return text.count("\u2b50") + text.count("\U0001f31f") or 3


def _extract_hours(text: str) -> int | None:
    """Extract estimated hours from text like '60 小时'."""
    m = re.search(r"(\d+)\s*小时", text)
    return int(m.group(1)) if m else None


def _detect_language(text: str) -> str:
    """Detect course language from description."""
    lower = text.lower()
    if "中文" in lower or "国内" in lower or "bilibili" in lower:
        return "zh"
    return "en"


def _extract_url(text: str) -> str | None:
    """Extract first URL from markdown text."""
    m = re.search(r"https?://[^\s)<>]+", text)
    return m.group(0).rstrip(".,;)") if m else None


def parse_nav(nav_data: list) -> list[tuple[str, str, str, str | None]]:
    """Parse mkdocs nav into (course_name, md_path, category) tuples.

    Returns list of (name, md_path, category, subcategory).
    """
    results: list[tuple[str, str, str, str | None]] = []

    def _walk(items: list, cat: str | None = None, subcat: str | None = None):
        for item in items:
            if isinstance(item, str):
                continue
            if isinstance(item, dict):
                for key, val in item.items():
                    if key in SKIP_CATEGORIES:
                        continue
                    if isinstance(val, str):
                        # leaf: course page
                        if cat and val.endswith(".md") and val != "index.md":
                            results.append((key, val, cat, subcat))
                    elif isinstance(val, list):
                        if cat is None:
                            # top-level category
                            _walk(val, cat=key)
                        else:
                            # sub-category (e.g., "Python 语言" inside "编程入门")
                            _walk(val, cat=cat, subcat=key)

    _walk(nav_data)
    return results


async def fetch_mkdocs_nav() -> list:
    """Fetch and parse mkdocs.yml nav section."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(MKDOCS_URL)
        resp.raise_for_status()
    data = yaml.safe_load(resp.text)
    return data.get("nav", [])


_MD_PATH_RE = re.compile(r"^[\w\-/ .()（）\u4e00-\u9fff+]+\.md$")
_MAX_RESPONSE_BYTES = 1024 * 1024  # 1 MB


async def fetch_course_markdown(
    md_path: str, client: httpx.AsyncClient | None = None,
) -> str | None:
    """Fetch raw markdown for a single course page."""
    # Validate path: reject traversal and non-md files
    if ".." in md_path or md_path.startswith("/") or not _MD_PATH_RE.match(md_path):
        logger.warning("Rejected invalid md_path: %s", md_path)
        return None
    encoded = quote(md_path, safe="/")
    url = f"{RAW_BASE}/docs/{encoded}"
    own_client = client is None
    c = client or httpx.AsyncClient(timeout=20)
    try:
        resp = await c.get(url)
        if resp.status_code == 200:
            if len(resp.content) > _MAX_RESPONSE_BYTES:
                logger.warning("Response too large (%d bytes): %s", len(resp.content), url)
                return None
            return resp.text
        logger.warning("HTTP %d for %s", resp.status_code, url)
        return None
    except httpx.HTTPError as exc:
        logger.warning("Failed to fetch %s: %s", url, exc)
        return None
    finally:
        if own_client:
            await c.aclose()


def parse_course_markdown(md: str, name: str, md_path: str, cat: str,
                          subcat: str | None) -> ParsedCourse:
    """Parse course metadata from markdown content."""
    course = ParsedCourse(name=name, md_path=md_path, category=cat,
                          subcategory=subcat)

    lines = md.split("\n")

    # Extract metadata from bullet list in 课程简介
    for line in lines:
        stripped = line.strip().lstrip("- ").strip()
        if stripped.startswith("所属大学"):
            course.university = stripped.split("：", 1)[-1].strip()
        elif stripped.startswith("先修要求"):
            course.prerequisites = stripped.split("：", 1)[-1].strip()
        elif stripped.startswith("编程语言"):
            course.programming_lang = stripped.split("：", 1)[-1].strip()
        elif stripped.startswith("课程难度"):
            course.difficulty = _count_stars(stripped)
        elif stripped.startswith("预计学时"):
            course.estimated_hours = _extract_hours(stripped)

    # Extract description: first paragraph after metadata
    in_intro = False
    desc_lines = []
    for line in lines:
        stripped = line.strip()
        # Skip title and metadata
        if stripped.startswith("#"):
            if "课程简介" in stripped:
                in_intro = True
                continue
            elif in_intro and stripped.startswith("##"):
                break  # Next section
            continue
        if in_intro and stripped and not stripped.startswith("- "):
            desc_lines.append(stripped)

    course.description = "\n".join(desc_lines[:5]).strip()

    # Extract course website URL from resources section
    for line in lines:
        if "课程网站" in line:
            course.website_url = _extract_url(line)
            break

    # Extract video URL
    for line in lines:
        if "课程视频" in line:
            url = _extract_url(line)
            if url:
                course.video_url = url
            break

    # Detect language
    course.language = _detect_language(md)

    # Build tags
    tags = set()
    if course.university:
        tags.add(course.university.lower().replace(" ", "-"))
    if course.programming_lang and course.programming_lang != "无":
        for lang in re.split(r"[/,、]", course.programming_lang):
            lang = lang.strip().lower()
            if lang:
                tags.add(lang)
    en_cat = CATEGORY_EN.get(cat, cat).lower().replace(" ", "-")
    tags.add(en_cat)
    if subcat:
        en_sub = CATEGORY_EN.get(subcat, subcat).lower().replace(" ", "-")
        tags.add(en_sub)
    course.tags = sorted(tags)

    return course


async def scrape_all_courses() -> tuple[dict[str, list[str]], list[ParsedCourse]]:
    """Scrape all courses from csdiy.wiki.

    Returns:
        (categories, courses) where categories maps category_name to
        list of subcategory names, and courses is list of ParsedCourse.
    """
    logger.info("Fetching mkdocs.yml navigation...")
    nav = await fetch_mkdocs_nav()
    entries = parse_nav(nav)
    if len(entries) > 1000:
        raise ValueError(f"Too many nav entries ({len(entries)}), aborting")
    logger.info("Found %d course entries in nav", len(entries))

    # Collect categories
    categories: dict[str, list[str]] = {}
    for _, _, cat, subcat in entries:
        if cat not in categories:
            categories[cat] = []
        if subcat and subcat not in categories[cat]:
            categories[cat].append(subcat)

    # Fetch all course markdowns with shared client + rate limiting
    courses: list[ParsedCourse] = []
    async with httpx.AsyncClient(timeout=20) as client:
        for name, md_path, cat, subcat in entries:
            if md_path.endswith("roadmap.md"):
                continue
            logger.info("Fetching: %s → %s", name, md_path)
            md = await fetch_course_markdown(md_path, client=client)
            if md is None:
                logger.warning("Skipped (fetch failed): %s", md_path)
                continue
            parsed = parse_course_markdown(md, name, md_path, cat, subcat)
            courses.append(parsed)
            await asyncio.sleep(0.15)  # rate limit: ~6 req/s

    logger.info(
        "Scraped %d courses across %d categories",
        len(courses), len(categories),
    )
    return categories, courses
