"""AI content rewriting pipeline for course descriptions.

Uses the existing LLM client (OpenRouter → Claude) to rewrite raw course
descriptions into platform-standard format with structured metadata.

Usage:
    from app.services.content_rewriter import rewrite_course, rewrite_batch

    result = await rewrite_course(raw_description="...", course_name="...")
"""

import asyncio
import logging
import random
import re

from pydantic import BaseModel, Field

from app.services.llm_client import get_llm_client, LLMError

logger = logging.getLogger(__name__)

# Default model for rewriting
DEFAULT_MODEL = "anthropic/claude-sonnet-4-5-20250514"
PROMPT_VERSION = "rewrite_v1"


# --- Output schema ---

class RewrittenCourse(BaseModel):
    """Structured output from the AI rewriter."""

    platform_description: str = Field(
        description="2-4 句中文，简洁专业，包含课程核心内容和亮点",
    )
    learning_objectives: list[str] = Field(
        description="3-5 个学习目标，用动词开头（掌握、理解、能够...）",
    )
    target_audience: str = Field(
        description="一句话，说明适合谁、需要什么前置知识",
    )
    tags: list[str] = Field(
        description="3-8 个英文标签，小写，连字符分隔",
    )
    detected_language: str = Field(
        default="zh",
        description="原始内容的语言 (zh/en)",
    )
    confidence: float = Field(
        default=0.8,
        ge=0.0,
        le=1.0,
        description="对重写质量的自信度 (0-1)",
    )


# --- Prompt ---

REWRITE_SYSTEM_PROMPT = """你是智阶学习平台的课程编辑 AI。
你的任务是将原始课程描述重写为平台标准格式。

要求：
1. platform_description: 2-4 句话，简洁专业，中文，包含课程核心内容和亮点。
   - 如果原始内容是英文，翻译为中文。
   - 不要营销话术，保持客观学术风格。
2. learning_objectives: 3-5 个学习目标，用动词开头（掌握、理解、能够...）。
   - 从课程内容推断，不要编造不存在的内容。
3. target_audience: 一句话，说明适合谁、需要什么前置知识。
4. tags: 3-8 个英文标签，小写，连字符分隔（如 linear-algebra, mit, undergraduate）。
5. detected_language: 原始描述的主要语言 (zh 或 en)。
6. confidence: 0-1，表示你对重写质量的自信度。
   - 如果原始内容太短或不完整，设为 0.3-0.5。
   - 如果原始内容详细，设为 0.7-0.9。

注意：仅根据提供的信息生成，不要添加编造的内容。"""


# --- Input sanitization (R-01: prevent prompt injection) ---

# Max input length to prevent abuse
_MAX_INPUT_CHARS = 3000

# Patterns that could be injection attempts
_INJECTION_PATTERNS = [
    re.compile(r"ignore\s+(previous|all|above)\s+instructions", re.IGNORECASE),
    re.compile(r"system\s*:\s*", re.IGNORECASE),
    re.compile(r"<\s*/?system\s*>", re.IGNORECASE),
    re.compile(r"```\s*system", re.IGNORECASE),
]


def sanitize_for_llm(text: str) -> str:
    """Sanitize raw text before sending to LLM.

    - Truncates to max length
    - Strips HTML tags
    - Removes potential injection patterns
    - Normalizes whitespace
    """
    if not text:
        return ""

    # Strip HTML
    text = re.sub(r"<[^>]+>", "", text)

    # Truncate
    if len(text) > _MAX_INPUT_CHARS:
        text = text[:_MAX_INPUT_CHARS] + "..."

    # Check for injection patterns (log warning but don't block)
    for pattern in _INJECTION_PATTERNS:
        if pattern.search(text):
            logger.warning(
                "Potential injection pattern detected in input: %s",
                pattern.pattern,
            )
            # Replace rather than block — the content might be legitimate
            text = pattern.sub("[FILTERED]", text)

    # Normalize whitespace
    text = re.sub(r"\s+", " ", text).strip()

    return text


# --- Core rewriting ---

async def rewrite_course(
    *,
    raw_description: str,
    course_name: str,
    university: str | None = None,
    category: str | None = None,
    model: str = DEFAULT_MODEL,
) -> RewrittenCourse | None:
    """Rewrite a single course description.

    Returns None if the input is too short or LLM call fails.
    """
    sanitized = sanitize_for_llm(raw_description)

    # Skip if too little content
    if len(sanitized) < 20:
        logger.info("Skipping %s: description too short (%d chars)",
                     course_name, len(sanitized))
        return None

    # Build context message
    context_parts = [f"课程名称: {sanitize_for_llm(course_name)}"]
    if university:
        context_parts.append(f"大学: {sanitize_for_llm(university)}")
    if category:
        context_parts.append(f"分类: {sanitize_for_llm(category)}")
    context_parts.append(f"\n原始描述:\n{sanitized}")

    user_message = "\n".join(context_parts)

    try:
        client = get_llm_client()
        result = await client.structured_output(
            model=model,
            system=REWRITE_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_message}],
            response_schema=RewrittenCourse,
            prompt_version=PROMPT_VERSION,
            max_tokens=1024,
        )
        return result.data
    except LLMError as e:
        logger.error("LLM rewrite failed for %s: %s", course_name, e)
        return None


async def rewrite_batch(
    courses: list[dict],
    *,
    concurrency: int = 5,
    model: str = DEFAULT_MODEL,
) -> list[tuple[str, RewrittenCourse | None]]:
    """Batch rewrite course descriptions with rate limiting.

    Args:
        courses: List of dicts with keys: id, name, raw_description,
                 university (optional), category (optional).
        concurrency: Max concurrent LLM calls (default: 5).
        model: LLM model to use.

    Returns:
        List of (course_id, RewrittenCourse | None) tuples.
    """
    semaphore = asyncio.Semaphore(concurrency)
    results: list[tuple[str, RewrittenCourse | None]] = []

    async def _rewrite_one(course: dict) -> tuple[str, RewrittenCourse | None]:
        async with semaphore:
            result = await rewrite_course(
                raw_description=course.get("raw_description", ""),
                course_name=course.get("name", ""),
                university=course.get("university"),
                category=course.get("category"),
                model=model,
            )
            # Jitter between calls to avoid thundering herd (R-02)
            await asyncio.sleep(random.uniform(0.5, 1.5))
            return (course["id"], result)

    # Process in chunks to limit memory and provide progress
    chunk_size = concurrency * 2
    for i in range(0, len(courses), chunk_size):
        chunk = courses[i:i + chunk_size]
        tasks = [_rewrite_one(c) for c in chunk]
        chunk_results = await asyncio.gather(*tasks, return_exceptions=True)

        for j, r in enumerate(chunk_results):
            if isinstance(r, Exception):
                course_id = chunk[j]["id"]
                logger.error("Rewrite exception for %s: %s", course_id, r)
                results.append((course_id, None))
            else:
                results.append(r)

        done = min(i + chunk_size, len(courses))
        logger.info("Rewrite progress: %d/%d", done, len(courses))

    successes = sum(1 for _, r in results if r is not None)
    logger.info("Batch rewrite complete: %d/%d succeeded",
                successes, len(results))
    return results
