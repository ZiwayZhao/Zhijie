# 高瓴生活迁移计划 — science1204 → 智阶新版

> **状态**：草案 v1.0 — 供 Codex 讨论
> **日期**：2026-03-17
> **作者**：Ziway + Claude
> **预计工期**：8-10 天

---

## 1. 概述

### 1.1 什么是高瓴生活

**高瓴生活**（Gaoling Life）是为中国人民大学高瓴人工智能学院打造的校园生活信息平台。它聚合来自 `ai.ruc.edu.cn` 的官方通知（讲座、招生、学术活动等）和学生自主发布的生活信息（运动约伴、就餐推荐、就医指南等），并提供基于 RAG（检索增强生成）的智能问答助手。

### 1.2 为什么要迁移

| 维度 | 现状（science1204） | 目标（智阶新版） |
|------|-------------------|----------------|
| 前端 | 单个 960 行 React 组件，内联样式 | 5-6 个组件，Editorial Academic 设计系统 |
| 后端 | Express.js + Prisma + Node 子进程调 Python | FastAPI + SQLAlchemy + 原生 Python |
| 爬虫 | Python 脚本由 Node `child_process` 调用 | 直接作为 FastAPI worker/CLI 集成 |
| RAG | 独立 FastAPI 服务 + ChromaDB + SiliconFlow API | 统一到智阶后端，复用 LLM 客户端 |
| 设计 | 自定义 CSS，与智阶主题不统一 | Editorial Academic 设计系统（Instrument Serif + Satoshi + 红色 accent） |
| 部署 | 与 science1204 绑定 | 作为智阶专属分支，独立可部署 |

### 1.3 迁移范围

```
science1204 待迁移文件：
├── components/GaolingLife.tsx          # 960行前端组件
├── services/gaolingLifeService.ts      # API 调用层
├── server/index.ts                     # Express 路由（6个 gaoling-life 端点）
├── server/crawlers/gaoling_life.py     # 爬虫（BeautifulSoup 版）
├── server/crawlers/gaoling_life_simple.py  # 爬虫（纯正则版，备用）
├── chatbot/gaoling_life_agent_api.py   # RAG 智能体 API
├── chatbot/dynamic.py                  # ChromaDB 向量存储 + 检索
├── chatbot/config.py                   # LLM/Embedding 配置
└── chatbot/doc/gaoling-life-agent-api.md  # API 规范文档
```

---

## 2. 现有架构分析

### 2.1 前端（GaolingLife.tsx — 960 行）

**功能清单**：

| 功能块 | 行数估计 | 描述 |
|--------|---------|------|
| 分类导航 | ~60 行 | 5 个分类 Tab：运动/就医/讲座/就餐/学习 |
| 帖子列表 | ~200 行 | 来源筛选（全部/官方/个人）+ 排序（时间/热门）+ 帖子卡片 |
| 帖子详情 | ~120 行 | 弹窗展示标题、内容、图片轮播、来源链接 |
| 发帖表单 | ~150 行 | 标题/内容/分类选择 + 图片上传 |
| AI 聊天面板 | ~250 行 | 右侧侧边栏，消息列表 + 输入框 + Markdown 渲染 |
| 类型定义 + 工具函数 | ~80 行 | CategoryKey, SourceFilter, normalizeCategory 等 |
| 引用高亮 | ~100 行 | AI 回答中 [1], [2] 引用对应帖子高亮 |

**关键状态**：
```typescript
// 核心状态
activeCategory: CategoryKey          // 当前分类
sourceFilter: SourceFilter           // 来源筛选
sortType: SortType                   // 排序方式
posts: Post[]                        // 帖子列表
selectedPost: Post | null            // 选中帖子（详情弹窗）

// AI 聊天
messages: Message[]                  // 对话消息
isChatting: boolean                  // 是否在对话中
isLoading: boolean                   // AI 加载中
sessionId: string                    // 会话 ID
sortedPosts: Post[]                  // AI 排序后的帖子

// 发帖
showPostForm: boolean                // 发帖表单显隐
```

### 2.2 后端 API（Express.js — 6 个路由）

| 路由 | 方法 | 功能 | Prisma 模型 |
|------|------|------|-------------|
| `/api/gaoling-life/posts` | GET | 分类/来源/排序筛选帖子列表 | `gaolingLifePost.findMany` |
| `/api/gaoling-life/posts` | POST | 创建个人帖子 | `gaolingLifePost.create` |
| `/api/gaoling-life/crawl` | POST | 触发爬虫，解析并 upsert 帖子 | `gaolingLifePost.upsert` |
| `/api/gaoling-life/agent/chat` | POST | RAG 智能问答（转发到 Python 服务） | — |
| `/api/gaoling-life/agent/update` | POST | 更新向量索引 | — |
| `/api/gaoling-life/agent/stats` | GET | 索引统计 | — |

**定时任务**：`cron.schedule("0 */6 * * *")` — 每 6 小时自动爬取

**数据库模型（Prisma）**：
```prisma
model GaolingLifePost {
  id          Int      @id @default(autoincrement())
  title       String
  summary     String
  category    String   // sport | medical | lecture | dining | study
  isOfficial  Boolean  @default(true)
  likes       Int      @default(0)
  authorName  String?
  coverImage  String?
  images      String[] // 多图
  sourceUrl   String?  @unique
  publishTime DateTime?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

### 2.3 爬虫系统

**两个版本**：

1. **gaoling_life.py**（主版本，243 行）
   - 依赖：`requests` + `beautifulsoup4` + `charset_normalizer`
   - 解析 `ai.ruc.edu.cn/newslist/newsdetail/` 的新闻列表页
   - 逐条爬取详情页：标题、发布时间、正文、封面图
   - `infer_category()` 根据关键词推断分类
   - 支持多页翻页（最多 5 页）
   - stdout 输出 JSON，stderr 输出日志

2. **gaoling_life_simple.py**（纯正则备用版，160 行）
   - 不依赖 BeautifulSoup，纯 `re` 解析
   - 功能相同但鲁棒性较差

### 2.4 RAG 智能体

**架构**：
```
用户提问 → Embedding API（SiliconFlow bge-m3）
     ↓
ChromaDB 向量检索（Top-K=6）
     ↓
构建上下文 → LLM API（SiliconFlow DeepSeek-V3）
     ↓
生成回答 + 解析引用 [1], [2]
     ↓
返回 { answer, sortedPosts, citedPosts }
```

**关键配置**：
- Embedding：`BAAI/bge-m3`（SiliconFlow API）
- LLM：`deepseek-ai/DeepSeek-V3.2`（SiliconFlow API）
- 向量存储：ChromaDB PersistentClient，按分类分 collection
- 语料来源：JSONL 文件（`dataset/gsai/gsai_chat_{category}.jsonl`）

---

## 3. 目标架构

### 3.1 整体架构图

```
智阶新版
├── frontend (Vite + React + TypeScript + Tailwind)
│   ├── src/pages/GaolingLifePage.tsx          # 页面壳
│   ├── src/components/gaoling/
│   │   ├── CategoryNav.tsx                    # 分类导航（5 Tab）
│   │   ├── PostFeed.tsx                       # 帖子列表 + 筛选
│   │   ├── PostCard.tsx                       # 帖子卡片
│   │   ├── PostDetail.tsx                     # 帖子详情弹窗/侧栏
│   │   ├── CreatePostForm.tsx                 # 发帖表单
│   │   └── GaolingChatPanel.tsx               # AI 聊天面板
│   └── src/services/gaolingLifeApi.ts         # API 调用层
│
└── backend (FastAPI + SQLAlchemy + PostgreSQL)
    └── app/
        ├── api/v1/gaoling_life.py             # REST 路由
        ├── models/gaoling_life.py             # SQLAlchemy 模型
        ├── schemas/gaoling_life.py            # Pydantic 请求/响应
        ├── services/
        │   ├── gaoling_crawler.py             # 爬虫（从 science1204 迁移）
        │   └── gaoling_rag.py                 # RAG 检索 + LLM 生成
        ├── cli/crawl_gaoling.py               # CLI 命令：手动触发爬取
        └── workers/gaoling_worker.py          # Celery 定时爬取任务
```

### 3.2 路由规划

```
/gaoling                              # 高瓴生活主页（帖子列表 + AI 侧栏）
/gaoling?category=sport               # 分类筛选（query param）
/gaoling/post/:id                     # 帖子详情（可选独立页 or 弹窗）
/gaoling/create                       # 发帖页面（可选独立页 or 弹窗）
```

### 3.3 API 路由（FastAPI v1 前缀）

| 路由 | 方法 | 功能 |
|------|------|------|
| `/api/v1/gaoling/posts` | GET | 帖子列表（分类/来源/排序/分页） |
| `/api/v1/gaoling/posts` | POST | 创建帖子（需认证） |
| `/api/v1/gaoling/posts/{id}` | GET | 帖子详情 |
| `/api/v1/gaoling/posts/{id}/like` | POST | 点赞 |
| `/api/v1/gaoling/chat` | POST | RAG 智能问答 |
| `/api/v1/gaoling/crawl` | POST | 手动触发爬取（管理员） |

---

## 4. 前端迁移计划

### 4.1 组件拆分策略

从 960 行单文件拆分为 6 个组件 + 1 个页面 + 1 个 service：

#### 4.1.1 `GaolingLifePage.tsx`（~80 行）
**职责**：页面容器，编排子组件布局
```
┌─────────────────────────────────────────────────┐
│  CategoryNav                                     │
├───────────────────────────────┬──────────────────┤
│  PostFeed (70%)               │ GaolingChatPanel │
│  ┌─────────────────────────┐  │ (30%)            │
│  │ PostCard                │  │                  │
│  │ PostCard                │  │  [对话消息]       │
│  │ PostCard                │  │  [输入框]         │
│  │ ...                     │  │                  │
│  └─────────────────────────┘  │                  │
├───────────────────────────────┴──────────────────┤
│  PostDetail (弹窗 overlay)                        │
│  CreatePostForm (弹窗 overlay)                    │
└─────────────────────────────────────────────────┘
```

#### 4.1.2 `CategoryNav.tsx`（~60 行）
- 5 个分类 Tab + active 状态
- 接收 `activeCategory` + `onChange` props
- Editorial 样式：衬线字体标题，红色 active 下划线

#### 4.1.3 `PostFeed.tsx`（~120 行）
- 来源筛选 Tabs（全部/官方/个人）
- 排序切换（时间/热门）
- PostCard 列表渲染
- 加载更多/分页

#### 4.1.4 `PostCard.tsx`（~80 行）
- 封面图 + 标题 + 摘要 + 作者 + 时间 + 点赞数
- 官方标签 badge
- Editorial 样式：`border-l-3 border-l-red-primary`，hover 动效

#### 4.1.5 `PostDetail.tsx`（~100 行）
- Modal 或 侧滑详情
- 图片轮播（如果多图）
- 全文内容 + 来源链接
- Framer Motion 进入/退出动画

#### 4.1.6 `CreatePostForm.tsx`（~100 行）
- 标题、内容、分类选择
- 图片上传（拖拽区域）
- 提交后刷新列表

#### 4.1.7 `GaolingChatPanel.tsx`（~180 行）
- 消息列表（用户/AI 气泡）
- Markdown 渲染（react-markdown + remark-math + rehype-katex）
- 引用 [1], [2] 点击跳转到对应帖子
- 输入框 + 发送按钮
- 加载态（typing indicator）

### 4.2 设计系统适配

| 元素 | 旧版 | 新版（Editorial Academic） |
|------|------|---------------------------|
| 分类标题 | 系统字体 | `font-heading`（Instrument Serif） |
| 正文 | 系统字体 | `font-body`（Satoshi / Noto Sans SC） |
| 主色调 | 自定义 | `red-primary: #A5192E` |
| 卡片 | box-shadow | `border border-border-warm`，hover → `border-red-primary` |
| 背景 | 白色 | `bg-main: #F7F5F2`（暖纸张色） |
| 官方标签 | 蓝色 | `accent-gold: #C49A2A` |
| AI 气泡 | 灰色 | `bg-accent: #FFF8F0` 暖色背景 |
| 动效 | 无 | Framer Motion staggered fade-in |

### 4.3 新增前端文件清单

```
src/
├── pages/GaolingLifePage.tsx
├── components/gaoling/
│   ├── CategoryNav.tsx
│   ├── PostFeed.tsx
│   ├── PostCard.tsx
│   ├── PostDetail.tsx
│   ├── CreatePostForm.tsx
│   └── GaolingChatPanel.tsx
├── services/gaolingLifeApi.ts
└── types/gaoling.ts                   # 类型定义
```

---

## 5. 后端迁移计划

### 5.1 Express → FastAPI 路由映射

| Express 路由 | FastAPI 路由 | 变更说明 |
|-------------|-------------|---------|
| `GET /api/gaoling-life/posts` | `GET /api/v1/gaoling/posts` | 前缀改为 v1，连字符改下划线 |
| `POST /api/gaoling-life/posts` | `POST /api/v1/gaoling/posts` | 添加 JWT 认证 |
| `POST /api/gaoling-life/crawl` | `POST /api/v1/gaoling/crawl` | 管理员权限 |
| `POST /api/gaoling-life/agent/chat` | `POST /api/v1/gaoling/chat` | 合并到主后端 |

### 5.2 数据库模型（SQLAlchemy）

```python
# app/models/gaoling_life.py

class GaolingLifePost(Base):
    __tablename__ = "gaoling_life_posts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    title = Column(String(500), nullable=False)
    summary = Column(Text, nullable=False)
    content = Column(Text, nullable=True)          # 新增：完整正文
    category = Column(
        String(20), nullable=False, index=True,
        comment="sport | medical | lecture | dining | study"
    )
    is_official = Column(Boolean, default=True)
    likes = Column(Integer, default=0)
    author_name = Column(String(100), nullable=True)
    cover_image = Column(String(500), nullable=True)
    images = Column(ARRAY(String), default=[])      # PostgreSQL 数组
    source_url = Column(String(500), unique=True, nullable=True)
    publish_time = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())

    # 新增字段
    embedding_synced = Column(Boolean, default=False)  # 是否已同步到向量库
    view_count = Column(Integer, default=0)            # 浏览量
    user_id = Column(UUID, ForeignKey("users.id"), nullable=True)  # 发帖用户
```

**与旧模型的差异**：
- 新增 `content` 字段（存储爬虫获取的完整正文，RAG 检索用）
- 新增 `embedding_synced` 字段（追踪向量索引同步状态）
- 新增 `view_count` 字段
- 新增 `user_id` 外键（关联智阶用户系统）
- `images` 使用 PostgreSQL 原生数组类型

### 5.3 Pydantic Schema

```python
# app/schemas/gaoling_life.py

class PostBase(BaseModel):
    title: str = Field(..., min_length=1, max_length=500)
    summary: str = Field(..., min_length=1)
    category: Literal["sport", "medical", "lecture", "dining", "study"]

class PostCreate(PostBase):
    images: list[str] = []
    cover_image: str | None = None

class PostResponse(PostBase):
    id: int
    is_official: bool
    likes: int
    author_name: str | None
    cover_image: str | None
    images: list[str]
    source_url: str | None
    publish_time: datetime | None
    created_at: datetime
    view_count: int

class PostListResponse(BaseModel):
    ok: bool = True
    data: list[PostResponse]
    total: int
    page: int
    limit: int

# RAG Chat
class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=1000)
    category: str | None = None
    session_id: str | None = None

class CitedPost(BaseModel):
    post_id: int
    citation_index: int
    excerpt: str | None = None

class ChatResponse(BaseModel):
    success: bool
    answer: str | None = None
    sorted_post_ids: list[int] | None = None
    cited_posts: list[CitedPost] | None = None
    session_id: str | None = None
    error: str | None = None
```

### 5.4 数据库迁移

```bash
# 新建 Alembic 迁移
alembic revision --autogenerate -m "add_gaoling_life_posts_table"
alembic upgrade head
```

迁移文件路径：`app/db/migrations/versions/0005_gaoling_life_posts.py`

### 5.5 API 实现要点

```python
# app/api/v1/gaoling_life.py

router = APIRouter(prefix="/gaoling", tags=["gaoling-life"])

@router.get("/posts", response_model=PostListResponse)
async def list_posts(
    category: str | None = None,
    source: Literal["all", "official", "personal"] = "all",
    sort: Literal["time", "hot"] = "time",
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    ...

@router.post("/posts", response_model=PostResponse)
async def create_post(
    data: PostCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ...

@router.post("/chat", response_model=ChatResponse)
async def chat(
    data: ChatRequest,
    db: AsyncSession = Depends(get_db),
):
    # 1. 从数据库获取帖子
    # 2. 调用 RAG 服务
    # 3. 返回结果
    ...

@router.post("/crawl")
async def trigger_crawl(
    current_user: User = Depends(get_current_admin),  # 管理员
):
    # 触发 Celery 异步任务
    ...
```

---

## 6. 爬虫系统迁移

### 6.1 迁移策略

爬虫代码从 `server/crawlers/gaoling_life.py` 迁移到 `app/services/gaoling_crawler.py`，核心逻辑保持不变，外壳适配 FastAPI 生态。

### 6.2 改造要点

| 改造项 | 旧版 | 新版 |
|--------|------|------|
| 调用方式 | Node `child_process.spawn` | FastAPI 直接调用 / Celery 异步任务 |
| 输出方式 | stdout JSON | 函数返回 `list[dict]` |
| 入库方式 | Node 解析 stdout → Prisma upsert | Python 直接 SQLAlchemy upsert |
| 依赖 | `requests` + `beautifulsoup4` + `charset_normalizer` | 同上（加入 `requirements.txt`） |
| 定时任务 | `node-cron` | Celery Beat |
| 去重逻辑 | `sourceUrl` 唯一索引 | 同上 |
| 旧数据清理 | `cleanupOldGaolingLifePosts()` 保留最新 N 条 | 同上逻辑移植 |

### 6.3 新增依赖

```txt
# requirements.txt 新增
beautifulsoup4==4.12.3
charset-normalizer==3.4.1    # 已随 requests 安装
```

### 6.4 CLI 命令

```python
# app/cli/crawl_gaoling.py
# 用法：python -m app.cli.crawl_gaoling --max-pages 5
```

### 6.5 Celery 定时任务

```python
# app/workers/gaoling_worker.py

@celery_app.task(name="crawl_gaoling_life")
def crawl_gaoling_life_task(max_pages: int = 5):
    """每 6 小时自动爬取 ai.ruc.edu.cn 新闻"""
    ...

# Celery Beat 配置
CELERY_BEAT_SCHEDULE = {
    "crawl-gaoling-life-every-6h": {
        "task": "crawl_gaoling_life",
        "schedule": crontab(minute=0, hour="*/6"),
    },
}
```

---

## 7. RAG 聊天机器人迁移

### 7.1 当前架构问题

1. **独立服务**：RAG 作为单独的 FastAPI 服务运行在 8001 端口，增加部署复杂度
2. **硬编码 API Key**：SiliconFlow API Key 直接写在 `config.py` 中
3. **ChromaDB 本地持久化**：向量库与应用进程绑定，不支持多实例
4. **JSONL 语料文件**：数据源与数据库不同步
5. **重复代码**：`rank_posts_by_query()` 在 `gaoling_life_agent_api.py` 和 `dynamic.py` 中各有一份

### 7.2 迁移方案

**方案 A（推荐）：PostgreSQL pgvector 替代 ChromaDB**

```
优点：
- 一个数据库搞定结构化数据 + 向量检索
- 与现有 PostgreSQL 基础设施统一
- 原生支持 SQL JOIN（帖子+向量同表查询）
- 支持多实例部署

缺点：
- 需要安装 pgvector 扩展
- 需要修改 docker-compose.yml
```

```python
# 在 GaolingLifePost 模型中添加向量列
from pgvector.sqlalchemy import Vector

class GaolingLifePost(Base):
    ...
    embedding = Column(Vector(1024), nullable=True)  # bge-m3 输出 1024 维
```

**方案 B：保留 ChromaDB 作为独立向量库**

```
优点：
- 改动最小，快速迁移
- ChromaDB 查询语法成熟

缺点：
- 需要额外维护 ChromaDB 容器/进程
- 数据同步逻辑复杂（DB → ChromaDB）
```

### 7.3 RAG 服务模块设计

```python
# app/services/gaoling_rag.py

class GaolingRAGService:
    """高瓴生活 RAG 问答服务"""

    def __init__(self, llm_client: LLMClient, db: AsyncSession):
        self.llm = llm_client
        self.db = db

    async def chat(self, query: str, category: str | None = None) -> ChatResult:
        """
        1. 获取 query embedding（调用 Embedding API）
        2. 从数据库检索相关帖子（pgvector 余弦相似度）
        3. 构建 prompt + context
        4. 调用 LLM 生成回答
        5. 解析引用 [1], [2]
        6. 返回结构化结果
        """
        ...

    async def sync_embeddings(self, batch_size: int = 50):
        """批量同步未索引帖子的 embedding"""
        ...
```

### 7.4 Embedding 管理

```python
# 新帖子入库后，异步计算 embedding
# 方式1：在 crawl 完成后批量计算
# 方式2：Celery 后台任务定期扫描 embedding_synced=False 的记录

@celery_app.task
def sync_gaoling_embeddings():
    """扫描未同步 embedding 的帖子，批量计算并更新"""
    ...
```

### 7.5 LLM 配置统一

当前 RAG 使用 SiliconFlow API（DeepSeek-V3），智阶后端使用 OpenRouter。需要决定：

| 选项 | 描述 |
|------|------|
| **A：统一用 OpenRouter** | 复用现有 `llm_client.py`，减少 API Key 管理，但 DeepSeek-V3 在 OpenRouter 上可能贵 |
| **B：保留 SiliconFlow** | 添加 `SILICONFLOW_API_KEY` 到 `.env`，为 RAG 专用 |
| **C：可配置** | 在 `config.py` 中支持多 provider，根据任务类型选择 |

---

## 8. 新功能增强

### 8.1 搜索增强

| 功能 | 描述 | 优先级 |
|------|------|--------|
| **全文搜索** | PostgreSQL `tsvector` 全文索引，支持中文分词 | 高 |
| **搜索框** | 顶部搜索栏，实时过滤帖子 | 高 |
| **搜索建议** | 热门搜索词 + 历史搜索 | 中 |

### 8.2 个性化推荐

| 功能 | 描述 | 优先级 |
|------|------|--------|
| **浏览历史** | 基于用户浏览记录推荐 | 中 |
| **热门趋势** | 24h 内浏览/点赞增长最快的帖子 | 中 |
| **智能分类推荐** | 根据用户常看分类调整首页展示 | 低 |

### 8.3 社区互动

| 功能 | 描述 | 优先级 |
|------|------|--------|
| **评论系统** | 帖子下方评论（需认证） | 中 |
| **收藏** | 帖子收藏到个人中心 | 中 |
| **分享** | 生成分享链接/海报 | 低 |
| **举报** | 不当内容举报 | 低 |

### 8.4 AI 增强

| 功能 | 描述 | 优先级 |
|------|------|--------|
| **流式回答** | SSE 流式输出 AI 回答（已有 sse-starlette 依赖） | 高 |
| **多轮对话** | 服务端维护会话上下文（Redis 缓存） | 中 |
| **自动摘要** | 长文帖子自动生成 AI 摘要 | 中 |
| **智能标签** | AI 自动为帖子打标签 | 低 |

### 8.5 爬虫增强

| 功能 | 描述 | 优先级 |
|------|------|--------|
| **更多数据源** | 爬取人大官网其他栏目（通知公告、学术会议等） | 中 |
| **增量爬取** | 只爬取新帖子，避免重复请求 | 高 |
| **爬取状态监控** | 管理后台查看爬取历史、成功率、错误日志 | 中 |
| **Webhook 通知** | 新帖子入库后推送通知 | 低 |

---

## 9. 时间线（8-10 天）

### Phase 1：后端基础（Day 1-3）

| 天 | 任务 | 产出 |
|----|------|------|
| **D1** | 数据库模型 + Alembic 迁移 | `0005_gaoling_life_posts.py` |
| **D1** | Pydantic schema 定义 | `schemas/gaoling_life.py` |
| **D2** | CRUD API 路由（GET/POST posts） | `api/v1/gaoling_life.py` |
| **D2** | 爬虫迁移 + CLI 命令 | `services/gaoling_crawler.py` + `cli/crawl_gaoling.py` |
| **D3** | Celery 定时爬取任务 | `workers/gaoling_worker.py` |
| **D3** | API 单元测试 | `tests/test_gaoling_life.py` |

### Phase 2：RAG 集成（Day 4-5）

| 天 | 任务 | 产出 |
|----|------|------|
| **D4** | pgvector 扩展安装 + 向量列迁移 | Docker 更新 + `0006_gaoling_embeddings.py` |
| **D4** | Embedding 同步服务 | `services/gaoling_rag.py` |
| **D5** | RAG Chat 端点 | `POST /api/v1/gaoling/chat` |
| **D5** | LLM 集成（SiliconFlow/OpenRouter） | 配置 + 测试 |

### Phase 3：前端搭建（Day 6-8）

| 天 | 任务 | 产出 |
|----|------|------|
| **D6** | 页面路由 + CategoryNav + PostCard | 基础页面可见 |
| **D6** | PostFeed + API 对接 | 帖子列表可用 |
| **D7** | PostDetail + CreatePostForm | 详情查看 + 发帖功能 |
| **D7** | Editorial Academic 样式适配 | 全套设计系统 |
| **D8** | GaolingChatPanel + RAG 对接 | AI 聊天可用 |
| **D8** | Framer Motion 动效 | 页面/卡片动画 |

### Phase 4：联调 + 收尾（Day 9-10）

| 天 | 任务 | 产出 |
|----|------|------|
| **D9** | 端到端联调（爬虫 → DB → API → 前端） | 完整流程跑通 |
| **D9** | 旧数据迁移脚本（从 Prisma DB 导入） | `scripts/migrate_gaoling_data.py` |
| **D10** | Bug 修复 + 性能优化 | 稳定版本 |
| **D10** | 文档更新 + PR 提交 | 合并就绪 |

---

## 10. 需要 Codex 讨论的技术决策

### Q1：向量存储选型

> **pgvector vs ChromaDB vs 纯 API 计算**
>
> 当前 RAG 使用 ChromaDB + SiliconFlow Embedding API。迁移后有三个选项：
>
> - **pgvector**：向量存储在 PostgreSQL 中，一个数据库搞定一切，部署最简单。需要安装扩展。
> - **ChromaDB**：保留现有方案，但需要额外容器和数据同步逻辑。
> - **纯 API 计算**：不存储向量，每次查询实时调 Embedding API 计算相似度（当前 `rank_posts_by_query()` 就是这样做的）。简单但慢且贵。
>
> **我的倾向**：pgvector，和现有 PostgreSQL 统一。请评估可行性和性能影响。

### Q2：LLM Provider 统一

> 智阶后端用 OpenRouter（`openai` SDK），RAG 用 SiliconFlow（原生 HTTP 调用）。
>
> - 是否统一到 OpenRouter？
> - 还是为 RAG 保留 SiliconFlow（便宜，bge-m3 embedding 免费）？
> - 是否需要 provider 抽象层？

### Q3：前端路由策略

> 高瓴生活是作为智阶的一个顶级页面（`/gaoling`），还是放在某个 namespace 下？
>
> - 选项 A：`/gaoling` — 顶级路由，侧边栏新增入口
> - 选项 B：`/campus/gaoling` — 预留 campus 命名空间，未来可扩展到其他学校
> - 选项 C：`/explore/gaoling` — 放在知识网络探索下
>
> **我的倾向**：A（`/gaoling`），因为这是高瓴特色功能，值得顶级入口。

### Q4：爬虫频率与数据量

> 当前每 6 小时爬一次，最多 5 页。
>
> - 实际产出大约 50-80 条帖子
> - `ai.ruc.edu.cn` 更新频率较低（每天 0-3 条新闻）
> - 是否需要调整为每天一次？
> - 是否需要增加更多数据源（人大官网通知、微信公众号等）？

### Q5：认证与权限

> - 浏览帖子是否需要登录？（当前不需要）
> - 发帖是否需要登录？（建议需要）
> - AI 聊天是否需要登录？（建议不需要，但有 rate limit）
> - 触发爬虫是否需要管理员权限？（建议需要）
>
> 请确认权限矩阵。

### Q6：数据迁移

> science1204 的 Prisma 数据库中已有爬取的帖子数据。
>
> - 是否需要写迁移脚本，将现有数据导入智阶 PostgreSQL？
> - 还是重新爬取一次就够了？
> - ChromaDB 中的向量数据是否需要迁移？（如果选 pgvector 就不需要）

### Q7：SSE 流式 vs 一次性返回

> 当前 RAG 是一次性返回完整回答。是否需要改为 SSE 流式输出？
>
> - 智阶后端已有 `sse-starlette` 依赖（用于 pipeline 进度推送）
> - 流式输出用户体验更好（打字机效果）
> - 但增加前端复杂度（需要处理 EventSource）
>
> **我的倾向**：第一版先一次性返回，后续迭代改为流式。

### Q8：安全问题 — API Key 处理

> 当前代码中 SiliconFlow API Key **硬编码**在 `config.py` 中：
> ```python
> LLM_API_KEY = "sk-unbxzqtnuxapmtseptzwrtzdmlqlfsddaupwyrfehtqbmhkp"
> ```
>
> 迁移时必须：
> 1. 移入 `.env` 文件
> 2. 通过 `pydantic-settings` 的 `Settings` 加载
> 3. 确保 `.env` 在 `.gitignore` 中
> 4. 旧仓库中的 key 是否需要轮换？

### Q9：测试策略

> - 爬虫测试：mock HTTP 响应 or 实际爬取？
> - RAG 测试：mock LLM API or 实际调用（成本）？
> - 前端测试：Vitest 组件测试 or Playwright E2E？
> - 目标覆盖率：>80%（符合项目规范）？

### Q10：分支策略

> 高瓴生活作为「中国人民大学高瓴人工智能学院」的专属功能：
>
> - 是否在 `feature/gaoling-life` 分支开发？
> - 合并到 master 还是维护 `gaoling` 长期分支？
> - 是否需要 feature flag 控制显隐（其他学校不需要这个功能）？

---

## 附录 A：文件对照表

| 旧文件（science1204） | 新文件（智阶新版） |
|----------------------|-------------------|
| `components/GaolingLife.tsx` | `src/pages/GaolingLifePage.tsx` + `src/components/gaoling/*.tsx` |
| `services/gaolingLifeService.ts` | `src/services/gaolingLifeApi.ts` |
| `server/index.ts`（gaoling 路由部分） | `backend/app/api/v1/gaoling_life.py` |
| Prisma GaolingLifePost | `backend/app/models/gaoling_life.py` |
| `server/crawlers/gaoling_life.py` | `backend/app/services/gaoling_crawler.py` |
| `chatbot/gaoling_life_agent_api.py` | `backend/app/services/gaoling_rag.py` |
| `chatbot/dynamic.py` | `backend/app/services/gaoling_rag.py`（合并） |
| `chatbot/config.py` | `backend/app/core/config.py`（合并到 Settings） |
| `chatbot/doc/gaoling-life-agent-api.md` | 本文档 + OpenAPI 自动生成 |

## 附录 B：新增依赖

### Backend（requirements.txt）

```txt
beautifulsoup4==4.12.3        # 爬虫 HTML 解析
pgvector==0.4.0               # 向量存储（如果选方案 A）
# chromadb==0.6.3             # 向量存储（如果选方案 B）
```

### Frontend（package.json）

```json
{
  "dependencies": {
    // 已有依赖，无需新增
    // react-markdown, remark-math, rehype-katex — 已安装
    // framer-motion — 已安装
  }
}
```

### Docker（docker-compose.yml）

```yaml
# PostgreSQL 需要启用 pgvector 扩展
services:
  db:
    image: pgvector/pgvector:pg16  # 替换为 pgvector 镜像
```

---

> **下一步**：请 Codex 审阅本文档，特别关注 Q1-Q10 的技术决策。确认后开始 Phase 1 实施。
