# 消灭所有 Mock — 严格开发计划

> 目标：智阶平台不再有任何 mock/硬编码数据，所有功能连接真实后端或真实数据源。
> 数据来源：csdiy.wiki (PKUFlyingPig/cs-self-learning) 的 150+ 门优质课程。

---

## 总览：需要消灭的 Mock 清单

| # | Mock 模块 | 当前状态 | 目标状态 | 优先级 |
|---|----------|---------|---------|--------|
| M1 | 课程数据 (courses.ts) | 8 门硬编码课程 | csdiy.wiki 150+ 真实课程 | P0 |
| M2 | 材料数据 (materials.ts) | 30 条假材料 | 后端 S3 + PostgreSQL | P0 |
| M3 | AI 分析管道 (api.ts USE_MOCK) | 前端 setInterval 模拟 | 连接真实后端 Celery pipeline | P0 |
| M4 | 材料上传 | localStorage base64 | 后端 S3 presigned upload | P0 |
| M5 | 学习统计 (activities.ts) | 硬编码 127min/7天 | 后端统计 API | P1 |
| M6 | 闪卡数据 (flashcards.ts) | 22 张预制卡 | AI 生成 + 后端持久化 | P1 |
| M7 | 苏格拉底对话 | 52 个模板 | OpenRouter 流式 LLM | P1 |
| M8 | 闪卡自进化 LLM 动作 | Mock 建议文本 | OpenRouter 真实生成 | P2 |
| M9 | 学习动态 (activities timeline) | 6 条假动态 | 后端事件流 | P2 |
| M10 | 日程学习任务 (agenda study items) | Mock 学习项 | 从学习记录推导 | P2 |

---

## Sprint 3：知识网络 + 材料上传真实化（1.5 周）

### 3.1 csdiy.wiki 课程爬虫（后端）

**目标**：从 GitHub 仓库 PKUFlyingPig/cs-self-learning 解析全部课程数据，写入数据库。

**数据源**：`https://raw.githubusercontent.com/PKUFlyingPig/cs-self-learning/master/docs/` 下的 Markdown 文件。

**数据模型**：
```python
class CourseCategory(Base):
    id: UUID
    name: str             # "数据结构与算法"
    slug: str             # "data-structures-algorithms"
    sort_order: int
    parent_id: UUID | None  # 支持子分类

class Course(Base):
    id: UUID
    category_id: UUID (FK)
    name: str              # "UCB CS61B: Data Structures and Algorithms"
    slug: str              # "cs61b"
    university: str        # "UC Berkeley"
    instructor: str | None # "Josh Hug"
    language: str          # "en" / "zh"
    programming_lang: str | None  # "Java"
    difficulty: int        # 1-5 星
    estimated_hours: int | None   # 60
    description: str       # 课程简介
    prerequisites: str | None     # "CS61A"
    website_url: str | None       # 课程官网
    video_url: str | None         # 视频链接
    csdiy_source: str      # "数据结构与算法/CS61B.md"（溯源）
    tags: list[str]        # ARRAY ["algorithms", "java", "berkeley"]
    student_count: int     # 默认 0，真实注册后递增
    material_count: int    # 默认 0
    created_at: datetime
```

**实现步骤**：
1. 写 `backend/app/services/course_scraper.py`
   - 从 GitHub API 获取 `/docs/` 目录树
   - 解析 `mkdocs.yml` 获取分类结构
   - 逐个解析课程 Markdown：提取课程名、大学、难度、时长、前置、链接
   - 写入 CourseCategory + Course 表
2. 写 Alembic 迁移 `0003_course_tables.py`
3. 写管理命令 `python -m app.cli.seed_courses` 执行爬取
4. 写 API `GET /api/v1/courses` (分页、分类筛选、搜索)
5. 写 API `GET /api/v1/courses/{slug}` (课程详情)
6. 写 API `GET /api/v1/courses/categories` (分类列表)

**预计课程数**：约 120-150 门，20+ 分类。

### 3.2 前端知识网络真实化

**目标**：ExplorePage 和 CoursePage 从后端 API 获取真实课程数据。

**实现步骤**：
1. `src/lib/api.ts` — 添加 `fetchCourses()`, `fetchCourse()`, `fetchCategories()`
2. `src/pages/ExplorePage.tsx` — 用 `useEffect` + `fetchCourses(category, search, page)` 替换 mock
3. `src/pages/CoursePage.tsx` — 用 `fetchCourse(slug)` 替换 mock
4. 删除 `src/mocks/courses.ts`

### 3.3 材料上传接入后端 S3

**目标**：UploadPage 通过 presigned URL 上传到 MinIO/S3。

**实现步骤**：
1. `src/lib/api.ts` — 添加 `requestUpload()`, `confirmUpload()`
2. `src/pages/UploadPage.tsx` — 替换 localStorage 逻辑为：
   - 调 `POST /materials/upload` 获取 presigned URL
   - `PUT` 文件到 presigned URL
   - 调 `POST /materials/{id}/confirm` 确认
3. `src/pages/MyMaterialsPage.tsx` — 用 `GET /materials` 替换 mock
4. 删除 `src/mocks/materials.ts`（保留 Markdown 渲染示例数据）

### 3.4 材料列表真实化

**目标**：CoursePage 的材料 Tab 从后端获取。

**实现步骤**：
1. `src/lib/api.ts` — `fetchMaterials(courseId)`
2. CoursePage 材料面板从 API 获取
3. 上传时关联 course_id

---

## Sprint 4：AI 管道前后端联调（1 周）

### 4.1 前端 SSE 连接真实后端

**目标**：`USE_MOCK=false`，AIToolPanel 连接真实 Celery pipeline。

**实现步骤**：
1. 创建 `.env` 文件 `VITE_USE_MOCK=false`
2. `src/lib/api.ts` — `subscribeProgress()` 改用真实 `EventSource`：
   ```typescript
   const es = new EventSource(
     `${API_BASE}/v1/disassembly/tasks/${taskId}/status?token=${token}`
   )
   ```
3. `startDisassembly()` 调真实 `POST /disassembly/start`
4. `getAnalysisResult()` 调真实 `GET /disassembly/tasks/${taskId}/result`
5. `getSpecialistResult()` 调真实 `GET /disassembly/tasks/${taskId}/module/${moduleId}`
6. 删除所有 `MOCK_MODULES`, `MOCK_QUIZ`, `MOCK_STEPS` 常量

### 4.2 启动 Celery Worker

**实现步骤**：
1. 验证 Celery worker 能正常启动
2. 上传一份真实 PDF
3. 触发分析 → 验证 4 阶段完成
4. 验证前端 SSE 实时接收进度
5. 验证精讲 Markdown 和测验题正确渲染

### 4.3 QuizPanel 溯源展示

**实现步骤**：
1. `QuizPanel.tsx` — 每题底部添加 "来源：{source_module_name} · 第{source_page}页"
2. 样式：`text-text-muted text-xs` + 书签 icon

---

## Sprint 5：闪卡 + 统计 后端化（1.5 周）

### 5.1 闪卡后端持久化

**数据模型**：
```python
class FlashcardDeck(Base):
    id: UUID
    user_id: UUID (FK)
    course_id: UUID (FK)
    name: str
    card_count: int
    due_count: int         # 缓存字段
    last_reviewed_at: datetime | None

class FlashcardNote(Base):
    id: UUID
    deck_id: UUID (FK)
    type: str              # basic/cloze/reverse/image-occlusion
    front: str
    back: str
    extra: str | None
    tags: list[str]
    source_material_id: UUID | None
    source_module_id: UUID | None
    source_page: int | None
    generated_by: str      # ai/user/ai-evolved
    created_at: datetime

class FlashcardCard(Base):
    id: UUID
    note_id: UUID (FK)
    # FSRS 状态
    due: datetime
    stability: float
    difficulty: float
    state: str             # new/learning/review/relearning
    reps: int
    lapses: int
    # 自进化追踪
    consecutive_again: int
    consecutive_easy: int
    avg_response_ms: int | None

class FlashcardReviewLog(Base):
    id: UUID
    card_id: UUID (FK)
    rating: int            # 1-4
    reviewed_at: datetime
    response_ms: int | None
```

**API**：
- `GET /flashcards/decks` — 用户的所有 deck
- `GET /flashcards/decks/{deckId}/due` — 获取到期卡片
- `POST /flashcards/decks/{deckId}/review` — 提交评分
- `POST /flashcards/generate` — AI 从 Specialist 输出生成闪卡
- `GET /flashcards/stats` — 复习统计

**实现步骤**：
1. Alembic 迁移 `0004_flashcard_tables.py`
2. 后端 CRUD API
3. AI 闪卡生成：从 SpecialistOutput 的 markdown + key_concepts 调 LLM 生成
4. 前端 `src/lib/fsrs.ts` 改为调后端 API（FSRS 计算可以前端做，但数据存后端）
5. 删除 `src/mocks/flashcards.ts`

### 5.2 学习统计真实化

**数据模型**：
```python
class StudySession(Base):
    id: UUID
    user_id: UUID (FK)
    course_id: UUID (FK)
    material_id: UUID | None
    activity_type: str     # reading/quiz/flashcard/analysis
    duration_seconds: int
    started_at: datetime
    ended_at: datetime

class UserStats(Base):  # 缓存表，定时刷新
    user_id: UUID (PK)
    today_minutes: int
    streak_days: int
    total_materials: int
    week_hours: float
    updated_at: datetime
```

**API**：
- `POST /stats/session` — 记录学习会话（前端定期上报）
- `GET /stats/summary` — 用户统计摘要
- `GET /stats/activities` — 学习动态列表

**实现步骤**：
1. Alembic 迁移 `0005_stats_tables.py`
2. 前端 `useStudyTimer()` hook：进入工作台/复习页时开始计时，离开时上报
3. HomePage 统计区域从 `GET /stats/summary` 获取
4. 学习动态从 `GET /stats/activities` 获取
5. 删除 `src/mocks/activities.ts`

---

## Sprint 6：苏格拉底对话 + 自进化 真实化（1 周）

### 6.1 苏格拉底对话接入 LLM

**后端 API**：
- `POST /dialogue/start` — 开启对话会话
- `GET /dialogue/{sessionId}/stream` — SSE 流式响应

**实现**：
1. 后端 `app/api/v1/dialogue.py` — SSE 端点
2. 使用 `LLMClient.stream_text()` 调 OpenRouter
3. System prompt 包含：当前模块精讲内容 + 学生 mastery + 脚手架等级
4. 前端 `SocraticChat.tsx` — 从模板驱动改为 SSE 流式接收

### 6.2 闪卡自进化接入 LLM

**后端 API**：
- `POST /flashcards/evolve` — 触发进化动作

**实现**：
1. 后端接收触发条件 + 原始卡片
2. 调 LLM 生成：拆分子卡 / 改写问法 / 添加提示
3. 返回新卡片数据
4. 前端 `card-evolution.ts` 改为调后端 API

---

## Sprint 7：BKT 后端化 + 日程真实化（0.5 周）

### 7.1 学生模型后端化

**数据模型**：
```python
class StudentMastery(Base):
    id: UUID
    user_id: UUID (FK)
    course_id: UUID (FK)
    module_id: UUID | None (FK)
    mastery: float          # 0.0-1.0
    updated_at: datetime
```

**API**：
- `GET /student/mastery?courseId=xxx` — 获取 mastery
- `POST /student/feedback` — 提交反馈信号（测验/闪卡/学习时间）

### 7.2 日程引擎后端化

**实现**：
1. `GET /agenda/today` — 服务端合并：闪卡到期 + 学习计划 + 待办 + 考试倒计时
2. `POST /agenda/todos` — 待办 CRUD
3. `POST /agenda/exams` — 考试日期设置
4. 删除 `src/mocks/agenda.ts`

---

## 文件删除清单（最终）

完成所有 Sprint 后删除：
```
src/mocks/courses.ts      → Sprint 3 删除
src/mocks/materials.ts    → Sprint 3 删除
src/mocks/flashcards.ts   → Sprint 5 删除
src/mocks/activities.ts   → Sprint 5 删除
src/mocks/agenda.ts       → Sprint 7 删除
```

`api.ts` 中的 `USE_MOCK` 逻辑和所有 `MOCK_*` 常量在 Sprint 4 删除。

---

## 技术约束

1. **所有新 API 必须有 JWT 鉴权**（除了 GET /courses 公开浏览）
2. **所有数据库操作必须有 Alembic 迁移**，不允许手动建表
3. **前端不允许新增任何 mock 数据**
4. **csdiy.wiki 数据每月自动更新**（后期 GitHub Actions cron）
5. **OpenRouter 调用必须有 token 审计**（input_tokens/output_tokens 记录）
6. **单文件 ≤ 400 行**，函数 ≤ 50 行

---

## 工期估算

| Sprint | 内容 | 时间 |
|--------|------|------|
| Sprint 3 | 知识网络 + 材料上传 | 1.5 周 |
| Sprint 4 | AI 管道联调 | 1 周 |
| Sprint 5 | 闪卡 + 统计 | 1.5 周 |
| Sprint 6 | 对话 + 自进化 | 1 周 |
| Sprint 7 | BKT + 日程 | 0.5 周 |
| **合计** | **消灭所有 Mock** | **5.5 周** |
