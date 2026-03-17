"""Gaoling Life RAG service — retrieval-augmented Q&A over campus posts.

Phase 1: keyword-based retrieval with LLM answer generation.
Phase 2 (future): pgvector embedding search.
"""

import logging
import re
import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.gaoling_life import GaolingLifePost
from app.services.llm_client import LLMClient, get_llm_client

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """\
你是「高瓴生活助手」，帮助中国人民大学高瓴人工智能学院的学生回答校园生活相关问题。

规则：
1. 仅基于提供的帖子内容回答，不要编造信息
2. 回答中引用来源时使用 [1], [2] 等编号
3. 如果帖子内容不足以回答问题，诚实说明
4. 用中文回答，简洁友好
"""


class GaolingRAGService:
    def __init__(self, llm: LLMClient, db: AsyncSession):
        self.llm = llm
        self.db = db

    async def chat(
        self,
        query: str,
        category: str | None = None,
        session_id: str | None = None,
    ) -> dict:
        """Answer a query using relevant posts as context."""
        session_id = session_id or str(uuid.uuid4())

        # 1. Retrieve relevant posts (keyword search for Phase 1)
        posts = await self._retrieve_posts(query, category, limit=6)

        if not posts:
            return {
                "success": True,
                "answer": "抱歉，目前没有找到相关信息。请换个关键词试试？",
                "sorted_post_ids": [],
                "cited_posts": [],
                "session_id": session_id,
            }

        # 2. Build context from posts
        context_parts = []
        for i, post in enumerate(posts, 1):
            text = post.content or post.summary
            context_parts.append(
                f"[{i}] 《{post.title}》\n"
                f"分类: {post.category} | 时间: {post.publish_time or '未知'}\n"
                f"{text[:500]}"
            )
        context = "\n\n---\n\n".join(context_parts)

        # 3. Call LLM
        user_msg = f"参考以下帖子内容回答用户问题。\n\n{context}\n\n用户问题: {query}"

        try:
            response = await self.llm._client.chat.completions.create(
                model="deepseek/deepseek-chat-v3-0324",
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_msg},
                ],
                max_tokens=1000,
            )
            answer = response.choices[0].message.content or ""
        except Exception:
            logger.exception("LLM call failed for Gaoling RAG")
            return {
                "success": False,
                "error": "AI 回答生成失败，请稍后重试",
                "session_id": session_id,
            }

        # 4. Parse citations [1], [2], etc.
        cited_indices = sorted(set(int(m) for m in re.findall(r"\[(\d+)\]", answer)))
        cited_posts = [
            {
                "post_id": posts[i - 1].id,
                "citation_index": i,
                "excerpt": (posts[i - 1].summary or "")[:100],
            }
            for i in cited_indices
            if 1 <= i <= len(posts)
        ]

        return {
            "success": True,
            "answer": answer,
            "sorted_post_ids": [p.id for p in posts],
            "cited_posts": cited_posts,
            "session_id": session_id,
        }

    async def _retrieve_posts(
        self,
        query: str,
        category: str | None,
        limit: int = 6,
    ) -> list[GaolingLifePost]:
        """Phase 1: keyword-based retrieval using ILIKE."""
        stmt = select(GaolingLifePost).where(
            GaolingLifePost.status == "published",
        )

        if category:
            stmt = stmt.where(GaolingLifePost.category == category)

        # Simple keyword matching against title + summary
        keywords = [kw.strip() for kw in query.split() if kw.strip()]
        if keywords:
            conditions = []
            for kw in keywords[:5]:  # limit to 5 keywords
                escaped = kw.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
                pattern = f"%{escaped}%"
                conditions.append(
                    GaolingLifePost.title.ilike(pattern)
                    | GaolingLifePost.summary.ilike(pattern)
                )
            if conditions:
                from sqlalchemy import or_
                stmt = stmt.where(or_(*conditions))

        stmt = stmt.order_by(GaolingLifePost.publish_time.desc().nullslast())
        stmt = stmt.limit(limit)

        result = await self.db.execute(stmt)
        return list(result.scalars().all())


async def get_rag_service(db: AsyncSession) -> GaolingRAGService:
    llm = get_llm_client()
    return GaolingRAGService(llm=llm, db=db)
