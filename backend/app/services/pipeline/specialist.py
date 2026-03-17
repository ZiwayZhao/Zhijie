"""Specialist Agent — generates detailed lecture notes for each module.

Input: Module's page-range Markdown slice + DisassemblyPlan context
Output: SpecialistResult — lecture Markdown, key concepts, exam traps, self-test questions
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Callable
from typing import Any

from pydantic import BaseModel, Field

from app.core.config import settings
from app.services.llm_client import LLMClient, LLMResult
from app.services.pdf_parser import ParsedPDF
from app.services.pipeline.cartographer import CartographerResult, ModulePlan
from app.services.s3_client import get_s3_client

logger = logging.getLogger(__name__)

PROMPT_VERSION = "spec_v1"
MODEL = "anthropic/claude-sonnet-4.5"
MAX_CONCURRENT = 3  # Semaphore limit to avoid rate limiting
SINGLE_MODULE_TIMEOUT = 120  # seconds


# ── Structured Output Schema ─────────────────────────────────────

class SelfTestQuestion(BaseModel):
    question: str
    answer: str


class SpecialistResult(BaseModel):
    """Specialist output for a single module."""
    lecture_markdown: str = Field(
        description="Detailed lecture notes in Markdown with LaTeX formulas where applicable",
    )
    summary: str = Field(
        max_length=500,
        description="200-char concise summary of this module",
    )
    key_concepts: list[str] = Field(
        min_length=1,
        max_length=15,
        description="Key concepts covered in this module",
    )
    exam_traps: list[str] = Field(
        default_factory=list,
        max_length=10,
        description="Common exam mistakes or tricky points",
    )
    self_test_questions: list[SelfTestQuestion] = Field(
        min_length=2,
        max_length=5,
        description="Quick self-test questions with answers",
    )


# ── Prompt ────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are a Specialist — an expert professor creating detailed, clear lecture notes for university students.

Your task: Given the raw content of a specific module from course materials, produce comprehensive lecture notes that help students truly understand the topic.

Rules:
1. Write in the same language as the source material
2. Use Markdown formatting with proper headings (##, ###)
3. Include LaTeX formulas where applicable ($inline$ and $$block$$)
4. Explain concepts step by step, as if teaching a student
5. Highlight exam-relevant points and common mistakes
6. Each key concept should be clearly defined
7. Self-test questions should check understanding, not just recall
8. Keep lecture_markdown comprehensive but focused (1500-4000 words)
9. summary should be a concise overview in 1-2 sentences"""


async def _process_single_module(
    module: ModulePlan,
    module_index: int,
    parsed: ParsedPDF,
    plan_context: str,
    llm: LLMClient,
    run_id: str,
    semaphore: asyncio.Semaphore,
) -> tuple[int, LLMResult]:
    """Process a single module with semaphore-controlled concurrency."""
    async with semaphore:
        # Extract page range markdown
        page_slices = []
        for page in parsed.pages:
            if module.page_range_start <= page.page_num <= module.page_range_end:
                page_slices.append(
                    f"--- Page {page.page_num} ---\n{page.markdown}"
                )

        module_content = "\n\n".join(page_slices)

        user_message = f"""Module: "{module.name}"
Description: {module.description}
Pages: {module.page_range_start}-{module.page_range_end}
Exam weight: {module.exam_weight}

Course context:
{plan_context}

Source content:
{module_content}"""

        result = await asyncio.wait_for(
            llm.structured_output(
                model=MODEL,
                system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": user_message}],
                response_schema=SpecialistResult,
                prompt_version=PROMPT_VERSION,
                run_id=f"{run_id}_mod{module_index}",
            ),
            timeout=SINGLE_MODULE_TIMEOUT,
        )

        logger.info(
            "Specialist: module '%s' done (%d tokens in, %d out, %dms)",
            module.name,
            result.input_tokens,
            result.output_tokens,
            result.latency_ms,
        )

        return module_index, result


def _build_plan_context(plan: CartographerResult) -> str:
    """Build a short context summary from the Cartographer plan."""
    lines = [f"Course topic: {plan.course_topic}"]
    lines.append(f"Difficulty: {plan.difficulty_level}")
    lines.append(f"Total modules: {len(plan.modules)}")
    for i, m in enumerate(plan.modules):
        lines.append(f"  {i}. {m.name} (pages {m.page_range_start}-{m.page_range_end}, weight: {m.exam_weight})")
    return "\n".join(lines)


async def upload_specialist_markdown(
    task_id: str,
    module_id: str,
    markdown: str,
) -> str:
    """Upload specialist markdown to S3 (sync boto3 via executor). Returns S3 key."""
    s3_key = f"specialist/{task_id}/{module_id}.md"

    def _upload():
        client = get_s3_client()
        client.put_object(
            Bucket=settings.s3_bucket_name,
            Key=s3_key,
            Body=markdown.encode("utf-8"),
            ContentType="text/markdown; charset=utf-8",
        )

    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, _upload)
    return s3_key


async def run_specialist(
    parsed: ParsedPDF,
    plan: CartographerResult,
    llm: LLMClient,
    run_id: str,
    on_module_complete: Callable[[int, int], Any] | None = None,
) -> list[tuple[int, LLMResult]]:
    """Execute the Specialist agent on all modules in parallel.

    Args:
        parsed: Full parsed PDF.
        plan: Cartographer's disassembly plan.
        llm: LLMClient instance.
        run_id: Execution run ID.
        on_module_complete: Optional callback(completed_count, total) for progress.

    Returns:
        List of (module_index, LLMResult) ordered by module_index.
    """
    plan_context = _build_plan_context(plan)
    semaphore = asyncio.Semaphore(MAX_CONCURRENT)

    tasks = [
        _process_single_module(
            module=module,
            module_index=i,
            parsed=parsed,
            plan_context=plan_context,
            llm=llm,
            run_id=run_id,
            semaphore=semaphore,
        )
        for i, module in enumerate(plan.modules)
    ]

    results = []
    completed = 0
    total = len(tasks)

    # Wrap in asyncio.Task for cancellation support
    pending_tasks = [asyncio.ensure_future(t) for t in tasks]

    # Use as_completed for progress tracking + error cancellation
    try:
        for coro in asyncio.as_completed(pending_tasks):
            idx, result = await coro
            results.append((idx, result))
            completed += 1
            if on_module_complete:
                # Support both sync and async callbacks
                ret = on_module_complete(completed, total)
                if asyncio.iscoroutine(ret):
                    await ret
            logger.info("Specialist progress: %d/%d modules", completed, total)
    except Exception:
        # Cancel remaining tasks to avoid wasting LLM tokens
        for t in pending_tasks:
            if not t.done():
                t.cancel()
        # Wait for cancellation to propagate
        await asyncio.gather(*pending_tasks, return_exceptions=True)
        raise

    # Sort by module index
    results.sort(key=lambda x: x[0])
    return results
