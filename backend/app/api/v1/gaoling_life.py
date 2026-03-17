"""Gaoling Life API — campus life posts + RAG chat + crawler trigger."""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.db.session import get_db
from app.models.gaoling_life import GaolingLifePost
from app.models.user import User
from app.schemas.gaoling_life import (
    CategoryType,
    ChatRequest,
    ChatResponse,
    CrawlResponse,
    PostCreate,
    PostListResponse,
    PostResponse,
    SortType,
    SourceFilter,
)
from app.services.gaoling_rag import get_rag_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/gaoling", tags=["gaoling-life"])


# ── Posts CRUD ───────────────────────────────────────────────────

@router.get("/posts", response_model=PostListResponse)
async def list_posts(
    db: AsyncSession = Depends(get_db),
    category: CategoryType | None = Query(None),
    source: SourceFilter = Query("all"),
    sort: SortType = Query("time"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str | None = Query(None, min_length=1, max_length=100),
):
    """List posts with filtering, sorting, and pagination. Public endpoint."""
    stmt = select(GaolingLifePost).where(
        GaolingLifePost.status == "published",
    )

    if category:
        stmt = stmt.where(GaolingLifePost.category == category)

    if source == "official":
        stmt = stmt.where(GaolingLifePost.is_official.is_(True))
    elif source == "personal":
        stmt = stmt.where(GaolingLifePost.is_official.is_(False))

    if search:
        escaped = (
            search.replace("\\", "\\\\")
            .replace("%", "\\%")
            .replace("_", "\\_")
        )
        pattern = f"%{escaped}%"
        stmt = stmt.where(
            GaolingLifePost.title.ilike(pattern)
            | GaolingLifePost.summary.ilike(pattern)
        )

    # Count total
    count_stmt = select(func.count()).select_from(stmt.subquery())
    total = (await db.execute(count_stmt)).scalar() or 0

    # Sort
    if sort == "hot":
        stmt = stmt.order_by(
            GaolingLifePost.likes.desc(),
            GaolingLifePost.view_count.desc(),
        )
    else:
        stmt = stmt.order_by(GaolingLifePost.publish_time.desc().nullslast())

    # Paginate
    stmt = stmt.offset((page - 1) * page_size).limit(page_size)

    result = await db.execute(stmt)
    posts = result.scalars().all()

    return PostListResponse(
        items=[PostResponse.model_validate(p) for p in posts],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/posts/{post_id}", response_model=PostResponse)
async def get_post(
    post_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Get a single post by ID. Public endpoint."""
    result = await db.execute(
        select(GaolingLifePost).where(GaolingLifePost.id == post_id)
    )
    post = result.scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")

    # Increment view count
    post.view_count += 1
    await db.commit()

    return PostResponse.model_validate(post)


@router.post("/posts", response_model=PostResponse, status_code=201)
async def create_post(
    data: PostCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Create a personal post. Requires authentication."""
    post = GaolingLifePost(
        title=data.title,
        summary=data.summary,
        category=data.category,
        is_official=False,
        status="published",
        author_name=user.name,
        cover_image=data.cover_image,
        images=data.images or [],
        user_id=user.id,
    )
    db.add(post)
    await db.commit()
    await db.refresh(post)

    return PostResponse.model_validate(post)


@router.post("/posts/{post_id}/like")
async def like_post(
    post_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Like a post. Public endpoint (no auth for simplicity)."""
    result = await db.execute(
        select(GaolingLifePost).where(GaolingLifePost.id == post_id)
    )
    post = result.scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")

    post.likes += 1
    await db.commit()

    return {"ok": True, "likes": post.likes}


# ── RAG Chat ─────────────────────────────────────────────────────

@router.post("/chat", response_model=ChatResponse)
async def chat(
    data: ChatRequest,
    db: AsyncSession = Depends(get_db),
):
    """RAG-powered Q&A over campus posts. Public with rate limiting."""
    rag = await get_rag_service(db)
    result = await rag.chat(
        query=data.message,
        category=data.category,
        session_id=data.session_id,
    )
    return ChatResponse(**result)


# ── Crawler ──────────────────────────────────────────────────────

@router.post("/crawl", response_model=CrawlResponse)
async def trigger_crawl(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    max_pages: int = Query(2, ge=1, le=10),
):
    """Manually trigger a crawl of ai.ruc.edu.cn. Requires authentication."""
    from app.services.gaoling_crawler import crawl_and_upsert

    try:
        new_count, updated_count = await crawl_and_upsert(db, max_pages=max_pages)
        return CrawlResponse(
            success=True,
            new_posts=new_count,
            updated_posts=updated_count,
            message=f"爬取完成：{new_count} 条新增，{updated_count} 条更新",
        )
    except Exception:
        logger.exception("Crawl failed")
        raise HTTPException(status_code=500, detail="爬取失败，请查看日志")
