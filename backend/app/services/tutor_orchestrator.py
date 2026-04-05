"""Tutor Orchestrator — Agent QueryLoop architecture.

State machine: INIT → PLANNING → [EXECUTING_TOOLS → SYNTHESIZING]* → STREAMING → COMPLETED

Wave 1 enhancements (inspired by Claude Code's AsyncGenerator QueryLoop):
- Multi-step plan: complex queries decompose into 1-3 steps
- Iterative execute-synthesize loop: each step executes tools + synthesizes
- Only final step streams the answer to the user
- Context compression integration (Snip + Auto layers)
- Tool registry integration

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
    TutorPlanStep,
    TutorMultiStepPlan,
    TutorToolResult,
)
from app.services.llm_client import get_llm_client, LLMError
from app.services.prompt_builder import (
    TutorPromptBuilder,
    TutorMode,
    StudentContext,
    SessionContext,
)
from app.services.context_compressor import ContextCompressor
from app.services.student_model import StudentModelService
from app.services.diagnosis_flow import DiagnosisFlow, DiagnosisStage
from app.services.session_memory import SessionMemoryExtractor, memory_to_dict
from app.services.hook_system import get_hook_registry
from app.services.tool_permissions import ToolPermissions, PermissionState
from app.services.tutor_tools import run_tool

logger = logging.getLogger(__name__)

# ── Model Config ─────────────────────────────────────────────────

PLAN_MODEL = "z-ai/glm-4.7-flash"  # Free, fast — good for planning
CHAT_MODEL = "glm-4.7"  # Quality dialogue
FALLBACK_CHAT_MODEL = "glm-4-flash"  # Free fallback

MAX_TOOL_CALLS_PER_STEP = 2
MAX_LOOP_ITERATIONS = 3  # Safety cap for multi-step plans
MAX_CONTEXT_CHARS = 12000  # Increased for multi-step results

# Prompt builder singleton
_prompt_builder = TutorPromptBuilder()

# Context compressor singleton
_compressor = ContextCompressor(max_context_tokens=24000)

# Diagnosis flow singleton (stateless logic)
_diagnosis = DiagnosisFlow()

# Session memory extractor singleton
_memory_extractor = SessionMemoryExtractor()

# Hook registry singleton (Wave 3)
_hook_registry = get_hook_registry()

# Tool permissions singleton (Wave 3)
_permissions = ToolPermissions()


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

MULTI_STEP_PLAN_SYSTEM = """你是一个学习助教的意图分析器。分析用户的复合请求，拆解为 1-3 个执行步骤。

可用工具：
{available_tools_desc}

**规则**：
- 简单请求（讲解一个概念、出题、问候）→ 单步计划
- 复合请求（讲A再讲B、讲完出题、对比两个概念）→ 多步计划
- 每步最多 2 个工具
- 总共最多 3 步
- 每步需要 module_hint 指明目标模块

示例：
输入："讲讲视图然后出题"
输出：2步 — Step1: explain["get_specialist"] hint="视图" / Step2: quiz["get_quiz"] hint="视图"

输入："讲讲 JOIN"
输出：1步 — Step1: explain["get_specialist"] hint="JOIN"

输入："对比视图和子查询"
输出：2步 — Step1: explain["get_specialist"] hint="视图" / Step2: explain["get_specialist"] hint="子查询"（最终回答合成对比）

输入："你好"
输出：1步 — Step1: answer_direct[] hint=null"""

SYNTHESIS_SYSTEM = """请简要总结以下工具查询的结果要点（200字以内），用于后续步骤的上下文参考。
只保留关键概念、定义和重要细节。"""

# Tool call human-readable descriptions for UI
TOOL_CALL_DESCRIPTIONS = {
    "get_specialist": "正在查阅课程精讲笔记...",
    "get_quiz": "正在准备测验题目...",
}

TOOL_DESCRIPTIONS = {
    "get_specialist": "get_specialist: 获取模块精讲笔记（含概念解释、考点、易错点）",
    "get_quiz": "get_quiz: 获取测验题目（选择题，只读展示，不做判分）",
}

NO_TOOLS_NOTICE = "当前材料尚未完成分析，无法使用学习工具。你只能进行简单对话，建议用户先在工具面板运行材料分析。"


# ── Orchestrator ─────────────────────────────────────────────────

class TutorOrchestrator:
    """Agent QueryLoop orchestrator: plan → [execute → synthesize]* → stream."""

    def __init__(self, db: AsyncSession, user_id: uuid.UUID):
        self._db = db
        self._user_id = user_id
        self._llm = get_llm_client()
        self._student_model = StudentModelService(db)

    async def stream_chat(
        self, request: TutorChatRequest,
    ) -> AsyncGenerator[dict, None]:
        """Full orchestration loop yielding SSE event dicts.

        Supports multi-step plans: each step executes tools and synthesizes,
        only the final step streams the answer.
        """
        session_id = uuid.uuid4().hex[:16]

        try:
            # ── Phase 0: Build Context + Student Profile ────────
            available_tools = await self._build_context(request.material_id)

            # Load student context (Wave 2)
            student_ctx = await self._student_model.build_student_context(
                self._user_id, request.material_id,
            )

            # Check if diagnosis is needed (Wave 2)
            profile = await self._student_model.get_or_create_profile(
                self._user_id, request.material_id,
            )
            diagnosis_prompt = ""
            if _diagnosis.is_diagnosis_needed(
                {"self_report": profile.self_report, "preferred_mode": profile.preferred_mode},
            ):
                diag_state = _diagnosis.get_initial_state()
                diagnosis_prompt = _diagnosis.get_diagnosis_prompt(diag_state)

                # Try to extract diagnosis data from user message
                new_state, extracted = _diagnosis.try_extract(
                    request.user_message, diag_state,
                )
                if extracted:
                    # Persist extracted self-report data
                    sr_updates = {}
                    if "learning_mode" in extracted:
                        profile.preferred_mode = extracted["learning_mode"]
                        sr_updates["learning_mode"] = extracted["learning_mode"]
                    if "covered_chapters" in extracted:
                        sr_updates["covered_chapters"] = extracted["covered_chapters"]
                    if "weak_areas" in extracted:
                        sr_updates["weak_areas"] = extracted["weak_areas"]
                    if "exam_date" in extracted:
                        sr_updates["exam_date"] = extracted["exam_date"]
                    if sr_updates:
                        await self._student_model.update_self_report(
                            self._user_id, request.material_id, sr_updates,
                        )
                        # Rebuild student context with new data
                        student_ctx = await self._student_model.build_student_context(
                            self._user_id, request.material_id,
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

            # ── Phase 0.5: Context Compression ──────────────────
            compressed_history = [
                {"role": m.role, "content": m.content}
                for m in request.conversation_history
            ]
            compression = await _compressor.maybe_compress(compressed_history)
            if compression.trigger != "none":
                compressed_history = compression.messages
                yield self._sse(
                    "context.compressed",
                    {
                        "summary": compression.summary or "",
                        "tokens_before": compression.tokens_before,
                        "tokens_after": compression.tokens_after,
                        "trigger": compression.trigger,
                    },
                )

            # ── Phase 1: Plan ────────────────────────────────────
            plan = await self._plan(
                user_message=request.user_message,
                conversation_history=request.conversation_history,
                available_tools=available_tools,
            )

            # Convert to multi-step plan
            steps = self._to_steps(plan)

            yield self._sse(
                "plan.completed",
                {
                    "intent": plan.intent,
                    "reasoning": plan.reasoning,
                    "tools_to_call": plan.tools_to_call,
                    "steps": [
                        {
                            "step_id": s.step_id,
                            "intent": s.intent,
                            "tools_to_call": s.tools_to_call,
                            "module_hint": s.module_hint,
                            "description": s.description,
                        }
                        for s in steps
                    ],
                    "is_multi_step": len(steps) > 1,
                },
            )

            # ── Phase 2: QueryLoop — iterate steps ──────────────
            accumulated_context: list[str] = []
            all_tool_results: list[TutorToolResult] = []

            for step_idx, step in enumerate(steps):
                is_last = step_idx == len(steps) - 1

                # Emit loop progress
                if len(steps) > 1:
                    yield self._sse(
                        "loop.step_start",
                        {
                            "step": step.step_id,
                            "total_steps": len(steps),
                            "description": step.description,
                        },
                    )

                # Execute tools for this step
                step_results: list[TutorToolResult] = []
                for tool_name in step.tools_to_call[:MAX_TOOL_CALLS_PER_STEP]:
                    description = TOOL_CALL_DESCRIPTIONS.get(
                        tool_name, f"正在执行 {tool_name}..."
                    )
                    yield self._sse(
                        "tool_call.start",
                        {"tool_name": tool_name, "description": description},
                    )

                    # Check permission (Wave 3)
                    perm = _permissions.check(tool_name)
                    if perm == PermissionState.DENY:
                        logger.warning("Tool '%s' denied by permissions", tool_name)
                        continue

                    import time as _time
                    _tool_start = _time.time()

                    result = await run_tool(
                        tool_name=tool_name,
                        db=self._db,
                        material_id=request.material_id,
                        user_id=self._user_id,
                        module_id=request.module_id,
                        module_hint=step.module_hint or plan.module_hint,
                    )

                    # Run post-tool hooks (Wave 3)
                    try:
                        hook_ctx = {
                            "start_time": _tool_start,
                            "session_id": session_id,
                            "user_id": str(self._user_id),
                        }
                        result_dict = {
                            "ok": result.ok,
                            "data": result.data,
                            "error": result.error.model_dump() if result.error else None,
                        }
                        await _hook_registry.run_post_tool_hooks(
                            tool_name, result_dict, hook_ctx,
                        )
                        # Hooks may have mutated result_dict["data"] (e.g. AI tagging)
                        if result_dict.get("data"):
                            result.data = result_dict["data"]
                    except Exception as hook_exc:
                        logger.warning("Hook execution error: %s", hook_exc)

                    step_results.append(result)
                    all_tool_results.append(result)

                    yield self._sse(
                        "tool.result",
                        {
                            "tool_name": result.tool_name,
                            "ok": result.ok,
                            "data": result.data,
                            "error": (
                                result.error.model_dump() if result.error else None
                            ),
                        },
                    )

                # Synthesize intermediate results (non-last steps)
                if not is_last and step_results:
                    synthesis = await self._synthesize_step(
                        step, step_results
                    )
                    if synthesis:
                        accumulated_context.append(synthesis)

                # Emit loop step complete
                if len(steps) > 1:
                    yield self._sse(
                        "loop.step_complete",
                        {"step": step.step_id, "total_steps": len(steps)},
                    )

            # ── Phase 3: Stream Final Answer ─────────────────────
            total_tokens = 0
            async for token in self._stream_answer(
                user_message=request.user_message,
                conversation_history=compressed_history,
                plan=plan,
                tool_results=all_tool_results,
                accumulated_context=accumulated_context,
                student_ctx=student_ctx,
                diagnosis_prompt=diagnosis_prompt,
            ):
                total_tokens += 1
                yield self._sse("answer.delta", {"content": token})

            yield self._sse(
                "answer.completed", {"total_tokens": total_tokens},
            )

            # ── Phase 4: Session Memory Extraction (Wave 2) ────
            try:
                all_msgs = compressed_history + [
                    {"role": "user", "content": request.user_message},
                ]
                if _memory_extractor.should_extract(
                    all_msgs,
                    last_extraction_tokens=0,
                ):
                    memory = await _memory_extractor.extract(
                        all_msgs,
                        session_id=session_id,
                        material_id=str(request.material_id),
                    )
                    if memory.covered_kps or memory.mastery_updates:
                        await self._student_model.merge_session_memory(
                            self._user_id,
                            request.material_id,
                            memory_to_dict(memory),
                        )
                        logger.info(
                            "Session memory extracted: %d KPs, %d mastery updates",
                            len(memory.covered_kps),
                            len(memory.mastery_updates),
                        )
            except Exception as mem_exc:
                logger.warning("Session memory extraction failed: %s", mem_exc)

            yield self._sse(
                "session.completed", {"session_id": session_id},
            )

        except LLMError as e:
            error_str = str(e)
            logger.exception("Tutor LLM error: %s", e)

            if "rate limit" in error_str.lower() or "Rate limit" in error_str:
                yield self._sse(
                    "degraded",
                    {
                        "message": "AI 服务请求频率受限，请稍后重试",
                        "reason": "rate_limit",
                    },
                )
            elif "overload" in error_str.lower() or "529" in error_str:
                yield self._sse(
                    "degraded",
                    {
                        "message": "AI 服务繁忙，已尝试切换备用模型",
                        "reason": "model_overload",
                        "fallback_model": FALLBACK_CHAT_MODEL,
                    },
                )

            yield self._sse(
                "error",
                {"message": f"AI 服务暂时不可用: {error_str[:200]}", "phase": "llm"},
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
        """Determine which tools are available for this material."""
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
            return []
        return ["get_specialist", "get_quiz"]

    async def _plan(
        self,
        user_message: str,
        conversation_history: list,
        available_tools: list[str],
    ) -> TutorPlanOutput:
        """Phase 1: Decide intent and tools via structured_output."""
        if not available_tools:
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

        recent_history = (
            conversation_history[-4:]
            if len(conversation_history) > 4
            else conversation_history
        )
        messages = [
            {"role": m.role, "content": m.content[:300]}
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
                prompt_version="tutor_plan_v3",
                max_tokens=256,
                max_retries=2,
            )
            plan: TutorPlanOutput = result.data
        except (LLMError, TypeError, Exception) as e:
            logger.warning("Plan LLM failed (%s), using keyword fallback", e)
            plan = self._keyword_fallback_plan(user_message, available_tools)

        # Sanitize: only allow tools that are actually available
        plan.tools_to_call = [
            t for t in plan.tools_to_call if t in available_tools
        ]

        # Safety net
        if plan.intent == "explain" and "get_specialist" not in plan.tools_to_call:
            if "get_specialist" in available_tools:
                plan.tools_to_call.insert(0, "get_specialist")
        elif plan.intent == "quiz" and "get_quiz" not in plan.tools_to_call:
            if "get_quiz" in available_tools:
                plan.tools_to_call.insert(0, "get_quiz")

        logger.info(
            "Tutor plan: intent=%s, tools=%s, hint=%s",
            plan.intent, plan.tools_to_call, plan.module_hint,
        )
        return plan

    @staticmethod
    def _to_steps(plan: TutorPlanOutput) -> list[TutorPlanStep]:
        """Convert a flat plan into execution steps.

        Most plans are single-step. Multi-tool plans with mixed intents
        (explain + quiz) split into 2 steps for cleaner execution.
        """
        has_specialist = "get_specialist" in plan.tools_to_call
        has_quiz = "get_quiz" in plan.tools_to_call

        # Mixed intent: explain + quiz → 2 steps
        if has_specialist and has_quiz:
            return [
                TutorPlanStep(
                    step_id=1,
                    intent="explain",
                    tools_to_call=["get_specialist"],
                    module_hint=plan.module_hint,
                    description=f"讲解{plan.module_hint or '相关概念'}",
                ),
                TutorPlanStep(
                    step_id=2,
                    intent="quiz",
                    tools_to_call=["get_quiz"],
                    module_hint=plan.module_hint,
                    description="生成测验题",
                ),
            ]

        # Single-step plan
        return [
            TutorPlanStep(
                step_id=1,
                intent=plan.intent,
                tools_to_call=plan.tools_to_call,
                module_hint=plan.module_hint,
                description=_intent_description(plan.intent, plan.module_hint),
            ),
        ]

    async def _synthesize_step(
        self,
        step: TutorPlanStep,
        results: list[TutorToolResult],
    ) -> str | None:
        """Synthesize tool results into compact context for next step."""
        context_parts = []
        for tr in results:
            if tr.ok:
                data_str = json.dumps(tr.data, ensure_ascii=False)
                # Cap individual result for synthesis
                if len(data_str) > 4000:
                    data_str = data_str[:4000] + "..."
                context_parts.append(f"[{tr.tool_name}]: {data_str}")

        if not context_parts:
            return None

        context_text = "\n".join(context_parts)

        try:
            synthesis = await self._llm.non_streaming_chat(
                model=PLAN_MODEL,
                system=SYNTHESIS_SYSTEM,
                messages=[{"role": "user", "content": context_text}],
                max_tokens=512,
                max_retries=1,
            )
            logger.info(
                "Step %d synthesis: %d chars → %d chars",
                step.step_id, len(context_text), len(synthesis),
            )
            return f"[步骤{step.step_id}摘要: {step.description}]\n{synthesis}"
        except LLMError:
            # Fallback: use first 500 chars of raw result
            logger.warning("Synthesis LLM failed, using truncated raw context")
            return context_text[:500]

    @staticmethod
    def _keyword_fallback_plan(
        user_message: str, available_tools: list[str],
    ) -> TutorPlanOutput:
        """Simple keyword-based fallback when plan LLM fails."""
        msg = user_message.lower()
        quiz_keywords = [
            "出题", "做题", "测验", "quiz", "考考", "测试",
            "学的怎么样", "道题", "几题", "出几道",
        ]
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

        # Check for compound: both explain + quiz
        has_quiz = any(k in msg for k in quiz_keywords)
        has_explain = any(k in msg for k in explain_keywords)

        if has_quiz and has_explain:
            tools = []
            if "get_specialist" in available_tools:
                tools.append("get_specialist")
            if "get_quiz" in available_tools:
                tools.append("get_quiz")
            return TutorPlanOutput(
                intent="explain",
                reasoning="关键词匹配：复合请求讲解+出题（LLM plan fallback）",
                tools_to_call=tools,
            )

        if has_quiz:
            tools = ["get_quiz"] if "get_quiz" in available_tools else []
            return TutorPlanOutput(
                intent="quiz",
                reasoning="关键词匹配：出题/测验（LLM plan fallback）",
                tools_to_call=tools,
            )

        if has_explain or available_tools:
            tools = (
                ["get_specialist"]
                if "get_specialist" in available_tools
                else []
            )
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
        conversation_history: list[dict],
        plan: TutorPlanOutput,
        tool_results: list[TutorToolResult],
        accumulated_context: list[str] | None = None,
        student_ctx: StudentContext | None = None,
        diagnosis_prompt: str = "",
    ) -> AsyncGenerator[str, None]:
        """Phase 3: Stream final answer using layered prompt builder."""
        # Build tool context
        tool_context_parts = []

        # Include diagnosis prompt if needed (Wave 2)
        if diagnosis_prompt:
            tool_context_parts.append(diagnosis_prompt)

        # Include accumulated context from previous steps
        if accumulated_context:
            tool_context_parts.extend(accumulated_context)

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

        # Determine tutor mode from plan intent
        mode = TutorMode.LEARN_DEEP
        if plan.intent == "quiz":
            mode = TutorMode.EXAM_PREP
        elif plan.intent == "answer_direct":
            mode = TutorMode.QUICK_QA

        # Build layered prompt (Wave 2: inject student context)
        prompt = _prompt_builder.build(
            mode=mode,
            tool_context=tool_context,
            student_ctx=student_ctx,
        )

        logger.info(
            "Prompt built: mode=%s, static_tokens≈%d, dynamic_tokens≈%d",
            mode.value,
            prompt.static_token_estimate,
            prompt.dynamic_token_estimate,
        )

        # conversation_history is already a list of dicts (may be compressed)
        messages = conversation_history + [
            {"role": "user", "content": user_message},
        ]

        async for token in self._llm.stream_text(
            model=CHAT_MODEL,
            system=prompt.full,
            messages=messages,
            max_tokens=2048,
            max_retries=2,
            fallback_model=FALLBACK_CHAT_MODEL,
        ):
            yield token

    @staticmethod
    def _sse(event: str, data: dict) -> dict:
        """Format SSE event dict for EventSourceResponse."""
        return {
            "event": event,
            "data": json.dumps(data, ensure_ascii=False),
        }


def _intent_description(intent: str, module_hint: str | None) -> str:
    """Generate human-readable step description."""
    hint = module_hint or "相关内容"
    if intent == "explain":
        return f"讲解{hint}"
    if intent == "quiz":
        return f"生成{hint}测验题"
    return "直接回答"
