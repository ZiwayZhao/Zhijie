"""Unit tests for tutor schemas — validation, edge cases."""

import uuid
import pytest
from pydantic import ValidationError

from app.schemas.tutor import (
    ChatMessage,
    TutorChatRequest,
    TutorPlanOutput,
    TutorToolResult,
    TutorToolError,
    MAX_HISTORY_TURNS,
)


class TestChatMessage:
    def test_valid_user(self):
        m = ChatMessage(role="user", content="hello")
        assert m.role == "user"

    def test_valid_assistant(self):
        m = ChatMessage(role="assistant", content="hi")
        assert m.role == "assistant"

    def test_invalid_role(self):
        with pytest.raises(ValidationError):
            ChatMessage(role="system", content="nope")


class TestTutorChatRequest:
    def test_minimal(self):
        req = TutorChatRequest(
            material_id=uuid.uuid4(),
            user_message="讲讲 B-Tree",
        )
        assert req.module_id is None
        assert req.conversation_history == []

    def test_with_module_id(self):
        mid = uuid.uuid4()
        mod = uuid.uuid4()
        req = TutorChatRequest(
            material_id=mid,
            module_id=mod,
            user_message="test",
        )
        assert req.module_id == mod

    def test_empty_message_rejected(self):
        with pytest.raises(ValidationError):
            TutorChatRequest(
                material_id=uuid.uuid4(),
                user_message="",
            )

    def test_long_message_rejected(self):
        with pytest.raises(ValidationError):
            TutorChatRequest(
                material_id=uuid.uuid4(),
                user_message="x" * 2001,
            )

    def test_history_truncated(self):
        history = [
            ChatMessage(role="user", content=f"msg {i}")
            for i in range(30)
        ]
        req = TutorChatRequest(
            material_id=uuid.uuid4(),
            user_message="hi",
            conversation_history=history,
        )
        assert len(req.conversation_history) == MAX_HISTORY_TURNS


class TestTutorPlanOutput:
    def test_explain_with_tool(self):
        plan = TutorPlanOutput(
            intent="explain",
            reasoning="用户想了解 B-Tree",
            tools_to_call=["get_specialist"],
            module_hint="B-Tree",
        )
        assert plan.intent == "explain"
        assert len(plan.tools_to_call) == 1

    def test_answer_direct(self):
        plan = TutorPlanOutput(
            intent="answer_direct",
            reasoning="简单问候",
        )
        assert plan.tools_to_call == []
        assert plan.module_hint is None

    def test_too_many_tools(self):
        with pytest.raises(ValidationError):
            TutorPlanOutput(
                intent="explain",
                reasoning="test",
                tools_to_call=["get_specialist", "get_quiz", "get_specialist"],
            )

    def test_invalid_intent(self):
        with pytest.raises(ValidationError):
            TutorPlanOutput(
                intent="invalid",
                reasoning="test",
            )

    def test_invalid_tool_name(self):
        with pytest.raises(ValidationError):
            TutorPlanOutput(
                intent="explain",
                reasoning="test",
                tools_to_call=["get_mastery"],  # Not in Literal
            )


class TestTutorToolResult:
    def test_success(self):
        r = TutorToolResult(
            ok=True,
            tool_name="get_specialist",
            scope={"material_id": str(uuid.uuid4())},
            data={"markdown": "# Hello"},
        )
        assert r.ok
        assert r.error is None

    def test_failure(self):
        r = TutorToolResult(
            ok=False,
            tool_name="get_quiz",
            error=TutorToolError(
                code="NO_ANALYSIS",
                message="尚未分析",
            ),
        )
        assert not r.ok
        assert r.error.code == "NO_ANALYSIS"

    def test_defaults(self):
        r = TutorToolResult(ok=True, tool_name="test")
        assert r.scope == {}
        assert r.data == {}
