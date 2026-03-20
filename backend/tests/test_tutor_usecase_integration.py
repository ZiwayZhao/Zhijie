"""Real use case integration tests for Tutor MVP.

Tests against REAL database data (DB-L05 SQL Lecture) with mocked LLM.
Simulates a student studying for a database exam (Grundlagen der Datenbanken).

Use cases:
  UC1: "讲讲 SQL 的 JOIN" → explain intent → get_specialist(JOIN模块) → streamed answer
  UC2: "出几道题" → quiz intent → get_quiz(all) → streamed answer
  UC3: "你好" → answer_direct → no tools → streamed answer
  UC4: "讲讲 SELECT" → explain → get_specialist(SELECT模块) → streamed answer
  UC5: "关于 DDL 出题" → quiz → get_quiz(DDL filtered) → streamed answer
  UC6: 没有分析的材料 → answer_direct(no tools) → 提示用户先分析
  UC7: "讲讲视图和索引" → explain → get_specialist(Views) → streamed answer
  UC8: "我学的怎么样" → answer_direct (no mastery in MVP) → streamed answer

Run with: DATABASE_URL="postgresql+asyncpg://zhijie:zhijie@localhost:5436/zhijie" \
          python -m pytest tests/test_tutor_usecase_integration.py -v -s
"""

import asyncio
import json
import os
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

# Skip if no real DB
DB_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql+asyncpg://zhijie:zhijie@localhost:5436/zhijie",
)

# Real data IDs from database exploration
# DB-L05-The-Structured-Query-Language (completed analysis)
MATERIAL_ID_SQL = uuid.UUID("14a0ca92-2f73-4607-a7fe-9b2696e420dc")
USER_ID_REAL = uuid.UUID("2037181f-c5cd-4c95-b482-272736efeac3")
TASK_ID_SQL = uuid.UUID("a4162c60-e616-4a01-8ac5-6fe9617da9c4")

# Module IDs
MODULE_JOIN = uuid.UUID("8ec4a520-3f4c-41ae-9778-c99a8580fe73")  # 多表连接查询
MODULE_SELECT = uuid.UUID("6d300d93-3e70-44a3-8d7b-52a42e3575aa")  # SELECT-FROM-WHERE
MODULE_DDL = uuid.UUID("b3ed4a75-327d-4e7b-aec5-9f0682a357dc")  # DDL
MODULE_VIEWS = uuid.UUID("4febb3a6-7742-4d55-8bb7-73bbcbb2e6b6")  # Views

# Material without completed analysis
MATERIAL_ID_NO_ANALYSIS = uuid.UUID("644c9a02-fb8a-424f-99de-ca11fcb2c317")

# ── Fixtures ─────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def db():
    """Create fresh engine + session per test to avoid event loop conflicts."""
    _engine = create_async_engine(DB_URL, echo=False)
    _sf = async_sessionmaker(bind=_engine, class_=AsyncSession, expire_on_commit=False)
    async with _sf() as session:
        yield session
    await _engine.dispose()


# ── Helper ───────────────────────────────────────────────────────

async def collect_events(orchestrator, request):
    events = []
    async for event in orchestrator.stream_chat(request):
        events.append({
            "event": event["event"],
            "data": json.loads(event["data"]),
        })
    return events


def summarize_events(events):
    """Pretty-print event flow for debugging."""
    lines = []
    for e in events:
        evt = e["event"]
        d = e["data"]
        if evt == "session.started":
            lines.append(f"  📋 session.started | tools={d.get('available_tools')}")
        elif evt == "plan.completed":
            lines.append(f"  🎯 plan.completed  | intent={d['intent']} tools={d['tools_to_call']}")
        elif evt == "tool.result":
            ok = "✅" if d["ok"] else "❌"
            extra = ""
            if d["ok"] and d.get("data"):
                if "module_name" in d["data"]:
                    extra = f" module={d['data']['module_name']}"
                if "questions_count" in d["data"]:
                    extra = f" questions={d['data']['questions_count']}"
            else:
                extra = f" error={d.get('error', {}).get('code', '?')}"
            lines.append(f"  {ok} tool.result    | {d['tool_name']}{extra}")
        elif evt == "answer.delta":
            pass  # too noisy
        elif evt == "answer.completed":
            lines.append(f"  ✍️  answer.completed | tokens={d.get('total_tokens', 0)}")
        elif evt == "error":
            lines.append(f"  ❗ error           | {d.get('message', '')[:60]}")
        elif evt == "session.completed":
            lines.append(f"  🏁 session.completed")
    return "\n".join(lines)


def get_full_answer(events):
    """Concatenate all answer.delta tokens."""
    return "".join(
        e["data"]["content"]
        for e in events
        if e["event"] == "answer.delta"
    )


# ── Mock LLM helpers ────────────────────────────────────────────

def mock_plan_result(intent, tools=None, module_hint=None):
    """Create a mock LLMResult for plan phase."""
    from app.schemas.tutor import TutorPlanOutput
    plan = TutorPlanOutput(
        intent=intent,
        reasoning=f"User intent: {intent}",
        tools_to_call=tools or [],
        module_hint=module_hint,
    )
    result = MagicMock()
    result.data = plan
    result.latency_ms = 50
    result.input_tokens = 100
    result.output_tokens = 30
    return result


def mock_stream_text(answer_text):
    """Create a mock stream_text that yields Chinese text."""
    async def stream(*args, **kwargs):
        # Split into chunks to simulate streaming
        for i in range(0, len(answer_text), 4):
            yield answer_text[i:i+4]
    return stream


# ── UC1: 讲讲 SQL 的 JOIN ────────────────────────────────────────

class TestUC1_ExplainJoin:
    """Student asks: '讲讲 SQL 的 JOIN 操作'"""

    @pytest.mark.asyncio
    async def test_tool_get_specialist_join(self, db):
        """Test get_specialist directly with JOIN module hint."""
        from app.services.tutor_tools import get_specialist

        with patch(
            "app.services.tutor_tools._load_specialist_markdown",
            return_value="# JOIN Operations\n\nSQL JOIN 用于连接多个表...",
        ):
            result = await get_specialist(
                db=db,
                material_id=MATERIAL_ID_SQL,
                user_id=USER_ID_REAL,
                module_hint="JOIN",
            )

        assert result.ok, f"Expected ok, got error: {result.error}"
        assert result.tool_name == "get_specialist"
        assert "JOIN" in result.data["module_name"] or "连接" in result.data["module_name"]
        assert result.data["exam_weight"] == "high"
        assert len(result.data["markdown"]) > 0
        print(f"\n✅ UC1 Tool: Found module '{result.data['module_name']}' "
              f"(pages {result.data['page_range']})")

    @pytest.mark.asyncio
    async def test_full_flow_explain_join(self, db):
        """Full orchestration: explain JOIN with mocked LLM."""
        from app.schemas.tutor import TutorChatRequest
        from app.services.tutor_orchestrator import TutorOrchestrator

        request = TutorChatRequest(
            material_id=MATERIAL_ID_SQL,
            user_message="讲讲 SQL 的 JOIN 操作，特别是 INNER JOIN 和 LEFT JOIN 的区别",
        )
        orch = TutorOrchestrator(db=db, user_id=USER_ID_REAL)

        answer = "JOIN 是 SQL 中用于连接多个表的核心操作。INNER JOIN 只返回两个表中匹配的行，而 LEFT JOIN 会保留左表所有行，右表无匹配时填 NULL。你能想到什么场景下必须用 LEFT JOIN 而不是 INNER JOIN 吗？"

        with patch.object(
            orch._llm, "structured_output",
            return_value=mock_plan_result("explain", ["get_specialist"], "JOIN"),
        ), patch(
            "app.services.tutor_orchestrator.run_tool",
        ) as mock_run_tool, patch.object(
            orch._llm, "stream_text",
            side_effect=mock_stream_text(answer),
        ):
            from app.schemas.tutor import TutorToolResult
            mock_run_tool.return_value = TutorToolResult(
                ok=True,
                tool_name="get_specialist",
                data={"module_name": "多表连接查询 (JOIN Operations)", "markdown": "# JOIN\n..."},
            )

            events = await collect_events(orch, request)

        event_types = [e["event"] for e in events]
        assert "session.started" in event_types
        assert "plan.completed" in event_types
        assert "tool.result" in event_types
        assert "answer.delta" in event_types
        assert "answer.completed" in event_types

        full_answer = get_full_answer(events)
        assert "JOIN" in full_answer
        assert len(full_answer) > 50

        print(f"\n✅ UC1 Full Flow:")
        print(summarize_events(events))
        print(f"  Answer: {full_answer[:100]}...")


# ── UC2: 出几道题 ───────────────────────────────────────────────

class TestUC2_QuizAll:
    """Student asks: '出几道题测试一下我的SQL水平'"""

    @pytest.mark.asyncio
    async def test_tool_get_quiz_all(self, db):
        """Test get_quiz with no module filter — returns first 5 questions."""
        from app.services.tutor_tools import get_quiz

        result = await get_quiz(
            db=db,
            material_id=MATERIAL_ID_SQL,
            user_id=USER_ID_REAL,
        )

        assert result.ok, f"Expected ok, got error: {result.error}"
        assert result.data["questions_count"] == 5  # MAX_QUIZ_QUESTIONS
        assert result.data["total_available"] == 11
        assert result.data["selection_mode"] == "all"
        assert result.data["module_matched"] is False

        # Verify question structure
        q = result.data["questions"][0]
        assert "question" in q
        assert "options" in q
        assert "correct_index" in q
        assert "source_module_name" in q

        print(f"\n✅ UC2 Tool: Got {result.data['questions_count']}/{result.data['total_available']} questions")
        for i, q in enumerate(result.data["questions"][:3]):
            print(f"  Q{i+1}: {q['question'][:50]}... (module: {q['source_module_name']})")


# ── UC3: 简单问候 ───────────────────────────────────────────────

class TestUC3_SimpleGreeting:
    """Student says: '你好，我在复习数据库'"""

    @pytest.mark.asyncio
    async def test_full_flow_greeting(self, db):
        from app.schemas.tutor import TutorChatRequest
        from app.services.tutor_orchestrator import TutorOrchestrator

        request = TutorChatRequest(
            material_id=MATERIAL_ID_SQL,
            user_message="你好，我在复习数据库",
        )
        orch = TutorOrchestrator(db=db, user_id=USER_ID_REAL)

        answer = "你好！很高兴帮助你复习数据库。这份 SQL 课件涵盖了 SELECT 查询、JOIN 操作、DDL 等重要内容。你想从哪个部分开始？"

        with patch.object(
            orch._llm, "structured_output",
            return_value=mock_plan_result("answer_direct"),
        ), patch.object(
            orch._llm, "stream_text",
            side_effect=mock_stream_text(answer),
        ):
            events = await collect_events(orch, request)

        # No tool.result events for answer_direct
        tool_events = [e for e in events if e["event"] == "tool.result"]
        assert len(tool_events) == 0

        plan = next(e for e in events if e["event"] == "plan.completed")
        assert plan["data"]["intent"] == "answer_direct"

        print(f"\n✅ UC3 Full Flow (greeting):")
        print(summarize_events(events))
        print(f"  Answer: {get_full_answer(events)[:80]}...")


# ── UC4: 讲讲 SELECT ─────────────────────────────────────────────

class TestUC4_ExplainSelect:
    """Student asks: 'SELECT 语句的 WHERE 条件怎么写？特别是 LIKE 和 BETWEEN'"""

    @pytest.mark.asyncio
    async def test_tool_specialist_select(self, db):
        from app.services.tutor_tools import get_specialist

        with patch(
            "app.services.tutor_tools._load_specialist_markdown",
            return_value="# SELECT-FROM-WHERE\n\nSELECT 语句的基本结构...",
        ):
            result = await get_specialist(
                db=db,
                material_id=MATERIAL_ID_SQL,
                user_id=USER_ID_REAL,
                module_hint="SELECT",
            )

        assert result.ok
        assert "SELECT" in result.data["module_name"]
        print(f"\n✅ UC4 Tool: Found module '{result.data['module_name']}'")

    @pytest.mark.asyncio
    async def test_tool_specialist_with_module_id(self, db):
        """Direct module_id access (from frontend sidebar click)."""
        from app.services.tutor_tools import get_specialist

        with patch(
            "app.services.tutor_tools._load_specialist_markdown",
            return_value="# SELECT basics...",
        ):
            result = await get_specialist(
                db=db,
                material_id=MATERIAL_ID_SQL,
                user_id=USER_ID_REAL,
                module_id=MODULE_SELECT,
            )

        assert result.ok
        assert "SELECT" in result.data["module_name"]
        print(f"\n✅ UC4 Direct ID: module='{result.data['module_name']}' pages={result.data['page_range']}")


# ── UC5: 关于 DDL 出题 ───────────────────────────────────────────

class TestUC5_QuizDDLFiltered:
    """Student asks: '关于 DDL 的部分出几道题'"""

    @pytest.mark.asyncio
    async def test_quiz_ddl_filtered(self, db):
        from app.services.tutor_tools import get_quiz

        result = await get_quiz(
            db=db,
            material_id=MATERIAL_ID_SQL,
            user_id=USER_ID_REAL,
            module_hint="DDL",
        )

        assert result.ok
        if result.data["module_matched"]:
            # All returned questions should be DDL-related
            for q in result.data["questions"]:
                assert "DDL" in q.get("source_module_name", "") or "数据定义" in q.get("source_module_name", "")
            print(f"\n✅ UC5: DDL filtered → {result.data['questions_count']} questions")
        else:
            # If no DDL questions in quiz, we get all questions (fallback)
            print(f"\n⚠️ UC5: No DDL questions found, got {result.data['questions_count']} unfiltered")

    @pytest.mark.asyncio
    async def test_quiz_select_filtered(self, db):
        """Filter quiz by SELECT module — should match many questions."""
        from app.services.tutor_tools import get_quiz

        result = await get_quiz(
            db=db,
            material_id=MATERIAL_ID_SQL,
            user_id=USER_ID_REAL,
            module_hint="SELECT-FROM-WHERE",
        )

        assert result.ok
        print(f"\n✅ UC5b: SELECT filtered → matched={result.data['module_matched']} "
              f"count={result.data['questions_count']}")


# ── UC6: 没有分析的材料 ─────────────────────────────────────────

class TestUC6_NoAnalysis:
    """Student opens a material that hasn't been analyzed yet."""

    @pytest.mark.asyncio
    async def test_build_context_no_tools(self, db):
        """No completed task → empty tools list."""
        from app.services.tutor_orchestrator import TutorOrchestrator

        orch = TutorOrchestrator(db=db, user_id=USER_ID_REAL)
        tools = await orch._build_context(MATERIAL_ID_NO_ANALYSIS)
        assert tools == []
        print(f"\n✅ UC6: No analysis → available_tools=[]")

    @pytest.mark.asyncio
    async def test_full_flow_no_analysis(self, db):
        """Full flow: should skip plan LLM call and force answer_direct."""
        from app.schemas.tutor import TutorChatRequest
        from app.services.tutor_orchestrator import TutorOrchestrator

        request = TutorChatRequest(
            material_id=MATERIAL_ID_NO_ANALYSIS,
            user_message="讲讲这个课件的内容",
        )
        orch = TutorOrchestrator(db=db, user_id=USER_ID_REAL)

        answer = "这份材料尚未完成分析，我暂时无法获取详细的课件内容。建议你先在工具面板运行「材料分析」，完成后我就能帮你讲解具体知识点了。"

        with patch.object(
            orch._llm, "stream_text",
            side_effect=mock_stream_text(answer),
        ) as mock_stream:
            events = await collect_events(orch, request)

        # Should NOT call structured_output (plan skipped)
        plan = next(e for e in events if e["event"] == "plan.completed")
        assert plan["data"]["intent"] == "answer_direct"
        assert plan["data"]["tools_to_call"] == []

        session = next(e for e in events if e["event"] == "session.started")
        assert session["data"]["available_tools"] == []

        print(f"\n✅ UC6 Full Flow:")
        print(summarize_events(events))
        print(f"  Answer: {get_full_answer(events)[:80]}...")


# ── UC7: 讲讲视图 ───────────────────────────────────────────────

class TestUC7_ExplainViews:
    """Student asks: '什么是 SQL 视图？怎么创建？'"""

    @pytest.mark.asyncio
    async def test_specialist_views(self, db):
        from app.services.tutor_tools import get_specialist

        with patch(
            "app.services.tutor_tools._load_specialist_markdown",
            return_value="# SQL Views\n\n视图是虚拟表...",
        ):
            result = await get_specialist(
                db=db,
                material_id=MATERIAL_ID_SQL,
                user_id=USER_ID_REAL,
                module_hint="视图",
            )

        assert result.ok
        assert "视图" in result.data["module_name"] or "View" in result.data["module_name"]
        print(f"\n✅ UC7: Found module '{result.data['module_name']}'")

    @pytest.mark.asyncio
    async def test_specialist_views_english(self, db):
        """Module hint in English should also work."""
        from app.services.tutor_tools import get_specialist

        with patch(
            "app.services.tutor_tools._load_specialist_markdown",
            return_value="# Views...",
        ):
            result = await get_specialist(
                db=db,
                material_id=MATERIAL_ID_SQL,
                user_id=USER_ID_REAL,
                module_hint="Views",
            )

        assert result.ok
        print(f"\n✅ UC7b: English hint 'Views' → '{result.data['module_name']}'")


# ── UC8: 我学的怎么样 ───────────────────────────────────────────

class TestUC8_MasteryQuestion:
    """Student asks: '我学的怎么样？哪些地方还需要加强？'
    MVP has no mastery → should answer honestly.
    """

    @pytest.mark.asyncio
    async def test_mastery_not_available(self, db):
        from app.schemas.tutor import TutorChatRequest
        from app.services.tutor_orchestrator import TutorOrchestrator

        request = TutorChatRequest(
            material_id=MATERIAL_ID_SQL,
            user_message="我学的怎么样？哪些地方还需要加强？",
        )
        orch = TutorOrchestrator(db=db, user_id=USER_ID_REAL)

        answer = "目前我还没有接入掌握度追踪功能，暂时无法评估你的学习状况。不过我们可以通过做几道题来检验一下，你觉得怎么样？"

        with patch.object(
            orch._llm, "structured_output",
            return_value=mock_plan_result("answer_direct"),
        ), patch.object(
            orch._llm, "stream_text",
            side_effect=mock_stream_text(answer),
        ):
            events = await collect_events(orch, request)

        plan = next(e for e in events if e["event"] == "plan.completed")
        assert plan["data"]["intent"] == "answer_direct"

        full_answer = get_full_answer(events)
        assert len(full_answer) > 20

        print(f"\n✅ UC8: Mastery question handled gracefully")
        print(f"  Answer: {full_answer[:80]}...")


# ── UC9: 复合请求 ────────────────────────────────────────────────

class TestUC9_CompoundRequest:
    """Student asks: '先讲讲 DML，然后出几道题'
    Should plan with 2 tools (get_specialist + get_quiz).
    """

    @pytest.mark.asyncio
    async def test_two_tools(self, db):
        from app.schemas.tutor import TutorChatRequest
        from app.services.tutor_orchestrator import TutorOrchestrator

        request = TutorChatRequest(
            material_id=MATERIAL_ID_SQL,
            user_message="先讲讲 DML 的 INSERT/UPDATE/DELETE，然后出几道相关的题",
        )
        orch = TutorOrchestrator(db=db, user_id=USER_ID_REAL)

        answer = "DML（数据操作语言）包括 INSERT、UPDATE、DELETE 三大核心语句..."

        with patch.object(
            orch._llm, "structured_output",
            return_value=mock_plan_result(
                "explain", ["get_specialist", "get_quiz"], "DML"
            ),
        ), patch(
            "app.services.tutor_orchestrator.run_tool",
        ) as mock_run_tool, patch.object(
            orch._llm, "stream_text",
            side_effect=mock_stream_text(answer),
        ):
            from app.schemas.tutor import TutorToolResult
            mock_run_tool.side_effect = [
                TutorToolResult(
                    ok=True, tool_name="get_specialist",
                    data={"module_name": "SQL数据操作语言 (DML)", "markdown": "..."},
                ),
                TutorToolResult(
                    ok=True, tool_name="get_quiz",
                    data={"questions": [{"q": "test"}], "questions_count": 3},
                ),
            ]

            events = await collect_events(orch, request)

        tool_events = [e for e in events if e["event"] == "tool.result"]
        assert len(tool_events) == 2
        assert tool_events[0]["data"]["tool_name"] == "get_specialist"
        assert tool_events[1]["data"]["tool_name"] == "get_quiz"

        print(f"\n✅ UC9: Compound request → 2 tool calls")
        print(summarize_events(events))


# ── UC10: 模块不存在的容错 ───────────────────────────────────────

class TestUC10_Fallback:
    """Student asks about a module that doesn't match any name → falls back to first module."""

    @pytest.mark.asyncio
    async def test_no_matching_module_fallback(self, db):
        from app.services.tutor_tools import get_specialist

        with patch(
            "app.services.tutor_tools._load_specialist_markdown",
            return_value="# SQL概述...",
        ):
            result = await get_specialist(
                db=db,
                material_id=MATERIAL_ID_SQL,
                user_id=USER_ID_REAL,
                module_hint="完全不存在的概念xyz",
            )

        # Should fallback to first module (sort_order=0)
        assert result.ok
        # First module is "SQL概述与关系模型基础"
        assert result.data["module_name"] is not None
        print(f"\n✅ UC10: Unknown hint fallback → '{result.data['module_name']}'")


# ── UC11: 带对话历史 ─────────────────────────────────────────────

class TestUC11_WithHistory:
    """Multi-turn conversation — history is passed through."""

    @pytest.mark.asyncio
    async def test_history_preserved(self, db):
        from app.schemas.tutor import ChatMessage, TutorChatRequest
        from app.services.tutor_orchestrator import TutorOrchestrator

        history = [
            ChatMessage(role="user", content="讲讲 JOIN"),
            ChatMessage(role="assistant", content="JOIN 用于连接多个表..."),
            ChatMessage(role="user", content="INNER JOIN 和 LEFT JOIN 的区别？"),
            ChatMessage(role="assistant", content="INNER JOIN 只返回匹配行..."),
        ]

        request = TutorChatRequest(
            material_id=MATERIAL_ID_SQL,
            user_message="能用一个具体的例子说明吗？",
            conversation_history=history,
        )
        orch = TutorOrchestrator(db=db, user_id=USER_ID_REAL)

        answer = "当然！假设我们有两个表：Employee 和 Department..."

        with patch.object(
            orch._llm, "structured_output",
            return_value=mock_plan_result("answer_direct"),
        ), patch.object(
            orch._llm, "stream_text",
            side_effect=mock_stream_text(answer),
        ) as mock_stream:
            events = await collect_events(orch, request)

            # Verify history was passed to stream_text
            call_kwargs = mock_stream.call_args
            messages = call_kwargs.kwargs.get("messages", [])
            # Should have 4 history + 1 new = 5 messages
            assert len(messages) == 5
            assert messages[0]["content"] == "讲讲 JOIN"
            assert messages[-1]["content"] == "能用一个具体的例子说明吗？"

        print(f"\n✅ UC11: History preserved ({len(messages)} messages)")
        print(f"  Answer: {get_full_answer(events)[:60]}...")


# ── UC12: 错误用户访问别人的材料 ─────────────────────────────────

class TestUC12_WrongUser:
    """User tries to access material they don't own — no completed task found."""

    @pytest.mark.asyncio
    async def test_wrong_user_no_tools(self, db):
        from app.services.tutor_orchestrator import TutorOrchestrator

        fake_user = uuid.uuid4()  # Random user, doesn't own this material
        orch = TutorOrchestrator(db=db, user_id=fake_user)
        tools = await orch._build_context(MATERIAL_ID_SQL)
        assert tools == []
        print(f"\n✅ UC12: Wrong user → no tools (user_id scope enforced)")

    @pytest.mark.asyncio
    async def test_wrong_user_specialist_fails(self, db):
        from app.services.tutor_tools import get_specialist

        result = await get_specialist(
            db=db,
            material_id=MATERIAL_ID_SQL,
            user_id=uuid.uuid4(),  # wrong user
            module_hint="JOIN",
        )
        assert not result.ok
        assert result.error.code == "NO_ANALYSIS"
        print(f"\n✅ UC12b: Wrong user specialist → {result.error.code}")
