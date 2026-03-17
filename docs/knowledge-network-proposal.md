# 知识网络（Knowledge Network）技术方案

> 方案代号：**Vector Similarity (方案A)**
> 状态：Proposal Draft — 供 Codex 讨论与实施规划
> 日期：2026-03-17

---

## 目录

1. [Executive Summary](#1-executive-summary)
2. [现状分析](#2-现状分析)
3. [数据模型设计](#3-数据模型设计)
4. [迁移策略](#4-迁移策略)
5. [Concept Linker Agent 设计](#5-concept-linker-agent-设计)
6. [API 端点设计](#6-api-端点设计)
7. [前端变更概要](#7-前端变更概要)
8. [5 阶段实施计划](#8-5-阶段实施计划)
9. [风险分析](#9-风险分析)
10. [用户上传材料 User Journey](#10-用户上传材料-user-journey--知识网络定位流程)

---

## 1. Executive Summary

智阶当前有 **227 门课程**（127 csdiy + 100 MIT OCW），按 `course_categories` 的扁平二级分类组织。用户只能通过分类浏览或文本搜索发现课程，无法：

- 知道"MIT 18.06 线性代数"和"TUM MA0901 线性代数"教的是**同一个学科**
- 从一个知识点（如"特征值分解"）出发，发现所有涉及它的课程和模块
- 看到知识点之间的前置依赖关系（学"SVD"需要先会"特征值"）

本方案引入 **4 层知识抽象**：

```
knowledge_domains (学科层级)
  └── abstract_courses (抽象课程 = 学科主题)
        └── courses (学校具体课程, 新增 standardized_code + abstract_course_id)
              └── disassembly_modules (模块)
                    └── knowledge_points (知识点, 带 pgvector embedding)
```

核心技术选择：**pgvector 向量相似度** 实现知识点自动去重与关联。当 Cartographer 拆解出模块后，Concept Linker 从模块描述中提取知识点，生成 embedding，通过 cosine similarity 与已有知识点匹配，实现跨课程的知识点自动链接。

**预期产出**：
- 用户可从"知识点"和"课程"两个维度探索内容
- 同一知识点自动聚合来自不同学校/不同课件的讲解
- 知识点 DAG 支撑后续 HTN 学习路径规划

---

## 2. 现状分析

### 2.1 现有表结构

| 表名 | 用途 | 行数(估) | 关键字段 |
|------|------|----------|---------|
| `users` | 用户 | — | id, email, auth_provider |
| `refresh_tokens` | JWT 刷新令牌 | — | user_id, token_hash |
| `course_categories` | 二级分类 | ~50 | name, slug, parent_id (self-ref) |
| `courses` | 具体课程 | 227 | category_id FK, name, university, source_platform, source_url, source_id |
| `course_material_sources` | OCW 外部材料链接 | ~2000 | course_id FK, source_url, content_type |
| `materials` | 用户上传材料 | — | user_id FK, course_id, s3_key |
| `disassembly_tasks` | 拆解任务 | — | material_id FK, status, phase |
| `disassembly_modules` | Cartographer 输出的模块 | — | task_id FK, name, description, page_range, exam_weight |
| `module_dependencies` | 模块间前置关系 | — | module_id, depends_on_id |
| `specialist_outputs` | Specialist 精讲 | — | module_id FK, key_concepts (TEXT[]), summary |
| `quiz_data` | Examiner 测验 | — | task_id FK, questions (JSONB) |

### 2.2 现有分类体系的局限

`course_categories` 是 csdiy.wiki 的章节分类（"数学基础"、"编译原理"等），二级结构，slug 直接从中文名翻译。MIT OCW 课程通过 `_DEPT_TO_CATEGORY_SLUG` 硬编码映射到已有分类。

**问题**：
1. **没有"抽象课程"概念** — MIT 18.06 和 TUM 的线性代数课被当作完全独立的课程
2. **没有标准化课程编号** — `source_id` 对 OCW 是数字 ID（如 `"18-06sc-fall-2011"`），对 csdiy 为空
3. **分类粒度太粗** — "数学基础"下混杂线性代数、微积分、概率论，无法表达学科层级
4. **没有知识点实体** — `specialist_outputs.key_concepts` 是 `TEXT[]` 纯字符串数组，无法跨课程关联
5. **无向量搜索能力** — 数据库未安装 pgvector 扩展

### 2.3 Cartographer 输出分析

Cartographer 的 `CartographerResult` 包含：
- `modules[].name`: 模块名称（中文，含英文术语）如 "有效应力与土力学 (Effective Stress)"
- `modules[].description`: 1-2 句描述
- `course_topic`: 推断的课程主题（如 "岩土工程"）
- `difficulty_level`: introductory / intermediate / advanced

Specialist 的 `SpecialistResult` 包含：
- `key_concepts: list[str]`: 1-15 个关键概念字符串

**关键洞察**：`key_concepts` 已经是现成的知识点提取结果，但目前只作为字符串存储在 `specialist_outputs` 表中，没有被实体化。

---

## 3. 数据模型设计

### 3.1 新增表总览

```
┌─────────────────────┐     ┌──────────────────────────┐
│ knowledge_domains    │←────│ knowledge_domains        │
│ (学科层级)           │     │ parent_id (self-ref)     │
└─────────┬───────────┘     └──────────────────────────┘
          │ 1:N
┌─────────▼───────────┐     ┌──────────────────────────┐
│ abstract_courses     │←────│ courses                  │
│ (抽象课程)           │     │ abstract_course_id FK    │
└─────────┬───────────┘     │ standardized_code (新增) │
          │                 └──────────────────────────┘
          │ 1:N
┌─────────▼───────────┐
│ knowledge_points     │
│ (知识点 + embedding) │
└─────────┬───────────┘
          │ M:N                    M:N
┌─────────▼───────────┐  ┌────────▼────────────────────┐
│ module_knowledge_    │  │ knowledge_prerequisites     │
│ points (模块↔知识点) │  │ (知识点 DAG)                │
└─────────────────────┘  └─────────────────────────────┘
```

### 3.2 `knowledge_domains` — 学科领域层级

```sql
CREATE TABLE knowledge_domains (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name_en     VARCHAR(200) NOT NULL,          -- "Linear Algebra"
    name_zh     VARCHAR(200) NOT NULL,          -- "线性代数"
    slug        VARCHAR(200) NOT NULL UNIQUE,   -- "linear-algebra"
    description TEXT,
    parent_id   UUID REFERENCES knowledge_domains(id) ON DELETE SET NULL,
    depth       SMALLINT NOT NULL DEFAULT 0,    -- 0=root, 1=sub, 2=leaf
    sort_order  INTEGER NOT NULL DEFAULT 0,
    icon_name   VARCHAR(50),                    -- lucide icon name
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_kd_parent ON knowledge_domains(parent_id);
CREATE INDEX idx_kd_depth  ON knowledge_domains(depth);
```

**SQLAlchemy Model**:

```python
class KnowledgeDomain(Base):
    __tablename__ = "knowledge_domains"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name_en: Mapped[str] = mapped_column(String(200), nullable=False)
    name_zh: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(200), nullable=False, unique=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("knowledge_domains.id", ondelete="SET NULL"), nullable=True
    )
    depth: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    icon_name: Mapped[str | None] = mapped_column(String(50), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
```

**预置数据示例**（3 层结构）：

```
数学 (Mathematics)
├── 线性代数 (Linear Algebra)
│   ├── 矩阵运算 (Matrix Operations)
│   ├── 向量空间 (Vector Spaces)
│   └── 特征值分解 (Eigendecomposition)
├── 微积分 (Calculus)
│   ├── 微分 (Differential Calculus)
│   └── 积分 (Integral Calculus)
└── 概率论 (Probability Theory)

计算机科学 (Computer Science)
├── 算法与数据结构 (Algorithms & Data Structures)
├── 操作系统 (Operating Systems)
├── 计算机网络 (Computer Networking)
└── ...
```

### 3.3 `abstract_courses` — 抽象课程（学科主题）

一个 abstract_course 代表"线性代数"这个学科主题，多门学校课程（MIT 18.06, TUM MA0901）归属同一个 abstract_course。

```sql
CREATE TABLE abstract_courses (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain_id       UUID NOT NULL REFERENCES knowledge_domains(id) ON DELETE RESTRICT,
    name_en         VARCHAR(500) NOT NULL,          -- "Linear Algebra"
    name_zh         VARCHAR(500) NOT NULL,          -- "线性代数"
    slug            VARCHAR(500) NOT NULL UNIQUE,   -- "linear-algebra"
    description     TEXT,
    difficulty_min  SMALLINT DEFAULT 1,             -- 归属课程的最低难度
    difficulty_max  SMALLINT DEFAULT 5,             -- 归属课程的最高难度
    course_count    INTEGER NOT NULL DEFAULT 0,     -- 反范式计数，trigger 维护
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ac_domain ON abstract_courses(domain_id);
```

**SQLAlchemy Model**:

```python
class AbstractCourse(Base):
    __tablename__ = "abstract_courses"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    domain_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("knowledge_domains.id", ondelete="RESTRICT"), nullable=False
    )
    name_en: Mapped[str] = mapped_column(String(500), nullable=False)
    name_zh: Mapped[str] = mapped_column(String(500), nullable=False)
    slug: Mapped[str] = mapped_column(String(500), nullable=False, unique=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    difficulty_min: Mapped[int] = mapped_column(SmallInteger, default=1)
    difficulty_max: Mapped[int] = mapped_column(SmallInteger, default=5)
    course_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
```

### 3.4 `courses` 表变更 — 新增列

```sql
-- 新增列
ALTER TABLE courses ADD COLUMN standardized_code VARCHAR(100);
ALTER TABLE courses ADD COLUMN abstract_course_id UUID REFERENCES abstract_courses(id) ON DELETE SET NULL;

-- 索引
CREATE UNIQUE INDEX idx_courses_std_code ON courses(standardized_code) WHERE standardized_code IS NOT NULL;
CREATE INDEX idx_courses_abstract ON courses(abstract_course_id);
```

**`standardized_code` 格式规范**：

| source_platform | 格式 | 示例 |
|----------------|------|------|
| `mit_ocw` | `MIT-{dept}.{number}` | `MIT-18.06`, `MIT-6.042J` |
| `csdiy` | `CSDIY-{slug}` | `CSDIY-missing-semester`, `CSDIY-cs61a` |
| `manual` | `{SCHOOL}-{code}` | `TUM-MA0901`, `ETH-401-0131` |

**Course Model 新增字段**：

```python
# 在 Course class 中新增
standardized_code: Mapped[str | None] = mapped_column(String(100), nullable=True)
abstract_course_id: Mapped[uuid.UUID | None] = mapped_column(
    UUID(as_uuid=True),
    ForeignKey("abstract_courses.id", ondelete="SET NULL"),
    nullable=True,
    index=True,
)
```

### 3.5 `knowledge_points` — 知识点实体（核心表）

```sql
-- 前置：启用 pgvector 扩展
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE knowledge_points (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical_name  VARCHAR(300) NOT NULL,          -- "eigenvalue decomposition"
    display_name_zh VARCHAR(300) NOT NULL,          -- "特征值分解"
    display_name_en VARCHAR(300),                   -- "Eigenvalue Decomposition"
    description     TEXT,
    domain_id       UUID REFERENCES knowledge_domains(id) ON DELETE SET NULL,

    -- pgvector embedding (text-embedding-3-small = 1536 dims)
    embedding       vector(1536),

    -- 元数据
    aliases         TEXT[] NOT NULL DEFAULT '{}',    -- 同义词列表 ["eigval decomp", "对角化"]
    difficulty      SMALLINT DEFAULT 3,             -- 1-5
    link_count      INTEGER NOT NULL DEFAULT 0,     -- 被关联的模块数（反范式）
    status          VARCHAR(20) NOT NULL DEFAULT 'active',  -- active, merged, deprecated
    merged_into_id  UUID REFERENCES knowledge_points(id) ON DELETE SET NULL,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_kp_canonical UNIQUE (canonical_name)
);

-- pgvector 索引（IVFFlat，适合 < 100k 行，无需调参）
CREATE INDEX idx_kp_embedding ON knowledge_points
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE INDEX idx_kp_domain ON knowledge_points(domain_id);
CREATE INDEX idx_kp_status ON knowledge_points(status) WHERE status = 'active';
```

**SQLAlchemy Model**:

```python
from pgvector.sqlalchemy import Vector

class KnowledgePoint(Base):
    __tablename__ = "knowledge_points"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    canonical_name: Mapped[str] = mapped_column(String(300), nullable=False, unique=True)
    display_name_zh: Mapped[str] = mapped_column(String(300), nullable=False)
    display_name_en: Mapped[str | None] = mapped_column(String(300), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    domain_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("knowledge_domains.id", ondelete="SET NULL"), nullable=True
    )
    embedding = mapped_column(Vector(1536), nullable=True)
    aliases: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False, server_default="{}")
    difficulty: Mapped[int] = mapped_column(SmallInteger, default=3)
    link_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    merged_into_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("knowledge_points.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
```

### 3.6 `module_knowledge_points` — 模块 ↔ 知识点关联

```sql
CREATE TABLE module_knowledge_points (
    module_id   UUID NOT NULL REFERENCES disassembly_modules(id) ON DELETE CASCADE,
    kp_id       UUID NOT NULL REFERENCES knowledge_points(id) ON DELETE CASCADE,
    relevance   NUMERIC(3,2) NOT NULL DEFAULT 1.00,  -- 0.70 - 1.00，来自 cosine similarity
    source      VARCHAR(20) NOT NULL DEFAULT 'auto',  -- auto | manual | specialist
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (module_id, kp_id)
);

CREATE INDEX idx_mkp_kp ON module_knowledge_points(kp_id);
```

**SQLAlchemy Model**:

```python
class ModuleKnowledgePoint(Base):
    __tablename__ = "module_knowledge_points"

    module_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("disassembly_modules.id", ondelete="CASCADE"), primary_key=True
    )
    kp_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("knowledge_points.id", ondelete="CASCADE"), primary_key=True
    )
    relevance: Mapped[float] = mapped_column(Numeric(3, 2), nullable=False, default=1.00)
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="auto")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
```

### 3.7 `knowledge_prerequisites` — 知识点前置关系 DAG

```sql
CREATE TABLE knowledge_prerequisites (
    kp_id           UUID NOT NULL REFERENCES knowledge_points(id) ON DELETE CASCADE,
    prerequisite_id UUID NOT NULL REFERENCES knowledge_points(id) ON DELETE CASCADE,
    strength        NUMERIC(3,2) NOT NULL DEFAULT 1.00,  -- 依赖强度 (0.5=helpful, 1.0=required)
    source          VARCHAR(20) NOT NULL DEFAULT 'auto',  -- auto | manual
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (kp_id, prerequisite_id),
    CONSTRAINT ck_kp_prereq_no_self CHECK (kp_id != prerequisite_id)
);

CREATE INDEX idx_kpre_prereq ON knowledge_prerequisites(prerequisite_id);
```

**SQLAlchemy Model**:

```python
class KnowledgePrerequisite(Base):
    __tablename__ = "knowledge_prerequisites"

    kp_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("knowledge_points.id", ondelete="CASCADE"), primary_key=True
    )
    prerequisite_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("knowledge_points.id", ondelete="CASCADE"), primary_key=True
    )
    strength: Mapped[float] = mapped_column(Numeric(3, 2), nullable=False, default=1.00)
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="auto")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        CheckConstraint("kp_id != prerequisite_id", name="ck_kp_prereq_no_self"),
    )
```

### 3.8 完整 ER 关系图

```
knowledge_domains ─────┐ (1:N)
    │ (self-ref)       │
    └──────────────────▶ abstract_courses ────┐ (1:N)
                             │                │
                             │                ▼
knowledge_domains ◀──── knowledge_points   courses (新增 abstract_course_id, standardized_code)
                             │                │
                             │ (M:N)          │ (1:N, existing)
                             ▼                ▼
                    module_knowledge_points  disassembly_modules
                                              │ (existing)
                                              ▼
                    knowledge_prerequisites  specialist_outputs (existing key_concepts)
                    (知识点 DAG)
```

### 3.9 新增 Python 依赖

```
pgvector==0.3.6        # SQLAlchemy Vector type + pgvector ops
openai>=1.30           # text-embedding-3-small API (已有或需新增)
```

`requirements.txt` / `pyproject.toml` 需追加。

---

## 4. 迁移策略

### 4.1 Phase 0: pgvector 安装

```sql
-- PostgreSQL 需安装 pgvector 扩展
-- Docker: 使用 pgvector/pgvector:pg16 镜像替代 postgres:16
CREATE EXTENSION IF NOT EXISTS vector;
```

**Docker Compose 变更**：

```yaml
# 将 image: postgres:16 改为
image: pgvector/pgvector:pg16
```

### 4.2 Alembic Migration `0005_knowledge_network.py`

完整迁移脚本应包含以下步骤（按依赖顺序）：

1. `CREATE EXTENSION IF NOT EXISTS vector`
2. 创建 `knowledge_domains` 表
3. 创建 `abstract_courses` 表
4. 为 `courses` 表添加 `standardized_code` 和 `abstract_course_id` 列
5. 创建 `knowledge_points` 表
6. 创建 `module_knowledge_points` 表
7. 创建 `knowledge_prerequisites` 表
8. 创建所有索引

### 4.3 `standardized_code` 回填脚本

需要一个 CLI 脚本 `app/cli/backfill_standardized_code.py`：

**MIT OCW 课程**（`source_platform = 'mit_ocw'`）：
```python
# source_id 格式：如 "18-06sc-fall-2011"
# 提取规则：取第一段 "{dept}-{number}" → "MIT-18.06SC"
import re

def extract_mit_code(source_id: str) -> str:
    """'18-06sc-fall-2011' → 'MIT-18.06SC'"""
    match = re.match(r"(\d+)-(\d+\w*)", source_id)
    if match:
        dept, num = match.group(1), match.group(2).upper()
        return f"MIT-{dept}.{num}"
    return None
```

**csdiy 课程**（`source_platform = 'csdiy'`）：
```python
# 已有 slug（如 "cs61a", "missing-semester"）
# 优先从 website_url 提取课程编号
# 兜底：CSDIY-{slug}

def extract_csdiy_code(course: Course) -> str:
    if course.website_url:
        # 尝试从 URL 提取课程编号
        # https://cs61a.org → CS61A
        # https://missing.csail.mit.edu → CSDIY-missing-semester
        match = re.search(r"(cs|ee|math|ece)\d+\w*", course.website_url, re.I)
        if match:
            return f"CSDIY-{match.group(0).upper()}"
    return f"CSDIY-{course.slug}"
```

**预计结果**：
- MIT OCW: 100 门全部可从 `source_id` 提取
- csdiy: ~80 门有明确课程编号，~47 门使用 slug 兜底

### 4.4 `abstract_courses` 初始化脚本

分两步：

**Step 1: LLM 批量分类**（离线脚本 `app/cli/init_abstract_courses.py`）

```python
# 将 227 门课程的 (name, university, category, description) 发送给 LLM
# 输出：每门课程应归属的 abstract_course 名称
# Prompt 设计：
PROMPT = """
你是一个课程分类专家。给定一批大学课程信息，请将它们归类到抽象学科主题中。

规则：
1. 同一学科主题的课程应该归为同一个 abstract_course（如 MIT 18.06 和 TUM MA0901 都是"线性代数"）
2. 每个 abstract_course 给出中英文名称
3. 指定所属的 knowledge_domain 路径
4. 不要过度细分——一个 abstract_course 应至少包含 1 门课程

课程列表：
{courses_json}

输出格式：JSON array of { "abstract_course_name_zh": "...", "abstract_course_name_en": "...", "domain_path": "数学 > 线性代数", "course_ids": ["uuid1", "uuid2"] }
"""
```

**Step 2: 人工审核 + 入库**

LLM 输出写入 `data/abstract_courses_draft.json`，人工审核后通过入库脚本写入。

**预估**：227 门课程可归纳为约 80-120 个 abstract_courses。

---

## 5. Concept Linker Agent 设计

### 5.1 触发时机

Concept Linker 在现有 pipeline 的 **Specialist 阶段之后** 自动触发：

```
Cartographer → Specialist → [NEW] Concept Linker → Examiner
```

输入来源：`specialist_outputs.key_concepts` (TEXT[])

### 5.2 处理流程

```
┌──────────────────────────────────────────────────────────────┐
│  Concept Linker Pipeline (per module)                        │
│                                                              │
│  1. 从 SpecialistResult.key_concepts 取 3-15 个概念          │
│  2. LLM 标准化：                                             │
│     - 输入："有效应力 (Effective Stress)"                     │
│     - 输出：{                                                │
│         canonical: "effective stress",                        │
│         zh: "有效应力",                                       │
│         en: "Effective Stress",                               │
│         aliases: ["effective stress principle", "有效应力原理"]│
│       }                                                      │
│  3. 调用 text-embedding-3-small 生成 canonical_name embedding │
│  4. pgvector cosine similarity 搜索:                         │
│     SELECT id, canonical_name, 1 - (embedding <=> $1) AS sim │
│     FROM knowledge_points                                    │
│     WHERE status = 'active'                                  │
│     ORDER BY embedding <=> $1                                │
│     LIMIT 5                                                  │
│  5. 决策：                                                   │
│     sim ≥ 0.85 → AUTO-LINK (复用已有 knowledge_point)         │
│     0.70 ≤ sim < 0.85 → FLAG FOR REVIEW (创建但标记)          │
│     sim < 0.70 → CREATE NEW (新建 knowledge_point)            │
│  6. 写入 module_knowledge_points 关联                         │
│  7. 从 ModuleDependency 推断 knowledge_prerequisites          │
└──────────────────────────────────────────────────────────────┘
```

### 5.3 LLM 标准化 Prompt

```python
CONCEPT_NORMALIZE_PROMPT = """你是一个学术概念标准化专家。

给定一个从课件中提取的关键概念（可能是中文、英文或混合），请输出标准化信息：

规则：
1. canonical_name: 小写英文，去掉冠词，用空格分隔（如 "eigenvalue decomposition"）
2. display_name_zh: 标准中文学术术语
3. display_name_en: 标准英文学术术语（Title Case）
4. aliases: 2-5 个常见同义词/缩写（中英文均可）
5. 如果概念太宽泛（如 "介绍"、"总结"），返回 null

概念: "{concept}"
课程上下文: "{course_topic}"
"""
```

**输出 Schema**:

```python
class NormalizedConcept(BaseModel):
    canonical_name: str | None  # null = skip
    display_name_zh: str
    display_name_en: str
    aliases: list[str] = []
```

### 5.4 Embedding 生成

```python
async def get_embedding(text: str) -> list[float]:
    """Generate embedding via OpenAI text-embedding-3-small."""
    response = await openai_client.embeddings.create(
        model="text-embedding-3-small",
        input=text,
        dimensions=1536,
    )
    return response.data[0].embedding
```

**成本估算**：
- text-embedding-3-small: $0.02 / 1M tokens
- 平均每个概念名 ~5 tokens
- 227 课程 × 8 模块 × 5 概念 = ~9000 次调用 ≈ 45K tokens ≈ **$0.001**（可忽略）

### 5.5 去重逻辑详细设计

```python
async def link_or_create_kp(
    db: AsyncSession,
    concept: NormalizedConcept,
    module_id: uuid.UUID,
    domain_id: uuid.UUID | None,
) -> uuid.UUID:
    """Link module to existing KP or create new one."""

    embedding = await get_embedding(concept.canonical_name)

    # 1. 先精确匹配 canonical_name
    exact = await db.execute(
        select(KnowledgePoint).where(
            KnowledgePoint.canonical_name == concept.canonical_name,
            KnowledgePoint.status == "active",
        )
    )
    if kp := exact.scalar_one_or_none():
        await _create_link(db, module_id, kp.id, relevance=1.0, source="auto")
        return kp.id

    # 2. 向量相似度搜索
    results = await db.execute(
        select(
            KnowledgePoint.id,
            KnowledgePoint.canonical_name,
            (1 - KnowledgePoint.embedding.cosine_distance(embedding)).label("similarity"),
        )
        .where(KnowledgePoint.status == "active")
        .order_by(KnowledgePoint.embedding.cosine_distance(embedding))
        .limit(5)
    )
    top_matches = results.all()

    if top_matches and top_matches[0].similarity >= 0.85:
        # AUTO-LINK: 高置信度匹配
        kp_id = top_matches[0].id
        await _create_link(db, module_id, kp_id, relevance=top_matches[0].similarity, source="auto")
        # 追加 alias
        await _append_alias(db, kp_id, concept.canonical_name)
        return kp_id

    # 3. 创建新 knowledge_point
    kp = KnowledgePoint(
        canonical_name=concept.canonical_name,
        display_name_zh=concept.display_name_zh,
        display_name_en=concept.display_name_en,
        aliases=concept.aliases,
        domain_id=domain_id,
        embedding=embedding,
        status="active" if (not top_matches or top_matches[0].similarity < 0.70) else "review",
    )
    db.add(kp)
    await db.flush()
    await _create_link(db, module_id, kp.id, relevance=1.0, source="auto")
    return kp.id
```

### 5.6 前置关系推断

利用已有的 `module_dependencies` 表推断知识点前置关系：

```python
async def infer_prerequisites(db: AsyncSession, task_id: uuid.UUID):
    """从 module_dependencies 推断 knowledge_prerequisites.

    逻辑：如果 module_A depends_on module_B，
    那么 module_A 的知识点 depends on module_B 的知识点。
    """
    # 获取该任务所有模块的知识点关联
    stmt = (
        select(
            ModuleDependency.module_id,
            ModuleDependency.depends_on_id,
        )
        .join(DisassemblyModule, DisassemblyModule.id == ModuleDependency.module_id)
        .where(DisassemblyModule.task_id == task_id)
    )
    deps = (await db.execute(stmt)).all()

    for dep in deps:
        # 获取 module_id 的知识点 和 depends_on_id 的知识点
        kps_a = await _get_module_kps(db, dep.module_id)
        kps_b = await _get_module_kps(db, dep.depends_on_id)

        for kp_a in kps_a:
            for kp_b in kps_b:
                if kp_a != kp_b:
                    await _upsert_prerequisite(db, kp_a, kp_b, strength=0.7, source="auto")
```

---

## 6. API 端点设计

### 6.1 Knowledge Domains API

```
GET  /api/v1/knowledge/domains
     → KnowledgeDomainTree[]  (嵌套树结构)
     Query: ?depth=2 (最大深度)

GET  /api/v1/knowledge/domains/{slug}
     → KnowledgeDomainDetail (含 abstract_courses 列表)
```

### 6.2 Abstract Courses API

```
GET  /api/v1/knowledge/abstract-courses
     → PaginatedList[AbstractCourseResponse]
     Query: ?domain={slug}&search={query}

GET  /api/v1/knowledge/abstract-courses/{slug}
     → AbstractCourseDetail (含归属的 courses 列表 + 涉及的 knowledge_points)
```

### 6.3 Knowledge Points API

```
GET  /api/v1/knowledge/points
     → PaginatedList[KnowledgePointResponse]
     Query: ?domain={slug}&search={query}

GET  /api/v1/knowledge/points/{id}
     → KnowledgePointDetail (含关联模块列表 + prerequisites + dependents)

GET  /api/v1/knowledge/points/{id}/related-modules
     → list[ModuleSummaryWithCourse]  (跨课程的模块聚合)

GET  /api/v1/knowledge/points/search
     → list[KnowledgePointMatch]
     Query: ?q={text}  (向量相似度搜索)
```

### 6.4 课程 API 增强

```
GET  /api/v1/courses/{slug}
     → CourseResponse (新增 standardized_code, abstract_course 信息)

GET  /api/v1/courses/{slug}/knowledge-points
     → list[KnowledgePointResponse]  (该课程所有模块涉及的知识点)

GET  /api/v1/courses/{slug}/related-courses
     → list[CourseResponse]  (同一 abstract_course 下的其他课程)
```

### 6.5 Pydantic Response Schemas

```python
class KnowledgeDomainNode(BaseModel):
    id: uuid.UUID
    name_en: str
    name_zh: str
    slug: str
    depth: int
    icon_name: str | None
    children: list["KnowledgeDomainNode"] = []
    abstract_course_count: int = 0

class AbstractCourseResponse(BaseModel):
    id: uuid.UUID
    name_en: str
    name_zh: str
    slug: str
    domain_slug: str
    domain_name_zh: str
    description: str | None
    course_count: int
    difficulty_range: str  # "1-3"

class KnowledgePointResponse(BaseModel):
    id: uuid.UUID
    canonical_name: str
    display_name_zh: str
    display_name_en: str | None
    description: str | None
    domain_slug: str | None
    link_count: int
    difficulty: int
    aliases: list[str]

class KnowledgePointDetail(KnowledgePointResponse):
    prerequisites: list[KnowledgePointResponse]
    dependents: list[KnowledgePointResponse]
    modules: list[ModuleSummaryWithCourse]

class ModuleSummaryWithCourse(BaseModel):
    module_id: uuid.UUID
    module_name: str
    course_name: str
    course_slug: str
    university: str | None
    relevance: float
```

---

## 7. 前端变更概要

### 7.1 新增页面

| 路由 | 页面 | 功能 |
|------|------|------|
| `/knowledge` | KnowledgeNetworkPage | 知识领域树 + 知识点搜索入口 |
| `/knowledge/:domainSlug` | DomainDetailPage | 某个领域下的 abstract_courses + 知识点 |
| `/knowledge/point/:id` | KnowledgePointPage | 单个知识点详情：定义、关联模块（跨课程）、前置/后续 |

### 7.2 现有页面增强

| 页面 | 变更 |
|------|------|
| `/explore` (ExplorePage) | 新增"按学科浏览"Tab，使用 abstract_courses 分组 |
| `/course/:id` (CourseDetailPage) | 显示 standardized_code、同一 abstract_course 下的相关课程、涉及的知识点列表 |
| 材料工作台 | 模块卡片上显示关联的知识点 tag，可点击跳转 |
| 侧边栏 | 新增"知识网络"导航入口 |

### 7.3 设计规范

遵循 CLAUDE.md 中定义的 Editorial Academic 设计系统：
- 知识点 tag: `border-l-3 border-l-red-primary` 引用线风格
- 领域树: 衬线标题 (Instrument Serif) + 无衬线正文 (Satoshi)
- 知识图谱可视化（远期）: 暖色节点，红色连线表示强依赖
- 动效: Framer Motion staggered fade-in

---

## 8. 5 阶段实施计划

### Phase 1: 基础设施 + 数据模型（3 天）

**前置条件**: 无

| 任务 | 产出 | 工时 |
|------|------|------|
| Docker Compose 切换到 pgvector 镜像 | docker-compose.yml | 0.5h |
| 安装 `pgvector` Python 包 | requirements.txt | 0.5h |
| Alembic migration `0005_knowledge_network` | migration 文件 | 2h |
| SQLAlchemy Models: KnowledgeDomain, AbstractCourse, KnowledgePoint, ModuleKnowledgePoint, KnowledgePrerequisite | `models/knowledge.py` | 3h |
| Course model 新增字段 | `models/course.py` 修改 | 1h |
| Pydantic schemas | `schemas/knowledge.py` | 2h |
| `__init__.py` 更新 model imports | `models/__init__.py` | 0.5h |

**验证**: `alembic upgrade head` 成功，表结构正确

### Phase 2: 数据回填 + 冷启动（3 天）

**前置条件**: Phase 1

| 任务 | 产出 | 工时 |
|------|------|------|
| 预置 knowledge_domains 种子数据（~50 个节点） | `data/knowledge_domains_seed.json` + seed 脚本 | 3h |
| `standardized_code` 回填脚本 | `cli/backfill_standardized_code.py` | 3h |
| LLM 批量分类生成 abstract_courses | `cli/init_abstract_courses.py` | 4h |
| 人工审核 + abstract_courses 入库 | JSON 数据 + 入库脚本 | 3h |
| courses.abstract_course_id 回填 | 在 init_abstract_courses 中完成 | 含上 |
| 单元测试（model CRUD + migration） | `tests/test_knowledge_models.py` | 2h |

**验证**: 227 门课程全部有 standardized_code，80%+ 有 abstract_course_id

### Phase 3: Concept Linker Agent（4 天）

**前置条件**: Phase 1 (Phase 2 可并行)

| 任务 | 产出 | 工时 |
|------|------|------|
| OpenAI embedding client 封装 | `services/embedding_client.py` | 2h |
| Concept Linker 核心逻辑 | `services/pipeline/concept_linker.py` | 6h |
| 集成到现有 pipeline（Specialist 后触发） | 修改 pipeline orchestrator | 3h |
| 前置关系推断逻辑 | `services/knowledge/prerequisite_inference.py` | 3h |
| 回填脚本：对已有 specialist_outputs 批量运行 Linker | `cli/backfill_knowledge_points.py` | 3h |
| 单元测试 + 集成测试 | `tests/test_concept_linker.py` | 4h |

**验证**: 对 10 个已完成 pipeline 的材料运行 Concept Linker，知识点去重率 > 30%

### Phase 4: API 端点（3 天）

**前置条件**: Phase 1, Phase 2

| 任务 | 产出 | 工时 |
|------|------|------|
| Knowledge domains CRUD API | `api/v1/knowledge.py` | 3h |
| Abstract courses API + 课程关联 | 含上 | 2h |
| Knowledge points API（含向量搜索） | 含上 | 4h |
| 课程 API 增强（related courses, knowledge points） | 修改 `api/v1/courses.py` | 3h |
| API 测试 | `tests/test_knowledge_api.py` | 3h |

**验证**: 所有 API 端点通过 Pytest + httpx 测试

### Phase 5: 前端集成（5 天）

**前置条件**: Phase 4

| 任务 | 产出 | 工时 |
|------|------|------|
| API client 函数 | `src/lib/api.ts` 扩展 | 2h |
| KnowledgeNetworkPage | `src/pages/KnowledgeNetworkPage.tsx` | 6h |
| KnowledgePointPage | `src/pages/KnowledgePointPage.tsx` | 4h |
| ExplorePage 增强（abstract_course 分组） | 修改 ExplorePage | 4h |
| CourseDetailPage 增强（知识点 + 相关课程） | 修改 CourseDetailPage | 3h |
| 侧边栏导航更新 | 修改 Sidebar | 1h |
| 路由配置 | `src/App.tsx` 或 router 配置 | 0.5h |

**验证**: 端到端可从知识网络页面浏览 → 点击知识点 → 查看跨课程模块

### 总计：~18 工作日

```
Phase 1 ───────┐
               ├── Phase 2 ──────┐
Phase 1 ───┬── Phase 3           ├── Phase 5
           │                     │
           └── Phase 4 ──────────┘
```

Phase 2 和 Phase 3 可与 Phase 1 完成后并行启动。Phase 4 依赖 Phase 1+2。Phase 5 依赖 Phase 4。

---

## 9. 风险分析

### 9.1 技术风险

| 风险 | 严重度 | 概率 | 缓解措施 |
|------|--------|------|---------|
| pgvector IVFFlat 索引在知识点 < 1000 时效果不佳 | 中 | 低 | 初期可用精确搜索（不建索引），数据量上来后再建 IVFFlat；或使用 HNSW 索引 |
| text-embedding-3-small 对中英混合学术概念的 embedding 质量不够 | 高 | 中 | 用 canonical_name (纯英文) 做 embedding；备选 multilingual-e5-large 模型 |
| LLM 标准化概念时输出不稳定（同一概念不同次调用得到不同 canonical_name） | 中 | 中 | 先做精确字符串匹配 canonical_name，再做 embedding 兜底；设置 temperature=0 |
| 知识点数量膨胀（每门课 30-50 个概念，227 课 × 40 = ~9000 个） | 低 | 高 | 正常情况，去重后应收敛到 2000-4000 个；IVFFlat lists=100 足够 |
| 前置关系 DAG 出现环 | 中 | 低 | 入库前做 DFS 环检测；发现环时保留较强的边，删弱边 |

### 9.2 产品风险

| 风险 | 严重度 | 概率 | 缓解措施 |
|------|--------|------|---------|
| abstract_course 分类不准（LLM 将不相关课程归为同一主题） | 中 | 中 | 人工审核步骤；提供 admin API 支持后续调整 |
| 用户对"知识网络"概念不理解，不知道怎么用 | 中 | 中 | 从 ExplorePage 的自然浏览入手，渐进引导；不强制用户使用新入口 |
| 知识点过于学术化，与课件实际内容脱节 | 中 | 低 | 知识点来自 Specialist 的 key_concepts，与课件内容强绑定 |

### 9.3 运维风险

| 风险 | 严重度 | 概率 | 缓解措施 |
|------|--------|------|---------|
| pgvector 扩展需要 PostgreSQL 重启或重建 | 低 | 低 | Docker 环境下切换镜像即可 |
| OpenAI embedding API 限流（batch backfill 时） | 低 | 中 | 加 asyncio.Semaphore 限制并发，每次 batch 最多 100 个 |
| migration 失败导致数据库不一致 | 高 | 低 | 所有新表都是 additive（不修改已有表结构的核心列），可安全回滚 |

### 9.4 决策点

以下决策需在实施前确认：

1. **Embedding 模型选择**: `text-embedding-3-small` (1536d, $0.02/1M tokens) vs `text-embedding-3-large` (3072d, $0.13/1M tokens)。推荐 small —— 知识点名称短文本，small 足够且成本低 90%。

2. **pgvector 索引类型**: IVFFlat vs HNSW。推荐先不建索引（< 10k 行精确搜索够快），超过 10k 后用 HNSW（无需调 lists 参数，recall 更高）。

3. **similarity 阈值**: 0.85 (auto-link) / 0.70 (flag-for-review)。需在回填阶段根据实际数据调整。建议先跑 100 个概念的 embedding，观察 similarity 分布后确定。

4. **知识点粒度**: 是否需要区分"知识点"和"概念"两个层级（如"线性代数"是概念，"矩阵乘法"是知识点）。推荐 Phase 1 不区分，统一用 knowledge_points，后续根据 depth/difficulty 自然分层。

---

## 10. 用户上传材料 User Journey — 知识网络定位流程

这是知识网络的**关键路径**：用户上传自己的材料时，如何自动定位到知识网络体系中，以及如何让用户自主决定是否公开。

### 10.1 完整流程

```
用户上传 PDF
    │
    ▼
Step 1: AI 自动识别与定位（后台静默，Pipeline 内完成）
    ├── Cartographer 拆解为模块（已有）
    ├── Specialist 生成精讲 + key_concepts（已有）
    ├── [NEW] Concept Linker 从 key_concepts 提取知识点
    │   ├── pgvector 匹配已有 knowledge_points
    │   └── 推断所属 knowledge_domain + abstract_course
    ├── Examiner 生成测验（已有）
    └── 输出：材料的知识网络定位建议
    │
    ▼
Step 2: 用户确认/调整（ClassifyForm UI 增强）
    ├── 上传时：用户手选课程归属（已有流程）
    ├── Pipeline 完成后：显示 AI 识别结果
    │   ├── "我们识别到这份材料涉及以下知识点：[特征值分解] [矩阵对角化] ..."
    │   ├── "建议归属学科：线性代数 (Linear Algebra)"
    │   └── 用户可修改/添加/删除知识点标签
    ├── 如果材料不属于任何已有 abstract_course → 建议创建新的
    └── 材料默认 visibility = 'private'（仅自己可见）
    │
    ▼
Step 3: 在私有工作台中使用（无需公开即可完整使用所有功能）
    ├── 精讲阅读、测验练习、闪卡生成、苏格拉底对话
    ├── 知识点标签在工作台中可见（方便自己组织）
    └── BKT 按知识点追踪 mastery
    │
    ▼
Step 4: 自主选择公开（用户主动触发，非强制）
    ├── 材料详情页或工作台中显示 "分享到知识网络" 按钮
    ├── 公开粒度选择：
    │   ├── Level 1: 仅公开知识点映射
    │   │   （其他用户可以看到"这个知识点有 N 份材料覆盖"，但看不到内容）
    │   ├── Level 2: 公开材料元信息 + AI 精讲
    │   │   （其他用户可以看到精讲内容，但看不到原始 PDF）
    │   └── Level 3: 完全公开（原始 PDF + 精讲 + 测验 + 闪卡）
    ├── 公开前质量检查：
    │   ├── AI 自动检查：是否含个人信息、是否内容完整
    │   └── 基本质量阈值：Specialist 成功率 > 80%
    └── 确认后：material.visibility = 'public' / 'metadata_only' / 'content_only'
```

### 10.2 数据模型变更

在 `materials` 表新增：

```sql
ALTER TABLE materials ADD COLUMN visibility VARCHAR(20) NOT NULL DEFAULT 'private';
-- 可选值：'private' | 'metadata_only' | 'content_only' | 'public'

ALTER TABLE materials ADD COLUMN shared_at TIMESTAMPTZ;
-- 首次公开时间

ALTER TABLE materials ADD COLUMN shared_by UUID REFERENCES users(id);
-- 公开者（= 上传者，预留未来转让场景）
```

### 10.3 核心原则

1. **先私有，后公开** — 上传默认私有，所有功能（精讲、测验、闪卡）私有状态下完全可用
2. **AI 定位，人工确认** — Concept Linker 自动推荐知识点归属，用户有最终决定权
3. **渐进式公开** — 3 个粒度级别，用户可以只贡献知识图谱映射而不暴露原始材料
4. **零摩擦** — 不公开不影响任何功能，公开是 opt-in 的附加价值
5. **贡献可见** — 公开后，材料在知识点页面聚合展示，标注贡献者

### 10.4 对 Pipeline 的改动

Pipeline 本身**无需改动**，Concept Linker 作为新 Phase 自然衔接：

```
Phase 1: PDF 上传 → S3
Phase 2: Cartographer → 模块拆解
Phase 3: Specialist → 精讲生成  ←── key_concepts 产出
Phase 3.5: [NEW] Concept Linker → 知识点提取 + embedding + 去重
Phase 4: Examiner → 测验生成
Phase 5: [NEW] 定位建议推送给前端（SSE event: 'knowledge_mapped'）
```

用户收到 `knowledge_mapped` 事件后，工作台显示：
- 知识点标签（可编辑）
- 学科归属建议（可修改）
- "分享到知识网络"入口

### 10.5 前端交互设计

**上传完成后的定位确认 UI**（在 WorkbenchPage 中）：

```
┌──────────────────────────────────────────────┐
│ 📌 知识网络定位                               │
│                                              │
│ AI 识别到以下知识点：                          │
│ [特征值分解] [矩阵对角化] [Jordan标准形] [+]   │
│                                              │
│ 建议学科归属：数学 > 线性代数                   │
│ [修改归属 ▾]                                  │
│                                              │
│ ─────────────────────────────────────────── │
│ 💡 这些标签帮助你组织学习，也可以选择          │
│    分享到公开知识网络，帮助其他同学发现好材料。  │
│                                              │
│ [暂不公开]              [分享到知识网络 →]     │
└──────────────────────────────────────────────┘
```

---

## 附录 A: 现有表结构速查

### courses 表关键字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID PK | |
| `category_id` | UUID FK → course_categories | 当前分类 |
| `name` | VARCHAR(500) | 课程名称 |
| `slug` | VARCHAR(500) UNIQUE | URL slug |
| `university` | VARCHAR(200) | 学校名 |
| `source_platform` | VARCHAR(50) | "csdiy" / "mit_ocw" / "manual" |
| `source_id` | VARCHAR(200) | 平台内部 ID |
| `source_url` | TEXT | 原始 URL |
| `school` | VARCHAR(200) | 学校（OCW 用） |
| `department` | VARCHAR(200) | 院系（OCW 用） |
| `tags` | TEXT[] | 标签数组 |
| **新增** `standardized_code` | VARCHAR(100) | 标准化课程编号 |
| **新增** `abstract_course_id` | UUID FK → abstract_courses | 抽象课程 |

### disassembly_modules 表关键字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID PK | |
| `task_id` | UUID FK → disassembly_tasks | 所属任务 |
| `name` | VARCHAR(500) | 模块名称（中文） |
| `description` | TEXT | 模块描述 |
| `exam_weight` | VARCHAR(20) | high / medium / low |
| `sort_order` | INTEGER | 排序 |

### specialist_outputs 表关键字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID PK | |
| `module_id` | UUID FK → disassembly_modules | 所属模块 |
| `key_concepts` | TEXT[] | **Concept Linker 的输入来源** |
| `summary` | TEXT | 模块摘要 |
| `markdown_s3_key` | VARCHAR(1000) | S3 存储路径 |

---

## 附录 B: Cartographer 输出 Schema

```python
class ModulePlan(BaseModel):
    name: str                       # 模块名（中文+英文括注）
    description: str                # 1-2 句描述
    page_range_start: int           # 起始页
    page_range_end: int             # 结束页
    exam_weight: str                # high/medium/low
    depends_on: list[int]           # 前置模块索引

class CartographerResult(BaseModel):
    modules: list[ModulePlan]       # 3-30 个模块
    course_topic: str               # 推断的课程主题
    difficulty_level: str           # introductory/intermediate/advanced
```

Concept Linker 可利用 `course_topic` 作为 domain 推断的辅助信息。

---

## 附录 C: 预计数据规模

| 实体 | 初始量 | 1 年后 | 存储估算 |
|------|--------|--------|---------|
| knowledge_domains | 50 | 100 | < 1MB |
| abstract_courses | 100 | 200 | < 1MB |
| courses | 227 | 500 | < 5MB |
| knowledge_points | 0 (新建) | 3,000-5,000 | ~30MB (含 embedding) |
| module_knowledge_points | 0 | 15,000-25,000 | < 5MB |
| knowledge_prerequisites | 0 | 5,000-10,000 | < 2MB |

Embedding 存储：每个 knowledge_point 的 embedding = 1536 × 4 bytes = 6KB。5000 个 = 30MB。pgvector IVFFlat 索引额外 ~15MB。总计 < 50MB，完全在 PostgreSQL 常规承受范围内。
