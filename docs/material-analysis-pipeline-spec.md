# 智阶 — 材料分析工作台（3-Agent管道）完整开发规格

> 版本：v1.0 | 日期：2026-03-16
> 状态：Architecture Specification — 可直接编码

---

## 目录

1. [架构总览](#1-架构总览)
2. [后端API规格（FastAPI）](#2-后端api规格fastapi)
3. [3-Agent管道详细设计](#3-3-agent管道详细设计)
4. [PDF解析方案](#4-pdf解析方案)
5. [LLM调用与结构化输出](#5-llm调用与结构化输出)
6. [任务队列设计](#6-任务队列设计)
7. [数据库Schema](#7-数据库schema)
8. [文件存储](#8-文件存储)
9. [前端改造规格](#9-前端改造规格)
10. [错误处理与重试策略](#10-错误处理与重试策略)
11. [部署配置](#11-部署配置)
12. [环境变量清单](#12-环境变量清单)

---

## 1. 架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│  React Frontend (Vite + React 19)                               │
│  ┌─────────────┐  ┌─────────────────┐  ┌──────────────────────┐ │
│  │ AIToolPanel  │  │ MaterialReader  │  │ WorkbenchPage        │ │
│  │ (意图引导)   │──│ (PDF + Markdown)│──│ (70:30 布局)         │ │
│  └──────┬──────┘  └────────┬────────┘  └──────────────────────┘ │
│         │ SSE              │ REST                                │
└─────────┼──────────────────┼────────────────────────────────────┘
          │                  │
          ▼                  ▼
┌─────────────────────────────────────────────────────────────────┐
│  FastAPI Server (:8003)                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐ │
│  │ /materials/* │  │ /disassembly │  │ /disassembly/result/* │ │
│  │ (上传+元数据)│  │ (启动+SSE)   │  │ (结果获取)            │ │
│  └──────┬───────┘  └──────┬───────┘  └───────────────────────┘ │
│         │                 │                                      │
│         ▼                 ▼                                      │
│  ┌──────────────┐  ┌──────────────────────────────────────────┐ │
│  │ File Storage │  │ ARQ Worker (Redis-backed)                │ │
│  │ (local/MinIO)│  │  ┌─────────────┐ ┌──────────┐ ┌───────┐ │ │
│  └──────────────┘  │  │Cartographer │→│Specialist│→│Examiner│ │ │
│                    │  └─────────────┘ └──────────┘ └───────┘ │ │
│                    └──────────────────────────────────────────┘ │
│                                │                                 │
│                    ┌───────────┴───────────┐                     │
│                    │ Redis (pub/sub+queue) │                     │
│                    └───────────────────────┘                     │
│                    ┌───────────────────────┐                     │
│                    │ PostgreSQL            │                     │
│                    └───────────────────────┘                     │
└─────────────────────────────────────────────────────────────────┘
```

### 技术选型决策

| 组件 | 选型 | 理由 |
|------|------|------|
| PDF解析 | **pymupdf4llm** | 速度快（0.12s/page），Markdown输出质量高，保留标题层级和表格 |
| 任务队列 | **ARQ** (非Celery) | 原生async，与FastAPI无缝集成，Redis单后端足够，轻量 |
| 消息通道 | **Redis Pub/Sub** | Worker → API进度推送，低延迟 |
| LLM | **Claude Sonnet 4.6** | 通过Anthropic API调用，Structured Outputs保证JSON合规 |
| 结构化输出 | **Pydantic + Claude Structured Outputs** | 零解析错误，无需重试验证 |
| 文件存储 | **MinIO** (开发阶段local fallback) | S3兼容，本地开发零依赖切换 |
| 数据库 | **PostgreSQL 16** | 与ClawMatch复用运维经验 |

---

## 2. 后端API规格（FastAPI）

### 2.1 材料上传

```
POST /api/v1/materials/upload
Content-Type: multipart/form-data
```

**请求体**:

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| file | File | 是 | PDF文件（max 50MB）|
| course_id | string | 是 | 课程ID |
| type | enum | 是 | `lecture` / `exercise` / `exam` / `notes` |
| name | string | 否 | 材料名（不传则用文件名）|

**响应** `201 Created`:

```json
{
  "material_id": "mat_a1b2c3d4",
  "file_name": "discrete_math_ch7.pdf",
  "page_count": 42,
  "file_size_bytes": 3145728,
  "text_extracted": true,
  "text_page_count": 42,
  "created_at": "2026-03-16T10:30:00Z"
}
```

**错误响应**:

| 状态码 | 场景 |
|--------|------|
| 400 | 非PDF文件、超过50MB |
| 413 | 文件过大 |
| 422 | course_id无效 |
| 500 | 存储/解析失败 |

**实现逻辑**:
1. 验证文件类型（magic bytes `%PDF-`）和大小
2. 生成 `material_id`（`mat_` + nanoid(12)）
3. 保存原始PDF到文件存储
4. 用pymupdf4llm提取文本，按页存储
5. 写入materials表
6. 返回元数据

### 2.2 课件拆解启动

```
POST /api/v1/disassembly/start
Content-Type: application/json
```

**请求体**:

```json
{
  "material_id": "mat_a1b2c3d4",
  "intent": "learn",
  "user_id": "user_xyz",
  "config": {
    "exam_date": "2026-04-15",
    "current_level": "beginner",
    "time_budget_min": 120
  }
}
```

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| material_id | string | 是 | 材料ID |
| intent | enum | 是 | `learn` / `exam` / `review` |
| user_id | string | 是 | 用户ID |
| config | object | 否 | 额外配置 |
| config.exam_date | ISO date | 否 | 考试日期（intent=exam时推荐） |
| config.current_level | enum | 否 | `beginner` / `intermediate` / `advanced` |
| config.time_budget_min | number | 否 | 可用学习时间（分钟） |

**响应** `202 Accepted`:

```json
{
  "task_id": "task_e5f6g7h8",
  "status": "pending",
  "estimated_seconds": 120,
  "stream_url": "/api/v1/disassembly/status/task_e5f6g7h8/stream"
}
```

**实现逻辑**:
1. 验证material_id存在且text已提取
2. 生成 `task_id`（`task_` + nanoid(12)）
3. 创建disassembly_tasks记录（status=pending）
4. 将任务入队ARQ
5. 返回task_id和SSE流URL

### 2.3 进度SSE流

```
GET /api/v1/disassembly/status/{task_id}/stream
Accept: text/event-stream
```

**SSE事件格式**:

```
event: progress
data: {"phase":"cartographer","progress":25,"message":"正在识别知识模块...","current_module":null,"eta_seconds":90}

event: progress
data: {"phase":"cartographer","progress":100,"message":"拆解完成，发现6个模块","module_count":6,"eta_seconds":70}

event: progress
data: {"phase":"specialist","progress":35,"message":"正在精讲：图的基本概念","current_module":"mod_1","module_index":1,"module_total":6,"eta_seconds":45}

event: progress
data: {"phase":"examiner","progress":80,"message":"正在生成测验题...","eta_seconds":15}

event: complete
data: {"task_id":"task_e5f6g7h8","modules":[...],"total_time_seconds":95}

event: error
data: {"error":"LLM调用超时","code":"LLM_TIMEOUT","retryable":true}
```

**TypeScript SSE Event类型**:

```typescript
interface SSEProgressEvent {
  phase: 'cartographer' | 'specialist' | 'examiner'
  progress: number           // 0-100 (当前phase内)
  message: string
  current_module?: string    // 当前处理的模块名
  module_index?: number      // specialist阶段：第几个模块
  module_total?: number      // specialist阶段：总模块数
  eta_seconds?: number       // 预估剩余时间
}

interface SSECompleteEvent {
  task_id: string
  modules: DisassemblyModule[]
  total_time_seconds: number
}

interface SSEErrorEvent {
  error: string
  code: string
  retryable: boolean
}
```

**实现逻辑**:

```python
# FastAPI SSE endpoint
from sse_starlette.sse import EventSourceResponse

@router.get("/disassembly/status/{task_id}/stream")
async def stream_progress(task_id: str):
    async def event_generator():
        pubsub = redis.pubsub()
        await pubsub.subscribe(f"task:{task_id}:progress")
        try:
            # 先发送当前状态（支持断线重连）
            current = await get_task_status(task_id)
            yield {"event": "progress", "data": json.dumps(current)}

            async for message in pubsub.listen():
                if message["type"] == "message":
                    data = json.loads(message["data"])
                    event_type = data.pop("_event", "progress")
                    yield {"event": event_type, "data": json.dumps(data)}
                    if event_type in ("complete", "error"):
                        break
        finally:
            await pubsub.unsubscribe(f"task:{task_id}:progress")

    return EventSourceResponse(event_generator())
```

### 2.4 任务状态轮询（SSE备选）

```
GET /api/v1/disassembly/status/{task_id}
```

**响应**:

```json
{
  "task_id": "task_e5f6g7h8",
  "status": "processing",
  "phase": "specialist",
  "progress": 45,
  "message": "正在精讲：图的遍历算法",
  "started_at": "2026-03-16T10:30:15Z",
  "updated_at": "2026-03-16T10:31:02Z"
}
```

### 2.5 结果获取 — 完整任务

```
GET /api/v1/disassembly/result/{task_id}
```

**响应**:

```json
{
  "task_id": "task_e5f6g7h8",
  "material_id": "mat_a1b2c3d4",
  "status": "complete",
  "intent": "learn",
  "created_at": "2026-03-16T10:30:00Z",
  "completed_at": "2026-03-16T10:32:15Z",
  "duration_seconds": 95,
  "modules": [
    {
      "id": "mod_1",
      "name": "图的基本概念与分类",
      "pages": "1-8",
      "page_start": 1,
      "page_end": 8,
      "exam_weight": "high",
      "key_concepts": ["图的定义", "邻接矩阵", "邻接表", "有向图/无向图"],
      "prerequisites": [],
      "has_specialist": true,
      "has_quiz": true
    },
    {
      "id": "mod_2",
      "name": "图的遍历算法 (BFS/DFS)",
      "pages": "9-18",
      "page_start": 9,
      "page_end": 18,
      "exam_weight": "high",
      "key_concepts": ["BFS", "DFS", "时间戳", "拓扑排序"],
      "prerequisites": ["mod_1"],
      "has_specialist": true,
      "has_quiz": true
    }
  ]
}
```

### 2.6 结果获取 — 单模块精讲

```
GET /api/v1/disassembly/result/{task_id}/module/{module_id}
```

**响应**:

```json
{
  "module_id": "mod_1",
  "module_name": "图的基本概念与分类",
  "specialist_markdown": "## 图的基本概念与分类\n\n### 核心定义\n\n...",
  "quiz_data": [
    {
      "id": "q_1",
      "type": "mcq",
      "question": "一个有n个顶点的完全图$K_n$有多少条边？",
      "options": [
        {"id": "a", "text": "$n(n-1)$"},
        {"id": "b", "text": "$\\frac{n(n-1)}{2}$"},
        {"id": "c", "text": "$n^2$"},
        {"id": "d", "text": "$2n$"}
      ],
      "correct_answer": "b",
      "explanation": "完全图中每对顶点之间有一条边，共$\\binom{n}{2} = \\frac{n(n-1)}{2}$条。",
      "difficulty": "medium",
      "concept_tags": ["完全图", "组合计数"],
      "source_page": 3
    }
  ],
  "metadata": {
    "page_range": "1-8",
    "word_count": 1240,
    "concept_count": 4,
    "generated_at": "2026-03-16T10:31:30Z"
  }
}
```

### 2.7 闪卡生成（从分析结果）

```
POST /api/v1/disassembly/result/{task_id}/flashcards
Content-Type: application/json
```

**请求体**:

```json
{
  "module_ids": ["mod_1", "mod_2"],
  "card_types": ["basic", "cloze", "reverse"],
  "max_cards_per_module": 10
}
```

**响应** `200`:

```json
{
  "cards": [
    {
      "note_type": "basic",
      "front": "什么是图的邻接矩阵？其空间复杂度是多少？",
      "back": "邻接矩阵是一个$n \\times n$的矩阵$A$，其中$A[i][j]=1$表示顶点$i$和$j$之间有边。空间复杂度$O(n^2)$。",
      "tags": ["图论", "数据结构", "邻接矩阵"],
      "source_ref": {
        "material_id": "mat_a1b2c3d4",
        "module_id": "mod_1",
        "slide_page": 5
      }
    },
    {
      "note_type": "cloze",
      "front": "BFS的时间复杂度为{{c1::$O(V+E)$}}，使用的数据结构是{{c2::队列}}。",
      "back": "",
      "tags": ["图论", "BFS", "复杂度"],
      "source_ref": {
        "material_id": "mat_a1b2c3d4",
        "module_id": "mod_2",
        "slide_page": 12
      }
    }
  ],
  "total_generated": 15
}
```

---

## 3. 3-Agent管道详细设计

### 3.1 管道流程

```
Input: PDF extracted text (per-page) + intent + config
                │
                ▼
┌──────────────────────────────┐
│  Phase 1: Cartographer       │
│  输入: 全文 + 页码映射        │
│  输出: DisassemblyPlan       │
│  耗时: ~15-30s               │
│  Token: ~4K input, ~2K out   │
└──────────┬───────────────────┘
           │
           ▼
┌──────────────────────────────┐
│  Phase 2: Specialist         │
│  输入: 模块PDF文本 + 元数据   │  ← 按模块并行（最多3路）
│  输出: Markdown精讲           │
│  耗时: ~15-25s/模块           │
│  Token: ~3K input, ~3K out   │
└──────────┬───────────────────┘
           │
           ▼
┌──────────────────────────────┐
│  Phase 3: Examiner           │
│  输入: Specialist Markdown   │  ← 按模块并行
│  输出: QuizQuestion[]        │
│  耗时: ~10-15s/模块           │
│  Token: ~3K input, ~1.5K out │
└──────────┬───────────────────┘
           │
           ▼
Output: modules[] with specialist MD + quiz data
```

### 3.2 TypeScript Interface 定义（完整）

```typescript
/* ====== Shared Types (前后端共用) ====== */

// --- Cartographer Output ---

export interface DisassemblyPlan {
  material_id: string
  total_pages: number
  detected_language: 'zh' | 'en' | 'de' | 'mixed'
  modules: ModulePlan[]
  dependency_graph: DependencyEdge[]
}

export interface ModulePlan {
  id: string                    // "mod_1", "mod_2", ...
  name: string                  // 模块名称
  pages: string                 // "1-8" 页码范围（显示用）
  page_start: number
  page_end: number
  exam_weight: 'high' | 'medium' | 'low'
  key_concepts: string[]        // 核心概念列表
  prerequisites: string[]       // 依赖的模块ID列表
  estimated_difficulty: 'basic' | 'intermediate' | 'advanced'
  summary: string               // 一句话概述
}

export interface DependencyEdge {
  from: string                  // 模块ID
  to: string                    // 依赖的模块ID
  relation: 'prerequisite' | 'related' | 'extends'
}

// --- Specialist Output ---

export interface SpecialistResult {
  module_id: string
  module_name: string
  markdown: string              // 完整精讲Markdown
  word_count: number
  sections: SpecialistSection[]
  exam_traps: ExamTrap[]
  self_test_questions: string[]
}

export interface SpecialistSection {
  heading: string
  level: number                 // 2 or 3
  start_line: number
  concept_tags: string[]
}

export interface ExamTrap {
  description: string
  related_concept: string
  severity: 'critical' | 'common' | 'subtle'
}

// --- Examiner Output ---

export interface QuizQuestion {
  id: string
  type: 'mcq' | 'true_false' | 'fill_blank' | 'short_answer'
  question: string              // 支持LaTeX
  options?: QuizOption[]        // mcq类型
  correct_answer: string        // option id 或 文本
  explanation: string           // 解析
  difficulty: 'easy' | 'medium' | 'hard'
  concept_tags: string[]
  source_page: number           // 来源页码
  bloom_level: 'remember' | 'understand' | 'apply' | 'analyze'
}

export interface QuizOption {
  id: string                    // "a", "b", "c", "d"
  text: string                  // 支持LaTeX
}

// --- Task Status ---

export interface DisassemblyTask {
  task_id: string
  material_id: string
  user_id: string
  intent: 'learn' | 'exam' | 'review'
  status: 'pending' | 'processing' | 'complete' | 'partial' | 'failed'
  phase: 'cartographer' | 'specialist' | 'examiner' | null
  progress: number              // 0-100 overall
  error_message?: string
  config?: TaskConfig
  created_at: string
  started_at?: string
  completed_at?: string
}

export interface TaskConfig {
  exam_date?: string
  current_level?: 'beginner' | 'intermediate' | 'advanced'
  time_budget_min?: number
}

// --- Module with Results ---

export interface ModuleWithResults extends ModulePlan {
  has_specialist: boolean
  has_quiz: boolean
  specialist?: SpecialistResult
  quiz?: QuizQuestion[]
}
```

### 3.3 Cartographer Agent — LLM Prompt

```python
CARTOGRAPHER_SYSTEM = """You are Cartographer, an expert course material analyzer.
Your job: decompose a lecture PDF into structured learning modules.

RULES:
1. Each module covers ONE coherent topic (3-15 pages typically)
2. Identify exact page ranges from the extracted text
3. Assess exam_weight based on: depth of content, number of definitions/theorems, practice problems
4. Detect prerequisite relationships between modules
5. Output MUST be valid JSON matching the schema exactly
6. Module IDs use sequential format: mod_1, mod_2, mod_3, ...
7. key_concepts: extract 3-6 core concepts per module
8. Respond in the same language as the source material
"""

CARTOGRAPHER_USER = """Analyze this lecture material and decompose it into learning modules.

## Material Info
- Material ID: {material_id}
- Total Pages: {total_pages}
- Type: {material_type}
- Student Intent: {intent}

## Extracted Text (with page markers)

{extracted_text_with_page_markers}

---

Decompose into modules. For exam intent, assign higher exam_weight to
topics with many formulas, theorems, or explicit "exam-relevant" markers.
"""
```

**Cartographer Pydantic Schema (用于Structured Output)**:

```python
from pydantic import BaseModel, Field
from typing import Literal

class ModulePlanSchema(BaseModel):
    id: str = Field(description="Module ID, e.g. mod_1")
    name: str = Field(description="Module name in source language")
    page_start: int
    page_end: int
    exam_weight: Literal["high", "medium", "low"]
    key_concepts: list[str] = Field(min_length=2, max_length=8)
    prerequisites: list[str] = Field(default_factory=list)
    estimated_difficulty: Literal["basic", "intermediate", "advanced"]
    summary: str = Field(max_length=200)

class DependencyEdgeSchema(BaseModel):
    from_module: str = Field(alias="from")
    to_module: str = Field(alias="to")
    relation: Literal["prerequisite", "related", "extends"]

class DisassemblyPlanSchema(BaseModel):
    detected_language: Literal["zh", "en", "de", "mixed"]
    modules: list[ModulePlanSchema] = Field(min_length=1, max_length=20)
    dependency_graph: list[DependencyEdgeSchema] = Field(default_factory=list)
```

### 3.4 Specialist Agent — LLM Prompt

```python
SPECIALIST_SYSTEM = """You are Specialist, an expert lecturer creating detailed study notes.
Given a module's raw PDF text, produce comprehensive Markdown lecture notes.

OUTPUT STRUCTURE (strict):
## {Module Name}

### 核心定义/Core Definitions
- Formal definitions with LaTeX formulas

### 详细讲解/Detailed Explanation
- Step-by-step concept breakdown
- Visual aids described in text (tables, comparisons)
- Real-world examples and analogies

### 重要定理与证明/Key Theorems
- Theorem statements
- Proof sketches (if in source material)

### 考试陷阱/Exam Traps
> **考试陷阱**: {description}
- Common mistakes students make
- Edge cases to remember

### 自测题/Self-Test Questions
1. Conceptual question
2. Application question
3. Comparison/analysis question

RULES:
1. Use LaTeX for all mathematical notation: $inline$ and $$block$$
2. Use Markdown tables for comparisons
3. Include "考试陷阱" blockquotes (>)
4. Write in the SAME LANGUAGE as the source material
5. Do NOT hallucinate content not present in the source
6. Aim for 800-1500 words per module
7. For exam intent: emphasize formulas, edge cases, common mistakes
8. For learn intent: emphasize intuition, examples, step-by-step
"""

SPECIALIST_USER = """Create detailed lecture notes for this module.

## Context
- Module: {module_name} (pages {page_start}-{page_end})
- Course Material ID: {material_id}
- Exam Weight: {exam_weight}
- Student Intent: {intent}
- Key Concepts to Cover: {key_concepts}
- Prerequisites: {prerequisites}

## Raw Text for This Module

{module_text}
"""
```

### 3.5 Examiner Agent — LLM Prompt

```python
EXAMINER_SYSTEM = """You are Examiner, an expert test designer for university courses.
Given Specialist lecture notes, create a structured quiz (8-12 questions).

QUESTION DESIGN PRINCIPLES:
1. Cover ALL key concepts from the lecture notes
2. Mix difficulty: 30% easy, 50% medium, 20% hard
3. Mix Bloom's taxonomy: remember, understand, apply, analyze
4. MCQ options must have plausible distractors (not obviously wrong)
5. Each question must trace to a specific source page
6. Explanations should teach, not just state the answer
7. Use LaTeX for mathematical content
8. Write in the SAME LANGUAGE as the lecture notes

QUESTION TYPES:
- mcq: 4 options (a,b,c,d), exactly one correct
- true_false: statement + true/false
- fill_blank: sentence with one blank
- short_answer: open question with model answer
"""

EXAMINER_USER = """Generate a quiz for this module.

## Module: {module_name}
## Exam Weight: {exam_weight}
## Student Intent: {intent}

## Specialist Lecture Notes:

{specialist_markdown}

---

Generate 8-12 questions. For exam intent, focus on common exam patterns.
For learn intent, include more conceptual understanding questions.
"""
```

**Examiner Pydantic Schema**:

```python
class QuizOptionSchema(BaseModel):
    id: Literal["a", "b", "c", "d"]
    text: str

class QuizQuestionSchema(BaseModel):
    id: str
    type: Literal["mcq", "true_false", "fill_blank", "short_answer"]
    question: str
    options: list[QuizOptionSchema] | None = None
    correct_answer: str
    explanation: str
    difficulty: Literal["easy", "medium", "hard"]
    concept_tags: list[str] = Field(min_length=1, max_length=5)
    source_page: int
    bloom_level: Literal["remember", "understand", "apply", "analyze"]

class QuizSetSchema(BaseModel):
    questions: list[QuizQuestionSchema] = Field(min_length=6, max_length=15)
```

---

## 4. PDF解析方案

### 4.1 选型：pymupdf4llm

**决策理由**:

| 方案 | 速度 | Markdown质量 | 表格 | LaTeX | 中文 | 许可证 |
|------|------|-------------|------|-------|------|--------|
| **pymupdf4llm** | 0.12s/page | 优秀 | 好 | 保留 | 好 | AGPL/商业 |
| pdfplumber | 0.10s/page | 需配置 | 优秀 | 无 | 好 | MIT |
| marker-pdf | 较慢 | 优秀 | 好 | 好 | 好 | GPL |

pymupdf4llm胜出因为：
- 直接输出Markdown（标题、列表、表格保留），免后处理
- 速度最快档（0.12s/page）
- 42页PDF约5s完成提取
- LLM友好的输出格式减少token消耗

### 4.2 解析实现

```python
# services/pdf_parser.py

import pymupdf4llm
import pymupdf
from pathlib import Path

class PDFParser:
    """Extract text from PDF with page-level granularity."""

    @staticmethod
    async def extract(file_path: Path) -> PDFExtractionResult:
        """Extract PDF text as Markdown, with per-page mapping."""
        doc = pymupdf.open(str(file_path))
        page_count = len(doc)
        doc.close()

        # pymupdf4llm returns markdown with page breaks
        full_md = pymupdf4llm.to_markdown(
            str(file_path),
            page_chunks=True,  # 按页分块
        )

        pages: list[PageText] = []
        for i, chunk in enumerate(full_md):
            pages.append(PageText(
                page_number=i + 1,
                text=chunk["text"],
                word_count=len(chunk["text"].split()),
                has_images=bool(chunk.get("images")),
                has_tables=bool(chunk.get("tables")),
            ))

        # 合并全文（带页码标记，供Cartographer使用）
        full_text_with_markers = ""
        for p in pages:
            full_text_with_markers += f"\n\n--- PAGE {p.page_number} ---\n\n"
            full_text_with_markers += p.text

        return PDFExtractionResult(
            page_count=page_count,
            pages=pages,
            full_text_with_markers=full_text_with_markers,
            total_word_count=sum(p.word_count for p in pages),
        )

    @staticmethod
    def extract_page_range(file_path: Path, start: int, end: int) -> str:
        """Extract specific page range for Specialist agent."""
        chunks = pymupdf4llm.to_markdown(
            str(file_path),
            page_chunks=True,
            pages=list(range(start - 1, end)),  # 0-indexed
        )
        return "\n\n".join(c["text"] for c in chunks)


# Data classes
from pydantic import BaseModel

class PageText(BaseModel):
    page_number: int
    text: str
    word_count: int
    has_images: bool
    has_tables: bool

class PDFExtractionResult(BaseModel):
    page_count: int
    pages: list[PageText]
    full_text_with_markers: str
    total_word_count: int
```

### 4.3 文本后处理

```python
# services/text_processor.py

import re

class TextProcessor:
    """Clean and normalize extracted PDF text for LLM consumption."""

    @staticmethod
    def clean_for_llm(text: str) -> str:
        # 1. Remove excessive whitespace
        text = re.sub(r'\n{4,}', '\n\n\n', text)
        # 2. Fix broken LaTeX (common in PDF extraction)
        text = text.replace(r'\|', r'\vert')
        # 3. Normalize bullet points
        text = re.sub(r'^[•●■]\s*', '- ', text, flags=re.MULTILINE)
        # 4. Fix split words across lines (hyphentation)
        text = re.sub(r'(\w)-\n(\w)', r'\1\2', text)
        # 5. Collapse page headers/footers (repeating patterns)
        text = TextProcessor._remove_headers_footers(text)
        return text.strip()

    @staticmethod
    def _remove_headers_footers(text: str) -> str:
        """Detect and remove repeating header/footer patterns."""
        lines = text.split('\n')
        # Simple heuristic: lines appearing >3 times are likely headers/footers
        from collections import Counter
        line_counts = Counter(l.strip() for l in lines if l.strip())
        repeated = {l for l, c in line_counts.items() if c > 3 and len(l) < 100}
        return '\n'.join(l for l in lines if l.strip() not in repeated)

    @staticmethod
    def get_page_range_text(
        full_text: str,
        page_start: int,
        page_end: int,
    ) -> str:
        """Extract text between page markers."""
        pattern = rf'--- PAGE {page_start} ---\n\n(.*?)(?=--- PAGE {page_end + 1} ---|$)'
        # For multi-page range, grab everything from start to end
        start_marker = f"--- PAGE {page_start} ---"
        end_marker = f"--- PAGE {page_end + 1} ---"

        start_idx = full_text.find(start_marker)
        if start_idx == -1:
            return ""
        start_idx += len(start_marker)

        end_idx = full_text.find(end_marker)
        if end_idx == -1:
            end_idx = len(full_text)

        return full_text[start_idx:end_idx].strip()
```

---

## 5. LLM调用与结构化输出

### 5.1 Claude Structured Outputs 集成

```python
# services/llm_client.py

import anthropic
from pydantic import BaseModel
from typing import TypeVar, Type

T = TypeVar("T", bound=BaseModel)

class LLMClient:
    """Wrapper for Anthropic Claude API with Structured Outputs."""

    def __init__(self, api_key: str, model: str = "claude-sonnet-4-6-20260116"):
        self.client = anthropic.AsyncAnthropic(api_key=api_key)
        self.model = model

    async def structured_call(
        self,
        system: str,
        user: str,
        output_schema: Type[T],
        max_tokens: int = 4096,
        temperature: float = 0.3,
    ) -> T:
        """Call Claude with guaranteed structured output.

        Uses Anthropic Structured Outputs beta for zero-parse-error JSON.
        """
        response = await self.client.messages.create(
            model=self.model,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": user}],
            # Structured Output via tool_use pattern
            tools=[{
                "name": "output",
                "description": "Structured output",
                "input_schema": output_schema.model_json_schema(),
            }],
            tool_choice={"type": "tool", "name": "output"},
            extra_headers={"anthropic-beta": "structured-outputs-2025-11-13"},
        )

        # Extract tool use result
        for block in response.content:
            if block.type == "tool_use":
                return output_schema.model_validate(block.input)

        raise ValueError("No structured output in response")

    async def streaming_call(
        self,
        system: str,
        user: str,
        max_tokens: int = 4096,
    ) -> str:
        """Regular streaming call for Specialist Markdown (free-form text)."""
        result = ""
        async with self.client.messages.stream(
            model=self.model,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": user}],
        ) as stream:
            async for text in stream.text_stream:
                result += text
        return result
```

### 5.2 Agent调用策略

| Agent | 调用方式 | 理由 |
|-------|---------|------|
| Cartographer | `structured_call` + `DisassemblyPlanSchema` | 输出必须是结构化JSON，用于后续模块路由 |
| Specialist | `streaming_call` (纯Markdown) | 自由文本输出，无需JSON schema约束 |
| Examiner | `structured_call` + `QuizSetSchema` | 输出必须是结构化题目，前端需要解析 |

### 5.3 Token预算与成本估算

| Agent | 输入Token | 输出Token | 单次成本(Sonnet) | 并行度 |
|-------|----------|----------|-----------------|--------|
| Cartographer | ~4,000 | ~2,000 | ~$0.027 | 1 |
| Specialist (per module) | ~3,000 | ~3,000 | ~$0.033 | 最多3路并行 |
| Examiner (per module) | ~3,000 | ~1,500 | ~$0.024 | 最多3路并行 |

**典型6模块材料总成本**: ~$0.027 + 6×$0.033 + 6×$0.024 = **~$0.37**

---

## 6. 任务队列设计

### 6.1 选型：ARQ (非Celery)

**决策理由**:

| 维度 | Celery | ARQ | 本项目选择 |
|------|--------|-----|-----------|
| Async原生 | 否（需bridge） | 是 | ARQ |
| 依赖 | Redis/RabbitMQ + flower | 仅Redis | ARQ |
| FastAPI集成 | 额外配置 | 无缝 | ARQ |
| 任务监控 | Flower Web UI | Redis直查 | ARQ（够用） |
| 学习成本 | 高 | 低 | ARQ |
| 适用规模 | 大规模分布式 | 中小规模 | ARQ（当前阶段） |

智阶当前是单服务器部署，ARQ的轻量级和async原生是最佳匹配。未来如需水平扩展可迁移到Celery。

### 6.2 ARQ Worker 实现

```python
# worker/tasks.py

import asyncio
import json
from arq import create_pool
from arq.connections import RedisSettings

from services.llm_client import LLMClient
from services.pdf_parser import PDFParser
from services.text_processor import TextProcessor
from schemas.agents import DisassemblyPlanSchema, QuizSetSchema
from prompts.cartographer import CARTOGRAPHER_SYSTEM, CARTOGRAPHER_USER
from prompts.specialist import SPECIALIST_SYSTEM, SPECIALIST_USER
from prompts.examiner import EXAMINER_SYSTEM, EXAMINER_USER
from db.repository import TaskRepository, ModuleRepository


async def publish_progress(ctx, task_id: str, data: dict):
    """Publish progress event to Redis pub/sub for SSE streaming."""
    redis = ctx["redis"]
    await redis.publish(
        f"task:{task_id}:progress",
        json.dumps(data),
    )


async def run_disassembly_pipeline(ctx, task_id: str, material_id: str,
                                     intent: str, user_id: str, config: dict):
    """Main pipeline: Cartographer → Specialist → Examiner.

    Publishes progress via Redis pub/sub at each step.
    """
    repo = TaskRepository(ctx["db"])
    mod_repo = ModuleRepository(ctx["db"])
    llm = ctx["llm"]

    try:
        await repo.update_status(task_id, "processing", phase="cartographer")

        # ======= Phase 1: Cartographer =======
        await publish_progress(ctx, task_id, {
            "phase": "cartographer",
            "progress": 10,
            "message": "正在解析文档结构...",
        })

        material = await repo.get_material(material_id)
        extracted_text = material.extracted_text

        await publish_progress(ctx, task_id, {
            "phase": "cartographer",
            "progress": 30,
            "message": "正在识别知识模块...",
        })

        plan: DisassemblyPlanSchema = await llm.structured_call(
            system=CARTOGRAPHER_SYSTEM,
            user=CARTOGRAPHER_USER.format(
                material_id=material_id,
                total_pages=material.page_count,
                material_type=material.type,
                intent=intent,
                extracted_text_with_page_markers=extracted_text,
            ),
            output_schema=DisassemblyPlanSchema,
            max_tokens=4096,
        )

        # Save modules to DB
        modules = []
        for mod_plan in plan.modules:
            mod = await mod_repo.create_module(task_id, material_id, mod_plan)
            modules.append(mod)

        await publish_progress(ctx, task_id, {
            "phase": "cartographer",
            "progress": 100,
            "message": f"拆解完成，发现{len(modules)}个模块",
            "module_count": len(modules),
        })

        # ======= Phase 2: Specialist (parallel, max 3 concurrent) =======
        await repo.update_status(task_id, "processing", phase="specialist")
        semaphore = asyncio.Semaphore(3)

        async def process_specialist(mod, index: int):
            async with semaphore:
                await publish_progress(ctx, task_id, {
                    "phase": "specialist",
                    "progress": int((index / len(modules)) * 100),
                    "message": f"正在精讲：{mod.name}",
                    "current_module": mod.name,
                    "module_index": index + 1,
                    "module_total": len(modules),
                })

                module_text = TextProcessor.get_page_range_text(
                    extracted_text, mod.page_start, mod.page_end,
                )

                markdown = await llm.streaming_call(
                    system=SPECIALIST_SYSTEM,
                    user=SPECIALIST_USER.format(
                        module_name=mod.name,
                        page_start=mod.page_start,
                        page_end=mod.page_end,
                        material_id=material_id,
                        exam_weight=mod.exam_weight,
                        intent=intent,
                        key_concepts=", ".join(mod.key_concepts),
                        prerequisites=", ".join(mod.prerequisites) or "无",
                        module_text=module_text,
                    ),
                    max_tokens=4096,
                )

                await mod_repo.save_specialist_result(mod.id, markdown)
                return markdown

        specialist_results = await asyncio.gather(
            *(process_specialist(m, i) for i, m in enumerate(modules))
        )

        await publish_progress(ctx, task_id, {
            "phase": "specialist",
            "progress": 100,
            "message": "所有模块精讲完成",
        })

        # ======= Phase 3: Examiner (parallel, max 3 concurrent) =======
        await repo.update_status(task_id, "processing", phase="examiner")

        async def process_examiner(mod, specialist_md: str, index: int):
            async with semaphore:
                await publish_progress(ctx, task_id, {
                    "phase": "examiner",
                    "progress": int((index / len(modules)) * 100),
                    "message": f"正在生成测验：{mod.name}",
                    "current_module": mod.name,
                })

                quiz: QuizSetSchema = await llm.structured_call(
                    system=EXAMINER_SYSTEM,
                    user=EXAMINER_USER.format(
                        module_name=mod.name,
                        exam_weight=mod.exam_weight,
                        intent=intent,
                        specialist_markdown=specialist_md,
                    ),
                    output_schema=QuizSetSchema,
                    max_tokens=3000,
                )

                await mod_repo.save_quiz_result(mod.id, quiz.questions)

        await asyncio.gather(
            *(process_examiner(m, sr, i)
              for i, (m, sr) in enumerate(zip(modules, specialist_results)))
        )

        # ======= Complete =======
        await repo.update_status(task_id, "complete")

        # Build final module list for SSE complete event
        final_modules = await mod_repo.get_modules_for_task(task_id)
        await publish_progress(ctx, task_id, {
            "_event": "complete",
            "task_id": task_id,
            "modules": [m.model_dump() for m in final_modules],
            "total_time_seconds": await repo.get_duration(task_id),
        })

    except Exception as e:
        await repo.update_status(task_id, "failed", error=str(e))
        await publish_progress(ctx, task_id, {
            "_event": "error",
            "error": str(e),
            "code": type(e).__name__,
            "retryable": not isinstance(e, (ValueError, FileNotFoundError)),
        })
        raise


# ======= ARQ Worker Config =======

class WorkerSettings:
    functions = [run_disassembly_pipeline]
    redis_settings = RedisSettings(
        host="localhost", port=6383, database=0,
    )
    max_jobs = 5                    # Max concurrent pipeline tasks
    job_timeout = 600               # 10min max per pipeline
    keep_result = 3600              # Keep result 1 hour
    health_check_interval = 30
```

### 6.3 进度汇总计算

前端需要一个"总体进度"。汇总逻辑：

```
总进度 = cartographer_weight × cartographer_progress
       + specialist_weight × specialist_progress
       + examiner_weight × examiner_progress

其中：
  cartographer_weight = 0.20  (通常最快)
  specialist_weight   = 0.55  (最耗时)
  examiner_weight     = 0.25
```

---

## 7. 数据库Schema

### 7.1 PostgreSQL DDL

```sql
-- 材料表
CREATE TABLE materials (
    id          VARCHAR(16) PRIMARY KEY,          -- "mat_" + nanoid(12)
    course_id   VARCHAR(64) NOT NULL,
    name        VARCHAR(255) NOT NULL,
    type        VARCHAR(20) NOT NULL              -- lecture/exercise/exam/notes
                CHECK (type IN ('lecture','exercise','exam','notes')),
    file_name   VARCHAR(255) NOT NULL,
    file_path   VARCHAR(512) NOT NULL,            -- 存储路径
    file_size   BIGINT NOT NULL,
    page_count  INTEGER NOT NULL,
    -- 文本提取结果
    text_extracted  BOOLEAN DEFAULT FALSE,
    extracted_text  TEXT,                          -- 全文(带页码标记)
    text_page_count INTEGER,
    total_word_count INTEGER,
    -- 元数据
    uploaded_by VARCHAR(64),
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_materials_course ON materials(course_id);
CREATE INDEX idx_materials_type ON materials(type);

-- 分析任务表
CREATE TABLE disassembly_tasks (
    id          VARCHAR(20) PRIMARY KEY,          -- "task_" + nanoid(12)
    material_id VARCHAR(16) NOT NULL REFERENCES materials(id),
    user_id     VARCHAR(64) NOT NULL,
    intent      VARCHAR(10) NOT NULL
                CHECK (intent IN ('learn','exam','review')),
    status      VARCHAR(20) NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','processing','complete','partial','failed')),
    phase       VARCHAR(20),                      -- cartographer/specialist/examiner
    progress    SMALLINT DEFAULT 0,               -- 0-100
    error_message TEXT,
    -- Config
    config_json JSONB,                            -- TaskConfig
    -- Timing
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    started_at  TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);

CREATE INDEX idx_tasks_material ON disassembly_tasks(material_id);
CREATE INDEX idx_tasks_user ON disassembly_tasks(user_id);
CREATE INDEX idx_tasks_status ON disassembly_tasks(status);

-- 模块表
CREATE TABLE modules (
    id              VARCHAR(20) PRIMARY KEY,      -- "mod_" + sequential
    task_id         VARCHAR(20) NOT NULL REFERENCES disassembly_tasks(id),
    material_id     VARCHAR(16) NOT NULL REFERENCES materials(id),
    name            VARCHAR(255) NOT NULL,
    page_start      INTEGER NOT NULL,
    page_end        INTEGER NOT NULL,
    pages_display   VARCHAR(20),                  -- "1-8"
    exam_weight     VARCHAR(10) NOT NULL
                    CHECK (exam_weight IN ('high','medium','low')),
    key_concepts    JSONB DEFAULT '[]',           -- string[]
    prerequisites   JSONB DEFAULT '[]',           -- string[] (module IDs)
    estimated_difficulty VARCHAR(20),
    summary         TEXT,
    sort_order      SMALLINT DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_modules_task ON modules(task_id);

-- Specialist精讲结果
CREATE TABLE specialist_results (
    id          SERIAL PRIMARY KEY,
    module_id   VARCHAR(20) NOT NULL REFERENCES modules(id) UNIQUE,
    markdown    TEXT NOT NULL,
    word_count  INTEGER,
    sections    JSONB,                            -- SpecialistSection[]
    exam_traps  JSONB,                            -- ExamTrap[]
    generated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 测验题目
CREATE TABLE quiz_questions (
    id              VARCHAR(20) PRIMARY KEY,      -- "q_" + sequential
    module_id       VARCHAR(20) NOT NULL REFERENCES modules(id),
    type            VARCHAR(20) NOT NULL
                    CHECK (type IN ('mcq','true_false','fill_blank','short_answer')),
    question        TEXT NOT NULL,
    options         JSONB,                        -- QuizOption[] (for mcq)
    correct_answer  TEXT NOT NULL,
    explanation     TEXT NOT NULL,
    difficulty      VARCHAR(10) NOT NULL
                    CHECK (difficulty IN ('easy','medium','hard')),
    concept_tags    JSONB DEFAULT '[]',
    source_page     INTEGER,
    bloom_level     VARCHAR(20),
    sort_order      SMALLINT DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_quiz_module ON quiz_questions(module_id);

-- 依赖关系图
CREATE TABLE module_dependencies (
    id          SERIAL PRIMARY KEY,
    task_id     VARCHAR(20) NOT NULL REFERENCES disassembly_tasks(id),
    from_module VARCHAR(20) NOT NULL REFERENCES modules(id),
    to_module   VARCHAR(20) NOT NULL REFERENCES modules(id),
    relation    VARCHAR(20) NOT NULL
                CHECK (relation IN ('prerequisite','related','extends')),
    UNIQUE (from_module, to_module)
);
```

### 7.2 SQLAlchemy Models

```python
# db/models.py

from sqlalchemy import Column, String, Integer, BigInteger, Boolean, Text,
                       SmallInteger, ForeignKey, UniqueConstraint, CheckConstraint
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP
from sqlalchemy.orm import DeclarativeBase, relationship
from datetime import datetime, timezone


class Base(DeclarativeBase):
    pass


class Material(Base):
    __tablename__ = "materials"

    id = Column(String(16), primary_key=True)
    course_id = Column(String(64), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    type = Column(String(20), nullable=False)
    file_name = Column(String(255), nullable=False)
    file_path = Column(String(512), nullable=False)
    file_size = Column(BigInteger, nullable=False)
    page_count = Column(Integer, nullable=False)
    text_extracted = Column(Boolean, default=False)
    extracted_text = Column(Text)
    text_page_count = Column(Integer)
    total_word_count = Column(Integer)
    uploaded_by = Column(String(64))
    created_at = Column(TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc))

    tasks = relationship("DisassemblyTask", back_populates="material")


class DisassemblyTask(Base):
    __tablename__ = "disassembly_tasks"

    id = Column(String(20), primary_key=True)
    material_id = Column(String(16), ForeignKey("materials.id"), nullable=False)
    user_id = Column(String(64), nullable=False, index=True)
    intent = Column(String(10), nullable=False)
    status = Column(String(20), nullable=False, default="pending")
    phase = Column(String(20))
    progress = Column(SmallInteger, default=0)
    error_message = Column(Text)
    config_json = Column(JSONB)
    created_at = Column(TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc))
    started_at = Column(TIMESTAMP(timezone=True))
    completed_at = Column(TIMESTAMP(timezone=True))

    material = relationship("Material", back_populates="tasks")
    modules = relationship("Module", back_populates="task")


class Module(Base):
    __tablename__ = "modules"

    id = Column(String(20), primary_key=True)
    task_id = Column(String(20), ForeignKey("disassembly_tasks.id"), nullable=False)
    material_id = Column(String(16), ForeignKey("materials.id"), nullable=False)
    name = Column(String(255), nullable=False)
    page_start = Column(Integer, nullable=False)
    page_end = Column(Integer, nullable=False)
    pages_display = Column(String(20))
    exam_weight = Column(String(10), nullable=False)
    key_concepts = Column(JSONB, default=[])
    prerequisites = Column(JSONB, default=[])
    estimated_difficulty = Column(String(20))
    summary = Column(Text)
    sort_order = Column(SmallInteger, default=0)
    created_at = Column(TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc))

    task = relationship("DisassemblyTask", back_populates="modules")
    specialist = relationship("SpecialistResult", uselist=False, back_populates="module")
    quiz_questions = relationship("QuizQuestion", back_populates="module")


class SpecialistResult(Base):
    __tablename__ = "specialist_results"

    id = Column(Integer, primary_key=True, autoincrement=True)
    module_id = Column(String(20), ForeignKey("modules.id"), unique=True, nullable=False)
    markdown = Column(Text, nullable=False)
    word_count = Column(Integer)
    sections = Column(JSONB)
    exam_traps = Column(JSONB)
    generated_at = Column(TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc))

    module = relationship("Module", back_populates="specialist")


class QuizQuestion(Base):
    __tablename__ = "quiz_questions"

    id = Column(String(20), primary_key=True)
    module_id = Column(String(20), ForeignKey("modules.id"), nullable=False)
    type = Column(String(20), nullable=False)
    question = Column(Text, nullable=False)
    options = Column(JSONB)
    correct_answer = Column(Text, nullable=False)
    explanation = Column(Text, nullable=False)
    difficulty = Column(String(10), nullable=False)
    concept_tags = Column(JSONB, default=[])
    source_page = Column(Integer)
    bloom_level = Column(String(20))
    sort_order = Column(SmallInteger, default=0)
    created_at = Column(TIMESTAMP(timezone=True), default=lambda: datetime.now(timezone.utc))

    module = relationship("Module", back_populates="quiz_questions")
```

---

## 8. 文件存储

### 8.1 双模式存储（Local + MinIO）

```python
# services/storage.py

from abc import ABC, abstractmethod
from pathlib import Path
import shutil
import aioboto3

class StorageBackend(ABC):
    @abstractmethod
    async def upload(self, key: str, data: bytes, content_type: str) -> str: ...

    @abstractmethod
    async def download(self, key: str) -> bytes: ...

    @abstractmethod
    async def get_url(self, key: str, expires: int = 3600) -> str: ...

    @abstractmethod
    async def delete(self, key: str) -> None: ...


class LocalStorage(StorageBackend):
    """Local filesystem storage for development."""

    def __init__(self, base_dir: str = "./storage"):
        self.base = Path(base_dir)
        self.base.mkdir(parents=True, exist_ok=True)

    async def upload(self, key: str, data: bytes, content_type: str) -> str:
        path = self.base / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return str(path)

    async def download(self, key: str) -> bytes:
        return (self.base / key).read_bytes()

    async def get_url(self, key: str, expires: int = 3600) -> str:
        # For local dev, return file:// URL or serve via FastAPI static
        return f"/storage/{key}"

    async def delete(self, key: str) -> None:
        path = self.base / key
        if path.exists():
            path.unlink()


class MinIOStorage(StorageBackend):
    """MinIO/S3-compatible storage for production."""

    def __init__(self, endpoint: str, access_key: str, secret_key: str,
                 bucket: str = "zhijie-materials"):
        self.endpoint = endpoint
        self.access_key = access_key
        self.secret_key = secret_key
        self.bucket = bucket

    async def upload(self, key: str, data: bytes, content_type: str) -> str:
        session = aioboto3.Session()
        async with session.client(
            "s3",
            endpoint_url=self.endpoint,
            aws_access_key_id=self.access_key,
            aws_secret_access_key=self.secret_key,
        ) as s3:
            await s3.put_object(
                Bucket=self.bucket,
                Key=key,
                Body=data,
                ContentType=content_type,
            )
        return f"{self.endpoint}/{self.bucket}/{key}"

    async def download(self, key: str) -> bytes:
        session = aioboto3.Session()
        async with session.client(
            "s3",
            endpoint_url=self.endpoint,
            aws_access_key_id=self.access_key,
            aws_secret_access_key=self.secret_key,
        ) as s3:
            resp = await s3.get_object(Bucket=self.bucket, Key=key)
            return await resp["Body"].read()

    async def get_url(self, key: str, expires: int = 3600) -> str:
        session = aioboto3.Session()
        async with session.client(
            "s3",
            endpoint_url=self.endpoint,
            aws_access_key_id=self.access_key,
            aws_secret_access_key=self.secret_key,
        ) as s3:
            return await s3.generate_presigned_url(
                "get_object",
                Params={"Bucket": self.bucket, "Key": key},
                ExpiresIn=expires,
            )

    async def delete(self, key: str) -> None:
        session = aioboto3.Session()
        async with session.client(
            "s3",
            endpoint_url=self.endpoint,
            aws_access_key_id=self.access_key,
            aws_secret_access_key=self.secret_key,
        ) as s3:
            await s3.delete_object(Bucket=self.bucket, Key=key)


def create_storage(config) -> StorageBackend:
    """Factory: create storage backend based on config."""
    if config.STORAGE_BACKEND == "minio":
        return MinIOStorage(
            endpoint=config.MINIO_ENDPOINT,
            access_key=config.MINIO_ACCESS_KEY,
            secret_key=config.MINIO_SECRET_KEY,
            bucket=config.MINIO_BUCKET,
        )
    return LocalStorage(base_dir=config.LOCAL_STORAGE_DIR)
```

### 8.2 存储键规范

```
materials/
  {course_id}/
    {material_id}/
      original.pdf                    # 原始PDF
      extracted/
        full_text.md                  # 全文Markdown（带页码标记）
        pages/
          page_001.md                 # 逐页文本
          page_002.md
          ...
      results/
        {task_id}/
          plan.json                   # Cartographer输出
          specialist/
            mod_1.md                  # Specialist精讲
            mod_2.md
          quiz/
            mod_1.json                # Examiner测验
            mod_2.json
```

### 8.3 缓存策略

| 数据 | 缓存位置 | TTL | 理由 |
|------|---------|-----|------|
| PDF提取文本 | PostgreSQL + 文件存储 | 永久 | 同一PDF不需要重复提取 |
| Cartographer输出 | PostgreSQL | 永久 | 同material+intent可复用 |
| Specialist Markdown | PostgreSQL + Redis | Redis 24h | 热数据走Redis，冷数据走DB |
| Quiz数据 | PostgreSQL | 永久 | 结构化数据，查询频繁 |
| SSE进度 | Redis Pub/Sub | 实时 | 任务完成后自动清理 |

---

## 9. 前端改造规格

### 9.1 api.ts 改造

**文件**: `src/lib/api.ts`

**改造策略**: 保留USE_MOCK开关，新增所有真实API调用。

```typescript
// src/lib/api.ts — 改造后

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8003/api/v1'
const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false'

/* ====================== Types (更新) ====================== */

export interface DisassemblyModule {
  id: string
  name: string
  pages: string
  page_start: number
  page_end: number
  exam_weight: 'high' | 'medium' | 'low'
  key_concepts: string[]
  prerequisites: string[]
  has_specialist: boolean
  has_quiz: boolean
}

export interface DisassemblyTask {
  taskId: string
  status: 'pending' | 'processing' | 'complete' | 'partial' | 'failed'
  phase: 'cartographer' | 'specialist' | 'examiner' | null
  progress: number
  modules?: DisassemblyModule[]
  currentStep?: string
}

export interface ProgressEvent {
  phase: 'cartographer' | 'specialist' | 'examiner'
  progress: number
  status: DisassemblyTask['status']
  currentStep?: string
  modules?: DisassemblyModule[]
  moduleIndex?: number
  moduleTotal?: number
  etaSeconds?: number
}

export interface SpecialistResult {
  moduleId: string
  moduleName: string
  markdown: string
  wordCount: number
  examTraps: Array<{
    description: string
    relatedConcept: string
    severity: 'critical' | 'common' | 'subtle'
  }>
}

export interface QuizQuestion {
  id: string
  type: 'mcq' | 'true_false' | 'fill_blank' | 'short_answer'
  question: string
  options?: Array<{ id: string; text: string }>
  correctAnswer: string
  explanation: string
  difficulty: 'easy' | 'medium' | 'hard'
  conceptTags: string[]
  sourcePage: number
  bloomLevel: 'remember' | 'understand' | 'apply' | 'analyze'
}

export interface MaterialUploadResult {
  materialId: string
  fileName: string
  pageCount: number
  fileSizeBytes: number
  textExtracted: boolean
}

/* ====================== Upload ====================== */

export async function uploadMaterial(
  file: File,
  courseId: string,
  type: 'lecture' | 'exercise' | 'exam' | 'notes',
  name?: string,
): Promise<MaterialUploadResult> {
  if (USE_MOCK) {
    await new Promise(r => setTimeout(r, 1500))
    return {
      materialId: `mat_mock_${Date.now()}`,
      fileName: file.name,
      pageCount: 42,
      fileSizeBytes: file.size,
      textExtracted: true,
    }
  }

  const form = new FormData()
  form.append('file', file)
  form.append('course_id', courseId)
  form.append('type', type)
  if (name) form.append('name', name)

  const res = await fetch(`${API_BASE}/materials/upload`, {
    method: 'POST',
    body: form,
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Upload failed: ${res.status}`)
  }

  const data = await res.json()
  return {
    materialId: data.material_id,
    fileName: data.file_name,
    pageCount: data.page_count,
    fileSizeBytes: data.file_size_bytes,
    textExtracted: data.text_extracted,
  }
}

/* ====================== Disassembly ====================== */

export async function startDisassembly(
  materialId: string,
  intent: 'learn' | 'exam' | 'review',
  config?: {
    examDate?: string
    currentLevel?: 'beginner' | 'intermediate' | 'advanced'
    timeBudgetMin?: number
  },
): Promise<{ taskId: string; streamUrl: string }> {
  if (USE_MOCK) {
    const taskId = `mock-task-${Date.now()}`
    return { taskId, streamUrl: '' }
  }

  const res = await fetch(`${API_BASE}/disassembly/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      material_id: materialId,
      intent,
      user_id: 'current_user', // TODO: from auth context
      config: config ? {
        exam_date: config.examDate,
        current_level: config.currentLevel,
        time_budget_min: config.timeBudgetMin,
      } : undefined,
    }),
  })

  if (!res.ok) throw new Error(`Disassembly start failed: ${res.status}`)
  const data = await res.json()
  return { taskId: data.task_id, streamUrl: data.stream_url }
}

/* ====================== SSE Progress ====================== */

const PHASE_WEIGHTS = { cartographer: 0.20, specialist: 0.55, examiner: 0.25 }

function computeOverallProgress(
  phase: 'cartographer' | 'specialist' | 'examiner',
  phaseProgress: number,
): number {
  const weights = PHASE_WEIGHTS
  let overall = 0

  if (phase === 'specialist') {
    overall = weights.cartographer * 100 + weights.specialist * phaseProgress
  } else if (phase === 'examiner') {
    overall = (weights.cartographer + weights.specialist) * 100 + weights.examiner * phaseProgress
  } else {
    overall = weights.cartographer * phaseProgress
  }

  return Math.min(Math.round(overall), 100)
}

export function subscribeProgress(
  taskId: string,
  onProgress: (event: ProgressEvent) => void,
): () => void {
  if (USE_MOCK) {
    return subscribeMockProgress(taskId, onProgress)
  }

  const evtSource = new EventSource(
    `${API_BASE}/disassembly/status/${taskId}/stream`,
  )

  evtSource.addEventListener('progress', (e: MessageEvent) => {
    try {
      const raw = JSON.parse(e.data)
      onProgress({
        phase: raw.phase,
        progress: computeOverallProgress(raw.phase, raw.progress),
        status: 'processing',
        currentStep: raw.message,
        moduleIndex: raw.module_index,
        moduleTotal: raw.module_total,
        etaSeconds: raw.eta_seconds,
      })
    } catch { /* ignore */ }
  })

  evtSource.addEventListener('complete', (e: MessageEvent) => {
    try {
      const raw = JSON.parse(e.data)
      const modules: DisassemblyModule[] = raw.modules.map((m: any) => ({
        id: m.id,
        name: m.name,
        pages: m.pages_display || `${m.page_start}-${m.page_end}`,
        page_start: m.page_start,
        page_end: m.page_end,
        exam_weight: m.exam_weight,
        key_concepts: m.key_concepts || [],
        prerequisites: m.prerequisites || [],
        has_specialist: m.has_specialist ?? true,
        has_quiz: m.has_quiz ?? true,
      }))
      onProgress({
        phase: 'examiner',
        progress: 100,
        status: 'completed',
        currentStep: '分析完成',
        modules,
      })
    } catch { /* ignore */ }
    evtSource.close()
  })

  evtSource.addEventListener('error', (e: MessageEvent) => {
    try {
      const raw = JSON.parse(e.data)
      onProgress({
        phase: 'cartographer',
        progress: 0,
        status: 'error',
        currentStep: raw.error || '分析过程中出现错误',
      })
    } catch {
      onProgress({
        phase: 'cartographer',
        progress: 0,
        status: 'error',
        currentStep: '连接中断',
      })
    }
    evtSource.close()
  })

  // Native error (connection lost)
  evtSource.onerror = () => {
    if (evtSource.readyState === EventSource.CLOSED) return
    onProgress({
      phase: 'cartographer',
      progress: 0,
      status: 'error',
      currentStep: '网络连接中断，请重试',
    })
    evtSource.close()
  }

  return () => evtSource.close()
}

/* ====================== Results ====================== */

export async function getSpecialistResult(
  taskId: string,
  moduleId: string,
): Promise<SpecialistResult> {
  if (USE_MOCK) {
    // ... (keep existing mock, same as current)
  }

  const res = await fetch(
    `${API_BASE}/disassembly/result/${taskId}/module/${moduleId}`,
  )
  if (!res.ok) throw new Error(`Specialist result failed: ${res.status}`)

  const data = await res.json()
  return {
    moduleId: data.module_id,
    moduleName: data.module_name,
    markdown: data.specialist_markdown,
    wordCount: data.metadata?.word_count ?? 0,
    examTraps: data.exam_traps ?? [],
  }
}

export async function getQuizQuestions(
  taskId: string,
  moduleId: string,
): Promise<QuizQuestion[]> {
  if (USE_MOCK) {
    await new Promise(r => setTimeout(r, 400))
    return [] // TODO: mock quiz data
  }

  const res = await fetch(
    `${API_BASE}/disassembly/result/${taskId}/module/${moduleId}`,
  )
  if (!res.ok) throw new Error(`Quiz result failed: ${res.status}`)

  const data = await res.json()
  return (data.quiz_data ?? []).map((q: any) => ({
    id: q.id,
    type: q.type,
    question: q.question,
    options: q.options,
    correctAnswer: q.correct_answer,
    explanation: q.explanation,
    difficulty: q.difficulty,
    conceptTags: q.concept_tags,
    sourcePage: q.source_page,
    bloomLevel: q.bloom_level,
  }))
}
```

### 9.2 ProcessingView 改造 — 三阶段进度

当前 `ProcessingView` 只显示单一进度条。改造为三阶段视觉显示：

```typescript
// src/components/workbench/ProcessingView.tsx — 改造要点

interface ProcessingViewProps {
  progress: number           // 0-100 总体
  step: string
  phase?: 'cartographer' | 'specialist' | 'examiner'
  moduleIndex?: number       // specialist阶段当前模块序号
  moduleTotal?: number       // specialist阶段模块总数
  etaSeconds?: number
}

// UI改造：
// 1. 顶部三段式phase indicator（拆解 → 精讲 → 出题）
//    当前phase高亮红色，已完成phase打勾，未完成phase灰色
// 2. 中间进度条保持不变
// 3. step文字下方新增ETA显示（"预计剩余约X分钟"）
// 4. specialist阶段显示 "正在精讲 (2/6)" 子进度
```

三段式phase indicator UI设计：

```
   ┌────────────────────────────────────────┐
   │  ① 拆解结构  ──→  ② 生成精讲  ──→  ③ 出题  │
   │  ✓ 完成         ● 进行中(3/6)    ○ 等待    │
   └────────────────────────────────────────┘
```

### 9.3 测验渲染组件（新增）

```typescript
// src/components/workbench/QuizRenderer.tsx

interface QuizRendererProps {
  questions: QuizQuestion[]
  moduleId: string
  moduleName: string
  onComplete: (results: QuizResult[]) => void
}

interface QuizResult {
  questionId: string
  selectedAnswer: string
  correct: boolean
  timeMs: number
}

// UI要点：
// - 一次显示一题（非列表）
// - 底部 "上一题 / 下一题" 导航
// - 选中选项后立即显示对错 + 解析
// - 完成后显示总分 + 每题复盘
// - 测验结果回流到 student-model（BKT更新mastery）
// - editorial设计：题目用衬线字体，选项用无衬线，解析带红色引用线

// 关键交互：
// 1. 用户点击选项 → 选项高亮
// 2. 点击"确认" → 显示正确答案 + 解析
// 3. 正确：绿色边框 + ✓
// 4. 错误：红色边框 + ✗，正确答案绿色高亮
// 5. 底部解析区域带 border-l-3 border-l-red-primary
```

### 9.4 环境变量

```bash
# .env.development
VITE_API_BASE=http://localhost:8003/api/v1
VITE_USE_MOCK=true              # 开发时用mock

# .env.production
VITE_API_BASE=https://api.zhijie.app/api/v1
VITE_USE_MOCK=false

# .env.staging
VITE_API_BASE=http://staging.zhijie.app:8003/api/v1
VITE_USE_MOCK=false
```

### 9.5 错误状态与重试UI

在 `ErrorPhase` 组件中增加：

```typescript
// 改造 ModuleDisplay.tsx 的 ErrorPhase

interface ErrorPhaseProps {
  message: string
  code?: string              // 新增：错误码
  retryable?: boolean        // 新增：是否可重试
  onRetry: () => void
}

// UI设计：
// - 区分可重试错误（网络超时、LLM限流）和不可重试错误（文件损坏、无文本）
// - 可重试：显示"重新分析"按钮 + 自动重试倒计时（30s）
// - 不可重试：显示错误说明 + "返回"按钮
// - 错误图标：lucide-react 的 AlertTriangle
// - 颜色：amber-500 警告色（非红色，避免与品牌色混淆）
```

---

## 10. 错误处理与重试策略

### 10.1 错误分类

| 错误类型 | 错误码 | 可重试 | 策略 |
|---------|--------|--------|------|
| LLM API超时 | `LLM_TIMEOUT` | 是 | 指数退避，最多3次 |
| LLM限流(429) | `LLM_RATE_LIMIT` | 是 | 等待Retry-After头 |
| LLM输出不合规 | `LLM_INVALID_OUTPUT` | 是 | 重试1次（不太可能连续） |
| PDF无文本(扫描件) | `PDF_NO_TEXT` | 否 | 提示用户上传文字版 |
| PDF损坏 | `PDF_CORRUPT` | 否 | 提示重新上传 |
| 文件过大 | `FILE_TOO_LARGE` | 否 | 提示压缩或拆分 |
| 数据库错误 | `DB_ERROR` | 是 | 退避重试 |
| Redis连接断 | `REDIS_ERROR` | 是 | 自动重连 |

### 10.2 重试实现

```python
# services/retry.py

import asyncio
from typing import TypeVar, Callable, Awaitable
import logging

T = TypeVar("T")
logger = logging.getLogger(__name__)


async def with_retry(
    fn: Callable[..., Awaitable[T]],
    *args,
    max_retries: int = 3,
    base_delay: float = 2.0,
    max_delay: float = 30.0,
    retryable_exceptions: tuple = (TimeoutError, ConnectionError),
    **kwargs,
) -> T:
    """Execute async function with exponential backoff retry."""
    last_exception = None

    for attempt in range(max_retries + 1):
        try:
            return await fn(*args, **kwargs)
        except retryable_exceptions as e:
            last_exception = e
            if attempt == max_retries:
                break
            delay = min(base_delay * (2 ** attempt), max_delay)
            logger.warning(
                f"Attempt {attempt + 1}/{max_retries + 1} failed: {e}. "
                f"Retrying in {delay:.1f}s..."
            )
            await asyncio.sleep(delay)

    raise last_exception  # type: ignore


# LLM-specific retry wrapper
async def llm_call_with_retry(llm_client, method: str, **kwargs):
    """Retry LLM calls with rate-limit awareness."""
    import anthropic

    async def _call():
        try:
            fn = getattr(llm_client, method)
            return await fn(**kwargs)
        except anthropic.RateLimitError as e:
            retry_after = float(e.response.headers.get("retry-after", 5))
            logger.warning(f"Rate limited, waiting {retry_after}s")
            await asyncio.sleep(retry_after)
            raise
        except anthropic.APITimeoutError:
            raise TimeoutError("LLM API timeout")

    return await with_retry(
        _call,
        max_retries=3,
        base_delay=3.0,
        retryable_exceptions=(TimeoutError, anthropic.RateLimitError),
    )
```

### 10.3 部分完成处理

如果Specialist在第4/6个模块失败：
1. 保存已完成的3个模块结果
2. 任务状态设为 `partial`
3. SSE推送 `partial_complete` 事件
4. 前端显示已完成模块 + 失败模块的重试按钮
5. 新增重试单模块API：`POST /api/v1/disassembly/result/{task_id}/module/{module_id}/retry`

---

## 11. 部署配置

### 11.1 Docker Compose

```yaml
# docker-compose.yml

version: "3.8"

services:
  # === API Server ===
  api:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "8003:8003"
    environment:
      - DATABASE_URL=postgresql+asyncpg://zhijie:zhijie_pass@db:5432/zhijie
      - REDIS_URL=redis://redis:6379/0
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - STORAGE_BACKEND=local
      - LOCAL_STORAGE_DIR=/data/storage
      - LOG_LEVEL=info
    volumes:
      - storage_data:/data/storage
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8003/health"]
      interval: 10s
      timeout: 5s
      retries: 3

  # === ARQ Worker ===
  worker:
    build:
      context: .
      dockerfile: Dockerfile
    command: arq worker.tasks.WorkerSettings
    environment:
      - DATABASE_URL=postgresql+asyncpg://zhijie:zhijie_pass@db:5432/zhijie
      - REDIS_URL=redis://redis:6379/0
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - STORAGE_BACKEND=local
      - LOCAL_STORAGE_DIR=/data/storage
      - LOG_LEVEL=info
    volumes:
      - storage_data:/data/storage
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    deploy:
      replicas: 2                    # 2 workers for parallel pipelines

  # === PostgreSQL ===
  db:
    image: postgres:16-alpine
    ports:
      - "5436:5432"                  # 避免与其他项目冲突
    environment:
      - POSTGRES_USER=zhijie
      - POSTGRES_PASSWORD=zhijie_pass
      - POSTGRES_DB=zhijie
    volumes:
      - pg_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U zhijie"]
      interval: 5s
      timeout: 3s
      retries: 5

  # === Redis ===
  redis:
    image: redis:7-alpine
    ports:
      - "6383:6379"                  # 避免与其他项目冲突
    command: redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy allkeys-lru
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

  # === MinIO (可选，生产用) ===
  minio:
    image: minio/minio:latest
    ports:
      - "9000:9000"                  # API
      - "9001:9001"                  # Console
    environment:
      - MINIO_ROOT_USER=zhijie_minio
      - MINIO_ROOT_PASSWORD=zhijie_minio_secret
    command: server /data --console-address ":9001"
    volumes:
      - minio_data:/data
    profiles:
      - production                   # 仅生产环境启动

volumes:
  pg_data:
  redis_data:
  storage_data:
  minio_data:
```

### 11.2 Dockerfile

```dockerfile
FROM python:3.12-slim

WORKDIR /app

# System deps for pymupdf
RUN apt-get update && apt-get install -y --no-install-recommends \
    libmupdf-dev curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8003
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8003", "--workers", "2"]
```

### 11.3 requirements.txt

```
# Web framework
fastapi==0.115.*
uvicorn[standard]==0.34.*
sse-starlette==2.2.*

# Database
sqlalchemy[asyncio]==2.0.*
asyncpg==0.30.*
alembic==1.14.*

# Redis + Task queue
redis[hiredis]==5.2.*
arq==0.26.*

# LLM
anthropic==0.43.*

# PDF parsing
pymupdf4llm==0.0.17
pymupdf==1.25.*

# Storage
aioboto3==13.*
python-multipart==0.0.18

# Utilities
pydantic==2.10.*
pydantic-settings==2.7.*
nanoid==2.0.*
python-dotenv==1.0.*

# Dev
httpx==0.28.*  # for testing
pytest-asyncio==0.25.*
```

### 11.4 端口分配（更新隔离矩阵）

| 项目 | App Port | DB Port | Redis Port |
|------|----------|---------|------------|
| ClawMatch | 8000 | 5433 | 6380 |
| Claw Coworker | 8001 | 5434 | 6381 |
| AgentFax | 8002 | 5435 | 6382 |
| **智阶后端** | **8003** | **5436** | **6383** |
| Bot_Matcher | 18800 | -- | -- |
| nanobot | 18790 | -- | -- |

---

## 12. 环境变量清单

```bash
# === 必需 ===
ANTHROPIC_API_KEY=sk-ant-...          # Claude API密钥
DATABASE_URL=postgresql+asyncpg://zhijie:zhijie_pass@localhost:5436/zhijie
REDIS_URL=redis://localhost:6383/0

# === 存储 ===
STORAGE_BACKEND=local                  # "local" or "minio"
LOCAL_STORAGE_DIR=./storage            # local模式的存储目录

# MinIO (仅STORAGE_BACKEND=minio时需要)
MINIO_ENDPOINT=http://localhost:9000
MINIO_ACCESS_KEY=zhijie_minio
MINIO_SECRET_KEY=zhijie_minio_secret
MINIO_BUCKET=zhijie-materials

# === 应用 ===
APP_ENV=development                    # development/staging/production
LOG_LEVEL=info                         # debug/info/warning/error
CORS_ORIGINS=http://localhost:5173     # 前端地址（逗号分隔多个）

# === LLM ===
LLM_MODEL=claude-sonnet-4-6-20260116  # 默认模型
LLM_MAX_RETRIES=3                      # LLM调用最大重试次数
LLM_TIMEOUT=120                        # LLM调用超时(秒)

# === Worker ===
ARQ_MAX_JOBS=5                         # Worker最大并发任务数
ARQ_JOB_TIMEOUT=600                    # 单任务超时(秒)
SPECIALIST_CONCURRENCY=3               # Specialist并行处理模块数

# === 上传限制 ===
MAX_UPLOAD_SIZE_MB=50                  # PDF最大上传大小
MAX_PAGES=200                          # PDF最大页数

# === 前端 (Vite) ===
VITE_API_BASE=http://localhost:8003/api/v1
VITE_USE_MOCK=true                     # true=mock模式, false=真实API
```

---

## 附录A：后端项目文件结构

```
zhijie-backend/
├── main.py                          # FastAPI app入口
├── config.py                        # Pydantic Settings配置
├── requirements.txt
├── Dockerfile
├── docker-compose.yml
├── alembic.ini
├── alembic/                         # 数据库迁移
│   └── versions/
├── routers/
│   ├── materials.py                 # POST /materials/upload
│   ├── disassembly.py               # POST /disassembly/start, GET /status, GET /result
│   └── health.py                    # GET /health
├── schemas/
│   ├── materials.py                 # 请求/响应Pydantic models
│   ├── disassembly.py
│   └── agents.py                    # Cartographer/Specialist/Examiner的Pydantic schemas
├── db/
│   ├── models.py                    # SQLAlchemy models
│   ├── session.py                   # async session factory
│   └── repository.py               # CRUD operations
├── services/
│   ├── pdf_parser.py                # pymupdf4llm封装
│   ├── text_processor.py            # 文本清理
│   ├── llm_client.py                # Anthropic SDK封装
│   ├── storage.py                   # Local/MinIO双模式
│   └── retry.py                     # 重试逻辑
├── worker/
│   ├── tasks.py                     # ARQ任务定义
│   └── startup.py                   # Worker启动配置
├── prompts/
│   ├── cartographer.py              # Cartographer prompt模板
│   ├── specialist.py                # Specialist prompt模板
│   └── examiner.py                  # Examiner prompt模板
├── tests/
│   ├── test_pdf_parser.py
│   ├── test_pipeline.py
│   ├── test_api_materials.py
│   └── test_api_disassembly.py
└── storage/                         # 本地存储目录(gitignore)
```

---

## 附录B：前端改造文件清单

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `src/lib/api.ts` | 重写 | Mock保留 + 真实API调用 + SSE事件监听改造 |
| `src/components/workbench/AIToolPanel.tsx` | 修改 | 传递phase/moduleIndex到ProcessingView |
| `src/components/workbench/ProcessingView.tsx` | 重写 | 三阶段进度indicator + ETA + 模块子进度 |
| `src/components/workbench/ModuleDisplay.tsx` | 修改 | ErrorPhase增加错误码+可重试判断 |
| `src/components/workbench/QuizRenderer.tsx` | **新增** | 测验渲染组件（单题模式+解析） |
| `src/components/workbench/QuizResultSummary.tsx` | **新增** | 测验完成总结 + BKT回流 |
| `.env.development` | **新增** | 开发环境变量 |
| `.env.production` | **新增** | 生产环境变量 |

---

## 附录C：实施顺序建议

```
Week 1: 基础设施
  ├── Day 1-2: 后端项目骨架 + Docker Compose + DB迁移
  ├── Day 3: PDF解析服务 + 材料上传API
  └── Day 4-5: ARQ Worker框架 + Redis pub/sub + SSE端点

Week 2: 3-Agent管道
  ├── Day 1-2: Cartographer Agent + Structured Output
  ├── Day 3-4: Specialist Agent + Streaming
  └── Day 5: Examiner Agent + Structured Output

Week 3: 前后端联调
  ├── Day 1-2: 前端api.ts改造 + SSE进度
  ├── Day 3: ProcessingView三阶段 + 模块列表
  ├── Day 4: QuizRenderer组件
  └── Day 5: 端到端测试 + 错误处理

Week 4: 优化与加固
  ├── Day 1-2: 重试策略 + 部分完成处理
  ├── Day 3: 闪卡生成API
  └── Day 4-5: 性能优化 + 负载测试
```

---

Sources:
- [Best Python PDF to Text Parser Libraries: A 2026 Evaluation](https://unstract.com/blog/evaluating-python-pdf-to-text-libraries/)
- [I Tested 7 Python PDF Extractors (2025 Edition)](https://dev.to/onlyoneaman/i-tested-7-python-pdf-extractors-so-you-dont-have-to-2025-edition-akm)
- [Server-Sent Events (SSE) - FastAPI](https://fastapi.tiangolo.com/tutorial/server-sent-events/)
- [Streaming AI Agents Responses with SSE](https://akanuragkumar.medium.com/streaming-ai-agents-responses-with-server-sent-events-sse-a-technical-case-study-f3ac855d0755)
- [FastAPI Background Tasks vs Celery vs Arq](https://medium.com/@komalbaparmar007/fastapi-background-tasks-vs-celery-vs-arq-picking-the-right-asynchronous-workhorse-b6e0478ecf4a)
- [Structured Outputs - Claude API Docs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- [Anthropic Launches Structured Outputs](https://techbytes.app/posts/claude-structured-outputs-json-schema-api/)
- [marker-pdf PyPI](https://pypi.org/project/marker-pdf/)
- [GitHub - datalab-to/marker](https://github.com/datalab-to/marker)
- [Managing Background Tasks in FastAPI](https://leapcell.io/blog/managing-background-tasks-and-long-running-operations-in-fastapi)
