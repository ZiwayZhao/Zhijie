# 考试对齐测验 — 完整集成方案

## 问题概述

当前系统有两套并行实现，但完全断裂：
- **V1（活跃）**：只用课件 PDF → 只出 MCQ 选择题 → QuizPanel 渲染
- **V2（休眠）**：ExamInfoCard、ExamUploadCard、ExamAnalyzer、QuizPanelV2、Examiner V2 全部写好，但 **零接入**

数据流在 5 个环节断裂：

```
用户选"备考"
  ↓
[断裂1] AIToolPanel: 只收集 examDate + masteryLevel
         应该: ExamInfoCard (4步) + ExamUploadCard (上传真题) + 补充习题
  ↓
[断裂2] startDisassembly(): 只发 { material_id }
         应该: { material_id, intent, exam_profile, reference_material_ids }
  ↓
[断裂3] StartAnalysisRequest: 只有 material_id
         应该: + intent + exam_profile + reference_material_ids
  ↓
[断裂4] pipeline_worker: 硬编码 run_examiner (v1, MCQ-only)
         应该: 有 exam_profile → run_examiner_v2, 否则 → v1 fallback
  ↓
[断裂5] QuizResponse: 只验证 MCQuestion 格式
         应该: schema_version=2 时返回 QuestionItem (多题型)
```

前端渲染侧（QuizPanelV2 + 5种题型卡片）已就绪，`hasV2Questions()` 自动检测切换。

---

## 完整改动清单

### Phase A: 前端流程重构 — AIToolPanel 集成 ExamInfoCard

**目标**：用户选"备考冲刺"后，进入完整的考试信息收集流程

#### A1. 扩展 AIToolPanel 状态机

**文件**: `src/components/workbench/AIToolPanel.tsx`

当前 phase: `idle → gathering → processing → plan-preview → complete → error`

新增 phase: `idle → gathering → **exam-setup** → processing → plan-preview → complete → error`

```
intent === 'exam' 时:
  idle → exam-setup (显示 ExamInfoCard + ExamUploadCard)
       → processing (带 examProfile)

intent === 'learn' 时:
  idle → gathering (保持现有流程) → processing

intent === 'review' 时:
  idle → processing (直接开始)
```

改动点：
- 新增 `examProfile` state
- 新增 `phase === 'exam-setup'` 分支，渲染 ExamInfoCard
- ExamInfoCard.onConfirm → 保存 profile + 进入 processing
- ExamInfoCard.onSkip → 无 profile 直接 processing (v1 fallback)
- 补充习题入口：增加"添加参考材料"按钮

#### A2. 扩展 GatheringData 类型

**文件**: `src/components/workbench/IntentGatherer.tsx`

```typescript
export interface GatheringData {
  examDate?: string
  masteryLevel?: number
  familiarity?: 'zero' | 'basic' | 'advanced'
  // 新增
  examProfile?: ExamProfile
  referenceMaterialIds?: string[]  // 习题/真题 material IDs
}
```

#### A3. 补充材料选择器

新增组件: `src/components/workbench/ReferenceMaterialPicker.tsx`

功能：
- 列出同一课程下的其他材料（Exercises、Solutions、Past Exam）
- 复选框选择要参考的材料
- 也支持直接上传新的习题/真题 PDF
- 选中的材料 ID 列表传给 startDisassembly

#### A4. WorkbenchPage 传递 examProfile

**文件**: `src/pages/WorkbenchPage.tsx`

改动：
- `AIToolPanel` 新增 props: `examProfile`, `courseId`, `courseName`
- 传入已保存的 examProfile（如果有的话）
- AIToolPanel 内部检测到已有 profile → 跳过 exam-setup 直接用

---

### Phase B: 前端 API 层 — 传递完整参数

#### B1. 扩展 startDisassembly 函数

**文件**: `src/lib/api-disassembly.ts`

```typescript
// 当前
export async function startDisassembly(materialId: string, _intent: 'learn' | 'exam')

// 改为
export async function startDisassembly(
  materialId: string,
  intent: 'learn' | 'exam',
  options?: {
    examProfile?: ExamProfile
    referenceMaterialIds?: string[]
  }
)

// POST body:
{
  material_id: materialId,
  intent: intent,
  exam_profile: options?.examProfile || null,
  reference_material_ids: options?.referenceMaterialIds || []
}
```

---

### Phase C: 后端 API — 接收完整参数

#### C1. 扩展 StartAnalysisRequest

**文件**: `backend/app/schemas/disassembly.py`

```python
class StartAnalysisRequest(BaseModel):
    material_id: uuid.UUID
    # 新增
    intent: str | None = None  # 'learn' | 'exam'
    exam_profile: ExamProfile | None = None
    reference_material_ids: list[uuid.UUID] = Field(default_factory=list)
```

#### C2. 扩展 DisassemblyTask 模型

**文件**: `backend/app/models/disassembly.py`

```python
# 新增字段
intent = Column(String(20), nullable=True)           # 'learn' / 'exam'
exam_profile = Column(JSONB, nullable=True)           # ExamProfile dict
reference_material_ids = Column(JSONB, nullable=True)  # list[str]
```

+ Alembic migration

#### C3. start_analysis 端点传递新字段

**文件**: `backend/app/api/v1/disassembly.py`

```python
task = DisassemblyTask(
    material_id=body.material_id,
    user_id=user.id,
    intent=body.intent,
    exam_profile=body.exam_profile.model_dump() if body.exam_profile else None,
    reference_material_ids=[str(mid) for mid in body.reference_material_ids],
)
```

---

### Phase D: Pipeline Worker — 条件调用 V2 + 参考材料

#### D1. Pipeline Worker 读取 exam_profile

**文件**: `backend/app/workers/pipeline_worker.py`

```python
# Phase 4: EXAMINER
# 从 task 读取 exam_profile
exam_profile = None
if task.exam_profile:
    from app.schemas.exam_profile import ExamProfile
    exam_profile = ExamProfile(**task.exam_profile)

# 有 exam_profile → v2, 否则 → v1 (自动 fallback)
from app.services.pipeline.examiner import run_examiner_v2
exam_result = await run_examiner_v2(
    plan=plan,
    specialist_results=spec_data,
    llm=llm,
    run_id=run_id,
    exam_profile=exam_profile,
)
```

`run_examiner_v2` 已经内置了 fallback：无 exam_profile 时调 v1。所以这个改动是**无损的**。

#### D2. 参考材料解析（Phase 1.5）

在 parsing 和 cartographer 之间加入：

```python
# ── Phase 1.5: REFERENCE MATERIALS ──────
reference_context = ""
if task.reference_material_ids:
    for ref_id in task.reference_material_ids:
        ref_material = await session.get(Material, uuid.UUID(ref_id))
        if ref_material and ref_material.s3_key:
            ref_parsed = await parse_pdf_async(ref_material.s3_key, f"{task_id_str}_ref_{ref_id}")
            # 提取前 N 页作为参考上下文
            ref_text = "\n".join(p.markdown for p in ref_parsed.pages[:10])
            reference_context += f"\n\n--- Reference: {ref_material.title} ---\n{ref_text}"

# 传给 examiner 作为额外上下文
```

#### D3. Examiner V2 注入参考材料

**文件**: `backend/app/services/pipeline/examiner.py`

`run_examiner_v2` 新增 `reference_context: str = ""` 参数。

System prompt 中加入：

```
{reference_section}

## 参考习题和真题
以下是该课程的习题和/或历年真题，请参考其题型、难度和出题风格：

{reference_context}

请严格模仿上述真题的出题风格和题型分布来生成测验。
```

#### D4. QuizData schema_version

**文件**: `backend/app/workers/pipeline_worker.py`

```python
session.add(QuizData(
    task_id=task_id,
    questions=[q.model_dump() for q in exam_data.questions],
    total_questions=len(exam_data.questions),
    schema_version=2 if exam_profile else 1,  # 新增
    ...
))
```

---

### Phase E: 后端响应 — 支持 V2 题目格式

#### E1. QuizResponse 支持多格式

**文件**: `backend/app/schemas/disassembly.py`

```python
class QuizResponse(BaseModel):
    questions: list[dict]  # 改为 dict，前端自行判断格式
    total: int
    schema_version: int = 1
```

或者更安全的方式：保持 MCQuestion 验证 for v1，但 v2 直接返回 raw JSONB。

---

### Phase F: 补充材料上传流程

#### F1. 课程材料列表 API

前端需要一个 API 获取同课程下的其他材料，供用户勾选：

```
GET /api/v1/materials?course_id={courseId}
```

这个 API 已经存在（`fetchMaterials`），只需在前端 ReferenceMaterialPicker 中调用。

#### F2. 前端上传流程增强

在 ExamInfoCard 的第 4 步或独立步骤中：
- 显示"上传历年真题" → ExamUploadCard（已有）
- 显示"选择参考习题" → ReferenceMaterialPicker（新建）
- 两者的结果合并到 GatheringData

---

## 实施顺序（按依赖关系）

```
Phase C (后端 schema) ─── 15min
  │
  ├── C1. StartAnalysisRequest 新增字段
  ├── C2. DisassemblyTask model + migration
  └── C3. start_analysis endpoint 传递

Phase D (Pipeline 核心) ─── 30min
  │
  ├── D1. Worker 读取 exam_profile, 调 v2
  ├── D4. QuizData schema_version
  └── D2+D3. 参考材料解析 + 注入 (可后做)

Phase E (后端响应) ─── 10min
  │
  └── E1. QuizResponse 支持 v2 格式

Phase B (前端 API) ─── 10min
  │
  └── B1. startDisassembly 传完整参数

Phase A (前端 UI) ─── 45min
  │
  ├── A1. AIToolPanel exam-setup phase
  ├── A2. GatheringData 类型扩展
  ├── A3. ReferenceMaterialPicker (新)
  └── A4. WorkbenchPage props 传递

Phase F (上传增强) ─── 20min
  │
  └── F1+F2. 材料选择器 + 上传流程
```

**总估时**：~2.5h

**优先级排序**：
1. **C+D+E (后端核心)**：先打通数据管道，让 v2 examiner 能被触发
2. **B+A (前端接入)**：UI 流程重构，让用户能输入考试信息
3. **F (补充材料)**：锦上添花，让用户能选习题/真题参考

---

## 验收标准

1. ✅ 选"备考冲刺" → 弹出 ExamInfoCard 4步向导（日期/时长/开闭卷/题型分布）
2. ✅ 可上传历年真题 → ExamAnalyzer 自动识别题型分布
3. ✅ 可选择同课程的习题/Solutions 作为参考材料
4. ✅ 生成的测验题包含多种题型（MCQ + 填空 + 判断 + 简答 + 计算）
5. ✅ QuizPanelV2 正确渲染所有题型，每种有独立交互
6. ✅ 无 exam_profile 时自动 fallback 到 v1 MCQ（向后兼容）
7. ✅ 参考习题的题目风格被 LLM 模仿
