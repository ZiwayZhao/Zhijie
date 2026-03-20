"""Multi-type question schema — flat model for exam-aligned quiz generation.

Design decision: a SINGLE flat Pydantic model instead of discriminated unions,
because OpenRouter's function-calling doesn't handle anyOf / union types well.
The `question_type` field determines which optional fields are relevant.
"""

from pydantic import BaseModel, Field


# ── Question Item (flat, all-types-in-one) ────────────────────────

class QuestionItem(BaseModel):
    """Flat question model — question_type determines which fields are relevant.

    Shared fields (always present):
        question_type, question, points, difficulty,
        source_module_name, source_page, explanation

    Type-specific fields (present only when relevant):
        MCQ:          options, correct_index
        Fill-blank:   blanks
        True/false:   correct_answer
        Short answer: reference_answer, scoring_rubric
        Calculation:  steps, final_answer
    """

    # ── Shared fields ─────────────────────────────────────────────
    question_type: str = Field(
        description="mcq | fill_blank | true_false | short_answer | calculation",
    )
    question: str = Field(
        description="Question text, supports LaTeX",
    )
    points: float = Field(default=2.0)
    difficulty: str = Field(
        default="medium",
        pattern="^(easy|medium|hard)$",
    )
    source_module_name: str
    source_page: int | None = None
    explanation: str

    # ── MCQ fields ────────────────────────────────────────────────
    options: list[str] | None = Field(
        default=None,
        description="4 options for MCQ",
    )
    correct_index: int | None = Field(
        default=None,
        ge=0,
        le=3,
        description="Correct option index for MCQ",
    )

    # ── Fill-blank fields ─────────────────────────────────────────
    blanks: list[str] | None = Field(
        default=None,
        description=(
            "Acceptable answers for each blank, "
            "alternatives separated by |"
        ),
    )

    # ── True/false fields ─────────────────────────────────────────
    correct_answer: bool | None = Field(
        default=None,
        description="Correct answer for true/false",
    )

    # ── Short answer fields ───────────────────────────────────────
    reference_answer: str | None = Field(
        default=None,
        description="Reference answer for short answer",
    )
    scoring_rubric: list[str] | None = Field(
        default=None,
        description="Scoring criteria",
    )

    # ── Calculation fields ────────────────────────────────────────
    steps: list[dict] | None = Field(
        default=None,
        description="Step-by-step solution",
    )
    final_answer: str | None = Field(
        default=None,
        description="Final answer for calculation",
    )


# ── Examiner Result V2 ───────────────────────────────────────────

class ExaminerResultV2(BaseModel):
    """Top-level container returned by the exam-aligned quiz generator.

    Constrains output to 3-30 questions to keep generation focused.
    """
    questions: list[QuestionItem] = Field(min_length=3, max_length=30)
