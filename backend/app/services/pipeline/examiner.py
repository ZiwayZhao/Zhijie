"""Examiner Agent — generates structured MCQ assessments from Specialist outputs.

Input: Module summaries + key concepts (NOT full markdown — token control)
Output: 8-12 MCQ questions with explanations and source tracing
"""

import logging
from collections import Counter

from pydantic import BaseModel, Field

from app.schemas.exam_profile import ExamProfile
from app.schemas.question import ExaminerResultV2, QuestionItem
from app.services.llm_client import LLMClient, LLMResult
from app.services.pipeline.cartographer import CartographerResult

logger = logging.getLogger(__name__)

PROMPT_VERSION = "exam_v1"
PROMPT_VERSION_V2 = "exam_v2"
MODEL = "hunyuan-turbos"


# ── Input DTO (lightweight, no validation constraints) ────────────

class ExaminerModuleInput(BaseModel):
    """Lightweight input for examiner — only the fields it needs."""
    summary: str
    key_concepts: list[str]
    exam_traps: list[str] = []
    formulas_and_examples: str | None = None


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
        if spec.formulas_and_examples:
            lines.append(f"Formulas & Examples:\n{spec.formulas_and_examples}")

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


# ── V2: Multi-type question generation ──────────────────────────

_QUESTION_TYPE_LABELS: dict[str, str] = {
    "mcq": "选择题",
    "fill_blank": "填空题",
    "true_false": "判断题",
    "short_answer": "简答题",
    "calculation": "计算题",
}

SYSTEM_PROMPT_V2 = """You are an Examiner — an expert assessment designer who creates high-quality, multi-type exam questions for university courses.

Your task: Given module summaries, key concepts, and an **exam format specification**, generate questions that exactly match the required question types and counts.

## Exam Format

{exam_format_section}

## Rules for each question type

### 选择题 (mcq)
- Exactly 4 options, one correct answer (correct_index: 0-3)
- Options must be plausible — include common misconceptions as distractors
- Set `options` and `correct_index` fields

### 填空题 (fill_blank)
- Use {{{{blank}}}} markers in the question text for each blank
- Provide acceptable answers in the `blanks` field (list of strings)
- For each blank, separate alternative acceptable answers with | (e.g. "有效应力|effective stress")
- Set `blanks` field

### 判断题 (true_false)
- Write a clear declarative statement that is definitively true or false
- Set `correct_answer` field (true or false)

### 简答题 (short_answer)
- Provide `reference_answer` (200-500 chars) with a model answer
- Provide `scoring_rubric` — a list of key points, each stating the point and its allocation (e.g. "正确定义概念（2分）")
- Set `reference_answer` and `scoring_rubric` fields

### 计算题 (calculation)
- Break the solution into `steps` — each step is a dict with "description" (step text) and "points" (partial credit)
- Provide `final_answer` — the final numerical or symbolic result
- Set `steps` and `final_answer` fields

## General Rules
1. **ALWAYS write in Chinese (中文)**. Keep technical terms in English parenthetically, e.g. "有效应力 (effective stress)". All formulas must use proper LaTeX notation (e.g. $\\rho_m$ not ρ_m).
2. Generate **exactly** the number of questions specified for each type — no more, no less.
3. Set the `points` field for each question to match the `points_each` from the exam format.
4. Distribute questions across modules proportional to their exam_weight:
   - "high" weight modules get the most questions
   - "medium" weight modules get moderate coverage
   - "low" weight modules get minimal coverage
5. Mix difficulty levels: ~30% easy, ~50% medium, ~20% hard
6. Explanations should teach, not just state the answer
7. Avoid trivial recall questions — test understanding and application
8. Include some questions that require connecting concepts across modules
9. source_module_name must exactly match a module name from the input
10. **计算题必须包含完整的数值代入过程和中间步骤**
11. **每个MCQ错误选项必须在explanation中说明'错在哪里'**
12. **至少2道题需要综合多个模块的知识点**
13. **使用每个模块提供的公式和例题作为出题素材，确保计算题使用真实公式和数值**"""


def _build_exam_format_section(exam_profile: ExamProfile) -> str:
    """Convert ExamProfile.question_distribution into a readable format spec."""
    lines = ["考试题型分布："]
    for dist in exam_profile.question_distribution:
        label = _QUESTION_TYPE_LABELS.get(dist.question_type, dist.question_type)
        total = dist.count * dist.points_each
        lines.append(
            f"- {label} ({dist.question_type}): "
            f"{dist.count}题，每题{dist.points_each:.0f}分，共{total:.0f}分"
        )

    total_pts = exam_profile.total_points
    lines.append(f"\n总分: {total_pts}分")
    if exam_profile.duration_minutes:
        lines.append(f"考试时长: {exam_profile.duration_minutes}分钟")
    return "\n".join(lines)


def _build_examiner_input_v2(
    plan: CartographerResult,
    specialist_results: list[tuple[int, ExaminerModuleInput]],
    exam_format_section: str,
) -> str:
    """Build condensed input for v2 — includes exam format section."""
    lines = [
        f"Course: {plan.course_topic}",
        f"Difficulty level: {plan.difficulty_level}",
        "",
        exam_format_section,
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
        if spec.formulas_and_examples:
            lines.append(f"Formulas & Examples:\n{spec.formulas_and_examples}")

    return "\n".join(lines)


async def run_examiner_v2(
    plan: CartographerResult,
    specialist_results: list[tuple[int, ExaminerModuleInput]],
    llm: LLMClient,
    run_id: str,
    exam_profile: ExamProfile | None = None,
    dedup_context: str = "",
) -> LLMResult:
    """Execute Examiner v2 — multi-type question generation.

    If exam_profile is None or has an empty question_distribution,
    falls back to the v1 MCQ-only path.

    Args:
        plan: Cartographer's disassembly plan.
        specialist_results: List of (module_index, ExaminerModuleInput).
        llm: LLMClient instance.
        run_id: Execution run ID.
        exam_profile: Optional exam format specification.
        dedup_context: Previously generated questions to avoid duplication.

    Returns:
        LLMResult with ExaminerResultV2 in .data (or ExaminerResult for v1 fallback).
    """
    # Fall back to v1 when no exam profile provided
    if exam_profile is None or not exam_profile.question_distribution:
        logger.info("Examiner v2: no exam profile — falling back to v1")
        return await run_examiner(plan, specialist_results, llm, run_id)

    exam_format_section = _build_exam_format_section(exam_profile)
    system_prompt = SYSTEM_PROMPT_V2.format(exam_format_section=exam_format_section)
    input_text = _build_examiner_input_v2(
        plan, specialist_results, exam_format_section,
    )
    if dedup_context:
        input_text += f"\n\n{dedup_context}"

    result = await llm.structured_output(
        model=MODEL,
        system=system_prompt,
        messages=[{"role": "user", "content": input_text}],
        response_schema=ExaminerResultV2,
        prompt_version=PROMPT_VERSION_V2,
        max_tokens=16384,
        run_id=run_id,
    )

    exam_v2: ExaminerResultV2 = result.data
    type_counts = Counter(q.question_type for q in exam_v2.questions)
    logger.info(
        "Examiner v2: %d questions generated — %s (%d tokens in, %d out, %dms)",
        len(exam_v2.questions),
        ", ".join(f"{_QUESTION_TYPE_LABELS.get(t, t)}={c}" for t, c in type_counts.items()),
        result.input_tokens,
        result.output_tokens,
        result.latency_ms,
    )

    return result


# ── Formula extraction helper ────────────────────────────────────


def extract_formulas_and_examples(markdown: str) -> str:
    """Extract LaTeX formulas and example problems from specialist markdown."""
    lines = markdown.split('\n')
    extracted = []
    in_block = False
    for line in lines:
        # Capture LaTeX display math
        if '$$' in line:
            extracted.append(line)
            in_block = not in_block
        elif in_block:
            extracted.append(line)
        # Capture inline formulas and key equations
        elif '$' in line and line.count('$') >= 2:
            extracted.append(line)
        # Capture example/calculation sections
        elif any(kw in line.lower() for kw in (
            '例题', '计算', 'cost =', 'cost=', '代价',
            '公式', 'example', 'formula',
        )):
            extracted.append(line)
    # Limit to ~2000 chars
    joined = '\n'.join(extracted)
    return joined[-2000:] if len(joined) > 2000 else joined


# ── Iterative multi-round question generation ────────────────────


MAX_QUESTIONS_CAP = 50
"""Hard cap on total questions to prevent runaway generation."""


async def run_examiner_v2_iterative(
    plan: CartographerResult,
    specialist_results: list[tuple[int, ExaminerModuleInput]],
    llm: LLMClient,
    run_id: str,
    exam_profile: ExamProfile | None = None,
    rounds: int = 3,
) -> LLMResult:
    """Multi-round question generation with deduplication.

    Intentionally runs multiple rounds (default 3) to produce a large,
    diverse question bank (typically 30+ questions). Each round generates
    a full set per the exam profile, with dedup context to avoid repeats.

    A hard cap of MAX_QUESTIONS_CAP (50) prevents runaway generation.

    Args:
        plan: Cartographer's disassembly plan.
        specialist_results: List of (module_index, ExaminerModuleInput).
        llm: LLMClient instance.
        run_id: Execution run ID.
        exam_profile: Optional exam format specification.
        rounds: Number of generation rounds (default 3).

    Returns:
        LLMResult with combined ExaminerResultV2 containing all questions.
    """
    all_questions: list[QuestionItem] = []
    total_input_tokens = 0
    total_output_tokens = 0
    total_latency = 0
    last_result: LLMResult | None = None

    # Split question counts across rounds to stay within output token limits
    round_profile = exam_profile
    if exam_profile and exam_profile.question_distribution and rounds > 1:
        from app.schemas.exam_profile import QuestionTypeDistribution
        split_dist = []
        for qtd in exam_profile.question_distribution:
            per_round = max(1, qtd.count // rounds)
            split_dist.append(QuestionTypeDistribution(
                question_type=qtd.question_type,
                count=per_round,
                points_each=qtd.points_each,
                total_points=per_round * qtd.points_each,
                percentage=qtd.percentage,
            ))
        round_profile = exam_profile.model_copy(
            update={"question_distribution": split_dist},
        )

    for round_num in range(rounds):
        # Build dedup context from previous questions
        dedup_context = ""
        if all_questions:
            dedup_context = "以下题目已出过，请出不同角度和知识点的新题：\n"
            dedup_context += "\n".join(
                f"- {q.question[:80]}" for q in all_questions[:30]
            )

        result = await run_examiner_v2(
            plan, specialist_results, llm, run_id,
            exam_profile=round_profile,
            dedup_context=dedup_context,
        )
        last_result = result
        all_questions.extend(result.data.questions)
        total_input_tokens += result.input_tokens
        total_output_tokens += result.output_tokens
        total_latency += result.latency_ms

        logger.info(
            "Examiner iterative round %d/%d: +%d questions (total %d)",
            round_num + 1, rounds,
            len(result.data.questions), len(all_questions),
        )

        # Enforce hard cap to prevent runaway generation
        if len(all_questions) >= MAX_QUESTIONS_CAP:
            all_questions = all_questions[:MAX_QUESTIONS_CAP]
            logger.info("Examiner: hit max cap of %d questions, stopping early", MAX_QUESTIONS_CAP)
            break

    return LLMResult(
        data=ExaminerResultV2(questions=all_questions),
        prompt_version=last_result.prompt_version,
        model=last_result.model,
        input_tokens=total_input_tokens,
        output_tokens=total_output_tokens,
        latency_ms=total_latency,
        run_id=last_result.run_id,
    )
