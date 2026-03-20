"""Tutor Orchestrator — two-phase plan→execute→stream architecture.

State machine: INIT → PLANNING → EXECUTING_TOOLS → STREAMING → COMPLETED

Usage:
    orchestrator = TutorOrchestrator(db, user_id)
    async for event in orchestrator.stream_chat(request):
        yield event  # SSE event dict
"""

import json
import logging
import uuid
from typing import AsyncGenerator

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.disassembly import DisassemblyTask
from app.schemas.tutor import (
    TutorChatRequest,
    TutorPlanOutput,
    TutorToolResult,
)
from app.services.llm_client import get_llm_client, LLMError
from app.services.tutor_tools import run_tool

logger = logging.getLogger(__name__)

# ── Model Config ─────────────────────────────────────────────────

PLAN_MODEL = "z-ai/glm-4.7-flash"  # Free, fast — good for planning
CHAT_MODEL = "z-ai/glm-5-turbo-20260315"  # Quality dialogue

MAX_TOOL_CALLS_PER_TURN = 2
MAX_CONTEXT_CHARS = 8000


# ── System Prompts ───────────────────────────────────────────────

PLAN_SYSTEM = """你是一个学习助教的意图分析器。根据用户消息和上下文，判断用户意图并决定需要调用的工具。

可用工具：
{available_tools_desc}

意图类型：
- explain: 用户想了解/学习某个概念 → **必须**调 get_specialist
- quiz: 用户想做题/测验 → **必须**调 get_quiz
- answer_direct: 简单问候/闲聊/感谢/无关学习内容的问题 → 不调工具

**关键规则**：
- intent=explain 时，tools_to_call **必须**包含 get_specialist
- intent=quiz 时，tools_to_call **必须**包含 get_quiz
- 只有 intent=answer_direct 时 tools_to_call 才可以为空
- 单轮最多调用 2 个工具
- 如果用户同时要求讲解和出题，同时调 get_specialist 和 get_quiz
- 如果用户问题提到某个模块/概念/关键词，提取为 module_hint
- 结合 conversation_history 推断用户意图和相关模块

示例：
- "讲讲 JOIN" → explain, tools=["get_specialist"], module_hint="JOIN"
- "出几道题" → quiz, tools=["get_quiz"], module_hint=null
- "NULL 是什么意思" → explain, tools=["get_specialist"], module_hint="NULL"
- "先讲讲视图再出题" → explain, tools=["get_specialist","get_quiz"], module_hint="视图"
- "你好/谢谢" → answer_direct, tools=[]
- "我学的怎么样" → quiz, tools=["get_quiz"], module_hint=null"""

ANSWER_SYSTEM = """你是智阶学习助教，一位耐心、专业的大学课程辅导老师。

核心原则：
- 基于提供的材料内容回答，不编造信息
- 如果材料中没有相关内容，诚实说明
- 用苏格拉底式提问引导思考，而非直接给答案
- 回复控制在 300 字以内
- 使用中文回复
- 可以用 LaTeX 公式（$行内$ 或 $$独立$$）

{tool_context}"""

TOOL_DESCRIPTIONS = {
    "get_specialist": "get_specialist: 获取模块精讲笔记（含概念解释、考点、易错点）",
    "get_quiz": "get_quiz: 获取测验题目（选择题，只读展示，不做判分）",
}

NO_TOOLS_NOTICE = "当前材料尚未完成分析，无法使用学习工具。你只能进行简单对话，建议用户先在工具面板运行材料分析。"


# ── Orchestrator ─────────────────────────────────────────────────

class TutorOrchestrator:
    """Two-phase orchestrator: plan → execute → stream."""

    def __init__(self, db: AsyncSession, user_id: uuid.UUID):
        self._db = db
        self._user_id = user_id
        self._llm = get_llm_client()

    async def stream_chat(
        self, request: TutorChatRequest,
    ) -> AsyncGenerator[dict, None]:
        """Full orchestration loop yielding SSE event dicts.

        Each event: {"event": str, "data": str(json)}
        """
        session_id = uuid.uuid4().hex[:16]

        try:
            # ── Phase 0: Build Context ───────────────────────────
            available_tools = await self._build_context(
                request.material_id,
            )

            yield self._sse(
                "session.started",
                {
                    "session_id": session_id,
                    "material_id": str(request.material_id),
                    "module_id": str(request.module_id) if request.module_id else None,
                    "available_tools": available_tools,
                },
            )

            # ── Phase 1: Plan ────────────────────────────────────
            plan = await self._plan(
                user_message=request.user_message,
                conversation_history=request.conversation_history,
                available_tools=available_tools,
            )

            yield self._sse(
                "plan.completed",
                {
                    "intent": plan.intent,
                    "reasoning": plan.reasoning,
                    "tools_to_call": plan.tools_to_call,
                },
            )

            # ── Phase 2: Execute Tools ───────────────────────────
            tool_results: list[TutorToolResult] = []

            for tool_name in plan.tools_to_call[:MAX_TOOL_CALLS_PER_TURN]:
                result = await run_tool(
                    tool_name=tool_name,
                    db=self._db,
                    material_id=request.material_id,
                    user_id=self._user_id,
                    module_id=request.module_id,
                    module_hint=plan.module_hint,
                )
                tool_results.append(result)

                yield self._sse(
                    "tool.result",
                    {
                        "tool_name": result.tool_name,
                        "ok": result.ok,
                        "data": result.data,
                        "error": result.error.model_dump() if result.error else None,
                    },
                )

            # ── Phase 3: Stream Answer ───────────────────────────
            total_tokens = 0
            async for token in self._stream_answer(
                user_message=request.user_message,
                conversation_history=request.conversation_history,
                plan=plan,
                tool_results=tool_results,
            ):
                total_tokens += 1
                yield self._sse("answer.delta", {"content": token})

            yield self._sse(
                "answer.completed", {"total_tokens": total_tokens},
            )

            yield self._sse(
                "session.completed", {"session_id": session_id},
            )

        except LLMError as e:
            logger.exception("Tutor LLM error: %s", e)
            yield self._sse(
                "error",
                {"message": f"AI 服务暂时不可用: {str(e)[:200]}", "phase": "llm"},
            )
        except Exception as e:
            logger.exception("Tutor orchestrator error: %s", e)
            yield self._sse(
                "error",
                {"message": f"服务内部错误: {str(e)[:200]}", "phase": "unknown"},
            )

    # ── Internal Methods ─────────────────────────────────────────

    async def _build_context(
        self, material_id: uuid.UUID,
    ) -> list[str]:
        """Determine which tools are available for this material.

        If no completed analysis exists, return empty list (NO_ANALYSIS).
        """
        task = (
            await self._db.execute(
                select(DisassemblyTask)
                .where(
                    DisassemblyTask.material_id == material_id,
                    DisassemblyTask.user_id == self._user_id,
                    DisassemblyTask.status == "completed",
                )
                .order_by(DisassemblyTask.created_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()

        if not task:
            return []  # No tools available

        return ["get_specialist", "get_quiz"]

    async def _plan(
        self,
        user_message: str,
        conversation_history: list,
        available_tools: list[str],
    ) -> TutorPlanOutput:
        """Phase 1: Decide intent and tools via structured_output."""
        if not available_tools:
            # No analysis available — force answer_direct
            return TutorPlanOutput(
                intent="answer_direct",
                reasoning="材料尚未分析，无可用工具，直接回答。",
                tools_to_call=[],
                module_hint=None,
            )

        tools_desc = "\n".join(
            TOOL_DESCRIPTIONS[t] for t in available_tools
            if t in TOOL_DESCRIPTIONS
        )

        system = PLAN_SYSTEM.format(available_tools_desc=tools_desc)

        # Only pass last 4 messages to plan model (lightweight, avoid token overflow)
        recent_history = conversation_history[-4:] if len(conversation_history) > 4 else conversation_history
        messages = [
            {"role": m.role, "content": m.content[:300]}  # Truncate long messages
            for m in recent_history
        ] + [
            {"role": "user", "content": user_message},
        ]

        try:
            result = await self._llm.structured_output(
                model=PLAN_MODEL,
                system=system,
                messages=messages,
                response_schema=TutorPlanOutput,
                prompt_version="tutor_plan_v2",
                max_tokens=256,
                max_retries=2,
            )
            plan: TutorPlanOutput = result.data
        except (LLMError, TypeError, Exception) as e:
            # LLM plan failed — fallback to keyword-based intent detection
            logger.warning("Plan LLM failed (%s), using keyword fallback", e)
            plan = self._keyword_fallback_plan(user_message, available_tools)

        # Sanitize: only allow tools that are actually available
        plan.tools_to_call = [
            t for t in plan.tools_to_call if t in available_tools
        ]

        # Safety net: if intent requires tools but none selected, auto-add
        if plan.intent == "explain" and "get_specialist" not in plan.tools_to_call:
            if "get_specialist" in available_tools:
                logger.warning(
                    "Plan intent=explain but missing get_specialist, auto-adding"
                )
                plan.tools_to_call.insert(0, "get_specialist")
        elif plan.intent == "quiz" and "get_quiz" not in plan.tools_to_call:
            if "get_quiz" in available_tools:
                logger.warning(
                    "Plan intent=quiz but missing get_quiz, auto-adding"
                )
                plan.tools_to_call.insert(0, "get_quiz")

        logger.info(
            "Tutor plan: intent=%s, tools=%s, hint=%s",
            plan.intent, plan.tools_to_call, plan.module_hint,
        )
        return plan

    @staticmethod
    def _keyword_fallback_plan(
        user_message: str, available_tools: list[str],
    ) -> TutorPlanOutput:
        """Simple keyword-based fallback when plan LLM fails."""
        msg = user_message.lower()
        quiz_keywords = ["出题", "做题", "测验", "quiz", "考考", "测试", "学的怎么样"]
        explain_keywords = [
            "讲讲", "解释", "什么是", "怎么", "为什么", "区别",
            "帮帮", "复习", "学习", "讲解", "概念", "原理",
        ]
        greet_keywords = ["你好", "谢谢", "感谢", "再见", "hi", "hello"]

        if any(k in msg for k in greet_keywords) and len(msg) < 10:
            return TutorPlanOutput(
                intent="answer_direct",
                reasoning="关键词匹配：问候/感谢（LLM plan fallback）",
            )

        if any(k in msg for k in quiz_keywords):
            tools = ["get_quiz"] if "get_quiz" in available_tools else []
            return TutorPlanOutput(
                intent="quiz",
                reasoning="关键词匹配：出题/测验（LLM plan fallback）",
                tools_to_call=tools,
            )

        if any(k in msg for k in explain_keywords) or available_tools:
            tools = ["get_specialist"] if "get_specialist" in available_tools else []
            return TutorPlanOutput(
                intent="explain",
                reasoning="关键词匹配/默认：讲解概念（LLM plan fallback）",
                tools_to_call=tools,
            )

        return TutorPlanOutput(
            intent="answer_direct",
            reasoning="无法识别意图（LLM plan fallback）",
        )

    async def _stream_answer(
        self,
        user_message: str,
        conversation_history: list,
        plan: TutorPlanOutput,
        tool_results: list[TutorToolResult],
    ) -> AsyncGenerator[str, None]:
        """Phase 3: Stream final answer with tool results injected."""
        # Build tool context for system prompt
        tool_context_parts = []

        if not tool_results:
            if plan.intent == "answer_direct":
                tool_context_parts.append(
                    "用户的问题不需要查阅材料，请直接回答。"
                )
            else:
                tool_context_parts.append(NO_TOOLS_NOTICE)
        else:
            for tr in tool_results:
                if tr.ok:
                    tool_context_parts.append(
                        f"=== {tr.tool_name} 结果 ===\n"
                        + json.dumps(tr.data, ensure_ascii=False, indent=2)
                    )
                else:
                    err_msg = tr.error.message if tr.error else "未知错误"
                    tool_context_parts.append(
                        f"=== {tr.tool_name} 失败 ===\n{err_msg}"
                    )

        tool_context = "\n\n".join(tool_context_parts)

        # Truncate if too long
        if len(tool_context) > MAX_CONTEXT_CHARS:
            tool_context = (
                tool_context[:MAX_CONTEXT_CHARS]
                + "\n\n…（工具结果过长，已截断）"
            )

        system = ANSWER_SYSTEM.format(tool_context=tool_context)

        messages = [
            {"role": m.role, "content": m.content}
            for m in conversation_history
        ] + [
            {"role": "user", "content": user_message},
        ]

        async for token in self._llm.stream_text(
            model=CHAT_MODEL,
            system=system,
            messages=messages,
            max_tokens=2048,
        ):
            yield token

    @staticmethod
    def _sse(event: str, data: dict) -> dict:
        """Format SSE event dict for EventSourceResponse."""
        return {
            "event": event,
            "data": json.dumps(data, ensure_ascii=False),
        }
