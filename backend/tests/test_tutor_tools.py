"""Unit tests for tutor_tools — mock DB + S3, test tool logic."""

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio

from app.schemas.tutor import TutorToolResult
from app.services.tutor_tools import (
    get_specialist,
    get_quiz,
    run_tool,
    _normalize_module_name,
    _find_completed_task,
)


# ── Fixtures ─────────────────────────────────────────────────────

def _make_task(material_id=None, user_id=None):
    task = MagicMock()
    task.id = uuid.uuid4()
    task.material_id = material_id or uuid.uuid4()
    task.user_id = user_id or uuid.uuid4()
    task.status = "completed"
    return task


def _make_module(task_id=None, name="B-Tree 索引", sort_order=0):
    mod = MagicMock()
    mod.id = uuid.uuid4()
    mod.task_id = task_id or uuid.uuid4()
    mod.name = name
    mod.description = f"关于 {name}"
    mod.page_range_start = 1
    mod.page_range_end = 10
    mod.exam_weight = "high"
    mod.sort_order = sort_order
    return mod


def _make_specialist(module_id=None, s3_key="specialist/test.md"):
    spec = MagicMock()
    spec.id = uuid.uuid4()
    spec.module_id = module_id or uuid.uuid4()
    spec.markdown_s3_key = s3_key
    spec.summary = "B-Tree 是一种平衡搜索树"
    spec.key_concepts = ["B-Tree", "平衡", "磁盘IO"]
    spec.exam_traps = ["B-Tree vs B+Tree 区别"]
    return spec


def _make_quiz(task_id=None, questions=None):
    quiz = MagicMock()
    quiz.id = uuid.uuid4()
    quiz.task_id = task_id or uuid.uuid4()
    quiz.total_questions = 3
    quiz.questions = questions or [
        {
            "question": "B-Tree 的最小度数是？",
            "options": ["1", "2", "3", "4"],
            "correct_index": 1,
            "explanation": "B-Tree 最小度数为 2",
            "source_module_name": "B-Tree 索引",
            "difficulty": "medium",
        },
        {
            "question": "哈希索引支持范围查询吗？",
            "options": ["是", "否"],
            "correct_index": 1,
            "explanation": "哈希索引不支持范围查询",
            "source_module_name": "哈希索引",
            "difficulty": "easy",
        },
        {
            "question": "B+Tree 的叶节点有什么特点？",
            "options": ["单链表", "双链表", "无链表"],
            "correct_index": 1,
            "explanation": "叶节点用双链表连接",
            "source_module_name": "B-Tree 索引",
            "difficulty": "hard",
        },
    ]
    return quiz


# ── Helper Tests ─────────────────────────────────────────────────

class TestNormalize:
    def test_basic(self):
        assert _normalize_module_name("B-Tree 索引") == "b-tree索引"

    def test_strip_spaces(self):
        assert _normalize_module_name("  Hello World  ") == "helloworld"

    def test_underscores(self):
        assert _normalize_module_name("hash_index") == "hashindex"


# ── get_specialist Tests ─────────────────────────────────────────

class TestGetSpecialist:
    @pytest.mark.asyncio
    async def test_no_completed_task(self):
        db = AsyncMock()
        # scalar_one_or_none returns None for no task
        execute_result = MagicMock()
        execute_result.scalar_one_or_none.return_value = None
        db.execute = AsyncMock(return_value=execute_result)

        result = await get_specialist(
            db=db,
            material_id=uuid.uuid4(),
            user_id=uuid.uuid4(),
        )
        assert not result.ok
        assert result.error.code == "NO_ANALYSIS"

    @pytest.mark.asyncio
    async def test_success_with_module_id(self):
        task = _make_task()
        module = _make_module(task_id=task.id)
        spec = _make_specialist(module_id=module.id)

        db = AsyncMock()
        call_count = 0

        async def mock_execute(stmt):
            nonlocal call_count
            call_count += 1
            result = MagicMock()
            if call_count == 1:  # find task
                result.scalar_one_or_none.return_value = task
            elif call_count == 2:  # find module by id
                result.scalar_one_or_none.return_value = module
            elif call_count == 3:  # find specialist
                result.scalar_one_or_none.return_value = spec
            return result

        db.execute = mock_execute

        with patch(
            "app.services.tutor_tools._load_specialist_markdown",
            return_value="# B-Tree\n\nB-Tree 是...",
        ):
            result = await get_specialist(
                db=db,
                material_id=task.material_id,
                user_id=task.user_id,
                module_id=module.id,
            )

        assert result.ok
        assert result.tool_name == "get_specialist"
        assert result.data["module_name"] == module.name
        assert "B-Tree" in result.data["markdown"]
        assert result.data["key_concepts"] == ["B-Tree", "平衡", "磁盘IO"]

    @pytest.mark.asyncio
    async def test_no_specialist_output(self):
        task = _make_task()
        module = _make_module(task_id=task.id)

        db = AsyncMock()
        call_count = 0

        async def mock_execute(stmt):
            nonlocal call_count
            call_count += 1
            result = MagicMock()
            if call_count == 1:
                result.scalar_one_or_none.return_value = task
            elif call_count == 2:
                result.scalar_one_or_none.return_value = module
            elif call_count == 3:
                result.scalar_one_or_none.return_value = None  # no specialist
            return result

        db.execute = mock_execute

        result = await get_specialist(
            db=db,
            material_id=task.material_id,
            user_id=task.user_id,
            module_id=module.id,
        )
        assert not result.ok
        assert result.error.code == "NO_SPECIALIST"


# ── get_quiz Tests ───────────────────────────────────────────────

class TestGetQuiz:
    @pytest.mark.asyncio
    async def test_no_completed_task(self):
        db = AsyncMock()
        execute_result = MagicMock()
        execute_result.scalar_one_or_none.return_value = None
        db.execute = AsyncMock(return_value=execute_result)

        result = await get_quiz(
            db=db,
            material_id=uuid.uuid4(),
            user_id=uuid.uuid4(),
        )
        assert not result.ok
        assert result.error.code == "NO_ANALYSIS"

    @pytest.mark.asyncio
    async def test_success_all_questions(self):
        task = _make_task()
        quiz = _make_quiz(task_id=task.id)

        db = AsyncMock()
        call_count = 0

        async def mock_execute(stmt):
            nonlocal call_count
            call_count += 1
            result = MagicMock()
            if call_count == 1:
                result.scalar_one_or_none.return_value = task
            elif call_count == 2:
                result.scalar_one_or_none.return_value = quiz
            return result

        db.execute = mock_execute

        result = await get_quiz(
            db=db,
            material_id=task.material_id,
            user_id=task.user_id,
        )
        assert result.ok
        assert result.data["questions_count"] == 3
        assert result.data["selection_mode"] == "all"

    @pytest.mark.asyncio
    async def test_filter_by_module_hint(self):
        task = _make_task()
        quiz = _make_quiz(task_id=task.id)

        db = AsyncMock()
        call_count = 0

        async def mock_execute(stmt):
            nonlocal call_count
            call_count += 1
            result = MagicMock()
            if call_count == 1:
                result.scalar_one_or_none.return_value = task
            elif call_count == 2:
                result.scalar_one_or_none.return_value = quiz
            return result

        db.execute = mock_execute

        result = await get_quiz(
            db=db,
            material_id=task.material_id,
            user_id=task.user_id,
            module_hint="B-Tree",
        )
        assert result.ok
        assert result.data["module_matched"] is True
        assert result.data["selection_mode"] == "module_filtered"
        # Should only have B-Tree questions (2 out of 3)
        assert result.data["questions_count"] == 2

    @pytest.mark.asyncio
    async def test_no_quiz_data(self):
        task = _make_task()

        db = AsyncMock()
        call_count = 0

        async def mock_execute(stmt):
            nonlocal call_count
            call_count += 1
            result = MagicMock()
            if call_count == 1:
                result.scalar_one_or_none.return_value = task
            elif call_count == 2:
                result.scalar_one_or_none.return_value = None
            return result

        db.execute = mock_execute

        result = await get_quiz(
            db=db,
            material_id=task.material_id,
            user_id=task.user_id,
        )
        assert not result.ok
        assert result.error.code == "NO_QUIZ"


# ── run_tool Tests ───────────────────────────────────────────────

class TestRunTool:
    @pytest.mark.asyncio
    async def test_unknown_tool(self):
        db = AsyncMock()
        result = await run_tool(
            tool_name="nonexistent",
            db=db,
            material_id=uuid.uuid4(),
            user_id=uuid.uuid4(),
        )
        assert not result.ok
        assert result.error.code == "UNKNOWN_TOOL"

    @pytest.mark.asyncio
    async def test_tool_exception_caught(self):
        db = AsyncMock()
        db.execute = AsyncMock(side_effect=RuntimeError("DB down"))

        result = await run_tool(
            tool_name="get_specialist",
            db=db,
            material_id=uuid.uuid4(),
            user_id=uuid.uuid4(),
        )
        assert not result.ok
        assert result.error.code == "TOOL_ERROR"
        assert result.error.retryable is True
