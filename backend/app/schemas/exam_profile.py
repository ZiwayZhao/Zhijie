"""Exam profile schema — describes exam format, constraints, and question distribution.

Used by the exam-aligned quiz generator to produce questions that match
the real exam structure (question types, point allocation, time pressure).
"""

from pydantic import BaseModel, Field


# ── Question Type Distribution ────────────────────────────────────

class QuestionTypeDistribution(BaseModel):
    """How many questions of a given type, and their point weight."""
    question_type: str = Field(
        description='mcq | fill_blank | true_false | short_answer | calculation',
    )
    count: int
    points_each: float
    total_points: float
    percentage: float = Field(
        description="Fraction of exam total, 0-1",
        ge=0,
        le=1,
    )


# ── Exam Profile ─────────────────────────────────────────────────

class ExamProfile(BaseModel):
    """Describes the format and constraints of a course exam.

    Three sources:
      - "default"       built-in template based on course_type
      - "user_input"    student filled in exam details manually
      - "exam_analysis" LLM analysed a past exam paper (PDF)
    """
    exam_date: str | None = None
    duration_minutes: int | None = None
    is_open_book: bool | None = None
    calculator_allowed: bool | None = None
    total_points: int = 100
    question_distribution: list[QuestionTypeDistribution] = []
    source: str = Field(
        default="default",
        description='default | user_input | exam_analysis',
    )
    analyzed_exam_s3_key: str | None = None

    @classmethod
    def default_for_course_type(cls, course_type: str) -> "ExamProfile":
        """Return a sensible default exam profile for the given course type.

        Templates:
          math / physics / engineering  — heavy on calculation + short answer
          cs / database / algorithms    — MCQ-heavy + short answer + calculation
          humanities (fallback)         — MCQ + short answer + true/false
        """
        templates: dict[str, list[QuestionTypeDistribution]] = {
            "math": [
                QuestionTypeDistribution(
                    question_type="mcq", count=10,
                    points_each=2, total_points=20, percentage=0.20,
                ),
                QuestionTypeDistribution(
                    question_type="fill_blank", count=5,
                    points_each=2, total_points=10, percentage=0.10,
                ),
                QuestionTypeDistribution(
                    question_type="true_false", count=5,
                    points_each=2, total_points=10, percentage=0.10,
                ),
                QuestionTypeDistribution(
                    question_type="calculation", count=6,
                    points_each=8, total_points=48, percentage=0.48,
                ),
                QuestionTypeDistribution(
                    question_type="short_answer", count=2,
                    points_each=6, total_points=12, percentage=0.12,
                ),
            ],
            "cs": [
                QuestionTypeDistribution(
                    question_type="mcq", count=15,
                    points_each=2, total_points=30, percentage=0.30,
                ),
                QuestionTypeDistribution(
                    question_type="true_false", count=5,
                    points_each=2, total_points=10, percentage=0.10,
                ),
                QuestionTypeDistribution(
                    question_type="fill_blank", count=5,
                    points_each=2, total_points=10, percentage=0.10,
                ),
                QuestionTypeDistribution(
                    question_type="short_answer", count=4,
                    points_each=5, total_points=20, percentage=0.20,
                ),
                QuestionTypeDistribution(
                    question_type="calculation", count=3,
                    points_each=10, total_points=30, percentage=0.30,
                ),
            ],
            "humanities": [
                QuestionTypeDistribution(
                    question_type="mcq", count=20,
                    points_each=2, total_points=40, percentage=0.40,
                ),
                QuestionTypeDistribution(
                    question_type="true_false", count=10,
                    points_each=2, total_points=20, percentage=0.20,
                ),
                QuestionTypeDistribution(
                    question_type="short_answer", count=4,
                    points_each=10, total_points=40, percentage=0.40,
                ),
            ],
        }

        # Map common course type strings to template keys
        type_lower = course_type.lower()
        if any(k in type_lower for k in ("math", "physics", "engineer", "chem")):
            key = "math"
        elif any(k in type_lower for k in ("cs", "comput", "algo", "data", "program")):
            key = "cs"
        else:
            key = "humanities"

        return cls(
            total_points=100,
            question_distribution=templates[key],
            source="default",
        )
