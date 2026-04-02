# 04 后端架构设计 — 工具 API + LLM 服务层 + 流式推送 + 学习会话

> 作者：后端架构师
> 日期：2026-03-18
> 基于：disassembly.py、pipeline_worker.py、llm_client.py、workbench-audit 现状分析

---

## 目录

1. [现有架构分析](#1-现有架构分析)
2. [A. 8个手动工具 API 设计](#a-8个手动工具-api-设计)
3. [B. 统一 LLM 调用服务层](#b-统一-llm-调用服务层)
4. [C. 流式模块推送架构](#c-流式模块推送架构)
5. [D. 学习会话管理 API](#d-学习会话管理-api)
6. [E. Socratic 对话 API](#e-socratic-对话-api)

---

## 1. 现有架构分析

### 1.1 当前管道架构

```
POST /disassembly/start
  → Celery Task (pipeline_worker.py)
    → Phase 1: PDF Parsing (pdf_parser.py → S3 JSON)
    → Phase 2: Cartographer (LLM structured output → DisassemblyModule rows)
    → Phase 3: Specialist (LLM per-module → SpecialistOutput + S3 markdown)
    → Phase 4: Examiner (LLM → QuizData JSONB)
  → Redis Pub/Sub → SSE → Frontend
```

### 1.2 已有技术栈

| 组件 | 选型 | 说明 |
|------|------|------|
| Web 框架 | FastAPI + async | APIRouter 模块化 |
| 任务队列 | Celery | pipeline_worker.py 同步入口 + asyncio.run |
| 实时推送 | Redis Pub/Sub + sse-starlette | channel = `pipeline:{task_id}` |
| LLM 调用 | OpenRouter (AsyncOpenAI) | llm_client.py, structured_output + stream_text |
| 数据库 | PostgreSQL + SQLAlchemy async | Alembic 迁移 |
| 对象存储 | S3/MinIO | 大 markdown 文件、解析结果 |
| 配置 | pydantic-settings (.env) | Settings 单例 |

### 1.3 LLM Client 现状

`llm_client.py` 已实现：
- `structured_output()`: function calling → Pydantic 验证，含重试 + 中文引号修复
- `stream_text()`: 流式文本生成（用于 Socratic 对话）
- 单例模式 `get_llm_client()`
- LLMResult 数据类（data, input_tokens, output_tokens, latency_ms, model, run_id）

**不足**：
- 仅支持 OpenRouter 单一 provider
- 无模型路由策略（所有调用方自行指定 model）
- 无缓存层
- 无 token 预算管理

---

## A. 8个手动工具 API 设计

### A.1 统一路由与数据模型

所有工具共享统一的请求/响应模式，注册在 `app/api/v1/tools.py` 路由下。

```python
# app/api/v1/tools.py
from fastapi import APIRouter

router = APIRouter(prefix="/tools", tags=["tools"])
```

#### 统一请求基类

```python
# app/schemas/tools.py
import uuid
from pydantic import BaseModel, Field

class ToolRequest(BaseModel):
    """所有工具的通用请求字段。"""
    material_id: uuid.UUID
    task_id: uuid.UUID | None = Field(
        None, description="关联的 disassembly task；未传则自动查最新 completed task"
    )
    module_ids: list[uuid.UUID] | None = Field(
        None, description="限定模块范围；None 表示全部模块"
    )

class ToolResponse(BaseModel):
    """通用工具响应信封。"""
    tool: str
    material_id: uuid.UUID
    task_id: uuid.UUID
    cached: bool = False
    result: dict  # 各工具子类型的具体结果
    model_used: str
    latency_ms: int
    token_usage: dict = Field(default_factory=lambda: {"input": 0, "output": 0})
```

#### 缓存键策略

```python
def tool_cache_key(tool: str, task_id: str, module_ids: list[str] | None) -> str:
    """生成缓存 key，相同输入返回相同结果。"""
    scope = "all" if not module_ids else ",".join(sorted(module_ids))
    return f"tool_result:{tool}:{task_id}:{scope}"
```

### A.2 各工具详细设计

---

#### 1. POST /api/v1/tools/concept-map（概念图谱）

**请求体**：
```python
class ConceptMapRequest(ToolRequest):
    max_nodes: int = Field(20, ge=5, le=50, description="最大概念节点数")
    depth: int = Field(2, ge=1, le=3, description="关联深度")
```

**响应体**：
```python
class ConceptNode(BaseModel):
    id: str
    label: str
    category: str  # "core" | "supporting" | "prerequisite"
    importance: float = Field(ge=0.0, le=1.0)

class ConceptEdge(BaseModel):
    source: str
    target: str
    relation: str  # "depends_on" | "related_to" | "extends" | "contrasts"
    strength: float = Field(ge=0.0, le=1.0)

class ConceptMapResult(BaseModel):
    nodes: list[ConceptNode]
    edges: list[ConceptEdge]
    central_concepts: list[str] = Field(description="Top-3 核心概念")
```

**实现策略**：
- LLM Prompt: 输入各模块的 key_concepts + summary，要求输出结构化的节点和边
- 后处理: 验证图的连通性，剪枝孤立节点，计算中心度排序
- 模型: `z-ai/glm-4-flash`（轻量结构化任务）
- 缓存: Redis 缓存 1 小时

---

#### 2. POST /api/v1/tools/exam-points（考点提取）

**请求体**：
```python
class ExamPointsRequest(ToolRequest):
    exam_type: str = Field("final", description="考试类型: midterm | final | quiz")
```

**响应体**：
```python
class ExamPoint(BaseModel):
    topic: str
    importance: str  # "critical" | "important" | "supplementary"
    frequency: str  # "high" | "medium" | "low"
    related_modules: list[str]
    typical_question_types: list[str]  # "选择" | "填空" | "计算" | "证明" | "简答"
    key_formulas: list[str] = []
    common_mistakes: list[str] = []

class ExamPointsResult(BaseModel):
    points: list[ExamPoint]
    total_points: int
    study_time_estimate_min: int
    priority_order: list[str] = Field(description="按重要性排序的 topic 列表")
```

**实现策略**：
- LLM Prompt: 输入 specialist 的 exam_traps + key_concepts + summary
- 后处理: 按 importance 和 frequency 联合排序，生成优先级列表
- 模型: `z-ai/glm-4-flash`
- 缓存: Redis 缓存 2 小时

---

#### 3. POST /api/v1/tools/mistake-analysis（易错总结）

**请求体**：
```python
class MistakeAnalysisRequest(ToolRequest):
    quiz_answers: list[dict] | None = Field(
        None, description="用户答题记录 [{question_idx, selected_idx}]，可选"
    )
```

**响应体**：
```python
class MistakePattern(BaseModel):
    pattern_name: str
    description: str
    affected_concepts: list[str]
    examples: list[str]
    prevention_tips: list[str]
    severity: str  # "critical" | "common" | "minor"

class ConfusionPair(BaseModel):
    concept_a: str
    concept_b: str
    distinction: str
    memory_aid: str  # 助记方法

class MistakeAnalysisResult(BaseModel):
    patterns: list[MistakePattern]
    confusion_pairs: list[ConfusionPair]
    weak_areas: list[str]
    recommended_review: list[str] = Field(description="推荐复习的模块名")
```

**实现策略**：
- LLM Prompt: 输入 exam_traps + quiz 错题（若有）+ key_concepts
- 若有用户答题数据，重点分析错误选项的原因
- 模型: `z-ai/glm-4-flash`
- 缓存: 有 quiz_answers 时不缓存，无时缓存 2 小时

---

#### 4. POST /api/v1/tools/flashcard-generate（闪卡生成）

**请求体**：
```python
class FlashcardGenerateRequest(ToolRequest):
    card_types: list[str] = Field(
        ["basic", "cloze"],
        description="生成卡片类型: basic | cloze | reverse"
    )
    max_cards: int = Field(20, ge=5, le=50)
```

**响应体**：
```python
class FlashcardItem(BaseModel):
    type: str  # "basic" | "cloze" | "reverse"
    front: str
    back: str
    tags: list[str]
    source_module: str
    source_page: int | None = None
    difficulty: str = "medium"  # "easy" | "medium" | "hard"

class FlashcardGenerateResult(BaseModel):
    cards: list[FlashcardItem]
    total_cards: int
    by_type: dict[str, int]  # {"basic": 10, "cloze": 5, ...}
    estimated_review_min: int
```

**实现策略**：
- LLM Prompt: 输入 specialist markdown + key_concepts，按 card_type 分别生成
- 后处理: 去重（相似度检查），标记难度，计算预估复习时间
- 模型: `z-ai/glm-4-flash`
- 缓存: Redis 缓存 4 小时

---

#### 5. POST /api/v1/tools/knowledge-qa（知识问答，RAG）

**请求体**：
```python
class KnowledgeQARequest(ToolRequest):
    question: str = Field(min_length=2, max_length=1000)
    conversation_history: list[dict] | None = Field(
        None, description="历史对话 [{role, content}]"
    )
```

**响应体**：
```python
class SourceReference(BaseModel):
    module_name: str
    page: int | None = None
    excerpt: str = Field(max_length=200)

class KnowledgeQAResult(BaseModel):
    answer: str
    sources: list[SourceReference]
    confidence: float = Field(ge=0.0, le=1.0)
    follow_up_questions: list[str] = Field(max_length=3)
```

**实现策略**：
- RAG 流程:
  1. 将 question embedding 化（复用 gaoling_embedding.py 的 SiliconFlow 接口）
  2. 在该 task 的所有 specialist markdown 中做向量检索（或简单 BM25）
  3. 取 top-5 片段作为 context，构造 LLM prompt
- 模型: `deepseek/deepseek-chat-v3-0324`（长上下文理解强）
- 缓存: 不缓存（每次提问不同）
- 流式: 此端点支持 SSE 流式响应（见 E 节）

---

#### 6. POST /api/v1/tools/summary（一键总结）

**请求体**：
```python
class SummaryRequest(ToolRequest):
    style: str = Field("academic", description="总结风格: academic | bullet | executive")
    max_words: int = Field(500, ge=100, le=2000)
```

**响应体**：
```python
class SummaryResult(BaseModel):
    summary: str
    key_takeaways: list[str]
    word_count: int
    modules_covered: list[str]
```

**实现策略**：
- LLM Prompt: 拼接所有模块的 summary，要求按 style 输出
- 后处理: 字数裁剪，提取 key_takeaways
- 模型: `z-ai/glm-4-flash`
- 缓存: Redis 缓存 2 小时（key 含 style + max_words）

---

#### 7. POST /api/v1/tools/reading-notes（精读笔记）

**请求体**：
```python
class ReadingNotesRequest(ToolRequest):
    format: str = Field(
        "cornell", description="笔记格式: cornell | outline | mindmap-md"
    )
    focus_pages: list[int] | None = Field(None, description="聚焦页码范围")
```

**响应体**：
```python
class ReadingNotesResult(BaseModel):
    notes_markdown: str
    format: str
    page_coverage: list[int]
    key_questions: list[str]  # Cornell 笔记法的问题列
    summary_section: str  # Cornell 笔记法的总结区
```

**实现策略**：
- LLM Prompt: 输入 specialist markdown（或指定页的原文），按格式要求生成笔记
- Cornell 格式: 分三栏（笔记/问题/总结），用 markdown 表格模拟
- 模型: `z-ai/glm-4-flash`
- 缓存: Redis 缓存 2 小时

---

#### 8. POST /api/v1/tools/practice-quiz（模拟测验生成）

**请求体**：
```python
class PracticeQuizRequest(ToolRequest):
    question_count: int = Field(10, ge=3, le=30)
    difficulty: str = Field("mixed", description="难度: easy | medium | hard | mixed")
    question_types: list[str] = Field(
        ["mcq"], description="题型: mcq | fill-blank | true-false | short-answer"
    )
```

**响应体**：
```python
class PracticeQuestion(BaseModel):
    type: str  # "mcq" | "fill-blank" | "true-false" | "short-answer"
    question: str
    options: list[str] | None = None  # MCQ 专用
    correct_answer: str
    explanation: str
    source_module: str
    difficulty: str
    points: int = 1

class PracticeQuizResult(BaseModel):
    questions: list[PracticeQuestion]
    total_questions: int
    total_points: int
    estimated_time_min: int
    difficulty_distribution: dict[str, int]
```

**实现策略**：
- 与 Examiner 类似但更灵活：支持多题型、可指定难度分布
- LLM Prompt: 按 difficulty 分层采样，确保覆盖所有模块
- 后处理: 难度校准（检查 options 干扰项合理性），去重（与 QuizData 对比）
- 模型: `z-ai/glm-4-flash`
- 缓存: 不缓存（每次生成应有变化）

---

### A.3 统一路由注册

```python
# app/api/v1/tools.py

import uuid
import json
import logging

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import get_current_user
from app.db.session import get_db
from app.models.disassembly import DisassemblyTask, DisassemblyModule, SpecialistOutput
from app.models.user import User
from app.schemas.tools import (
    ConceptMapRequest, ConceptMapResult,
    ExamPointsRequest, ExamPointsResult,
    MistakeAnalysisRequest, MistakeAnalysisResult,
    FlashcardGenerateRequest, FlashcardGenerateResult,
    KnowledgeQARequest, KnowledgeQAResult,
    SummaryRequest, SummaryResult,
    ReadingNotesRequest, ReadingNotesResult,
    PracticeQuizRequest, PracticeQuizResult,
    ToolResponse,
)
from app.services.tool_executor import ToolExecutor

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/tools", tags=["tools"])


async def _resolve_task(
    material_id: uuid.UUID,
    task_id: uuid.UUID | None,
    user: User,
    db: AsyncSession,
) -> DisassemblyTask:
    """查找 completed task；优先用指定 task_id，否则取最新。"""
    if task_id:
        task = await db.get(DisassemblyTask, task_id)
    else:
        task = (await db.execute(
            select(DisassemblyTask)
            .where(
                DisassemblyTask.material_id == material_id,
                DisassemblyTask.status == "completed",
            )
            .order_by(DisassemblyTask.completed_at.desc())
            .limit(1)
        )).scalar_one_or_none()

    if not task:
        raise HTTPException(404, detail="No completed analysis found for this material")
    # 权限: owner 或 completed task 的公开访问
    if task.user_id != user.id and task.status != "completed":
        raise HTTPException(404, detail="Task not found")
    return task


async def _load_context(
    task: DisassemblyTask,
    module_ids: list[uuid.UUID] | None,
    db: AsyncSession,
) -> dict:
    """加载工具所需的上下文数据（模块 + specialist）。"""
    query = (
        select(DisassemblyModule, SpecialistOutput)
        .outerjoin(SpecialistOutput, SpecialistOutput.module_id == DisassemblyModule.id)
        .where(DisassemblyModule.task_id == task.id)
    )
    if module_ids:
        query = query.where(DisassemblyModule.id.in_(module_ids))
    query = query.order_by(DisassemblyModule.sort_order)
    rows = (await db.execute(query)).all()

    modules_data = []
    for module, specialist in rows:
        modules_data.append({
            "module_id": str(module.id),
            "name": module.name,
            "description": module.description,
            "page_range": f"{module.page_range_start}-{module.page_range_end}",
            "exam_weight": module.exam_weight,
            "summary": specialist.summary if specialist else None,
            "key_concepts": list(specialist.key_concepts) if specialist else [],
            "exam_traps": list(specialist.exam_traps or []) if specialist else [],
            "markdown_s3_key": specialist.markdown_s3_key if specialist else None,
        })
    return {"modules": modules_data, "task_id": str(task.id)}


@router.post("/concept-map", response_model=ToolResponse)
async def concept_map(
    body: ConceptMapRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    task = await _resolve_task(body.material_id, body.task_id, user, db)
    context = await _load_context(task, body.module_ids, db)
    executor = ToolExecutor()
    return await executor.run("concept-map", body, context, task)


# ... 其余 7 个端点结构相同，仅 tool_name 和 Request/Result 类型不同 ...

@router.post("/exam-points", response_model=ToolResponse)
async def exam_points(body: ExamPointsRequest, db=Depends(get_db), user=Depends(get_current_user)):
    task = await _resolve_task(body.material_id, body.task_id, user, db)
    context = await _load_context(task, body.module_ids, db)
    return await ToolExecutor().run("exam-points", body, context, task)

@router.post("/mistake-analysis", response_model=ToolResponse)
async def mistake_analysis(body: MistakeAnalysisRequest, db=Depends(get_db), user=Depends(get_current_user)):
    task = await _resolve_task(body.material_id, body.task_id, user, db)
    context = await _load_context(task, body.module_ids, db)
    return await ToolExecutor().run("mistake-analysis", body, context, task)

@router.post("/flashcard-generate", response_model=ToolResponse)
async def flashcard_generate(body: FlashcardGenerateRequest, db=Depends(get_db), user=Depends(get_current_user)):
    task = await _resolve_task(body.material_id, body.task_id, user, db)
    context = await _load_context(task, body.module_ids, db)
    return await ToolExecutor().run("flashcard-generate", body, context, task)

@router.post("/knowledge-qa", response_model=ToolResponse)
async def knowledge_qa(body: KnowledgeQARequest, db=Depends(get_db), user=Depends(get_current_user)):
    task = await _resolve_task(body.material_id, body.task_id, user, db)
    context = await _load_context(task, body.module_ids, db)
    return await ToolExecutor().run("knowledge-qa", body, context, task)

@router.post("/summary", response_model=ToolResponse)
async def summary(body: SummaryRequest, db=Depends(get_db), user=Depends(get_current_user)):
    task = await _resolve_task(body.material_id, body.task_id, user, db)
    context = await _load_context(task, body.module_ids, db)
    return await ToolExecutor().run("summary", body, context, task)

@router.post("/reading-notes", response_model=ToolResponse)
async def reading_notes(body: ReadingNotesRequest, db=Depends(get_db), user=Depends(get_current_user)):
    task = await _resolve_task(body.material_id, body.task_id, user, db)
    context = await _load_context(task, body.module_ids, db)
    return await ToolExecutor().run("reading-notes", body, context, task)

@router.post("/practice-quiz", response_model=ToolResponse)
async def practice_quiz(body: PracticeQuizRequest, db=Depends(get_db), user=Depends(get_current_user)):
    task = await _resolve_task(body.material_id, body.task_id, user, db)
    context = await _load_context(task, body.module_ids, db)
    return await ToolExecutor().run("practice-quiz", body, context, task)
```

---

## B. 统一 LLM 调用服务层

### B.1 LLMService 类设计

在现有 `llm_client.py` 基础上扩展，增加多 provider 路由、缓存、token 预算。

```python
# app/services/llm_service.py

import hashlib
import json
import logging
import time
from dataclasses import dataclass
from enum import Enum
from typing import AsyncGenerator, TypeVar

import redis.asyncio as aioredis
from pydantic import BaseModel

from app.core.config import settings
from app.services.llm_client import LLMClient, LLMResult, LLMError, get_openai_client

logger = logging.getLogger(__name__)
T = TypeVar("T", bound=BaseModel)


class LLMProvider(str, Enum):
    OPENROUTER = "openrouter"
    ZHIPU = "zhipu"       # Z.AI GLM
    SILICONFLOW = "siliconflow"  # 免费 embedding + 推理


class ModelTier(str, Enum):
    """模型层级，用于自动路由。"""
    FAST = "fast"          # 概念图、总结等轻量任务
    STANDARD = "standard"  # 精读笔记、考点提取等标准任务
    DEEP = "deep"          # 知识问答(RAG)、苏格拉底对话等需要深度理解的任务


# 模型路由表：tier → 首选 model → 降级 model
MODEL_ROUTING: dict[ModelTier, list[str]] = {
    ModelTier.FAST: [
        "z-ai/glm-4-flash",               # 首选：免费额度大
        "deepseek/deepseek-chat-v3-0324",  # 降级
    ],
    ModelTier.STANDARD: [
        "z-ai/glm-4-flash",
        "deepseek/deepseek-chat-v3-0324",
    ],
    ModelTier.DEEP: [
        "deepseek/deepseek-chat-v3-0324",  # 首选：长上下文 + 推理强
        "z-ai/glm-4-flash",               # 降级
    ],
}

# 工具 → 模型层级映射
TOOL_TIER_MAP: dict[str, ModelTier] = {
    "concept-map": ModelTier.FAST,
    "exam-points": ModelTier.FAST,
    "mistake-analysis": ModelTier.STANDARD,
    "flashcard-generate": ModelTier.FAST,
    "knowledge-qa": ModelTier.DEEP,
    "summary": ModelTier.FAST,
    "reading-notes": ModelTier.STANDARD,
    "practice-quiz": ModelTier.STANDARD,
    "socratic": ModelTier.DEEP,
}

# Token 限制（每工具调用的最大输出 token）
TOOL_MAX_TOKENS: dict[str, int] = {
    "concept-map": 2048,
    "exam-points": 3072,
    "mistake-analysis": 3072,
    "flashcard-generate": 4096,
    "knowledge-qa": 2048,
    "summary": 2048,
    "reading-notes": 4096,
    "practice-quiz": 4096,
    "socratic": 1024,
}


class LLMService:
    """统一 LLM 调用服务，封装模型路由、缓存、降级。"""

    def __init__(self):
        self._client = LLMClient()
        self._redis: aioredis.Redis | None = None

    async def _get_redis(self) -> aioredis.Redis:
        if self._redis is None:
            self._redis = aioredis.from_url(settings.redis_url, decode_responses=True)
        return self._redis

    def _select_model(self, tool: str, explicit_model: str | None = None) -> str:
        """根据工具类型选择模型。显式指定优先。"""
        if explicit_model:
            return explicit_model
        tier = TOOL_TIER_MAP.get(tool, ModelTier.STANDARD)
        candidates = MODEL_ROUTING[tier]
        return candidates[0]  # 首选

    def _fallback_model(self, tool: str, failed_model: str) -> str | None:
        """获取降级模型。"""
        tier = TOOL_TIER_MAP.get(tool, ModelTier.STANDARD)
        candidates = MODEL_ROUTING[tier]
        for m in candidates:
            if m != failed_model:
                return m
        return None

    def _cache_key(self, tool: str, prompt_hash: str) -> str:
        return f"llm_cache:{tool}:{prompt_hash}"

    def _hash_prompt(self, system: str, messages: list[dict]) -> str:
        content = json.dumps({"s": system, "m": messages}, ensure_ascii=False, sort_keys=True)
        return hashlib.sha256(content.encode()).hexdigest()[:16]

    async def structured_call(
        self,
        *,
        tool: str,
        system: str,
        messages: list[dict],
        response_schema: type[T],
        prompt_version: str,
        cache_ttl_seconds: int = 0,
        model: str | None = None,
    ) -> LLMResult:
        """统一的结构化 LLM 调用，含缓存 + 降级。

        Args:
            tool: 工具名（用于模型路由和 token 限制）
            cache_ttl_seconds: >0 时启用 Redis 缓存
            其余参数同 LLMClient.structured_output
        """
        selected_model = self._select_model(tool, model)
        max_tokens = TOOL_MAX_TOKENS.get(tool, 4096)

        # 1. 缓存检查
        if cache_ttl_seconds > 0:
            prompt_hash = self._hash_prompt(system, messages)
            cache_key = self._cache_key(tool, prompt_hash)
            r = await self._get_redis()
            cached = await r.get(cache_key)
            if cached:
                logger.info("Cache hit for tool=%s", tool)
                data = response_schema.model_validate_json(cached)
                return LLMResult(
                    data=data,
                    input_tokens=0,
                    output_tokens=0,
                    latency_ms=0,
                    model="cache",
                    run_id="cached",
                    prompt_version=prompt_version,
                )

        # 2. LLM 调用（含自动降级）
        try:
            result = await self._client.structured_output(
                model=selected_model,
                system=system,
                messages=messages,
                response_schema=response_schema,
                prompt_version=prompt_version,
                max_tokens=max_tokens,
            )
        except LLMError as e:
            fallback = self._fallback_model(tool, selected_model)
            if fallback:
                logger.warning(
                    "Primary model %s failed for tool=%s, falling back to %s: %s",
                    selected_model, tool, fallback, e,
                )
                result = await self._client.structured_output(
                    model=fallback,
                    system=system,
                    messages=messages,
                    response_schema=response_schema,
                    prompt_version=prompt_version,
                    max_tokens=max_tokens,
                )
            else:
                raise

        # 3. 写缓存
        if cache_ttl_seconds > 0:
            r = await self._get_redis()
            await r.setex(
                cache_key,
                cache_ttl_seconds,
                result.data.model_dump_json(),
            )

        return result

    async def stream_call(
        self,
        *,
        tool: str,
        system: str,
        messages: list[dict],
        model: str | None = None,
    ) -> AsyncGenerator[str, None]:
        """流式文本生成（用于 Socratic 对话和知识问答）。"""
        selected_model = self._select_model(tool, model)
        max_tokens = TOOL_MAX_TOKENS.get(tool, 2048)
        async for chunk in self._client.stream_text(
            model=selected_model,
            system=system,
            messages=messages,
            max_tokens=max_tokens,
        ):
            yield chunk


# 单例
_llm_service: LLMService | None = None

def get_llm_service() -> LLMService:
    global _llm_service
    if _llm_service is None:
        _llm_service = LLMService()
    return _llm_service
```

### B.2 ToolExecutor — 工具执行器

```python
# app/services/tool_executor.py

import time
import logging
from typing import Any

from app.models.disassembly import DisassemblyTask
from app.services.llm_service import get_llm_service
from app.services.tool_prompts import TOOL_PROMPTS  # 各工具的 system prompt
from app.schemas.tools import ToolResponse

logger = logging.getLogger(__name__)

# 缓存 TTL（秒），0 = 不缓存
TOOL_CACHE_TTL: dict[str, int] = {
    "concept-map": 3600,
    "exam-points": 7200,
    "mistake-analysis": 7200,  # 无 quiz_answers 时
    "flashcard-generate": 14400,
    "knowledge-qa": 0,
    "summary": 7200,
    "reading-notes": 7200,
    "practice-quiz": 0,
}

# 工具 → Pydantic 响应模型映射
from app.schemas.tools import (
    ConceptMapResult, ExamPointsResult, MistakeAnalysisResult,
    FlashcardGenerateResult, KnowledgeQAResult, SummaryResult,
    ReadingNotesResult, PracticeQuizResult,
)

TOOL_RESULT_SCHEMAS: dict[str, type] = {
    "concept-map": ConceptMapResult,
    "exam-points": ExamPointsResult,
    "mistake-analysis": MistakeAnalysisResult,
    "flashcard-generate": FlashcardGenerateResult,
    "knowledge-qa": KnowledgeQAResult,
    "summary": SummaryResult,
    "reading-notes": ReadingNotesResult,
    "practice-quiz": PracticeQuizResult,
}


class ToolExecutor:
    """统一工具执行器：构造 prompt → 调用 LLMService → 包装响应。"""

    async def run(
        self,
        tool_name: str,
        request: Any,
        context: dict,
        task: DisassemblyTask,
    ) -> ToolResponse:
        llm_service = get_llm_service()
        prompt_config = TOOL_PROMPTS[tool_name]
        schema = TOOL_RESULT_SCHEMAS[tool_name]

        # 构造 user message（将上下文数据序列化为 prompt）
        user_content = prompt_config["build_user_message"](request, context)
        system_prompt = prompt_config["system"]

        cache_ttl = TOOL_CACHE_TTL.get(tool_name, 0)
        # 特殊逻辑：有用户答题数据时不缓存
        if tool_name == "mistake-analysis" and getattr(request, "quiz_answers", None):
            cache_ttl = 0

        start = time.monotonic()
        result = await llm_service.structured_call(
            tool=tool_name,
            system=system_prompt,
            messages=[{"role": "user", "content": user_content}],
            response_schema=schema,
            prompt_version=prompt_config["version"],
            cache_ttl_seconds=cache_ttl,
        )
        elapsed = int((time.monotonic() - start) * 1000)

        return ToolResponse(
            tool=tool_name,
            material_id=request.material_id,
            task_id=task.id,
            cached=result.model == "cache",
            result=result.data.model_dump(),
            model_used=result.model,
            latency_ms=elapsed,
            token_usage={"input": result.input_tokens, "output": result.output_tokens},
        )
```

### B.3 Prompt 注册表（骨架）

```python
# app/services/tool_prompts.py

def _build_modules_context(context: dict) -> str:
    """将模块数据序列化为 LLM 可读的文本。"""
    lines = []
    for m in context["modules"]:
        lines.append(
            f"## 模块: {m['name']} (页码 {m['page_range']}, 考试权重: {m['exam_weight']})\n"
            f"摘要: {m['summary'] or '无'}\n"
            f"核心概念: {', '.join(m['key_concepts']) or '无'}\n"
            f"考试陷阱: {', '.join(m['exam_traps']) or '无'}\n"
        )
    return "\n".join(lines)

TOOL_PROMPTS: dict[str, dict] = {
    "concept-map": {
        "version": "cm_v1",
        "system": (
            "你是一个知识图谱专家。根据课件模块的核心概念，生成概念节点和关系边。"
            "确保图是连通的，边有明确的关系类型。"
            "按重要性排序节点。"
        ),
        "build_user_message": lambda req, ctx: (
            f"以下是课件的模块分析结果：\n\n"
            f"{_build_modules_context(ctx)}\n\n"
            f"请提取最多 {req.max_nodes} 个核心概念节点和它们之间的关系。"
            f"关联深度不超过 {req.depth} 层。"
        ),
    },
    "exam-points": {
        "version": "ep_v1",
        "system": (
            "你是一个考试辅导专家。根据课件分析结果，提取高频考点，"
            "标注重要性、出题概率、常见题型和易错点。"
        ),
        "build_user_message": lambda req, ctx: (
            f"以下是课件的模块分析结果：\n\n"
            f"{_build_modules_context(ctx)}\n\n"
            f"考试类型: {req.exam_type}\n"
            f"请提取考点并按重要性排序。"
        ),
    },
    # ... 其余 6 个工具的 prompt 配置结构相同 ...
    "summary": {
        "version": "sum_v1",
        "system": "你是一个学术摘要专家。根据课件模块摘要生成全材料总结。",
        "build_user_message": lambda req, ctx: (
            f"以下是课件的模块分析结果：\n\n"
            f"{_build_modules_context(ctx)}\n\n"
            f"总结风格: {req.style}\n"
            f"字数上限: {req.max_words}\n"
            f"请生成总结。"
        ),
    },
    "flashcard-generate": {
        "version": "fc_v1",
        "system": (
            "你是一个闪卡生成专家。根据课件内容生成间隔重复闪卡。"
            "每张卡片必须有 front（问题）、back（答案）、tags 和来源。"
        ),
        "build_user_message": lambda req, ctx: (
            f"以下是课件的模块分析结果：\n\n"
            f"{_build_modules_context(ctx)}\n\n"
            f"卡片类型: {', '.join(req.card_types)}\n"
            f"最多生成 {req.max_cards} 张闪卡。"
        ),
    },
    "mistake-analysis": {
        "version": "ma_v1",
        "system": (
            "你是一个教育诊断专家。分析课件中的易错点和概念混淆对，"
            "给出预防建议和助记方法。"
        ),
        "build_user_message": lambda req, ctx: (
            f"以下是课件的模块分析结果：\n\n"
            f"{_build_modules_context(ctx)}\n\n"
            f"请分析常见错误模式和易混淆概念。"
        ),
    },
    "knowledge-qa": {
        "version": "qa_v1",
        "system": (
            "你是一个知识问答助手。根据提供的课件内容回答问题。"
            "必须基于材料内容回答，给出引用来源。"
            "如果材料中没有相关信息，请如实说明。"
        ),
        "build_user_message": lambda req, ctx: (
            f"以下是课件的模块分析结果：\n\n"
            f"{_build_modules_context(ctx)}\n\n"
            f"学生提问: {req.question}"
        ),
    },
    "reading-notes": {
        "version": "rn_v1",
        "system": (
            "你是一个笔记整理专家。根据课件精讲内容生成结构化学习笔记。"
            "支持 Cornell 笔记法、大纲式和思维导图 Markdown 格式。"
        ),
        "build_user_message": lambda req, ctx: (
            f"以下是课件的模块分析结果：\n\n"
            f"{_build_modules_context(ctx)}\n\n"
            f"笔记格式: {req.format}\n"
            f"请生成结构化笔记。"
        ),
    },
    "practice-quiz": {
        "version": "pq_v1",
        "system": (
            "你是一个出题专家。根据课件内容生成模拟测验。"
            "题目要有区分度，干扰项要合理，解释要清晰。"
        ),
        "build_user_message": lambda req, ctx: (
            f"以下是课件的模块分析结果：\n\n"
            f"{_build_modules_context(ctx)}\n\n"
            f"题目数量: {req.question_count}\n"
            f"难度: {req.difficulty}\n"
            f"题型: {', '.join(req.question_types)}"
        ),
    },
}
```

---

## C. 流式模块推送架构

### C.1 当前管道架构的瓶颈

当前 `pipeline_worker.py` 的 Specialist 阶段：
1. 顺序处理所有模块（虽然有 `on_module_complete` 回调）
2. 回调仅更新 progress 数字，不携带模块内容
3. 前端收到 progress 事件后，需等全部完成才能加载模块数据

### C.2 改进方案：Specialist 完成即推送

#### 新增 SSE 事件类型

```python
# 扩展 schemas/disassembly.py

class SSEModuleReadyEvent(BaseModel):
    """Specialist 完成一个模块时推送。"""
    task_id: uuid.UUID
    phase: str = "specialist"
    event_type: str = "module_ready"
    module_id: uuid.UUID
    module_name: str
    sort_order: int
    has_specialist: bool = True

class SSEQuizReadyEvent(BaseModel):
    """Examiner 完成测验时推送。"""
    task_id: uuid.UUID
    phase: str = "examiner"
    event_type: str = "quiz_ready"
    quiz_id: uuid.UUID
    total_questions: int

class SSEToolResultEvent(BaseModel):
    """工具结果推送（用于后台执行的工具）。"""
    task_id: uuid.UUID
    event_type: str = "tool_result"
    tool: str
    result_summary: str  # 简短描述
    cached: bool = False
```

#### Redis Pub/Sub 消息格式

```json
// channel: "pipeline:{task_id}"

// 模块完成事件
{
    "task_id": "xxx",
    "phase": "specialist",
    "event_type": "module_ready",
    "progress": 0.55,
    "message": "模块 3/7 完成: 图的遍历算法",
    "module_id": "yyy",
    "module_name": "图的遍历算法",
    "sort_order": 2,
    "detail": {"completed": 3, "total": 7}
}

// 测验完成事件
{
    "task_id": "xxx",
    "phase": "examiner",
    "event_type": "quiz_ready",
    "progress": 0.95,
    "message": "测验生成完成",
    "quiz_id": "zzz",
    "total_questions": 10
}
```

#### pipeline_worker.py 改造要点

```python
# 在 Specialist 阶段的 on_module_done 回调中增加 module_ready 事件

async def on_module_done(completed: int, total: int, module_idx: int):
    """Specialist 完成一个模块后的回调。"""
    db_module = db_modules[module_idx]

    # 1. 更新进度（已有逻辑）
    progress = 0.40 + (completed / total) * 0.40
    await _update_task(session, task_id, progress=min(progress, 0.80))

    # 2. 新增: 推送 module_ready 事件
    _publish_progress(
        redis_client, task_id_str, "specialist",
        min(progress, 0.80),
        f"模块 {completed}/{total} 完成: {db_module.name}",
        {
            "completed": completed,
            "total": total,
            "event_type": "module_ready",
            "module_id": str(db_module.id),
            "module_name": db_module.name,
            "sort_order": db_module.sort_order,
        },
    )
```

#### 前端 SSE 适配

```typescript
// api-disassembly.ts 扩展 ProgressEvent
export interface ProgressEvent {
  progress: number
  status: DisassemblyTask['status']
  phase: string
  currentStep?: string
  modules?: DisassemblyModule[]
  detail?: {
    completed?: number
    total?: number
    event_type?: 'module_ready' | 'quiz_ready' | 'tool_result'
    module_id?: string
    module_name?: string
    sort_order?: number
  }
}
```

前端在收到 `event_type: "module_ready"` 时，可立即加载该模块的 specialist 内容并显示在 MaterialReader 中。

### C.3 并行 Specialist 执行

当前 `run_specialist` 可能是顺序执行模块。建议改为**受控并行**（semaphore 限流 3 个并发），加速总体执行时间：

```python
async def run_specialist_parallel(
    parsed, plan, llm, run_id, on_module_complete, max_concurrent=3
):
    """并行执行 Specialist，限制并发数。"""
    sem = asyncio.Semaphore(max_concurrent)
    results = [None] * len(plan.modules)

    async def process_module(idx):
        async with sem:
            result = await _run_single_specialist(parsed, plan.modules[idx], llm, run_id)
            results[idx] = (idx, result)
            await on_module_complete(sum(1 for r in results if r), len(plan.modules), idx)

    await asyncio.gather(*[process_module(i) for i in range(len(plan.modules))])
    return [r for r in results if r]
```

---

## D. 学习会话管理 API

### D.1 数据库模型

```python
# app/models/learning.py

import uuid
from datetime import datetime
from sqlalchemy import (
    Boolean, CheckConstraint, DateTime, Float, ForeignKey,
    Integer, String, Text, func,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class LearningSession(Base):
    """一次完整的学习会话（从意图选择到结束）。"""
    __tablename__ = "learning_sessions"
    __table_args__ = (
        CheckConstraint(
            "status IN ('active', 'paused', 'completed', 'abandoned')",
            name="ck_lsession_status",
        ),
        CheckConstraint(
            "intent IN ('learn', 'exam', 'review')",
            name="ck_lsession_intent",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    material_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("materials.id", ondelete="CASCADE"),
        nullable=False,
    )
    task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("disassembly_tasks.id", ondelete="SET NULL"),
        nullable=True,
    )

    intent: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="active",
    )

    # 学生上下文（创建时快照）
    context_json: Mapped[dict | None] = mapped_column(
        JSONB, nullable=True,
        comment="{ exam_date, familiarity, available_hours, ... }",
    )

    # 学习计划（可修改）
    plan_steps: Mapped[list | None] = mapped_column(
        JSONB, nullable=True,
        comment="LearningPlanStep[] — 可被 replan 覆盖",
    )
    plan_version: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="1",
    )

    # 统计
    total_study_minutes: Mapped[float] = mapped_column(
        Float, nullable=False, server_default="0",
    )
    modules_completed: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0",
    )

    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
    )


class LearningStep(Base):
    """学习步骤执行记录。"""
    __tablename__ = "learning_steps"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'active', 'completed', 'skipped')",
            name="ck_lstep_status",
        ),
        CheckConstraint(
            "action IN ('read', 'quiz', 'flashcard', 'review', 'deep-dive', 'tool')",
            name="ck_lstep_action",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("learning_sessions.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    module_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("disassembly_modules.id", ondelete="SET NULL"),
        nullable=True,
    )

    sort_order: Mapped[int] = mapped_column(Integer, nullable=False)
    action: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="pending",
    )

    # 执行结果
    mastery_before: Mapped[float | None] = mapped_column(Float, nullable=True)
    mastery_after: Mapped[float | None] = mapped_column(Float, nullable=True)
    quiz_score: Mapped[float | None] = mapped_column(
        Float, nullable=True, comment="测验正确率 0.0-1.0",
    )
    time_spent_min: Mapped[float | None] = mapped_column(Float, nullable=True)

    # 元数据
    metadata_json: Mapped[dict | None] = mapped_column(
        JSONB, nullable=True,
        comment="工具参数、结果引用等",
    )

    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
    )


class StudentProfile(Base):
    """持久化的学生学习画像（per user x material）。"""
    __tablename__ = "student_profiles"
    __table_args__ = (
        # 每个用户每个材料一个画像
        {"schema": None},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    material_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("materials.id", ondelete="CASCADE"),
        nullable=False,
    )

    # BKT per-module mastery
    module_mastery: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default="{}",
        comment='{ "module_id": {"mastery": 0.5, "attempts": 3, "correct": 2} }',
    )

    # 整体画像
    goal: Mapped[str | None] = mapped_column(String(20), nullable=True)
    total_study_minutes: Mapped[float] = mapped_column(
        Float, nullable=False, server_default="0",
    )
    streak_days: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0",
    )
    last_study_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
    )
```

### D.2 API 端点

```python
# app/api/v1/learning.py

import uuid
import json
import asyncio
import logging

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, HTTPException
from sse_starlette.sse import EventSourceResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import get_current_user, decode_access_token
from app.db.session import get_db
from app.models.learning import LearningSession, LearningStep, StudentProfile
from app.models.user import User

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/learning", tags=["learning"])


# ── Schemas ──────────────────────────────────────────────────

from pydantic import BaseModel, Field
from datetime import datetime


class CreateSessionRequest(BaseModel):
    material_id: uuid.UUID
    task_id: uuid.UUID
    intent: str = Field(description="learn | exam | review")
    context: dict | None = Field(
        None, description="{ exam_date, familiarity, available_hours }"
    )
    plan_steps: list[dict] | None = Field(
        None, description="前端确认后的学习计划步骤"
    )


class SessionResponse(BaseModel):
    id: uuid.UUID
    material_id: uuid.UUID
    intent: str
    status: str
    plan_version: int
    total_study_minutes: float
    modules_completed: int
    started_at: datetime
    created_at: datetime

    model_config = {"from_attributes": True}


class FeedbackRequest(BaseModel):
    step_id: uuid.UUID
    action: str = Field(description="完成的动作类型")
    quiz_score: float | None = Field(None, ge=0.0, le=1.0)
    time_spent_min: float | None = None
    mastery_update: dict | None = Field(
        None, description="{ module_id: new_mastery }"
    )


class ReplanRequest(BaseModel):
    reason: str = Field(description="重规划原因: quiz_fail | user_request | time_change")
    new_context: dict | None = None


# ── POST /learning/sessions ──────────────────────────────────

@router.post("/sessions", response_model=SessionResponse, status_code=201)
async def create_session(
    body: CreateSessionRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """创建学习会话。"""
    session = LearningSession(
        user_id=user.id,
        material_id=body.material_id,
        task_id=body.task_id,
        intent=body.intent,
        context_json=body.context,
        plan_steps=body.plan_steps,
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return SessionResponse.model_validate(session)


# ── GET /learning/sessions/:id/stream (SSE) ──────────────────

@router.get("/sessions/{session_id}/stream")
async def session_stream(
    session_id: uuid.UUID,
    token: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """SSE 学习事件流 — 推送学习进度、推荐、mastery 变化。

    事件类型:
      - step_activated: 当前步骤变更
      - mastery_updated: 模块 mastery 变化
      - recommendation: AI 推荐下一步
      - replan_triggered: 学习计划自动调整
      - session_completed: 会话结束
    """
    # 认证（同 disassembly SSE）
    if not token:
        raise HTTPException(401, "Missing token")
    payload = decode_access_token(token)
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(401, "Invalid token")

    ls = await db.get(LearningSession, session_id)
    if not ls or str(ls.user_id) != user_id:
        raise HTTPException(404, "Session not found")

    async def event_gen():
        # 初始状态
        yield {"event": "session_state", "data": json.dumps({
            "session_id": str(session_id),
            "status": ls.status,
            "plan_version": ls.plan_version,
            "modules_completed": ls.modules_completed,
        })}

        if ls.status in ("completed", "abandoned"):
            return

        # 订阅 Redis channel
        r = aioredis.from_url(settings.redis_url, decode_responses=True)
        pubsub = r.pubsub()
        channel = f"learning:{session_id}"
        try:
            await pubsub.subscribe(channel)
            deadline = asyncio.get_event_loop().time() + 3600  # 1 小时超时
            while asyncio.get_event_loop().time() < deadline:
                msg = await pubsub.get_message(
                    ignore_subscribe_messages=True, timeout=10.0
                )
                if msg and msg["type"] == "message":
                    data = json.loads(msg["data"])
                    yield {"event": data.get("event_type", "update"), "data": msg["data"]}
                    if data.get("event_type") == "session_completed":
                        break
                else:
                    yield {"event": "heartbeat", "data": ""}
        finally:
            await pubsub.unsubscribe(channel)
            await pubsub.close()
            await r.close()

    return EventSourceResponse(event_gen())


# ── POST /learning/sessions/:id/feedback ─────────────────────

@router.post("/sessions/{session_id}/feedback")
async def submit_feedback(
    session_id: uuid.UUID,
    body: FeedbackRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """提交学习反馈（完成步骤、测验分数等）。

    触发:
    1. 更新 LearningStep 状态
    2. 更新 StudentProfile mastery
    3. 检查是否需要自动 replan
    4. 通过 Redis Pub/Sub 推送事件到前端 SSE
    """
    ls = await db.get(LearningSession, session_id)
    if not ls or ls.user_id != user.id:
        raise HTTPException(404, "Session not found")

    # 更新步骤
    step = await db.get(LearningStep, body.step_id)
    if not step or step.session_id != session_id:
        raise HTTPException(404, "Step not found")

    step.status = "completed"
    step.quiz_score = body.quiz_score
    step.time_spent_min = body.time_spent_min

    # 更新 mastery
    if body.mastery_update:
        profile = (await db.execute(
            select(StudentProfile).where(
                StudentProfile.user_id == user.id,
                StudentProfile.material_id == ls.material_id,
            )
        )).scalar_one_or_none()
        if not profile:
            profile = StudentProfile(
                user_id=user.id,
                material_id=ls.material_id,
            )
            db.add(profile)
        mastery = dict(profile.module_mastery)
        mastery.update(body.mastery_update)
        profile.module_mastery = mastery

    # 更新会话统计
    ls.modules_completed += 1
    if body.time_spent_min:
        ls.total_study_minutes += body.time_spent_min

    await db.commit()

    # 推送事件
    r = aioredis.from_url(settings.redis_url, decode_responses=True)
    try:
        event = {
            "event_type": "mastery_updated",
            "step_id": str(body.step_id),
            "quiz_score": body.quiz_score,
            "modules_completed": ls.modules_completed,
        }
        await r.publish(f"learning:{session_id}", json.dumps(event))

        # 自动 replan 检查
        if body.quiz_score is not None and body.quiz_score < 0.6:
            replan_event = {
                "event_type": "recommendation",
                "message": "测验正确率不足60%，建议复习该模块",
                "recommended_action": "review",
            }
            await r.publish(f"learning:{session_id}", json.dumps(replan_event))
    finally:
        await r.close()

    return {"status": "ok", "modules_completed": ls.modules_completed}


# ── POST /learning/sessions/:id/replan ───────────────────────

@router.post("/sessions/{session_id}/replan")
async def replan_session(
    session_id: uuid.UUID,
    body: ReplanRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """请求重新规划学习路径。

    根据当前 mastery 状态和新上下文，重新生成计划步骤。
    """
    ls = await db.get(LearningSession, session_id)
    if not ls or ls.user_id != user.id:
        raise HTTPException(404, "Session not found")
    if ls.status != "active":
        raise HTTPException(400, "Can only replan active sessions")

    # TODO: 调用 HTN 规划器重新生成计划
    # 当前简化实现: 仅增加版本号 + 记录原因
    ls.plan_version += 1
    if body.new_context:
        ctx = dict(ls.context_json or {})
        ctx.update(body.new_context)
        ls.context_json = ctx

    await db.commit()

    # 推送事件
    r = aioredis.from_url(settings.redis_url, decode_responses=True)
    try:
        event = {
            "event_type": "replan_triggered",
            "reason": body.reason,
            "plan_version": ls.plan_version,
        }
        await r.publish(f"learning:{session_id}", json.dumps(event))
    finally:
        await r.close()

    return {
        "status": "replanned",
        "plan_version": ls.plan_version,
        "reason": body.reason,
    }
```

---

## E. Socratic 对话 API

### E.1 API 端点

```python
# app/api/v1/chat.py

import uuid
import json
import logging

from fastapi import APIRouter, Depends, HTTPException
from sse_starlette.sse import EventSourceResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.services.llm_service import get_llm_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/chat", tags=["chat"])


# ── Schemas ──────────────────────────────────────────────────

from pydantic import BaseModel, Field


class SocraticRequest(BaseModel):
    material_id: uuid.UUID
    task_id: uuid.UUID
    module_id: uuid.UUID
    message: str = Field(min_length=1, max_length=2000)
    conversation_history: list[dict] = Field(
        default_factory=list,
        description="[{role: 'user'|'assistant', content: str}]",
    )
    mastery: float = Field(0.5, ge=0.0, le=1.0, description="当前模块 mastery")
    module_context: dict | None = Field(
        None, description="{ summary, key_concepts, exam_traps }",
    )


class KnowledgeQAStreamRequest(BaseModel):
    material_id: uuid.UUID
    task_id: uuid.UUID
    question: str = Field(min_length=2, max_length=1000)
    conversation_history: list[dict] = Field(default_factory=list)
    module_ids: list[uuid.UUID] | None = None


# ── POST /chat/socratic (SSE 流式) ──────────────────────────

@router.post("/socratic")
async def socratic_chat(
    body: SocraticRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """苏格拉底对话 — SSE 流式响应。

    根据 mastery 等级调整脚手架强度:
      mastery < 0.3  → full: 手把手引导，分解概念，类比解释
      0.3-0.7        → moderate: 追问深度，要求归纳总结
      >= 0.7         → minimal: 反例挑战，跨学科连接
    """
    llm_service = get_llm_service()

    # 构造 system prompt（脚手架等级驱动）
    if body.mastery < 0.3:
        scaffold_instruction = (
            "学生对这个概念很陌生。使用引导式提问：\n"
            "- 分解为更小的子问题\n"
            "- 提供类比和直觉解释\n"
            "- 在每一步确认理解后再继续\n"
            "- 不要直接给出答案"
        )
    elif body.mastery < 0.7:
        scaffold_instruction = (
            "学生有基础了解。使用讨论式提问：\n"
            "- 追问'为什么'和'如何'\n"
            "- 要求学生用自己的话总结\n"
            "- 指出常见误解\n"
            "- 适度提供提示但不给完整答案"
        )
    else:
        scaffold_instruction = (
            "学生已较好掌握。使用挑战式提问：\n"
            "- 构造反例和边界情况\n"
            "- 要求跨概念连接\n"
            "- 提出开放性问题\n"
            "- 几乎不给提示"
        )

    # 加载模块上下文
    context_text = ""
    if body.module_context:
        mc = body.module_context
        context_text = (
            f"\n\n## 当前模块上下文\n"
            f"摘要: {mc.get('summary', '无')}\n"
            f"核心概念: {', '.join(mc.get('key_concepts', []))}\n"
            f"考试陷阱: {', '.join(mc.get('exam_traps', []))}\n"
        )

    system_prompt = (
        f"你是一个苏格拉底式的学习引导者，正在帮助学生学习。\n\n"
        f"## 脚手架策略 (mastery = {body.mastery:.1%})\n"
        f"{scaffold_instruction}\n"
        f"{context_text}\n\n"
        f"## 对话规则\n"
        f"1. 永远不要直接给出答案，用提问引导思考\n"
        f"2. 每次回复只提出 1-2 个问题\n"
        f"3. 肯定学生的正确思路\n"
        f"4. 用简洁、亲切的中文\n"
        f"5. 如果学生连续 3 次无法回答，降低难度并给出提示"
    )

    messages = list(body.conversation_history) + [
        {"role": "user", "content": body.message}
    ]

    async def stream_gen():
        buffer = ""
        async for chunk in llm_service.stream_call(
            tool="socratic",
            system=system_prompt,
            messages=messages,
        ):
            buffer += chunk
            yield {"event": "delta", "data": json.dumps({"content": chunk})}

        # 最终完整消息
        yield {"event": "done", "data": json.dumps({
            "content": buffer,
            "role": "assistant",
        })}

    return EventSourceResponse(stream_gen())


# ── POST /chat/knowledge-qa (SSE 流式) ──────────────────────

@router.post("/knowledge-qa")
async def knowledge_qa_stream(
    body: KnowledgeQAStreamRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """知识问答 — 基于材料内容的 RAG 问答，SSE 流式响应。"""
    llm_service = get_llm_service()

    # 加载模块上下文用于 RAG
    from app.models.disassembly import DisassemblyModule, SpecialistOutput
    from sqlalchemy import select

    query = (
        select(DisassemblyModule.name, SpecialistOutput.summary, SpecialistOutput.key_concepts)
        .outerjoin(SpecialistOutput, SpecialistOutput.module_id == DisassemblyModule.id)
        .where(DisassemblyModule.task_id == body.task_id)
    )
    if body.module_ids:
        query = query.where(DisassemblyModule.id.in_(body.module_ids))
    rows = (await db.execute(query)).all()

    context_parts = []
    for name, summary, concepts in rows:
        context_parts.append(
            f"模块: {name}\n摘要: {summary or '无'}\n概念: {', '.join(concepts or [])}"
        )
    context_text = "\n\n".join(context_parts)

    system_prompt = (
        f"你是一个知识问答助手。根据以下材料内容回答学生提问。\n\n"
        f"## 材料内容\n{context_text}\n\n"
        f"## 规则\n"
        f"1. 仅基于提供的材料回答\n"
        f"2. 引用具体模块名作为来源\n"
        f"3. 如材料中无相关信息，坦诚说明\n"
        f"4. 用简洁的中文回答"
    )

    messages = list(body.conversation_history) + [
        {"role": "user", "content": body.question}
    ]

    async def stream_gen():
        buffer = ""
        async for chunk in llm_service.stream_call(
            tool="knowledge-qa",
            system=system_prompt,
            messages=messages,
        ):
            buffer += chunk
            yield {"event": "delta", "data": json.dumps({"content": chunk})}

        yield {"event": "done", "data": json.dumps({
            "content": buffer,
            "role": "assistant",
        })}

    return EventSourceResponse(stream_gen())
```

### E.2 SSE 流式响应格式

```
event: delta
data: {"content": "让我"}

event: delta
data: {"content": "用一个"}

event: delta
data: {"content": "问题来引导"}

event: delta
data: {"content": "你的思考..."}

event: done
data: {"content": "让我用一个问题来引导你的思考...", "role": "assistant"}
```

### E.3 对话历史管理

对话历史由**前端管理**（存 localStorage 或组件 state），每次请求携带 `conversation_history`。

策略：
- 前端保留最近 20 轮对话
- 超过 20 轮时做滑动窗口裁剪
- 后端不持久化对话历史（无状态）
- 若未来需要持久化，可新增 `ChatMessage` 表

```python
# 未来扩展: 服务端对话持久化
class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("learning_sessions.id"), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False)  # "user" | "assistant" | "system"
    content: Mapped[str] = mapped_column(Text, nullable=False)
    tool_used: Mapped[str | None] = mapped_column(String(50), nullable=True)  # "socratic" | "knowledge-qa"
    metadata_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
```

---

## 附录：路由注册总览

```python
# app/main.py 中新增路由注册

from app.api.v1.tools import router as tools_router
from app.api.v1.learning import router as learning_router
from app.api.v1.chat import router as chat_router

app.include_router(tools_router, prefix=settings.api_v1_prefix)
app.include_router(learning_router, prefix=settings.api_v1_prefix)
app.include_router(chat_router, prefix=settings.api_v1_prefix)
```

### 完整 API 端点清单

| 方法 | 路由 | 功能 | 状态 |
|------|------|------|------|
| POST | `/api/v1/tools/concept-map` | 概念图谱 | 新增 |
| POST | `/api/v1/tools/exam-points` | 考点提取 | 新增 |
| POST | `/api/v1/tools/mistake-analysis` | 易错总结 | 新增 |
| POST | `/api/v1/tools/flashcard-generate` | 闪卡生成 | 新增 |
| POST | `/api/v1/tools/knowledge-qa` | 知识问答 | 新增 |
| POST | `/api/v1/tools/summary` | 一键总结 | 新增 |
| POST | `/api/v1/tools/reading-notes` | 精读笔记 | 新增 |
| POST | `/api/v1/tools/practice-quiz` | 模拟测验 | 新增 |
| POST | `/api/v1/learning/sessions` | 创建学习会话 | 新增 |
| GET | `/api/v1/learning/sessions/:id/stream` | 学习事件 SSE | 新增 |
| POST | `/api/v1/learning/sessions/:id/feedback` | 提交反馈 | 新增 |
| POST | `/api/v1/learning/sessions/:id/replan` | 请求重规划 | 新增 |
| POST | `/api/v1/chat/socratic` | 苏格拉底对话 SSE | 新增 |
| POST | `/api/v1/chat/knowledge-qa` | 知识问答 SSE | 新增 |
| POST | `/api/v1/disassembly/start` | 启动分析 | 已有 |
| GET | `/api/v1/disassembly/tasks/:id/status` | SSE 进度 | 已有 |
| GET | `/api/v1/disassembly/tasks/:id/result` | 分析结果 | 已有 |
| GET | `/api/v1/disassembly/tasks/:id/module/:mid` | 模块详情 | 已有 |

### 实施优先级

1. **P0（立即）**: tools.py 路由 + LLMService + ToolExecutor — 解除 8 个占位符工具
2. **P1（1周）**: chat.py 路由 — Socratic 对话从模板制升级为 LLM 驱动
3. **P2（2周）**: learning.py 路由 + 数据库模型 — 学习会话管理
4. **P3（3周）**: 流式推送改造 — pipeline_worker.py 增加 module_ready 事件
