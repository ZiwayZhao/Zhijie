"""Gaoling Life crawler — scrapes ai.ruc.edu.cn news for campus posts.

Ported from science1204/server/crawlers/gaoling_life.py.
Key changes: returns list[dict] instead of stdout JSON, async-compatible
DB upsert, incremental crawling (stops when existing source_url found).
"""

import logging
import re
from datetime import datetime
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup
from charset_normalizer import from_bytes
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.gaoling_life import GaolingLifePost

logger = logging.getLogger(__name__)

BASE_LIST_URL = "https://ai.ruc.edu.cn/newslist/newsdetail/index.htm"
HEADERS = {"User-Agent": "Mozilla/5.0 (GaolingLifeCrawler/2.0)"}


# ── HTML helpers ─────────────────────────────────────────────────

def _norm_text(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip())


def _fetch_html(url: str) -> str | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        if resp.status_code != 200:
            return None
        raw = resp.content
        result = from_bytes(raw).best()
        return str(result) if result else raw.decode("utf-8", errors="ignore")
    except Exception:
        logger.warning("Failed to fetch %s", url, exc_info=True)
        return None


def _infer_category(title: str) -> str:
    t = title.lower()
    if any(kw in t for kw in ("讲座", "论坛", "报告")):
        return "lecture"
    if any(kw in t for kw in ("招生", "培养", "课程", "讲", "项目")):
        return "study"
    if any(kw in t for kw in ("体检", "医院", "病")):
        return "medical"
    if any(kw in t for kw in ("食堂", "餐", "饭")):
        return "dining"
    if any(kw in t for kw in ("体育", "运动会", "羽毛球", "篮球", "足球")):
        return "sport"
    return "lecture"


# ── Page parsing ─────────────────────────────────────────────────

def _crawl_detail(url: str) -> dict | None:
    html = _fetch_html(url)
    if not html:
        return None

    soup = BeautifulSoup(html, "html.parser")

    title_el = soup.select_one("div.tit h6")
    title = _norm_text(title_el.get_text()) if title_el else None
    if not title:
        return None

    # Publish time
    publish_time = None
    date_span = soup.select_one("div.tit span")
    if date_span:
        m = re.search(r"\d{4}-\d{2}-\d{2}", date_span.get_text())
        if m:
            publish_time = m.group(0)

    # Article body
    article_el = soup.select_one("#articleDiv")
    if not article_el:
        return None

    paragraphs = [
        _norm_text(p.get_text())
        for p in article_el.find_all("p")
        if _norm_text(p.get_text())
    ]
    if not paragraphs:
        return None

    content = "\n".join(paragraphs)
    summary = paragraphs[0][:200]

    # Cover image
    img = article_el.find("img")
    cover = urljoin(url, img["src"]) if img and img.get("src") else None

    return {
        "title": title,
        "summary": summary,
        "content": content,
        "cover_image": cover,
        "publish_time": publish_time or datetime.now().isoformat(),
    }


def _crawl_list_page(url: str) -> list[dict]:
    html = _fetch_html(url)
    if not html:
        return []

    soup = BeautifulSoup(html, "html.parser")
    items: list[dict] = []

    for a in soup.select("ul.news_list li a"):
        href = a.get("href", "").strip()
        if not href or not (href.endswith(".html") or href.endswith(".htm")):
            continue
        if href.startswith("index"):
            continue

        title_el = a.select_one("h6")
        link_title = _norm_text(title_el.get_text()) if title_el else _norm_text(a.get_text())
        source_url = urljoin(url, href)

        detail = _crawl_detail(source_url)
        if not detail:
            continue

        items.append({
            "title": detail["title"] or link_title,
            "summary": detail["summary"],
            "content": detail["content"],
            "category": _infer_category(detail["title"] or link_title),
            "cover_image": detail["cover_image"],
            "author_name": "学院公告",
            "source_url": source_url,
            "publish_time": detail["publish_time"],
            "is_official": True,
        })

    return items


# ── Public API ───────────────────────────────────────────────────

def crawl_pages(max_pages: int = 2) -> list[dict]:
    """Crawl ai.ruc.edu.cn news pages. Returns deduplicated post dicts."""
    all_items: list[dict] = []
    seen_urls: set[str] = set()

    for page in range(max_pages):
        if page == 0:
            url = BASE_LIST_URL
        else:
            url = BASE_LIST_URL.replace("index.htm", f"index{page}.htm")

        logger.info("Crawling page: %s", url)
        items = _crawl_list_page(url)

        if not items:
            logger.info("No items found, stopping pagination")
            break

        for item in items:
            src = item["source_url"]
            if src not in seen_urls:
                seen_urls.add(src)
                all_items.append(item)

    logger.info("Crawled %d unique posts", len(all_items))
    return all_items


async def crawl_and_upsert(
    db: AsyncSession, max_pages: int = 2
) -> tuple[int, int]:
    """Crawl and upsert posts into DB. Returns (new_count, updated_count)."""
    items = crawl_pages(max_pages)
    new_count = 0
    updated_count = 0

    for item in items:
        # Check existing by source_url
        stmt = select(GaolingLifePost).where(
            GaolingLifePost.source_url == item["source_url"]
        )
        result = await db.execute(stmt)
        existing = result.scalar_one_or_none()

        publish_dt = None
        if item["publish_time"]:
            try:
                publish_dt = datetime.fromisoformat(item["publish_time"])
            except ValueError:
                pass

        if existing:
            # Update if title or content changed
            if existing.title != item["title"] or existing.content != item.get("content"):
                existing.title = item["title"]
                existing.summary = item["summary"]
                existing.content = item.get("content")
                existing.cover_image = item["cover_image"]
                existing.publish_time = publish_dt
                updated_count += 1
        else:
            post = GaolingLifePost(
                title=item["title"],
                summary=item["summary"],
                content=item.get("content"),
                category=item["category"],
                is_official=item["is_official"],
                cover_image=item["cover_image"],
                author_name=item["author_name"],
                source_url=item["source_url"],
                publish_time=publish_dt,
            )
            db.add(post)
            new_count += 1

    await db.commit()
    logger.info("Upsert complete: %d new, %d updated", new_count, updated_count)
    return new_count, updated_count
