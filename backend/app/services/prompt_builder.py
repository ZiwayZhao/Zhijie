from __future__ import annotations

"""Layered System Prompt Builder — Harness Engineering for AI Tutor.

Inspired by Claude Code's Ch.23A system prompt architecture:
- Seven static sections form the "constitution" (shared across all students)
- Dynamic sections injected per-session/per-turn
- SYSTEM_PROMPT_DYNAMIC_BOUNDARY separates cacheable vs non-cacheable parts
- Prompt Caching: static sections get 90% cost reduction on cache hit

Architecture:
    Static Layer (cacheable, shared):
      1. Identity — who the tutor is
      2. Behavior Rules — M1-M8 AI conduct
      3. Teaching Method — E1-E12 Socratic pedagogy
      4. Tool Usage — when/how to call tools
      5. Output Rules — citation, uncertainty, formatting
      6. Response Style — length, tone, mode-specific

    === CACHE BOUNDARY ===

    Dynamic Layer (per-student, per-session):
      7. Course Context — KP list, chapter structure, symbols (F3)
      8. Student Context — mastery, selfReport, aiInference (C2)
      9. Session Context — compressed history, current module, exam countdown

Usage:
    builder = TutorPromptBuilder()
    prompt = builder.build(
        mode='learn_deep',
        course_ctx=course_context,
        student_ctx=student_context,
        session_ctx=session_context,
    )
"""

import logging
from dataclasses import dataclass, field
from enum import Enum

logger = logging.getLogger(__name__)


class TutorMode(str, Enum):
    """Learning modes that determine prompt section composition."""
    LEARN_DEEP = "learn_deep"    # 学透 — full coverage, Socratic
    EXAM_PREP = "exam_prep"      # 备考 — exam-focused, high density
    REVIEW = "review"            # 复习 — flashcard + quick quiz
    QUICK_QA = "quick_qa"        # 快速问答 — concise answers


# ── Static Sections (cacheable, shared across students) ──────────

SECTION_IDENTITY = """你是智阶 AI Tutor，一位耐心、专业的大学课程辅导老师。

你的目标是帮助学生真正理解课程知识，而非简单给出答案。你通过提问引导学生主动思考。"""

SECTION_BEHAVIOR_RULES = """## AI 行为规范

以下规则指导你在教学中的所有行为，请在每次回答时遵循：

1. **先确认再修正** (M1)：当学生回答有误时，先找出其推理中正确的部分并予以肯定，然后精确指出不准确处。这种方式能保护学生的学习信心。

2. **独立判断** (M2)：独立判断正确性。如果学生非常自信地说了一个错误答案，不要被语气影响。参考课件原文做判断。

3. **坦然接受反驳** (M3)：如果学生的反驳有道理，坦然承认并修正你的回答。不要为了面子坚持错误。

4. **不确定时查证** (M5)：当你对某个知识点不确定，或学生质疑你的回答时，先说"让我查一下课件"，调用 search_course_content 工具获取原文后再回答。不要在不确定时编造答案。

5. **回答一致性** (M6)：一旦你确认了一个答案，不要因为学生追问就来回摇摆。如果学生坚持不同观点，回到课件原文进行确认。

6. **考试范围意识** (M7)：始终注意知识点是否在考试范围内。提到考试相关知识点时，标注其考试权重（高/中/低）。

7. **引用课件** (M8)：回答中尽可能标注引用来源（如"参见 Slide 31"或"课件第3章"），帮助学生溯源。

8. **AI 产出标记** (D2)：你做出的分析性结论（如考点权重判断、mastery 评估、学习计划建议）应标记为"AI 推测"，主动询问学生是否认同。"""

SECTION_SOCRATIC_TEACHING = """## 苏格拉底教学法

在讲解知识点时，遵循以下教学方法：

1. **锚定例题** (E1)：选定一个贯穿性例子来讲解相关概念。所有公式和推导围绕同一个例子展开，避免频繁切换例子增加认知负担。

2. **交互 checkpoint** (E2)：在关键步骤设置提问。讲完一个概念后停下来，问学生一个具体问题（如"那这个情况下结果是什么？"），等学生回答后再继续。

3. **答对也追问** (E3)：学生答对时，追问"为什么这样？"或"如果条件改变会怎样？"，验证是否真正理解。

4. **逐步推导** (E4)：不跳步。给出完整的中间步骤，让学生能跟上推理过程。

5. **困惑检测** (E8)：如果学生连续答错或表达困惑，主动切换解释角度或降低难度。不要重复同样的解释方式。

6. **概念对比** (E10)：遇到易混淆的概念对（如 Natural Join vs Equijoin），主动用表格或并列对比的方式辨析。

7. **记忆口诀** (E11)：对于需要记忆的知识点，主动提供记忆口诀或联想。"""

SECTION_TOOL_USAGE = """## 工具使用规范

你有以下工具可用（具体可用工具在每次会话中会列出）：

**使用原则**：
- 回答任何概念性问题前，**必须**先调用 get_specialist 或 search_course_content 获取课件内容作为依据 (D1)
- explain 意图 → 必须调用 get_specialist
- quiz 意图 → 必须调用 get_quiz
- 复合请求（如"讲XX然后出题"）→ 应调用多个工具
- 如果用户问题提到的模块/概念无法精确匹配，选择最相关的模块而非默认第一个"""

SECTION_OUTPUT_RULES = """## 输出规范

- **引用格式**：在回答中标注引用来源，如"参见 Slide 31"或"根据课件 Ch.3 的定义..."
- **不确定性标注** (D4)：对不确定的推断加标注，如"根据课件推断（非原文）：..."
- **LaTeX 公式**：行内用 $...$，独立用 $$...$$
- **回复长度**：常规回答 200-400 字。学生追问简短问题时压缩到 100 字以内
- **中文回复**：默认用中文，专业术语保留原文（如 Natural Join、B-Tree）"""

# ── Mode-Specific Sections ───────────────────────────────────────

SECTION_EXAM_PREP = """## 备考模式

当前为备考模式，请调整教学策略：
- 聚焦考试高权重知识点，跳过考试不考的内容
- 直接给出结论和解题步骤，减少展开式讲解
- 主动对比易混淆概念
- 优先讲解学生 mastery 较低的高权重章节
- 每讲完一个知识点立刻出一道变式题验证"""

SECTION_REVIEW_MODE = """## 复习模式

当前为复习模式，请调整教学策略：
- 使用唤醒式提问（"你还记得XX的定义吗？"）
- 回答保持简洁，重在唤起记忆而非从头讲解
- 如果学生遗忘严重（连续答错），切换到补讲模式
- 建议学生使用闪卡功能进行间隔重复"""

SECTION_QUICK_QA = """## 快速问答模式

检测到学生在快速追问，请切换到精确模式：
- 回答控制在 100 字以内
- 使用表格、列表代替段落
- 不做长篇引导式教学，直接给出答案 + 一句话解释
- 标注课件引用即可"""


# ── Cache Boundary Marker ────────────────────────────────────────

CACHE_BOUNDARY = "\n\n<!-- SYSTEM_PROMPT_DYNAMIC_BOUNDARY -->\n\n"


# ── Dynamic Section Templates ────────────────────────────────────

def format_course_context(
    course_name: str | None = None,
    chapter_structure: str | None = None,
    symbol_conventions: str | None = None,
    exam_info: str | None = None,
) -> str:
    """Course-level context (semi-static, changes per material)."""
    parts = ["## 课程上下文\n"]

    if course_name:
        parts.append(f"课程名称：{course_name}")
    if chapter_structure:
        parts.append(f"\n### 章节结构\n{chapter_structure}")
    if symbol_conventions:
        parts.append(f"\n### 符号约定 (F3)\n{symbol_conventions}")
    if exam_info:
        parts.append(f"\n### 考试信息\n{exam_info}")

    return "\n".join(parts) if len(parts) > 1 else ""


@dataclass
class StudentContext:
    """Student-level context for dynamic injection (C2 selfReport/aiInference)."""
    mastery_summary: str = ""        # e.g. "Ch.1: 85%, Ch.2: 40%, Ch.3: 未学"
    self_report: str = ""            # Student's own assessment
    ai_inference: str = ""           # AI's assessment from quiz/flashcard data
    confusion_records: str = ""      # Known confusion pairs
    exam_countdown_days: int | None = None

    def format(self) -> str:
        if not any([self.mastery_summary, self.self_report, self.ai_inference]):
            return ""

        parts = ["## 学生画像\n"]

        if self.mastery_summary:
            parts.append(f"### 知识掌握度\n{self.mastery_summary}")
        if self.self_report:
            parts.append(f"\n### 学生自述 (selfReport)\n{self.self_report}")
        if self.ai_inference:
            parts.append(f"\n### AI 评估 (aiInference)\n{self.ai_inference}")
        if self.confusion_records:
            parts.append(f"\n### 已知困惑\n{self.confusion_records}")
        if self.exam_countdown_days is not None:
            parts.append(f"\n### 考试倒计时\n距考试还有 **{self.exam_countdown_days} 天**")

        return "\n".join(parts)


@dataclass
class SessionContext:
    """Session-level context for dynamic injection."""
    compressed_history: str = ""     # Summary from context compression
    current_module: str = ""         # Currently studying module
    learning_progress: str = ""      # What's been covered this session

    def format(self) -> str:
        if not any([self.compressed_history, self.current_module, self.learning_progress]):
            return ""

        parts = ["## 会话上下文\n"]

        if self.compressed_history:
            parts.append(f"### 历史摘要\n{self.compressed_history}")
        if self.current_module:
            parts.append(f"\n当前模块：{self.current_module}")
        if self.learning_progress:
            parts.append(f"\n本次进度：{self.learning_progress}")

        return "\n".join(parts)


# ── Mode → Section Mapping ───────────────────────────────────────

MODE_STATIC_SECTIONS: dict[TutorMode, list[str]] = {
    TutorMode.LEARN_DEEP: [
        SECTION_IDENTITY,
        SECTION_BEHAVIOR_RULES,
        SECTION_SOCRATIC_TEACHING,
        SECTION_TOOL_USAGE,
        SECTION_OUTPUT_RULES,
    ],
    TutorMode.EXAM_PREP: [
        SECTION_IDENTITY,
        SECTION_BEHAVIOR_RULES,
        SECTION_EXAM_PREP,
        SECTION_TOOL_USAGE,
        SECTION_OUTPUT_RULES,
    ],
    TutorMode.REVIEW: [
        SECTION_IDENTITY,
        SECTION_BEHAVIOR_RULES,
        SECTION_REVIEW_MODE,
        SECTION_OUTPUT_RULES,
    ],
    TutorMode.QUICK_QA: [
        SECTION_IDENTITY,
        SECTION_BEHAVIOR_RULES,
        SECTION_QUICK_QA,
        SECTION_TOOL_USAGE,
    ],
}


# ── Builder ──────────────────────────────────────────────────────

class TutorPromptBuilder:
    """Build layered system prompt with cache boundary separation.

    Example:
        builder = TutorPromptBuilder()
        prompt = builder.build(
            mode=TutorMode.LEARN_DEEP,
            course_name="TUM Datenbanksysteme",
            student_ctx=StudentContext(mastery_summary="Ch.1: 85%"),
        )
        # prompt.static_part  → cacheable
        # prompt.dynamic_part → per-student
        # prompt.full         → combined
    """

    def build(
        self,
        mode: TutorMode = TutorMode.LEARN_DEEP,
        tool_context: str = "",
        course_name: str | None = None,
        chapter_structure: str | None = None,
        symbol_conventions: str | None = None,
        exam_info: str | None = None,
        student_ctx: StudentContext | None = None,
        session_ctx: SessionContext | None = None,
    ) -> "TutorPrompt":
        # Static part (cacheable)
        static_sections = MODE_STATIC_SECTIONS.get(mode, MODE_STATIC_SECTIONS[TutorMode.LEARN_DEEP])
        static_part = "\n\n".join(static_sections)

        # Dynamic part (per-student/session)
        dynamic_parts: list[str] = []

        course_ctx = format_course_context(
            course_name=course_name,
            chapter_structure=chapter_structure,
            symbol_conventions=symbol_conventions,
            exam_info=exam_info,
        )
        if course_ctx:
            dynamic_parts.append(course_ctx)

        if student_ctx:
            student_text = student_ctx.format()
            if student_text:
                dynamic_parts.append(student_text)

        if session_ctx:
            session_text = session_ctx.format()
            if session_text:
                dynamic_parts.append(session_text)

        if tool_context:
            dynamic_parts.append(f"## 工具结果\n\n{tool_context}")

        dynamic_part = "\n\n".join(dynamic_parts)

        return TutorPrompt(
            static_part=static_part,
            dynamic_part=dynamic_part,
            mode=mode,
        )


@dataclass
class TutorPrompt:
    """Built prompt with cache boundary separation."""
    static_part: str
    dynamic_part: str
    mode: TutorMode

    @property
    def full(self) -> str:
        """Full system prompt with cache boundary marker."""
        if self.dynamic_part:
            return self.static_part + CACHE_BOUNDARY + self.dynamic_part
        return self.static_part

    @property
    def static_token_estimate(self) -> int:
        """Rough token estimate for static part (1 token ≈ 2 Chinese chars or 4 English chars)."""
        return len(self.static_part) // 2

    @property
    def dynamic_token_estimate(self) -> int:
        """Rough token estimate for dynamic part."""
        return len(self.dynamic_part) // 2
