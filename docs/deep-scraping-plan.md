# 深度课程资料爬取 + AI 洗稿 + 课程创建工作流 — 技术方案

## 一、目标

1. **MIT OCW 深度爬虫**：从 MIT Learn API 获取完整课程元数据 + 材料列表（PDF/讲义/习题/考试）
2. **课程数据模型扩展**：区分原始描述 vs 平台描述，支持多来源课程数据
3. **AI 洗稿 Pipeline**：用 LLM 将爬取的原始内容重写为平台风格
4. **课程创建工作流**：定义课程从创建到发布的完整流程（PRD 草案）

---

## 二、数据模型扩展

### 2.1 Course 表新增字段

```sql
ALTER TABLE courses ADD COLUMN raw_description TEXT DEFAULT '';
ALTER TABLE courses ADD COLUMN platform_description TEXT DEFAULT '';
ALTER TABLE courses ADD COLUMN content_status VARCHAR(20) DEFAULT 'raw';
  -- raw | ai_rewritten | reviewed | published
ALTER TABLE courses ADD COLUMN learning_objectives TEXT;   -- JSON array or bullet list
ALTER TABLE courses ADD COLUMN target_audience TEXT;
ALTER TABLE courses ADD COLUMN syllabus JSONB;             -- structured syllabus
ALTER TABLE courses ADD COLUMN source_platform VARCHAR(50) DEFAULT 'csdiy';
  -- csdiy | mit_ocw | manual | stanford | coursera
ALTER TABLE courses ADD COLUMN source_id VARCHAR(200);     -- MIT OCW course ID, etc.
ALTER TABLE courses ADD COLUMN source_url VARCHAR(1000);   -- original source URL
ALTER TABLE courses ADD COLUMN instructor VARCHAR(200);    -- (already exists)
ALTER TABLE courses ADD COLUMN semester VARCHAR(20);       -- e.g., "Fall 2011"
ALTER TABLE courses ADD COLUMN level VARCHAR(20);          -- undergraduate | graduate
ALTER TABLE courses ADD COLUMN school VARCHAR(200);        -- School of Science, etc.
ALTER TABLE courses ADD COLUMN department VARCHAR(200);    -- Mathematics, EECS, etc.
ALTER TABLE courses ADD COLUMN image_url VARCHAR(1000);
ALTER TABLE courses ADD COLUMN completeness NUMERIC(3,2);  -- 0.00-1.00 (MIT OCW field)
ALTER TABLE courses ADD COLUMN last_scraped_at TIMESTAMP;
```

### 2.2 新增表：CourseMaterialSource（课程资料来源）

```sql
CREATE TABLE course_material_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title VARCHAR(500) NOT NULL,
  source_url VARCHAR(1000) NOT NULL,
  content_type VARCHAR(50) NOT NULL,       -- pdf, video, page, assignment, exam, notes
  content_feature VARCHAR(100),            -- "Lecture Notes", "Problem Sets", etc.
  file_extension VARCHAR(10),              -- .pdf, .mp4, .zip
  ocw_content_id INTEGER,                  -- MIT Learn API content ID
  downloaded BOOLEAN DEFAULT FALSE,
  s3_key VARCHAR(1000),                    -- after download, stored in S3
  file_size BIGINT,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_cms_course ON course_material_sources(course_id);
CREATE INDEX idx_cms_type ON course_material_sources(content_type);
```

### 2.3 迁移策略

- Alembic migration `0004_course_extensions.py`
- 非破坏性：全部用 ADD COLUMN + DEFAULT，不影响已有数据
- 现有 csdiy 课程的 description → 复制到 raw_description，content_status = 'raw'

---

## 三、MIT OCW 深度爬虫

### 3.1 API 调用计划

| 步骤 | API | 说明 |
|------|-----|------|
| 1 | `GET /api/v1/learning_resources/?platform=ocw&resource_type=course&limit=100&offset=N` | 分页获取所有 OCW 课程（~2567 门） |
| 2 | `GET /api/v1/contentfiles/?resource_id={id}&platform=ocw` | 获取每门课程的材料列表 |
| 3 | 过滤 `.pdf` 文件 | 只保留 PDF 类型的内容文件 |
| 4 | 解析 resource page HTML | 获取直接 PDF 下载链接 |

### 3.2 与 csdiy 课程匹配

MIT OCW 课程需要和已有 csdiy 课程做匹配：

```python
# 匹配策略（优先级递降）
1. 精确匹配：course.source_id == ocw_course.readable_id
2. 名称模糊匹配：fuzz.ratio(course.name, ocw_course.title) > 85
3. 课号匹配：csdiy 描述中包含 MIT 课号（如 "6.006", "18.06"）
4. 未匹配 → 创建新课程（source_platform='mit_ocw'）
```

### 3.3 爬虫服务架构

```
backend/app/services/
├── course_scraper.py          # 已有：csdiy.wiki 爬虫
├── ocw_scraper.py             # 新增：MIT OCW 爬虫
└── content_rewriter.py        # 新增：AI 洗稿服务

backend/app/cli/
├── seed_courses.py            # 已有：csdiy 种子数据
├── scrape_ocw.py              # 新增：MIT OCW 爬取 CLI
└── rewrite_courses.py         # 新增：AI 洗稿 CLI
```

### 3.4 ocw_scraper.py 核心逻辑

```python
@dataclass
class OCWCourse:
    ocw_id: int
    readable_id: str           # "18.06SC+fall_2011"
    title: str
    description: str           # HTML → strip to text
    url: str
    department: str            # "Mathematics"
    school: str                # "School of Science"
    course_number: str         # "18.06SC"
    level: str                 # "undergraduate" | "graduate"
    semester: str              # "Fall 2011"
    instructors: list[str]
    topics: list[str]
    course_features: list[str] # ["Lecture Notes", "Problem Sets", ...]
    image_url: str | None
    completeness: float        # 0.0-1.0
    content_files: list[OCWContentFile]

@dataclass
class OCWContentFile:
    content_id: int
    title: str
    url: str                   # resource page URL
    content_type: str          # pdf, video, page
    file_extension: str
    content_feature: str       # "Lecture Notes", "Exams", etc.

async def scrape_ocw_courses(
    department: str | None = None,
    limit: int | None = None,
) -> list[OCWCourse]:
    """Fetch courses from MIT Learn API."""
    ...

async def scrape_ocw_content_files(
    resource_id: int,
    file_types: list[str] = [".pdf"],
) -> list[OCWContentFile]:
    """Fetch content files for a specific course."""
    ...
```

### 3.5 安全与限流

- Rate limit: 0.2s between API calls (~5 req/s)
- 每批最多 100 条，总量 cap 5000（防止意外）
- URL 验证：只允许 `api.learn.mit.edu` 和 `ocw.mit.edu` 域名
- Response size cap: 5MB per response
- 超时: 30s per request
- 全程 httpx.AsyncClient 共享连接池

---

## 四、AI 洗稿 Pipeline

### 4.1 洗稿目标

将原始描述（csdiy 中文/OCW 英文 HTML）重写为平台风格：

```
输入（csdiy 原始）：
"这门课由MIT的Gilbert Strang教授开设，是全球最知名的线性代数课程之一..."

输出（平台风格）：
{
  "platform_description": "MIT 线性代数经典课程，由 Gilbert Strang 教授讲授。...",
  "learning_objectives": [
    "掌握矩阵运算、向量空间等核心概念",
    "理解线性变换的几何意义",
    "能够应用特征值分解解决实际问题"
  ],
  "target_audience": "理工科大一/大二学生，需要高中数学基础",
  "tags": ["linear-algebra", "mathematics", "mit", "undergraduate"]
}
```

### 4.2 Prompt 设计

```python
REWRITE_SYSTEM_PROMPT = """你是智阶平台的课程编辑 AI。
你的任务是将原始课程描述重写为平台标准格式。

要求：
1. platform_description: 2-4 句话，简洁专业，中文，包含课程核心内容和亮点
2. learning_objectives: 3-5 个学习目标，用动词开头（掌握、理解、能够...）
3. target_audience: 一句话，说明适合谁、需要什么前置知识
4. tags: 3-8 个英文标签，小写，连字符分隔

保持客观学术风格，不要营销话术。"""
```

### 4.3 Pydantic Schema

```python
class RewrittenCourse(BaseModel):
    platform_description: str
    learning_objectives: list[str]
    target_audience: str
    tags: list[str]
```

### 4.4 Batch 处理流程

```python
async def rewrite_batch(
    courses: list[Course],
    batch_size: int = 10,
    model: str = "anthropic/claude-sonnet-4-5-20250514",
) -> list[tuple[UUID, RewrittenCourse]]:
    """Batch rewrite course descriptions."""
    results = []
    for i in range(0, len(courses), batch_size):
        batch = courses[i:i+batch_size]
        tasks = [rewrite_single(c, model) for c in batch]
        batch_results = await asyncio.gather(*tasks, return_exceptions=True)
        results.extend(batch_results)
        await asyncio.sleep(1)  # rate limit between batches
    return results
```

### 4.5 成本估算

- 约 300 门 csdiy 课程 + ~2500 门 OCW 课程 = ~2800 门
- 每门：~500 input tokens + ~300 output tokens = ~800 tokens
- 总计：~2.2M tokens × Claude Sonnet price ≈ $6.60 input + $13.20 output ≈ **~$20**
- 可接受，一次性成本

---

## 五、课程创建工作流（PRD 草案）

### 5.1 课程生命周期

```
                    ┌──────────────┐
                    │   raw        │ ← 爬虫导入（csdiy/OCW）
                    └──────┬───────┘
                           │ AI 洗稿
                    ┌──────▼───────┐
                    │ ai_rewritten │ ← AI 自动生成平台描述
                    └──────┬───────┘
                           │ 人工审核
                    ┌──────▼───────┐
                    │  reviewed    │ ← 编辑确认/修改
                    └──────┬───────┘
                           │ 发布
                    ┌──────▼───────┐
                    │  published   │ ← 对外可见
                    └──────────────┘
```

### 5.2 手动创建课程流程

```
1. 管理员/教师进入"创建课程"页面
2. 填写基础信息：名称、分类、语言、难度
3. （可选）输入课程网站 URL → AI 自动抓取并生成描述
4. 编辑平台描述、学习目标、适合人群
5. 上传/关联课程材料（PDF、视频链接）
6. 预览 → 发布
```

### 5.3 API 扩展

```
POST   /api/v1/admin/courses           — 创建课程（管理员）
PUT    /api/v1/admin/courses/{id}      — 编辑课程
POST   /api/v1/admin/courses/{id}/rewrite  — 触发 AI 洗稿
PATCH  /api/v1/admin/courses/{id}/status   — 更新状态（reviewed/published）
GET    /api/v1/admin/courses?status=raw    — 按状态筛选
```

### 5.4 角色权限（未来）

| 角色 | 可见课程状态 | 可执行操作 |
|------|------------|-----------|
| 匿名用户 | published | 浏览 |
| 注册用户 | published | 浏览 + 上传材料 |
| 编辑 | all | 审核、修改、发布 |
| 管理员 | all | 创建、删除、管理用户 |

---

## 六、实施计划

### Sprint 3.5（本次）

| 序号 | 任务 | 文件 | 估计行数 |
|------|------|------|---------|
| 1 | Course 模型扩展 | `models/course.py` | +30 行 |
| 2 | Alembic 迁移 0004 | `migrations/versions/0004_...py` | ~80 行 |
| 3 | Schema 更新 | `schemas/course.py` | +25 行 |
| 4 | MIT OCW 爬虫服务 | `services/ocw_scraper.py` | ~250 行 |
| 5 | OCW 种子 CLI | `cli/scrape_ocw.py` | ~150 行 |
| 6 | AI 洗稿服务 | `services/content_rewriter.py` | ~120 行 |
| 7 | AI 洗稿 CLI | `cli/rewrite_courses.py` | ~80 行 |
| 8 | 数据迁移脚本 | `cli/migrate_descriptions.py` | ~40 行 |

### 依赖关系

```
1 → 2 → 3 (模型/迁移/schema 顺序)
1 → 4 → 5 (模型 → 爬虫 → CLI)
1 → 6 → 7 (模型 → 洗稿 → CLI)
2 → 8 (迁移后才能跑数据迁移)
```

### 并行可能

```
4 (OCW爬虫) 和 6 (AI洗稿) 可以并行开发
5 (OCW CLI) 和 7 (洗稿 CLI) 可以并行开发
```

---

## 七、风险与决策点

| 风险 | 缓解措施 |
|------|---------|
| MIT Learn API 变更/限流 | 本地缓存 JSON，二次处理 |
| OCW 课程与 csdiy 匹配不准 | 先人工验证前 50 个匹配结果 |
| AI 洗稿质量不稳定 | 人工审核环节兜底 |
| 2800 门课程洗稿成本 | ~$20，可接受 |
| PDF 下载量大（存储） | 先只存元数据，按需下载 |
| CC BY-NC-SA 合规 | 标注来源，非商业使用 |

### 需要产品经理决策的问题

1. 课程详情页展示哪些字段？（现在只展示 description）
2. 是否需要编辑后台？还是先用 CLI 管理？
3. OCW 课程是否直接展示给用户？还是先内部审核？
4. 材料下载策略：链接到 OCW 原站 vs 存到自己的 S3？
5. 多语言策略：OCW 英文描述保留还是全部翻译成中文？
