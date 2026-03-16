# Sprint 2 详细开发计划 — 材料分析 3-Agent 管道（v2，Codex 审查修订版）

> 日期：2026-03-16 | v2 — 根据 Codex REVISE 反馈重写
> 依赖：Sprint 1 已完成（后端骨架 + Auth + S3 presigned上传 + 前端 Auth）
> 参考：comprehensive-dev-spec.md §5, material-analysis-pipeline-spec.md

---

## 目标

把 PDF 课件变成结构化学习内容：PDF → Markdown → DisassemblyPlan → Specialist精讲 → Examiner测验

## 架构总览

```
用户上传 PDF → presigned URL → S3
         ↓
confirm_upload → POST /disassembly/start
         ↓
┌────────────────────────────────────────────────────────┐
│ Celery Worker (复用 Sprint 1 配置)                      │
│                                                         │
│ Phase 1: PARSING                                        │
│   pymupdf4llm → 分页 Markdown + 页码映射                │
│   结果存 S3 (s3://parsed/{task_id}/pages.json)          │
│     ↓                                                    │
│ Phase 2: CARTOGRAPHER                                    │
│   分块摘要 → Claude Sonnet Structured Output             │
│   输出: DisassemblyPlan (模块列表+页码范围+考点权重)      │
│     ↓                                                    │
│ Phase 3: SPECIALIST (×N, Semaphore=3)                    │
│   每模块: 页码切片 Markdown → Claude Sonnet              │
│   输出: 精讲 Markdown (概念+陷阱+自测题)                  │
│   结果存 S3 (s3://specialist/{task_id}/{module_id}.md)   │
│     ↓                                                    │
│ Phase 4: EXAMINER                                        │
│   所有 Specialist 概念摘要 → Claude Sonnet               │
│   输出: 8-12 道 MCQ (含溯源)                             │
└────────────────────────────────────────────────────────┘
         ↓ DB 持久化当前态 + Redis Pub/Sub 实时事件
         ↓
FastAPI SSE (sse-starlette) → 前端进度 + 结果
  └─ 断线重连: GET /status 先读 DB 态，再订阅 Pub/Sub
```

## Codex v2 审查遗留决策（已补充）

1. **attempt 递增规则**：Celery `self.request.retries` 自动管理；DTO `TaskStatusResponse` 包含 `attempt` 字段
2. **模块依赖映射**：Cartographer 输出模块的 `sort_order` 作为依赖标识（非名称），Worker 写入 `module_dependencies` 时按 sort_order 关联为 UUID 外键
3. **Cartographer 重跑策略**：重新分析 = 新建 task（旧 task 保留作对比）；不覆盖旧 task 的 modules
4. **业务错误码**：定义 `DisassemblyErrorCode` 枚举：`MATERIAL_NOT_PDF`, `MATERIAL_NOT_CONFIRMED`, `ANALYSIS_ALREADY_RUNNING`, `PIPELINE_TIMEOUT`, `LLM_ERROR`, `PARSING_ERROR`
5. **cancelled 状态**：前端增加"取消中"状态 → POST /disassembly/{task_id}/cancel → Celery revoke + DB status='cancelled'

## 核心设计决策（Codex 审查修正）

| 决策 | v1 方案 | Codex 反馈 | v2 方案 |
|------|---------|-----------|---------|
| 任务队列 | Celery (但 spec 写 ARQ) | 统一 | **Celery**（Sprint 1 已配置） |
| 任务状态 | 单 status 字段混合阶段 | 拆分 | **status + phase + progress** |
| PDF 输入 | 全文 markdown 直喂 LLM | token 溢出 | **分页提取 + 分块摘要 + 汇总** |
| 中间产物 | pdf_markdown 存 DB | 行膨胀 | **大文本存 S3，DB 存引用** |
| 模块依赖 | prerequisites TEXT[] | 重命名断引用 | **module_dependencies 关系表** |
| 进度通道 | 纯 Redis Pub/Sub | 消息丢失 | **DB 持久态 + Pub/Sub 实时** |
| 幂等性 | 未定义 | 重试重复写 | **每阶段 upsert + 唯一约束** |
| 质量审计 | 部分 | 不足 | **prompt_version + run_id + 全 LLM 元数据** |

---

## 数据库设计（修订版）

### disassembly_tasks — 管道任务

```sql
CREATE TABLE disassembly_tasks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    material_id     UUID NOT NULL REFERENCES materials(id),
    user_id         UUID NOT NULL REFERENCES users(id),

    -- 生命周期状态（独立于阶段）
    status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','running','completed','failed','cancelled')),
    -- 当前阶段
    phase           VARCHAR(20) NOT NULL DEFAULT 'init'
                    CHECK (phase IN ('init','parsing','cartographer','specialist','examiner','done')),
    -- 阶段内进度 0.0-1.0
    progress        NUMERIC(4,3) NOT NULL DEFAULT 0.000,

    -- 错误信息
    error_message   TEXT,
    error_phase     VARCHAR(20),        -- 哪个阶段失败
    attempt         INT NOT NULL DEFAULT 1,

    -- 解析结果引用（不存大文本）
    pdf_page_count  INT,
    parsed_s3_key   VARCHAR(1000),      -- s3://parsed/{task_id}/pages.json

    -- Celery
    celery_task_id  VARCHAR(100),

    -- 配置快照（便于重现）
    config_json     JSONB DEFAULT '{}', -- {model, prompt_version, ...}

    -- 审计字段
    run_id          VARCHAR(64) NOT NULL,  -- 唯一执行标识
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_dtasks_user_created ON disassembly_tasks(user_id, created_at DESC);
CREATE INDEX idx_dtasks_material ON disassembly_tasks(material_id, created_at DESC);
CREATE INDEX idx_dtasks_status ON disassembly_tasks(status) WHERE status IN ('pending','running');
CREATE UNIQUE INDEX idx_dtasks_run ON disassembly_tasks(run_id);
```

### disassembly_modules — Cartographer 输出

```sql
CREATE TABLE disassembly_modules (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id         UUID NOT NULL REFERENCES disassembly_tasks(id) ON DELETE CASCADE,
    name            VARCHAR(500) NOT NULL,
    description     TEXT,
    page_range_start INT NOT NULL,
    page_range_end   INT NOT NULL,
    exam_weight     VARCHAR(20) NOT NULL DEFAULT 'medium'
                    CHECK (exam_weight IN ('high','medium','low')),
    sort_order      INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT now(),

    -- 幂等：每个任务的模块按 sort_order 唯一
    UNIQUE(task_id, sort_order)
);

CREATE INDEX idx_dmodules_task ON disassembly_modules(task_id, sort_order);
```

### module_dependencies — 模块前置关系

```sql
CREATE TABLE module_dependencies (
    module_id       UUID NOT NULL REFERENCES disassembly_modules(id) ON DELETE CASCADE,
    depends_on_id   UUID NOT NULL REFERENCES disassembly_modules(id) ON DELETE CASCADE,
    PRIMARY KEY (module_id, depends_on_id),
    CHECK (module_id != depends_on_id)
);
```

### specialist_outputs — 每模块精讲

```sql
CREATE TABLE specialist_outputs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    module_id       UUID NOT NULL REFERENCES disassembly_modules(id) ON DELETE CASCADE,

    -- 内容引用（大文本存 S3）
    markdown_s3_key VARCHAR(1000) NOT NULL, -- s3://specialist/{task_id}/{module_id}.md
    summary         TEXT,                    -- 200字摘要（DB 内，便于快速展示）
    key_concepts    TEXT[] NOT NULL DEFAULT '{}',
    exam_traps      TEXT[] DEFAULT '{}',
    self_test_questions JSONB,

    -- 质量审计
    prompt_version  VARCHAR(20) NOT NULL,
    model_used      VARCHAR(50) NOT NULL,
    input_tokens    INT NOT NULL,
    output_tokens   INT NOT NULL,
    latency_ms      INT NOT NULL,
    run_id          VARCHAR(64) NOT NULL,

    created_at      TIMESTAMPTZ DEFAULT now(),

    -- 幂等：每模块只有一份当前结果
    UNIQUE(module_id)
);
```

### quiz_data — Examiner 测验

```sql
CREATE TABLE quiz_data (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id         UUID NOT NULL REFERENCES disassembly_tasks(id) ON DELETE CASCADE,

    -- 题目（JSONB，含 schema_version）
    schema_version  INT NOT NULL DEFAULT 1,
    questions       JSONB NOT NULL,
    -- [{question, options: [str], correct_index: int, explanation, source_module_id, source_page, difficulty}]
    total_questions INT NOT NULL,
    source_module_ids UUID[] NOT NULL,  -- 溯源

    -- 质量审计
    prompt_version  VARCHAR(20) NOT NULL,
    model_used      VARCHAR(50) NOT NULL,
    input_tokens    INT NOT NULL,
    output_tokens   INT NOT NULL,
    latency_ms      INT NOT NULL,
    run_id          VARCHAR(64) NOT NULL,

    created_at      TIMESTAMPTZ DEFAULT now(),

    -- 幂等：每任务只有一份测验
    UNIQUE(task_id)
);
```

---

## Checkpoint 划分（7 个 CP）

### CP1: 数据库模型 + Contract Schema + 迁移

**范围**：
- SQLAlchemy 模型：`disassembly_tasks`, `disassembly_modules`, `module_dependencies`, `specialist_outputs`, `quiz_data`
- Pydantic DTO（前后端共用契约）：
  - `TaskStatusResponse` — SSE/轮询返回格式
  - `DisassemblyResultResponse` — 完整结果
  - `ModuleDetailResponse` — 单模块精讲
  - `QuizResponse` — 测验数据
  - `SSEProgressEvent` — SSE 事件格式
- Alembic migration: `0002_disassembly_tables.py`
- **错误码表**（枚举）

**交付物**：
- `backend/app/models/disassembly.py`
- `backend/app/schemas/disassembly.py`（含 SSE event schema）
- `backend/app/db/migrations/versions/0002_disassembly_tables.py`

**Codex 审查重点**：表设计、索引、约束、DTO 契约完整性

---

### CP2: PDF 解析 + S3 中间产物存储

**范围**：
- `backend/app/services/pdf_parser.py`
  - `parse_pdf(s3_key: str) -> ParsedPDF`
  - 从 S3 下载 PDF → pymupdf4llm 分页提取
  - 输出：`{pages: [{page_num, markdown, char_count}], total_pages, total_chars}`
  - 结果存 S3: `parsed/{task_id}/pages.json`（避免 DB 膨胀）
  - 限制：≤ 50MB, ≤ 500 页
  - 临时文件 + contextmanager 确保清理

**Codex 审查重点**：内存管理、临时文件清理、大文件处理、S3 路径安全

---

### CP3: LLM Client + Structured Output

**范围**：
- `backend/app/services/llm_client.py`
  - 单例 AsyncAnthropic client（复用 S3 client 的 singleton 模式）
  - `structured_output(model, system, messages, response_schema) -> T`
    — Claude Structured Outputs (tool_use 模式) + Pydantic 二次校验
  - `stream_text(model, system, messages) -> AsyncGenerator[str]`
  - 重试：429 指数退避(1s, 2s, 4s)，500 重试 2 次
  - 每次调用返回 `LLMResult(data, input_tokens, output_tokens, latency_ms, model, run_id)`
  - prompt_version 参数，便于 A/B 对比

**新增依赖**：`anthropic>=0.50.0`

**Codex 审查重点**：API key 不泄露、重试逻辑、token 计量准确性

---

### CP4: 3-Agent 管道纯服务层

**范围**：纯业务逻辑，不含 worker/DB 操作（便于单测）

**`backend/app/services/pipeline/cartographer.py`**:
- 输入：分块摘要（非全文！每页 markdown 的前 200 字 + 标题）+ 材料元数据
- Cartographer 策略：
  1. 提取每页标题/摘要 → 拼接为"课件大纲" (~2000-4000 tokens)
  2. Claude Structured Output → `CartographerResult(modules: list[ModulePlan])`
  3. `ModulePlan`: name, description, page_range, exam_weight, depends_on(模块名列表)
- prompt_version: `"cart_v1"`

**`backend/app/services/pipeline/specialist.py`**:
- 输入：单模块的页码范围 Markdown 切片 + DisassemblyPlan 上下文摘要
- 输出：`SpecialistResult(markdown, summary, key_concepts, exam_traps, self_test_questions)`
- 结果 markdown 存 S3
- 单模块 timeout: 120s
- 并行控制：asyncio.Semaphore(3) — 限制并发避免 rate limit
- prompt_version: `"spec_v1"`

**`backend/app/services/pipeline/examiner.py`**:
- 输入：所有模块的 summary + key_concepts（不是全文 markdown！）
- 输出：`ExaminerResult(questions: list[MCQ])` — 8-12 道
- `MCQ`: question, options[4], correct_index, explanation, source_module_name, source_page, difficulty
- prompt_version: `"exam_v1"`

**Codex 审查重点**：Prompt 质量、输入 token 控制、Structured Output schema、错误处理

---

### CP5: Celery Worker + 编排 + 进度推送

**范围**：任务编排、幂等性、进度事件

**`backend/app/workers/pipeline_worker.py`**:
```python
@celery_app.task(bind=True, max_retries=2, soft_time_limit=600, time_limit=660)
def run_pipeline(self, task_id: str):
    """
    4 阶段管道，每阶段：
    1. 检查是否已有结果（幂等 → 跳过）
    2. 执行
    3. Upsert 结果到 DB
    4. 更新 task phase/progress
    5. Redis PUBLISH 进度事件
    6. 失败 → 记录 error_message + error_phase，status='failed'
    """
```

**幂等规则**：
| 阶段 | 幂等策略 | 唯一约束 |
|------|---------|---------|
| parsing | 检查 parsed_s3_key 是否存在 → 跳过 | — |
| cartographer | 检查 modules count > 0 → 跳过 | task_id + sort_order |
| specialist | 检查 module 的 specialist_output 存在 → 跳过 | module_id UNIQUE |
| examiner | 检查 quiz_data 存在 → 跳过 | task_id UNIQUE |

**进度持久化**（DB 当前态 + Redis 实时）：
- DB: 每阶段开始/结束更新 `phase`, `progress`, `updated_at`
- Redis PUBLISH `pipeline:{task_id}`: `SSEProgressEvent` JSON

**重复分析处理**：
- 同一 material 已有 running task → 返回 409 Conflict
- 同一 material 已有 completed task → 前端提示"已有分析结果，是否重新分析？"

**Codex 审查重点**：幂等性、重试安全、部分完成恢复、内存/时间限制

---

### CP6: REST API + SSE 端点

**范围**：
```
POST /api/v1/disassembly/start
  → 检查 material 归属 + 检查无 running task
  → 创建 disassembly_task + 触发 Celery
  → 返回 {task_id, status, phase}

GET /api/v1/disassembly/{task_id}/status
  → SSE 进度流
  → 实现：先发一次 DB 当前态，再订阅 Redis Pub/Sub
  → 断线重连安全：客户端重连后先收 DB 态

GET /api/v1/disassembly/{task_id}/result
  → 完整结果：modules + specialist summaries + quiz
  → 仅 status=completed 时可用

GET /api/v1/disassembly/{task_id}/module/{module_id}
  → 单模块精讲 Markdown（从 S3 读取）

GET /api/v1/materials/{material_id}/analysis
  → 查询该材料最新分析 task
```

**SSE 实现**：
- `sse-starlette` EventSourceResponse
- 权限：task.user_id == current_user.id（防枚举）
- 超时 10 分钟自动断开
- 客户端断开 → 取消 Redis 订阅

**错误码**：
| HTTP | 场景 |
|------|------|
| 201 | 分析任务创建成功 |
| 404 | task/module 不存在或不属于当前用户 |
| 409 | 该材料已有正在运行的分析任务 |
| 400 | 材料未确认上传 / 非 PDF |
| 502 | Worker 不可用 |

**Codex 审查重点**：SSE 连接管理、权限检查、错误码、契约一致性

---

### CP7: 前端改造 — 进度可视化 + 结果渲染

**范围**：前端从 mock 数据切换到真实 API

**页面信息架构**：
```
MaterialWorkbenchPage (70:30 布局)
├── Left 70%: MaterialReader
│   ├── Tab: PDF 原文（已有 PdfAnnotator）
│   ├── Tab: 精讲笔记（Specialist Markdown，新）
│   └── Tab: 测验（QuizPanel，新）
└── Right 30%: AIToolPanel
    ├── 状态: 未分析 → "开始智能分析" 按钮
    ├── 状态: 分析中 → AnalysisProgress 组件
    ├── 状态: 已完成 → 模块导航列表 + 工具入口
    └── 状态: 失败 → 错误信息 + 重试按钮
```

**组件状态机**：
```
                    ┌──────────┐
                    │ 未分析    │
                    │ (idle)   │
                    └─────┬────┘
                          │ 点击"开始分析"
                          ▼
                    ┌──────────┐
               ┌───│ 分析中    │───┐
               │   │ (running) │   │
               │   └─────┬────┘   │
               │         │         │
           失败 ▼         │ 完成    ▼ 网络断开
        ┌──────────┐     │   ┌──────────┐
        │ 失败      │     │   │ 重连中    │
        │ (failed) │     │   │ (reconnect)│
        └─────┬────┘     │   └─────┬────┘
              │           │         │
              │ 重试       ▼         │ 重连成功
              │    ┌──────────┐     │
              └───→│ 已完成    │←────┘
                   │(completed)│
                   └──────────┘
```

**AnalysisProgress 组件（非 AI slop 设计）**：
- 左侧竖向 timeline，4 个阶段节点
- 每节点：图标 + 阶段名 + 耗时
  - 待执行：灰色空心圆 + 灰色文字
  - 执行中：红色脉冲圆 + 黑色文字 + spinner
  - 已完成：红色实心勾 + 黑色文字 + 耗时标签
  - 失败：红色叉 + 错误消息
- 节点间连接线：已完成段红色，未完成段灰色虚线
- Specialist 阶段特殊：显示 "模块 3/7" 子进度条
- 整体包裹在 `border border-border-warm` 卡片中
- 底部：预计剩余时间（基于历史数据估算）

**精讲笔记 Tab**：
- 左侧模块导航栏（竖向列表，当前模块高亮红色 border-left）
- 右侧 Markdown 渲染区（复用已有 ReactMarkdown + KaTeX）
- 模块间切换：fade 过渡动效
- 每模块顶部：概念标签 chips + 考试权重 badge
- 考试陷阱区块：用 border-l-3 border-l-accent-gold + 暖黄背景

**QuizPanel**：
- 题目卡片列表，每题一张卡
- 选项：4 个选项按钮，hover border 变红
- 选中后：
  - 正确 → 绿色边框 + 勾号 + 解释展开
  - 错误 → 红色边框 + 叉号 + 正确选项高亮 + 解释展开
- 底部得分统计 + "生成闪卡" 按钮（Sprint 3 对接）
- 来源溯源：每题底部小字显示 "来自：模块名 · 第X页"

**错误状态 UI**：
- 分析失败：显示 error_phase + error_message
- "重新分析" 按钮（POST /disassembly/start 再次触发）
- 网络断开：toast 提示 "连接中断，正在重连..."
- 加载态：暖色 shimmer 骨架屏（非冷灰）

**移动端适配**：
- 70:30 布局 → 全宽 + 底部 sheet 切换面板
- 模块导航 → 水平滑动 pills
- Quiz 选项 → 全宽纵向排列

**SSE 连接管理**：
```typescript
// useAnalysisSSE hook
function useAnalysisSSE(taskId: string) {
  // 1. GET /status → SSE
  // 2. EventSource with auto-reconnect
  // 3. onmessage → 更新 progress state
  // 4. onerror → 3s 后重连，最多 5 次
  // 5. cleanup → close connection on unmount
  // 返回: { phase, progress, message, isConnected }
}
```

**Codex 审查重点**：
1. 设计质量 — editorial 美学而非 AI slop
2. 状态机完整性 — 5 种状态全覆盖
3. SSE 连接生命周期 — 无泄漏
4. 错误状态 — 用户可感知、可恢复
5. 可访问性 — 键盘导航、aria 标签

---

## 技术决策记录

| 决策 | 选择 | 理由 |
|------|------|------|
| 任务队列 | **Celery**（统一） | Sprint 1 已配置，不引入 ARQ 双轨 |
| PDF 解析 | **pymupdf4llm** | 速度快(0.12s/page)，Markdown 质量高 |
| LLM | **Claude Sonnet 4.6** | Structured Outputs 零解析错误 |
| SSE | **sse-starlette** | FastAPI 生态标配 |
| 进度通道 | **DB 持久态 + Redis Pub/Sub** | 兼顾可恢复 + 实时 |
| 大文本存储 | **S3（parsed/specialist markdown）** | 避免 DB 行膨胀 |
| 并行度 | **Semaphore(3)** | Specialist 并行控制 |

## 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| 大 PDF token 溢出 | Cartographer context 爆 | 分页摘要+汇总，不送全文 |
| 大 PDF 内存溢出 | Worker OOM | 分页处理 + 内存限制 + 临时文件 |
| LLM 超时 | 管道卡住 | 单步 120s timeout + soft_time_limit 600s |
| Structured Output 语义错 | 模块切分级联错误 | Pydantic 二次校验 + 有限重试(2次) |
| Worker 重试重复写 | 数据不一致 | 每阶段 upsert + UNIQUE 约束 |
| 部分完成后失败 | 浪费计算 | 幂等跳过已完成阶段 |
| Redis 断连 | SSE 中断 | DB 态兜底 + 客户端重连 |
| 并发 Specialist Rate limit | 429 | Semaphore(3) + 429 指数退避 |
| 重复点击"开始分析" | 多任务竞争 | 409 Conflict + 前端去重 |
| 内容质量无法追溯 | prompt 迭代盲目 | prompt_version + run_id + token 计量 |

## 新增依赖

```
# backend/requirements.txt 追加
anthropic>=0.50.0
pymupdf4llm>=0.0.17
pymupdf>=1.25.0
sse-starlette>=2.0.0
```

## CP 依赖图

```
CP1 (DB + Contract)
 ├── CP2 (PDF解析)
 └── CP3 (LLM Client)
      └── CP4 (3-Agent 服务层)
           └── CP5 (Worker + 进度)
                └── CP6 (REST/SSE API)
                     └── CP7 (前端)
```
