from __future__ import annotations

"""Student Model Service — manages selfReport/aiInference separation.

Provides the C2 requirement: student self-assessment and AI inference
are stored separately, with clear rules for conflict resolution.

Conflict resolution rules:
- selfReport is ALWAYS respected for subjective assessments
  (weak_areas, covered_chapters, confidence, exam_date)
- aiInference is trusted for objective measurements
  (quiz scores, mastery percentages, confusion_pairs)
- When they conflict on mastery: use aiInference but acknowledge selfReport
- Student can override aiInference via explicit self-report updates
"""

import logging
from datetime import date, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.student_profile import StudentProfile
from app.services.prompt_builder import StudentContext

logger = logging.getLogger(__name__)

# Cap session memories to avoid unbounded JSONB growth
MAX_SESSION_MEMORIES = 50


class StudentModelService:
    """Reads/writes StudentProfile and builds StudentContext for prompts."""

    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    # ── CRUD ────────────────────────────────────────────────────────

    async def get_or_create_profile(
        self, user_id: UUID, material_id: UUID,
    ) -> StudentProfile:
        """Get existing profile or create a blank one."""
        stmt = select(StudentProfile).where(
            StudentProfile.user_id == user_id,
            StudentProfile.material_id == material_id,
        )
        result = await self._db.execute(stmt)
        profile = result.scalar_one_or_none()

        if profile is None:
            profile = StudentProfile(
                user_id=user_id,
                material_id=material_id,
                self_report={},
                ai_inference={},
                session_memories=[],
            )
            self._db.add(profile)
            await self._db.flush()
            logger.info(
                "Created student profile user=%s material=%s",
                user_id, material_id,
            )

        return profile

    async def update_self_report(
        self, user_id: UUID, material_id: UUID, updates: dict,
    ) -> StudentProfile:
        """Merge *updates* into selfReport. Student-initiated."""
        profile = await self.get_or_create_profile(user_id, material_id)
        merged = {**profile.self_report, **updates}
        profile.self_report = merged
        await self._db.flush()
        return profile

    async def update_ai_inference(
        self, user_id: UUID, material_id: UUID, updates: dict,
    ) -> StudentProfile:
        """Merge *updates* into aiInference. AI-initiated."""
        profile = await self.get_or_create_profile(user_id, material_id)

        old = dict(profile.ai_inference)
        # Deep-merge mastery dicts instead of overwriting
        if "mastery" in updates and "mastery" in old:
            old["mastery"] = {**old["mastery"], **updates["mastery"]}
            updates = {k: v for k, v in updates.items() if k != "mastery"}

        merged = {**old, **updates}
        profile.ai_inference = merged
        await self._db.flush()
        return profile

    async def merge_session_memory(
        self, user_id: UUID, material_id: UUID, memory_dict: dict,
    ) -> None:
        """Append a session memory and update aiInference from it."""
        profile = await self.get_or_create_profile(user_id, material_id)

        # Append memory, cap at MAX_SESSION_MEMORIES (keep newest)
        memories = list(profile.session_memories)
        memories.append(memory_dict)
        if len(memories) > MAX_SESSION_MEMORIES:
            memories = memories[-MAX_SESSION_MEMORIES:]
        profile.session_memories = memories

        # Extract inference signals from the memory dict
        inference_updates: dict = {}
        if mastery := memory_dict.get("mastery_updates"):
            inference_updates["mastery"] = mastery
        if confusions := memory_dict.get("confusion_pairs"):
            existing = profile.ai_inference.get("confusion_pairs", [])
            # Deduplicate confusion pairs (as sorted tuples)
            seen = {tuple(sorted(p)) for p in existing}
            for pair in confusions:
                key = tuple(sorted(pair))
                if key not in seen:
                    existing.append(pair)
                    seen.add(key)
            inference_updates["confusion_pairs"] = existing

        if inference_updates:
            await self.update_ai_inference(user_id, material_id, inference_updates)
        else:
            await self._db.flush()

    # ── Bridge to Prompt Builder ────────────────────────────────────

    async def build_student_context(
        self, user_id: UUID, material_id: UUID,
    ) -> StudentContext:
        """Build a StudentContext for prompt injection.

        Merges selfReport and aiInference into the format expected
        by TutorPromptBuilder.
        """
        profile = await self.get_or_create_profile(user_id, material_id)

        mastery_summary = self._format_mastery(
            profile.ai_inference.get("mastery", {}),
        )

        self_report_text = self._format_self_report(profile.self_report)
        ai_inference_text = self._format_ai_inference(profile.ai_inference)
        confusion_text = self._format_confusions(profile)

        exam_days = self._calc_exam_countdown(profile.self_report)

        return StudentContext(
            mastery_summary=mastery_summary,
            self_report=self_report_text,
            ai_inference=ai_inference_text,
            confusion_records=confusion_text,
            exam_countdown_days=exam_days,
        )

    # ── Formatting Helpers ──────────────────────────────────────────

    @staticmethod
    def _format_mastery(mastery: dict) -> str:
        """Format mastery dict into readable string for prompt."""
        if not mastery:
            return ""
        lines = [f"- {topic}: {score}%" for topic, score in mastery.items()]
        return "\n".join(lines)

    @staticmethod
    def _format_self_report(report: dict) -> str:
        """Format selfReport dict into readable string."""
        if not report:
            return ""
        parts: list[str] = []
        if chapters := report.get("covered_chapters"):
            parts.append(f"已学章节: {', '.join(chapters)}")
        if weak := report.get("weak_areas"):
            parts.append(f"自评薄弱点: {', '.join(weak)}")
        if confidence := report.get("confidence"):
            parts.append(f"自信度: {confidence}")
        if exam_date := report.get("exam_date"):
            parts.append(f"考试日期: {exam_date}")
        # Include any extra keys the student set
        skip = {"covered_chapters", "weak_areas", "confidence", "exam_date"}
        for k, v in report.items():
            if k not in skip:
                parts.append(f"{k}: {v}")
        return "\n".join(parts)

    @staticmethod
    def _format_ai_inference(inference: dict) -> str:
        """Format aiInference dict (excluding mastery, handled separately)."""
        if not inference:
            return ""
        parts: list[str] = []
        if score := inference.get("avg_quiz_score"):
            parts.append(f"平均测验得分: {score:.0%}")
        if total := inference.get("total_sessions"):
            parts.append(f"累计会话数: {total}")
        # Skip mastery and confusion_pairs (formatted elsewhere)
        skip = {"mastery", "confusion_pairs", "avg_quiz_score", "total_sessions"}
        for k, v in inference.items():
            if k not in skip:
                parts.append(f"{k}: {v}")
        return "\n".join(parts)

    @staticmethod
    def _format_confusions(profile: StudentProfile) -> str:
        """Extract and format confusion records from both report and inference."""
        pairs: list[list[str]] = profile.ai_inference.get("confusion_pairs", [])
        # Also include self-reported confusions if any
        if sr_confusions := profile.self_report.get("confusions"):
            if isinstance(sr_confusions, list):
                pairs = pairs + sr_confusions

        if not pairs:
            return ""
        lines = [f"- {a} vs {b}" for a, b in pairs]
        return "\n".join(lines)

    @staticmethod
    def _calc_exam_countdown(report: dict) -> int | None:
        """Calculate days until exam from selfReport exam_date."""
        exam_str = report.get("exam_date")
        if not exam_str:
            return None
        try:
            exam_date = date.fromisoformat(exam_str)
            delta = (exam_date - date.today()).days
            return max(delta, 0)
        except (ValueError, TypeError):
            return None
