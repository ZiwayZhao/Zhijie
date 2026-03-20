"""Unit tests for TutorOrchestrator — mock LLM + DB, test orchestration flow."""

import json
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.schemas.tutor import (
    ChatMessage,
    TutorChatRequest,
    TutorPlanOutput,
    TutorToolResult,
    TutorToolError,
)
from app.services.tutor_orchestrator import TutorOrchestrator


# ── Fixtures ─────────────────────────────────────────────────────

def _make_request(
    material_id=None,
    module_id=None,
    message="讲讲 B-Tree",
    history=None,
):
    return TutorChatRequest(
        material_id=material_id or uuid.uuid4(),
        module_id=module_id,
        user_message=message,
        conversation_history=history or [],
    )


def _make_llm_result(data, latency_ms=100):
    """Create a mock LLMResult."""
    result = MagicMock()
    result.data = data
    result.latency_ms = latency_ms
    result.input_tokens = 100
    result.output_tokens = 50
    return result


async def _collect_events(orchestrator, request):
    """Collect all SSE events from stream_chat."""
    events = []
    async for event in orchestrator.stream_chat(request):
        events.append(event)
    return events


def _parse_event(event):
    """Parse SSE event dict."""
    return event["event"], json.loads(event["data"])


# ── Tests ────────────────────────────────────────────────────────

class TestBuildContext:
    @pytest.mark.asyncio
    async def test_no_analysis_returns_empty_tools(self):
        db = AsyncMock()
        execute_result = MagicMock()
        execute_result.scalar_one_or_none.return_value = None
        db.execute = AsyncMock(return_value=execute_result)

        orch = TutorOrchestrator(db=db, user_id=uuid.uuid4())
        tools = await orch._build_context(uuid.uuid4())
        assert tools == []

    @pytest.mark.asyncio
    async def test_completed_task_returns_all_tools(self):
        task = MagicMock()
        task.id = uuid.uuid4()
        task.status = "completed"

        db = AsyncMock()
        execute_result = MagicMock()
        execute_result.scalar_one_or_none.return_value = task
        db.execute = AsyncMock(return_value=execute_result)

        orch = TutorOrchestrator(db=db, user_id=uuid.uuid4())
        tools = await orch._build_context(uuid.uuid4())
        assert "get_specialist" in tools
        assert "get_quiz" in tools


class TestPlan:
    @pytest.mark.asyncio
    async def test_no_tools_forces_answer_direct(self):
        db = AsyncMock()
        orch = TutorOrchestrator(db=db, user_id=uuid.uuid4())

        plan = await orch._plan(
            user_message="你好",
            conversation_history=[],
            available_tools=[],
        )
        assert plan.intent == "answer_direct"
        assert plan.tools_to_call == []

    @pytest.mark.asyncio
    async def test_plan_with_tools_calls_llm(self):
        db = AsyncMock()
        orch = TutorOrchestrator(db=db, user_id=uuid.uuid4())

        plan_output = TutorPlanOutput(
            intent="explain",
            reasoning="用户想了解 B-Tree",
            tools_to_call=["get_specialist"],
            module_hint="B-Tree",
        )

        with patch.object(
            orch._llm,
            "structured_output",
            return_value=_make_llm_result(plan_output),
        ):
            plan = await orch._plan(
                user_message="讲讲 B-Tree",
                conversation_history=[],
                available_tools=["get_specialist", "get_quiz"],
            )
            assert plan.intent == "explain"
            assert "get_specialist" in plan.tools_to_call

    @pytest.mark.asyncio
    async def test_plan_sanitizes_unavailable_tools(self):
        db = AsyncMock()
        orch = TutorOrchestrator(db=db, user_id=uuid.uuid4())

        # LLM returns a tool that's not available
        plan_output = TutorPlanOutput(
            intent="quiz",
            reasoning="test",
            tools_to_call=["get_quiz", "get_specialist"],
        )

        with patch.object(
            orch._llm,
            "structured_output",
            return_value=_make_llm_result(plan_output),
        ):
            plan = await orch._plan(
                user_message="出题",
                conversation_history=[],
                available_tools=["get_quiz"],  # Only quiz available
            )
            assert plan.tools_to_call == ["get_quiz"]


class TestFullFlow:
    @pytest.mark.asyncio
    async def test_answer_direct_flow(self):
        """No analysis → answer_direct → stream answer."""
        db = AsyncMock()
        execute_result = MagicMock()
        execute_result.scalar_one_or_none.return_value = None
        db.execute = AsyncMock(return_value=execute_result)

        user_id = uuid.uuid4()
        request = _make_request(message="你好")
        orch = TutorOrchestrator(db=db, user_id=user_id)

        async def mock_stream(*args, **kwargs):
            for token in ["你好", "！", "有什么", "可以", "帮助你的？"]:
                yield token

        with patch.object(orch._llm, "stream_text", side_effect=mock_stream):
            events = await _collect_events(orch, request)

        event_types = [e["event"] for e in events]

        assert "session.started" in event_types
        assert "plan.completed" in event_types
        assert "answer.delta" in event_types
        assert "answer.completed" in event_types
        assert "session.completed" in event_types

        # Check plan is answer_direct
        plan_event = next(e for e in events if e["event"] == "plan.completed")
        plan_data = json.loads(plan_event["data"])
        assert plan_data["intent"] == "answer_direct"
        assert plan_data["tools_to_call"] == []

        # Check no tool.result events
        assert "tool.result" not in event_types

    @pytest.mark.asyncio
    async def test_explain_flow_with_tool(self):
        """Has analysis → explain → get_specialist → stream answer."""
        task = MagicMock()
        task.id = uuid.uuid4()
        task.status = "completed"

        db = AsyncMock()
        execute_result = MagicMock()
        execute_result.scalar_one_or_none.return_value = task
        db.execute = AsyncMock(return_value=execute_result)

        user_id = uuid.uuid4()
        request = _make_request(message="讲讲 B-Tree")
        orch = TutorOrchestrator(db=db, user_id=user_id)

        plan_output = TutorPlanOutput(
            intent="explain",
            reasoning="用户想了解 B-Tree",
            tools_to_call=["get_specialist"],
            module_hint="B-Tree",
        )

        tool_result = TutorToolResult(
            ok=True,
            tool_name="get_specialist",
            scope={"material_id": str(request.material_id)},
            data={
                "module_name": "B-Tree 索引",
                "markdown": "# B-Tree\n\nB-Tree 是...",
                "key_concepts": ["B-Tree"],
            },
        )

        async def mock_stream(*args, **kwargs):
            for token in ["B-Tree", " 是一种", "平衡搜索树"]:
                yield token

        with patch.object(
            orch._llm,
            "structured_output",
            return_value=_make_llm_result(plan_output),
        ), patch(
            "app.services.tutor_orchestrator.run_tool",
            return_value=tool_result,
        ), patch.object(
            orch._llm,
            "stream_text",
            side_effect=mock_stream,
        ):
            events = await _collect_events(orch, request)

        event_types = [e["event"] for e in events]
        assert "tool.result" in event_types

        # Check tool result
        tool_event = next(e for e in events if e["event"] == "tool.result")
        tool_data = json.loads(tool_event["data"])
        assert tool_data["ok"] is True
        assert tool_data["tool_name"] == "get_specialist"

        # Check answer tokens
        deltas = [
            json.loads(e["data"])["content"]
            for e in events if e["event"] == "answer.delta"
        ]
        assert "".join(deltas) == "B-Tree 是一种平衡搜索树"

    @pytest.mark.asyncio
    async def test_plan_fallback_on_llm_error(self):
        """LLM plan error → keyword fallback plan, not crash."""
        from app.services.llm_client import LLMError

        task = MagicMock()
        task.id = uuid.uuid4()

        db = AsyncMock()
        execute_result = MagicMock()
        execute_result.scalar_one_or_none.return_value = task
        db.execute = AsyncMock(return_value=execute_result)

        user_id = uuid.uuid4()
        request = _make_request(message="讲讲 B-Tree")
        orch = TutorOrchestrator(db=db, user_id=user_id)

        tool_result = TutorToolResult(
            ok=True, tool_name="get_specialist",
            data={"module_name": "B-Tree", "markdown": "..."},
        )

        async def mock_stream(*args, **kwargs):
            yield "fallback answer"

        with patch.object(
            orch._llm, "structured_output",
            side_effect=LLMError("Rate limit"),
        ), patch(
            "app.services.tutor_orchestrator.run_tool",
            return_value=tool_result,
        ), patch.object(
            orch._llm, "stream_text",
            side_effect=mock_stream,
        ):
            events = await _collect_events(orch, request)

        event_types = [e["event"] for e in events]
        # Should still complete successfully via keyword fallback
        assert "plan.completed" in event_types
        assert "session.completed" in event_types

        plan = next(e for e in events if e["event"] == "plan.completed")
        plan_data = json.loads(plan["data"])
        assert plan_data["intent"] == "explain"  # keyword fallback detects "讲讲"
        assert "fallback" in plan_data["reasoning"].lower()

    @pytest.mark.asyncio
    async def test_stream_error_handling(self):
        """Stream phase error → error event emitted."""
        db = AsyncMock()
        execute_result = MagicMock()
        execute_result.scalar_one_or_none.return_value = None
        db.execute = AsyncMock(return_value=execute_result)

        user_id = uuid.uuid4()
        request = _make_request(message="你好")
        orch = TutorOrchestrator(db=db, user_id=user_id)

        async def failing_stream(*args, **kwargs):
            raise RuntimeError("Stream crashed")
            yield  # noqa: unreachable - makes it a generator

        with patch.object(
            orch._llm, "stream_text",
            side_effect=failing_stream,
        ):
            events = await _collect_events(orch, request)

        event_types = [e["event"] for e in events]
        assert "error" in event_types


class TestSSEFormat:
    def test_sse_format(self):
        event = TutorOrchestrator._sse("test.event", {"key": "value"})
        assert event["event"] == "test.event"
        assert json.loads(event["data"]) == {"key": "value"}

    def test_sse_chinese(self):
        event = TutorOrchestrator._sse("test", {"msg": "你好世界"})
        data = json.loads(event["data"])
        assert data["msg"] == "你好世界"
