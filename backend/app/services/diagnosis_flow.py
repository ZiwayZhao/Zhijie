"""Learning Diagnosis Flow — initial student assessment dialogue.

When a student starts a new material session without prior profile data,
the tutor asks diagnostic questions to build a student model.

The diagnosis is conversational (not a form), inspired by Claude Code's
KAIROS tick system — it detects when diagnosis is needed and injects
appropriate prompts into the tutor's system prompt.

Flow:
    1. Detect: is_diagnosis_needed() checks if student has a profile
    2. Generate: get_diagnosis_prompt() returns system prompt addition
    3. Parse: try_extract() extracts structured data from user response
    4. Apply: caller updates student profile with extracted data

Usage in orchestrator:
    flow = DiagnosisFlow()
    if flow.is_diagnosis_needed(profile_data):
        state = flow.get_initial_state()
        extra_prompt = flow.get_diagnosis_prompt(state)
        # Inject extra_prompt into system prompt
        # After user responds:
        new_state, extracted = flow.try_extract(user_msg, state)
        if extracted:
            await student_model.update_self_report(...)
"""

from __future__ import annotations

import re
import logging
from dataclasses import dataclass, field
from enum import Enum

logger = logging.getLogger(__name__)


class DiagnosisStage(str, Enum):
    """Stages of the diagnosis flow."""
    NOT_NEEDED = "not_needed"
    GOAL_SETTING = "goal_setting"
    COVERAGE_CHECK = "coverage"
    DIFFICULTY_PROBE = "difficulty"
    EXAM_INFO = "exam_info"
    COMPLETED = "completed"


@dataclass
class DiagnosisState:
    """Current state of the diagnosis flow."""
    stage: DiagnosisStage = DiagnosisStage.GOAL_SETTING
    gathered: dict = field(default_factory=dict)
    turns_in_stage: int = 0
    max_diagnosis_turns: int = 4


# ── Stage Prompts ───────────────────────────────────────────────

_STAGE_PROMPTS = {
    DiagnosisStage.GOAL_SETTING: """## 初始诊断 — 学习目标

这是你和该学生的第一次对话。在回答学生的问题之前，请**自然地**先了解学生的情况。

用友好的语气，在回答的开头先问学生：
"你好！在开始学习之前，我想了解一下你的学习目标 — 你现在是想**学透**这门课（系统学习每个概念），还是在**备考**（有考试要准备），还是**复习**（已经学过想回顾）？你可以直接说你的情况。"

然后自然地回答学生原本的问题。""",

    DiagnosisStage.COVERAGE_CHECK: """## 诊断进行中 — 了解进度

学生已经告知了学习目标。请在回答中**自然地**追问：
"那你目前这门课学到哪里了？比如学了前几章，或者哪些概念已经了解了？"

将这个问题融入你的回答中，不要生硬地单独提问。""",

    DiagnosisStage.DIFFICULTY_PROBE: """## 诊断进行中 — 了解困难点

请在回答中**自然地**追问：
"有没有哪些部分你觉得特别困难或者容易搞混的？"

如果学生之前已经提到了困难点，可以跳过这个问题。""",

    DiagnosisStage.EXAM_INFO: """## 诊断进行中 — 考试信息

学生选择了备考模式。请在回答中**自然地**追问：
"你的考试是什么时候？这样我可以帮你安排复习节奏。"

如果学生之前已经提到了考试时间，可以跳过。""",
}


# ── Keyword patterns ────────────────────────────────────────────

_MODE_KEYWORDS = {
    "learn_deep": ["学透", "深入", "系统", "从头", "全面", "透彻", "打基础"],
    "exam_prep": ["备考", "考试", "复习考试", "期末", "期中", "月考", "准备考"],
    "review": ["复习", "回顾", "温习", "巩固", "重新看"],
}

_DATE_PATTERNS = [
    # "7月15日" "7月15"
    re.compile(r"(\d{1,2})月(\d{1,2})[日号]?"),
    # "2026-07-15" "2026/07/15"
    re.compile(r"(\d{4})[-/](\d{1,2})[-/](\d{1,2})"),
    # "下周" "后天" "3天后" "一周后"
    re.compile(r"(\d+)\s*天后"),
    re.compile(r"(\d+)\s*[周]后"),
    re.compile(r"下周[一二三四五六日天]?"),
    re.compile(r"后天"),
    re.compile(r"大后天"),
]

_CHAPTER_PATTERNS = [
    # "前3章" "前三章"
    re.compile(r"前(\d+|[一二三四五六七八九十]+)章"),
    # "第1-5章" "第1到5章"
    re.compile(r"第(\d+)[-到至](\d+)章"),
    # "学了一半" "学了大部分"
    re.compile(r"学了(一半|大部分|一点|前半|后半)"),
    # "Ch.1" "Chapter 1-3"
    re.compile(r"[Cc]h(?:apter)?\.?\s*(\d+)(?:\s*[-到至]\s*(\d+))?"),
    # "第3章" "第三章"
    re.compile(r"第(\d+|[一二三四五六七八九十]+)章"),
]

_CN_NUMS = {
    "一": 1, "二": 2, "三": 3, "四": 4, "五": 5,
    "六": 6, "七": 7, "八": 8, "九": 9, "十": 10,
}


def _cn_to_int(s: str) -> int:
    """Convert Chinese numeral to int, fallback to int()."""
    if s in _CN_NUMS:
        return _CN_NUMS[s]
    try:
        return int(s)
    except ValueError:
        return 0


# ── DiagnosisFlow ───────────────────────────────────────────────

class DiagnosisFlow:
    """Manages the learning diagnosis dialogue flow.

    Pure logic — no LLM calls, no DB access. Just keyword matching
    and state machine transitions.
    """

    @staticmethod
    def is_diagnosis_needed(profile_data: dict | None) -> bool:
        """Check if we need to run diagnosis.

        Returns True if:
        - No profile exists yet
        - Profile exists but has no selfReport data
        - Profile has no learning mode set
        """
        if not profile_data:
            return True
        sr = profile_data.get("self_report", {})
        if not sr:
            return True
        # Has profile but no mode preference → still needs goal setting
        if not profile_data.get("preferred_mode"):
            return True
        return False

    @staticmethod
    def get_initial_state() -> DiagnosisState:
        """Create initial diagnosis state."""
        return DiagnosisState(stage=DiagnosisStage.GOAL_SETTING)

    @staticmethod
    def get_diagnosis_prompt(state: DiagnosisState) -> str:
        """Get system prompt addition for current diagnosis stage.

        Returns empty string if diagnosis is not needed or completed.
        """
        if state.stage in (DiagnosisStage.NOT_NEEDED, DiagnosisStage.COMPLETED):
            return ""
        return _STAGE_PROMPTS.get(state.stage, "")

    def try_extract(
        self,
        user_message: str,
        state: DiagnosisState,
    ) -> tuple[DiagnosisState, dict | None]:
        """Try to extract diagnosis data from user's response.

        Returns:
            (updated_state, extracted_data_or_None)
            extracted_data keys: learning_mode, covered_chapters,
            weak_areas, exam_date
        """
        if state.stage in (DiagnosisStage.NOT_NEEDED, DiagnosisStage.COMPLETED):
            return state, None

        msg = user_message.strip()
        extracted: dict = dict(state.gathered)  # accumulate
        advanced = False

        if state.stage == DiagnosisStage.GOAL_SETTING:
            mode = self._extract_mode(msg)
            if mode:
                extracted["learning_mode"] = mode
                advanced = True

        elif state.stage == DiagnosisStage.COVERAGE_CHECK:
            chapters = self._extract_chapters(msg)
            if chapters:
                extracted["covered_chapters"] = chapters
            advanced = True  # advance even if no chapters extracted

        elif state.stage == DiagnosisStage.DIFFICULTY_PROBE:
            weak = self._extract_weak_areas(msg)
            if weak:
                extracted["weak_areas"] = weak
            advanced = True

        elif state.stage == DiagnosisStage.EXAM_INFO:
            date_str = self._extract_date(msg)
            if date_str:
                extracted["exam_date"] = date_str
            advanced = True

        # Update state
        new_state = DiagnosisState(
            stage=state.stage,
            gathered=extracted,
            turns_in_stage=state.turns_in_stage + 1,
            max_diagnosis_turns=state.max_diagnosis_turns,
        )

        # Advance or force-advance after too many turns in same stage
        if advanced or new_state.turns_in_stage >= 2:
            new_state = self._advance_stage(new_state)

        # Check total turns limit
        total_turns = sum(1 for _ in extracted)
        if total_turns >= new_state.max_diagnosis_turns:
            new_state.stage = DiagnosisStage.COMPLETED

        return new_state, extracted if extracted else None

    def _advance_stage(self, state: DiagnosisState) -> DiagnosisState:
        """Move to the next diagnosis stage."""
        order = [
            DiagnosisStage.GOAL_SETTING,
            DiagnosisStage.COVERAGE_CHECK,
            DiagnosisStage.DIFFICULTY_PROBE,
            DiagnosisStage.EXAM_INFO,
            DiagnosisStage.COMPLETED,
        ]

        try:
            idx = order.index(state.stage)
        except ValueError:
            return DiagnosisState(
                stage=DiagnosisStage.COMPLETED,
                gathered=state.gathered,
            )

        next_idx = idx + 1

        # Skip EXAM_INFO if not in exam_prep mode
        mode = state.gathered.get("learning_mode", "")
        if next_idx < len(order) and order[next_idx] == DiagnosisStage.EXAM_INFO:
            if mode != "exam_prep":
                next_idx += 1

        if next_idx >= len(order):
            next_stage = DiagnosisStage.COMPLETED
        else:
            next_stage = order[next_idx]

        return DiagnosisState(
            stage=next_stage,
            gathered=state.gathered,
            turns_in_stage=0,
            max_diagnosis_turns=state.max_diagnosis_turns,
        )

    # ── Extraction helpers ──────────────────────────────────────

    @staticmethod
    def _extract_mode(msg: str) -> str | None:
        """Extract learning mode from user message."""
        msg_lower = msg.lower()
        for mode, keywords in _MODE_KEYWORDS.items():
            if any(k in msg_lower for k in keywords):
                return mode
        return None

    @staticmethod
    def _extract_chapters(msg: str) -> list[str] | None:
        """Extract chapter coverage from user message."""
        for pat in _CHAPTER_PATTERNS:
            m = pat.search(msg)
            if m:
                groups = m.groups()
                if len(groups) == 2 and groups[1]:
                    start = _cn_to_int(groups[0])
                    end = _cn_to_int(groups[1])
                    if start and end:
                        return [f"Ch.{i}" for i in range(start, end + 1)]
                elif len(groups) >= 1:
                    n = _cn_to_int(groups[0])
                    if n:
                        return [f"Ch.{i}" for i in range(1, n + 1)]
        # Fallback: "学了一半" etc.
        if "一半" in msg:
            return ["前半部分"]
        if "大部分" in msg:
            return ["大部分已学"]
        return None

    @staticmethod
    def _extract_weak_areas(msg: str) -> list[str] | None:
        """Extract self-reported weak areas from user message.

        Returns the original text segments — no NLP needed,
        the student model stores them as-is.
        """
        # If the student says something substantive, capture it
        # Skip very short / uninformative responses
        if len(msg) < 4 or msg in ("没有", "暂时没有", "不知道", "还好"):
            return None
        # Return the whole message as a weak area description
        return [msg[:200]]

    @staticmethod
    def _extract_date(msg: str) -> str | None:
        """Extract exam date from user message as ISO format string."""
        from datetime import date, timedelta

        today = date.today()

        # "7月15日"
        m = re.search(r"(\d{1,2})月(\d{1,2})[日号]?", msg)
        if m:
            month, day = int(m.group(1)), int(m.group(2))
            year = today.year
            exam = date(year, month, day)
            if exam < today:
                exam = date(year + 1, month, day)
            return exam.isoformat()

        # "2026-07-15"
        m = re.search(r"(\d{4})[-/](\d{1,2})[-/](\d{1,2})", msg)
        if m:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3))).isoformat()

        # "3天后"
        m = re.search(r"(\d+)\s*天后", msg)
        if m:
            return (today + timedelta(days=int(m.group(1)))).isoformat()

        # "下周"
        if "下周" in msg:
            return (today + timedelta(days=7)).isoformat()

        # "后天"
        if "后天" in msg:
            return (today + timedelta(days=2)).isoformat()

        if "大后天" in msg:
            return (today + timedelta(days=3)).isoformat()

        return None
