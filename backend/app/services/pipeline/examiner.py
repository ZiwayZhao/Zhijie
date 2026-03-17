"""Examiner Agent — generates structured MCQ assessments from Specialist outputs.

Input: Module summaries + key concepts (NOT full markdown — token control)
Output: 8-12 MCQ questions with explanations and source tracing
"""

import logging

from pydantic import BaseModel, Field

from app.services.llm_client import LLMClient, LLMResult
from app.services.pipeline.cartographer import CartographerResult

logger = logging.getLogger(__name__)

PROMPT_VERSION = "exam_v1"
MODEL = "z-ai/glm-5-20260211"


# ── Input DTO (lightweight, no validation constraints) ────────────

class ExaminerModuleInput(BaseModel):
    """Lightweight input for examiner — only the fields it needs."""
    summary: str
    key_concepts: list[str]
    exam_traps: list[str] = []


# ── Structured Output Schema ─────────────────────────────────────

class MCQ(BaseModel):
    """A single multiple-choice question."""
    question: str = Field(description="The question text")
    options: list[str] = Field(
        min_length=4,
        max_length=4,
        description="Exactly 4 answer options",
    )
    correct_index: int = Field(
        ge=0, le=3,
        description="Index of the correct answer (0-3)",
    )
    explanation: str = Field(
        description="Why the correct answer is right and common mistakes",
    )
    source_module_name: str = Field(
        description="Name of the module this question comes from",
    )
    source_page: int | None = Field(
        default=None,
        description="Approximate page number of the source content",
    )
    difficulty: str = Field(
        default="medium",
        description="easy, medium, or hard",
        pattern="^(easy|medium|hard)$",
    )


class ExaminerResult(BaseModel):
    """Examiner output — the complete quiz."""
    questions: list[MCQ] = Field(
        min_length=8,
        max_length=12,
        description="8-12 multiple choice questions",
    )


# ── Prompt ────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are an Examiner — an expert assessment designer who creates high-quality multiple choice questions (MCQ) for university courses.

Your task: Given module summaries and key concepts from a course material, generate 8-12 MCQs that thoroughly test student understanding.

Rules:
1. **ALWAYS write in Chinese (中文)**. All questions, options, and explanations must be in Chinese. Keep technical terms in English parenthetically where helpful, e.g. "有效应力 (effective stress)". All formulas must use proper LaTeX notation (e.g. $\\rho_m$ not ρ_m).
2. Each question must have exactly 4 options with one correct answer
3. Options should be plausible — include common misconceptions as distractors
4. Cover all modules proportionally to their exam_weight:
   - "high" weight modules: 3-4 questions
   - "medium" weight modules: 1-2 questions
   - "low" weight modules: 0-1 questions
5. Mix difficulty levels: ~30% easy, ~50% medium, ~20% hard
6. Explanations should teach, not just state the answer
7. Avoid trivial recall questions — test understanding and application
8. Include some questions that require connecting concepts across modules
9. source_module_name must exactly match a module name from the input
10. Generate 10 questions as default target"""


def _build_examiner_input(
    plan: CartographerResult,
    specialist_results: list[tuple[int, ExaminerModuleInput]],
) -> str:
    """Build a condensed input from Specialist outputs.

    Uses summaries + key_concepts + exam_traps (NOT full markdown)
    to stay within reasonable token limits.
    """
    lines = [
        f"Course: {plan.course_topic}",
        f"Difficulty level: {plan.difficulty_level}",
        "",
        "Modules:",
    ]

    for idx, spec in specialist_results:
        module = plan.modules[idx]
        lines.append(f"\n## Module {idx}: {module.name}")
        lines.append(f"Exam weight: {module.exam_weight}")
        lines.append(f"Pages: {module.page_range_start}-{module.page_range_end}")
        lines.append(f"Summary: {spec.summary}")
        lines.append(f"Key concepts: {', '.join(spec.key_concepts)}")
        if spec.exam_traps:
            lines.append(f"Common mistakes: {', '.join(spec.exam_traps)}")

    return "\n".join(lines)


async def run_examiner(
    plan: CartographerResult,
    specialist_results: list[tuple[int, ExaminerModuleInput]],
    llm: LLMClient,
    run_id: str,
) -> LLMResult:
    """Execute the Examiner agent.

    Args:
        plan: Cartographer's disassembly plan.
        specialist_results: List of (module_index, ExaminerModuleInput) from DB.
        llm: LLMClient instance.
        run_id: Execution run ID.

    Returns:
        LLMResult with ExaminerResult in .data
    """
    input_text = _build_examiner_input(plan, specialist_results)

    result = await llm.structured_output(
        model=MODEL,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": input_text}],
        response_schema=ExaminerResult,
        prompt_version=PROMPT_VERSION,
        run_id=run_id,
    )

    exam: ExaminerResult = result.data
    logger.info(
        "Examiner: %d questions generated (%d tokens in, %d out, %dms)",
        len(exam.questions),
        result.input_tokens,
        result.output_tokens,
        result.latency_ms,
    )

    return result
