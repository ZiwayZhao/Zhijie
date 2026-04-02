"""Cartographer Agent — analyzes PDF structure into learning modules.

Input: Per-page markdown summaries (NOT full text) + material metadata
Output: DisassemblyPlan — list of modules with page ranges, exam weights, dependencies
"""

import logging
from typing import Optional

from pydantic import BaseModel, Field

from app.services.llm_client import LLMClient, LLMResult
from app.services.pdf_parser import ParsedPDF

logger = logging.getLogger(__name__)

PROMPT_VERSION = "cart_v1"
MODEL = "hunyuan-turbos"

# ── Structured Output Schema ─────────────────────────────────────

class ModulePlan(BaseModel):
    """A single learning module identified by the Cartographer."""
    name: str = Field(description="Module name (concise, descriptive)")
    description: str = Field(description="1-2 sentence description of what this module covers")
    page_range_start: int = Field(ge=1, description="Starting page number (1-indexed)")
    page_range_end: int = Field(ge=1, description="Ending page number (inclusive)")
    exam_weight: str = Field(
        description="Exam importance: high, medium, or low",
        pattern="^(high|medium|low)$",
    )
    depends_on: list[int] = Field(
        default_factory=list,
        description="sort_order indices of prerequisite modules (0-indexed)",
    )


class CartographerResult(BaseModel):
    """Cartographer output — the complete disassembly plan."""
    modules: list[ModulePlan] = Field(
        min_length=1,
        max_length=30,
        description="Ordered list of learning modules",
    )
    course_topic: str = Field(description="Inferred overall topic of the material")
    difficulty_level: str = Field(
        description="Overall difficulty: introductory, intermediate, or advanced",
    )


# ── Prompt ────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are a Cartographer — an expert curriculum designer who analyzes course materials and breaks them into optimal learning modules.

Your task: Given a page-by-page outline of a PDF course material, create a structured DisassemblyPlan that divides the content into logical learning modules.

Rules:
1. Each module should cover a coherent topic (3-15 pages typically)
2. Modules should follow the natural order of the material
3. Page ranges must be continuous and non-overlapping, covering all pages
4. exam_weight reflects how likely this topic appears on exams:
   - "high": core concepts, frequently tested
   - "medium": important but less frequently tested
   - "low": background, introduction, appendix
5. depends_on uses 0-indexed module positions (e.g., module 2 depends on module 0)
6. Keep module count between 3-15 for a typical course material
7. **ALWAYS write module names and descriptions in Chinese (中文)**. Even if the source material is in English, use Chinese names with English terms in parentheses where helpful, e.g. "有效应力与土力学 (Effective Stress in Soil Mechanics)"

Think step by step:
1. First identify the major sections/topics from the page outlines
2. Group related pages into modules
3. Determine exam weight based on content density and importance
4. Identify prerequisite dependencies between modules"""


def _build_page_outline(parsed: ParsedPDF, max_chars_per_page: int = 200) -> str:
    """Build a condensed outline from parsed pages.

    Instead of sending full markdown (which would explode context),
    extract first ~200 chars + any headings from each page.
    """
    lines = []
    for page in parsed.pages:
        md = page.markdown.strip()
        if not md:
            lines.append(f"[Page {page.page_num}] (empty)")
            continue

        # Extract headings (lines starting with #)
        headings = []
        preview_chars = []
        for line in md.split("\n"):
            stripped = line.strip()
            if stripped.startswith("#"):
                headings.append(stripped)
            elif len("\n".join(preview_chars)) < max_chars_per_page:
                preview_chars.append(stripped)

        heading_text = " | ".join(headings[:3]) if headings else ""
        preview_text = " ".join(preview_chars)[:max_chars_per_page]

        if heading_text:
            lines.append(f"[Page {page.page_num}] {heading_text}\n  {preview_text}")
        else:
            lines.append(f"[Page {page.page_num}] {preview_text}")

    return "\n".join(lines)


async def run_cartographer(
    parsed: ParsedPDF,
    material_name: str,
    material_type: str,
    llm: LLMClient,
    run_id: str,
) -> LLMResult:
    """Execute the Cartographer agent.

    Args:
        parsed: Per-page markdown from PDF parser.
        material_name: Original filename or title.
        material_type: pdf, slides, notes, exam, etc.
        llm: LLMClient instance.
        run_id: Execution run ID for audit.

    Returns:
        LLMResult with CartographerResult in .data
    """
    outline = _build_page_outline(parsed)

    user_message = f"""Analyze this {material_type} material: "{material_name}"
Total pages: {parsed.total_pages}

Page-by-page outline:
{outline}"""

    result = await llm.structured_output(
        model=MODEL,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_message}],
        response_schema=CartographerResult,
        prompt_version=PROMPT_VERSION,
        run_id=run_id,
    )

    plan: CartographerResult = result.data

    # ── Post-validation ──────────────────────────────────────────
    total_pages = parsed.total_pages

    # 1. Clamp page ranges and filter depends_on
    for i, mod in enumerate(plan.modules):
        mod.page_range_start = max(1, min(mod.page_range_start, total_pages))
        mod.page_range_end = max(mod.page_range_start, min(mod.page_range_end, total_pages))
        mod.depends_on = [
            d for d in mod.depends_on
            if 0 <= d < len(plan.modules) and d != i
        ]

    # 2. Sort by page_range_start, remapping depends_on indices
    old_order = list(range(len(plan.modules)))
    indexed = list(enumerate(plan.modules))
    indexed.sort(key=lambda pair: pair[1].page_range_start)

    # Build old_index → new_index mapping
    old_to_new = {old_idx: new_idx for new_idx, (old_idx, _) in enumerate(indexed)}

    # Reorder and remap
    sorted_modules = []
    for old_idx, mod in indexed:
        mod.depends_on = [
            old_to_new[d] for d in mod.depends_on
            if d in old_to_new and old_to_new[d] != old_to_new[old_idx]
        ]
        sorted_modules.append(mod)
    plan.modules = sorted_modules

    logger.info(
        "Cartographer: %d modules, topic='%s', difficulty='%s'",
        len(plan.modules),
        plan.course_topic,
        plan.difficulty_level,
    )

    return result
