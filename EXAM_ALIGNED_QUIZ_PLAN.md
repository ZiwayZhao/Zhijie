# 考试对齐出题系统 — 开发方案

> 基于竞品调研 + OpenDataLoader 集成测试结论设计
> 目标：让 AI 生成的练习题贴近真实考试格式，而非固定 8-12 道 MCQ

---

## 一、现状分析

### 当前能力
| 模块 | 状态 | 限制 |
|------|------|------|
| Examiner Agent | ✅ 已上线 | 固定 8-12 道 MCQ，不支持填空/简答/计算 |
| QuizPanel 前端 | ✅ 已上线 | 只能渲染 MCQ（4 选项单选） |
| OpenDataLoader | ✅ 刚集成 | 可高质量提取 PDF（图片+bbox+表格） |
| 意图系统 | ✅ 基础版 | 三种意图（learn/exam/review），但"备考"模式未采集考试信息 |
| 学生模型 | ✅ BKT | 有 mastery 追踪，但未关联考试题型分布 |

### 核心问题
1. **题型单一**：真实大学考试 = 填空 20% + 判断 10% + 简答 30% + 计算 30% + 论述 10%，我们只出 MCQ
2. **题量固定**：固定 8-12 题，无法匹配真实试卷结构（如 6 道大题，每题 3-5 小题）
3. **无考试信息**：不知道用户考试的题型分布、时长、开卷/闭卷、是否允许计算器
4. **无真题参考**：未利用历年真题来校准出题风格

### 市场空白（调研结论）
**无产品做到「上传历年真题 → 分析题型格式 → 生成匹配练习题」**，这是差异化机会。

---

## 二、目标架构

```
用户选择"备考"意图
  ↓
ExamInfoCollector（考试信息采集）
  ├── 对话式采集：考试日期、时长、开/闭卷
  ├── 可选上传：历年真题 PDF/照片
  └── 输出：ExamProfile
        ↓
ExamAnalyzer（真题分析 — 可选）
  ├── OpenDataLoader 解析真题 PDF
  ├── Vision LLM 识别题型+分值分布
  └── 更新 ExamProfile.question_distribution
        ↓
Examiner v2（动态出题）
  ├── 输入：Specialist 摘要 + ExamProfile
  ├── 动态题型：MCQ / 填空 / 判断 / 简答 / 计算
  ├── 动态题量：匹配真实试卷结构
  └── 输出：ExaminerResult v2（多题型）
        ↓
QuizPanel v2（多题型渲染）
  ├── MCQ：保持现有交互
  ├── 填空：输入框 + 模糊匹配判分
  ├── 判断：True/False 按钮
  ├── 简答：textarea + AI 评分
  └── 计算：多步输入 + 过程分评分
```

---

## 三、数据模型

### 3.1 ExamProfile（考试画像）

```python
# backend/app/schemas/exam_profile.py

class QuestionTypeDistribution(BaseModel):
    """单个题型的分布"""
    question_type: str          # "mcq" | "fill_blank" | "true_false" | "short_answer" | "calculation" | "essay"
    count: int                  # 题目数量
    points_each: float          # 每题分值
    total_points: float         # 该题型总分
    percentage: float           # 占总分百分比

class ExamProfile(BaseModel):
    """考试画像 — 驱动 Examiner 动态出题"""
    # 基础信息（对话采集）
    exam_date: str | None = None                    # "2026-04-15"
    duration_minutes: int | None = None              # 120
    is_open_book: bool | None = None                 # True/False
    calculator_allowed: bool | None = None
    total_points: int = 100

    # 题型分布（真题分析 or 用户手动输入 or 默认推断）
    question_distribution: list[QuestionTypeDistribution] = []

    # 来源
    source: str = "default"     # "default" | "user_input" | "exam_analysis"
    analyzed_exam_s3_key: str | None = None  # 上传的真题 S3 key

    # 冷启动默认值
    @classmethod
    def default_for_course_type(cls, course_type: str) -> "ExamProfile":
        """根据课程类型生成合理默认分布"""
        if course_type in ("math", "physics", "engineering"):
            return cls(question_distribution=[
                QuestionTypeDistribution(question_type="mcq", count=10, points_each=2, total_points=20, percentage=0.20),
                QuestionTypeDistribution(question_type="fill_blank", count=5, points_each=2, total_points=10, percentage=0.10),
                QuestionTypeDistribution(question_type="calculation", count=4, points_each=10, total_points=40, percentage=0.40),
                QuestionTypeDistribution(question_type="short_answer", count=3, points_each=10, total_points=30, percentage=0.30),
            ])
        elif course_type in ("cs", "database", "algorithms"):
            return cls(question_distribution=[
                QuestionTypeDistribution(question_type="mcq", count=15, points_each=2, total_points=30, percentage=0.30),
                QuestionTypeDistribution(question_type="true_false", count=5, points_each=2, total_points=10, percentage=0.10),
                QuestionTypeDistribution(question_type="fill_blank", count=5, points_each=2, total_points=10, percentage=0.10),
                QuestionTypeDistribution(question_type="short_answer", count=3, points_each=10, total_points=30, percentage=0.30),
                QuestionTypeDistribution(question_type="calculation", count=2, points_each=10, total_points=20, percentage=0.20),
            ])
        else:
            # 文科/通识默认
            return cls(question_distribution=[
                QuestionTypeDistribution(question_type="mcq", count=20, points_each=2, total_points=40, percentage=0.40),
                QuestionTypeDistribution(question_type="true_false", count=10, points_each=1, total_points=10, percentage=0.10),
                QuestionTypeDistribution(question_type="short_answer", count=3, points_each=10, total_points=30, percentage=0.30),
                QuestionTypeDistribution(question_type="essay", count=1, points_each=20, total_points=20, percentage=0.20),
            ])
```

### 3.2 Question v2（多题型统一模型）

```python
# backend/app/schemas/question.py

class BaseQuestion(BaseModel):
    """所有题型的共享字段"""
    question_type: str          # "mcq" | "fill_blank" | "true_false" | "short_answer" | "calculation" | "essay"
    question: str               # 题干（支持 LaTeX）
    points: float               # 分值
    difficulty: str             # "easy" | "medium" | "hard"
    source_module_name: str
    source_page: int | None = None
    explanation: str            # 解析

class MCQuestion(BaseQuestion):
    """选择题（现有）"""
    question_type: str = "mcq"
    options: list[str]          # 4 个选项
    correct_index: int          # 0-3

class FillBlankQuestion(BaseQuestion):
    """填空题"""
    question_type: str = "fill_blank"
    blanks: list[str]           # 每个空的标准答案（支持多个可接受答案用 | 分隔）
    # 例: ["Entity-Relationship|ER", "实体-关系|ER"]

class TrueFalseQuestion(BaseQuestion):
    """判断题"""
    question_type: str = "true_false"
    correct_answer: bool        # True / False

class ShortAnswerQuestion(BaseQuestion):
    """简答题"""
    question_type: str = "short_answer"
    reference_answer: str       # 参考答案（200-500 字）
    scoring_rubric: list[str]   # 评分要点，如 ["提到范式的定义(2分)", "说明 1NF-3NF 区别(3分)"]

class CalculationQuestion(BaseQuestion):
    """计算题"""
    question_type: str = "calculation"
    steps: list[dict]           # [{"step": "第一步：建立方程", "answer": "$x = 5$", "points": 2}]
    final_answer: str           # 最终答案

# 统一联合类型
QuestionItem = MCQuestion | FillBlankQuestion | TrueFalseQuestion | ShortAnswerQuestion | CalculationQuestion
```

### 3.3 前端类型（TypeScript）

```typescript
// src/lib/types/question.ts

interface BaseQuestion {
  question_type: "mcq" | "fill_blank" | "true_false" | "short_answer" | "calculation"
  question: string
  points: number
  difficulty: "easy" | "medium" | "hard"
  source_module_name: string
  source_page: number | null
  explanation: string
}

interface MCQuestion extends BaseQuestion {
  question_type: "mcq"
  options: string[]
  correct_index: number
}

interface FillBlankQuestion extends BaseQuestion {
  question_type: "fill_blank"
  blanks: string[]  // 每个空的可接受答案（| 分隔）
}

interface TrueFalseQuestion extends BaseQuestion {
  question_type: "true_false"
  correct_answer: boolean
}

interface ShortAnswerQuestion extends BaseQuestion {
  question_type: "short_answer"
  reference_answer: string
  scoring_rubric: string[]
}

interface CalculationQuestion extends BaseQuestion {
  question_type: "calculation"
  steps: { step: string; answer: string; points: number }[]
  final_answer: string
}

type QuestionItem = MCQuestion | FillBlankQuestion | TrueFalseQuestion | ShortAnswerQuestion | CalculationQuestion

interface ExamProfile {
  exam_date?: string
  duration_minutes?: number
  is_open_book?: boolean
  total_points: number
  question_distribution: {
    question_type: string
    count: number
    points_each: number
    percentage: number
  }[]
  source: "default" | "user_input" | "exam_analysis"
}
```

---

## 四、实施分步

### Phase A：ExamProfile + Examiner v2（后端，3 天）

**目标**：Examiner 能根据 ExamProfile 生成多题型测验

#### A1. 新建 ExamProfile Schema
- 文件：`backend/app/schemas/exam_profile.py`
- 内容：ExamProfile + QuestionTypeDistribution + 课程类型默认值

#### A2. 新建 Question v2 Schema
- 文件：`backend/app/schemas/question.py`
- 内容：MCQuestion / FillBlankQuestion / TrueFalseQuestion / ShortAnswerQuestion / CalculationQuestion
- **向后兼容**：新 QuestionItem union type 包含旧 MCQ，现有 QuizData 表无需改 schema

#### A3. 升级 Examiner Prompt
- 文件：`backend/app/services/pipeline/examiner.py`
- 改动：
  - 新增 `SYSTEM_PROMPT_V2`：接受 ExamProfile 作为输入，动态调整题型和数量
  - 新增 `ExaminerResultV2`：`questions: list[QuestionItem]`（discriminated union by question_type）
  - `run_examiner()` 增加可选 `exam_profile` 参数
  - 无 ExamProfile 时退回 v1 行为（固定 MCQ）

```python
# examiner.py 改动要点

SYSTEM_PROMPT_V2 = """You are an Examiner for university courses.

## Exam Format (follow EXACTLY):
{exam_format_section}

## Rules:
1. Generate questions matching EACH question_type and count in the exam format
2. Distribute across modules proportional to exam_weight
3. For fill_blank: use {{blank}} marker in question, provide acceptable answers (separated by |)
4. For calculation: break into numbered steps with partial credit points
5. For short_answer: provide reference answer AND scoring rubric (key points + points allocation)
6. All content in Chinese, technical terms can have English in parentheses
7. LaTeX for all formulas
...
"""

class ExaminerResultV2(BaseModel):
    questions: list[QuestionItem]  # 使用 discriminated union
```

#### A4. Tutor Tools 升级
- 文件：`backend/app/services/tutor_tools.py`
- 改动：`get_quiz` tool 支持传入 ExamProfile → Examiner v2 生成多题型

#### A5. DB Model 扩展
- 文件：`backend/app/models/disassembly.py`
- 改动：
  - `QuizData.schema_version = 2`（区分 v1 MCQ-only 和 v2 multi-type）
  - `QuizData.exam_profile_json: JSONB | None`（存储使用的 ExamProfile）
- **不改表结构**：questions JSONB 字段天然支持新题型 JSON

### Phase B：考试信息采集 UI（前端，2 天）

**目标**：用户选择"备考"意图时，引导式采集考试信息

#### B1. ExamInfoCard 组件
- 文件：`src/components/workbench/ExamInfoCard.tsx`
- 功能：
  - 卡片式 UI（editorial 风格），在 AIToolPanel 的"备考"意图流程中出现
  - 渐进式采集：考试日期 → 时长 → 开/闭卷 → 题型分布（可选）
  - "不确定"选项 → 使用课程类型默认值
  - 上传真题入口（可选，非必须）

#### B2. ExamProfile 本地存储
- 文件：`src/lib/exam-profile.ts`
- 功能：
  - localStorage 持久化（key = `zhijie_exam_profile_${courseId}`）
  - 默认值生成（根据课程名推断类型）
  - 合并用户输入 + 真题分析结果

#### B3. Tutor 意图升级
- 改动：Tutor Plan 增加 `exam_profile` 上下文传递
- 用户在 TutorSidebar 说"出几道备考题" → Plan 阶段检测到 exam intent → 带上 ExamProfile 调 get_quiz

### Phase C：QuizPanel v2 多题型渲染（前端，2 天）

**目标**：前端能渲染和交互所有题型

#### C1. 题型渲染组件
```
src/components/quiz/
  ├── QuizPanelV2.tsx          # 主容器（替代 QuizPanel）
  ├── MCQuestionCard.tsx       # 选择题（从现有 QuizPanel 提取）
  ├── FillBlankCard.tsx        # 填空题（输入框 + 模糊匹配）
  ├── TrueFalseCard.tsx        # 判断题（✓/✗ 按钮）
  ├── ShortAnswerCard.tsx      # 简答题（textarea + AI 评分按钮）
  ├── CalculationCard.tsx      # 计算题（分步输入）
  └── QuestionRenderer.tsx     # 路由：根据 question_type 选渲染器
```

#### C2. 判分逻辑
| 题型 | 判分方式 | 实时/延迟 |
|------|---------|----------|
| MCQ | `selected === correct_index` | 实时 |
| 判断 | `selected === correct_answer` | 实时 |
| 填空 | 模糊匹配（toLowerCase + trim + alternatives） | 实时 |
| 简答 | 本地关键词匹配 → 可选 AI 精判 | 延迟（AI） |
| 计算 | 分步对比 final_answer | 实时（结果）+ 延迟（过程） |

#### C3. 简答/计算 AI 评分
- 新增 API：`POST /api/v1/quiz/grade`
- 输入：用户答案 + 参考答案 + 评分标准
- 输出：分数 + 评语
- 模型：GLM-4.7-Flash（免费，速度快，足够判分）

### Phase D：真题上传 + ExamAnalyzer（后端+前端，3 天）

**目标**：用户上传历年真题 → AI 分析题型分布 → 自动生成 ExamProfile

#### D1. 真题上传 API
- 文件：`backend/app/api/v1/exam.py`
- 端点：`POST /api/v1/exam/upload-past-exam`
- 流程：
  1. 接收 PDF/图片文件
  2. 存入 S3（key = `past_exams/{user_id}/{course_id}/{filename}`）
  3. 触发异步分析任务

#### D2. ExamAnalyzer Service
- 文件：`backend/app/services/exam_analyzer.py`
- 流程：
  ```
  真题 PDF
    ↓
  OpenDataLoader 提取（markdown + images + bbox）
    ↓
  Vision LLM 分析每页（Claude Vision）
    ├── 识别题型：选择/填空/判断/简答/计算/论述
    ├── 提取分值分布
    ├── 识别题目数量
    └── 检测格式特征（是否有答题纸、是否分 Part A/B）
    ↓
  汇总为 ExamProfile
    ├── question_distribution（题型+数量+分值）
    ├── 考试特征（开卷/闭卷、时长）
    └── source = "exam_analysis"
  ```

#### D3. 真题上传 UI
- 文件：`src/components/workbench/ExamUploadCard.tsx`
- 功能：
  - 拖拽上传区域（复用 DropZone 组件模式）
  - 支持 PDF / 图片（手机拍照常见）
  - 上传后展示分析进度 → 完成后显示识别出的题型分布
  - 用户可手动修正分析结果

### Phase E：反馈闭环 + BKT 联动（1 天）

#### E1. 多题型 BKT 更新
- 改动：`src/lib/student-model.ts`
- 不同题型权重不同：
  - MCQ correct → standard BKT update
  - 填空 correct → 1.2x weight（harder than MCQ）
  - 简答 AI 评分 > 80% → correct, otherwise incorrect
  - 计算题按步骤分 → 每步独立 BKT update

#### E2. 日程联动
- 改动：`src/lib/agenda-engine.ts`
- 考试倒计时 + ExamProfile → 自动生成每日备考任务
- 弱项模块优先 + 真题匹配题型优先

---

## 五、技术风险与降级方案

| 风险 | 降级方案 |
|------|---------|
| 真题 OCR 不准（手机拍照） | OpenDataLoader OCR 80+ 语言 + Vision LLM 兜底 |
| 简答题自动评分争议 | 显示"参考评分"标签 + 允许学生查看评分标准自评 |
| Examiner v2 结构化输出不稳定 | question_type discriminator + Pydantic 重试 + fallback 到 v1 MCQ |
| 冷启动（无真题上传） | 课程类型推断默认分布（已在 ExamProfile.default_for_course_type） |
| 新题型 LLM token 消耗增大 | 简答/计算题限制字数 + 分批生成 |

---

## 六、时间线

```
Week 1 (3天):  Phase A — ExamProfile + Examiner v2 后端
Week 1 (2天):  Phase B — 考试信息采集 UI

Week 2 (2天):  Phase C — QuizPanel v2 多题型渲染
Week 2 (3天):  Phase D — 真题上传 + ExamAnalyzer

Week 3 (1天):  Phase E — 反馈闭环
Week 3 (1天):  集成测试 + 修 bug
```

**总计：~2 周**

---

## 七、验收标准

### MVP 验收（Phase A + B + C）
- [ ] 用户选择"备考" → 可设置考试日期和题型分布
- [ ] Examiner 能根据 ExamProfile 生成 MCQ + 填空 + 判断混合测验
- [ ] QuizPanel v2 能渲染和交互所有题型
- [ ] 无 ExamProfile 时退回现有 MCQ-only 行为（向后兼容）

### 完整验收（Phase D + E）
- [ ] 用户上传历年真题 PDF → ExamAnalyzer 识别题型分布
- [ ] 分析结果回填 ExamProfile → Examiner 按真题格式出题
- [ ] BKT 能处理多题型反馈信号
- [ ] 考试倒计时驱动每日备考任务生成

---

## 八、与 OpenDataLoader 的协同

| 场景 | ODL 的角色 |
|------|-----------|
| **课件分析（已集成）** | 提取图片+bbox+表格 → 增强 Specialist 理解 |
| **真题分析（Phase D）** | 提取真题 PDF 结构 → Vision LLM 识别题型分布 |
| **图表出题** | 提取 ER 图/电路图 → 基于图片描述出"看图题" |
| **公式提取** | LaTeX 公式精确提取 → 计算题自动生成 |

OpenDataLoader 是整个考试对齐系统的**感知基础设施**——它负责"看懂"PDF，后续的理解和生成交给 LLM。
