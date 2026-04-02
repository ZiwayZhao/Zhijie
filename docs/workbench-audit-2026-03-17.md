# 智阶新版 WorkbenchPage 完整审计报告

> 审计日期：2026-03-17
> 目的：为 WorkbenchPage 重设计提供全面的现状分析，供与 Codex 讨论

## 执行摘要

WorkbenchPage 是智阶新版的核心学习工作台，实现了 70:30 布局（左侧材料阅读器，右侧 AI 工具面板）。整个系统采用**相位状态机**架构，驱动从意图收集 → 处理中 → 学习计划确认 → 完成的流程。

### 核心发现
- ✅ **架构清晰**：五层 HTTP+SSE 管道，前端状态机管理整洁
- ✅ **设计系统一致**：Editorial Academic 美学贯穿全组件
- ⚠️ **功能碎片化**：手动工具、Socratic 对话、闪卡生成等分散在多个地方，缺乏统一编排
- ⚠️ **学生模型轻量化**：BKT 仅用于 Socratic 对话脚手架，未驱动动态学习路径调整
- ⚠️ **实时性不足**：模块加载需要手动点击，无法流式实时展示
- ⚠️ **后端工具未对接**：除了 Cartographer/Specialist/Examiner 外的高级工具（概念图、易错总结等）仅有前端占位符

---

## 1. WorkbenchPage.tsx — 页面容器层

### 职责
- 加载路由参数（`courseId`, `mid`）
- 并行获取 Course + Material 数据
- 管理 7 个 state（material、course、activeTab 等）
- 协调 MaterialReader 和 AIToolPanel 的通信

### 数据流
```
WorkbenchPage (state: material, course, specialistMarkdown, quizQuestions)
├─ fetchCourse(courseId) → setCourse()
├─ fetchMaterial(mid) → setMaterial()
└─ AIToolPanel 触发事件
   ├─ onModuleSelect(moduleId, moduleName, markdown) → setSpecialistMarkdown() + setActiveTab('specialist')
   └─ onQuizReady(questions) → setQuizQuestions()
```

### Props 和 State
```typescript
const [material, setMaterial] = useState<MaterialItem | null>(null)
const [course, setCourse] = useState<CourseItem | null>(null)
const [specialistMarkdown, setSpecialistMarkdown] = useState<string | null>(null)
const [quizQuestions, setQuizQuestions] = useState<MCQuestion[]>([])
const [activeTab, setActiveTab] = useState('original')  // 'original' | 'specialist' | 'quiz'
const [showSocratic, setShowSocratic] = useState(false)
const [currentModuleId, setCurrentModuleId] = useState<string | null>(null)
const [hasPdf, setHasPdf] = useState(true)  // 用于 autoSelectFirstModule 判断
```

### 布局结构
```
<div className="flex flex-col lg:flex-row min-h-0">
  {/* 70% Left — Material Reader (journal page) */}
  <motion.div className="flex-[7] ... overflow-y-auto">
    <Breadcrumb>首页 / 课程 / 材料</Breadcrumb>
    <MaterialReader
      material={material}
      specialistMarkdown={specialistMarkdown}
      quizQuestions={quizQuestions}
      activeTab={activeTab}
      onTabChange={setActiveTab}
    />

    {/* Socratic 对话快捷入口 */}
    {specialistMarkdown && currentModuleId && (
      showSocratic ? <SocraticChat ... /> : <button onClick={() => setShowSocratic(true)} />
    )}
  </motion.div>

  {/* 30% Right — AI tool panel (sticky) */}
  <motion.aside className="flex-[3] ... lg:sticky lg:top-0 lg:h-screen">
    <AIToolPanel
      materialId={material.id}
      onModuleSelect={handleModuleSelect}
      onQuizReady={handleQuizReady}
      autoSelectFirstModule={!hasPdf}
    />
  </motion.aside>
</div>
```

### UX 流程
1. 页面加载 → 获取 Material 元数据
2. 用户在右侧 AIToolPanel 选择意图 (learn/exam/review)
3. 可选：填写背景信息（考试日期、当前水平等）
4. 点击"开始分析"→ 后端启动管道（SSE 推送进度）
5. 分析完成 → 显示学习计划预览
6. 用户确认 → 切换到 CompletePhase，显示模块列表
7. 用户点击模块 → AIToolPanel 触发 `onModuleSelect` 回调
8. WorkbenchPage 更新 `specialistMarkdown` 和 `activeTab`
9. MaterialReader 显示精讲内容

### 当前问题
- **缺乏跨组件协调**：各组件独立管理状态，缺乏全局学习流程编排
- **Socratic 对话孤立**：独立在 MaterialReader 下方，无法与其他学习工具集成
- **无学习进度追踪**：完成一个模块后，无法自动推荐下一个，需要手动点击

---

## 2. MaterialReader.tsx — 材料多视图阅读器

### 职责
- 管理三个标签页：原文 (PDF/其他) / AI 精讲 / 自测验
- 懒加载 PdfAnnotator 组件
- 渲染 Markdown 精讲内容（LaTeX + 表格支持）
- 显示测验面板

### 接口定义
```typescript
interface MaterialReaderProps {
  material: MaterialItem
  courseName?: string
  courseSchool?: string
  specialistMarkdown?: string | null
  quizQuestions?: MCQuestion[]
  activeTab?: string
  onTabChange?: (tab: string) => void
  onGenerateFlashcards?: () => void
}
```

### 三个标签页内容
| 标签 | 条件 | 内容 |
|------|------|------|
| 原文 | always available | PdfAnnotator (lazy) 或 占位符 |
| AI 精讲 | `!!specialistMarkdown` | `<ReactMarkdown>` 渲染 (remark-math, remark-gfm, rehype-katex) |
| 自测验 | `!!quizQuestions && length > 0` | QuizPanel 组件 |

### Markdown 渲染管道
```
raw markdown (from Specialist Agent)
  ↓
fixMarkdown() — 预处理
  ├─ LaTeX 管道符转义 (| → \\vert)
  ├─ 重复 # 修复
  └─ 空格补全
  ↓
<ReactMarkdown>
  ├─ remarkPlugins: [remarkMath, remarkGfm]
  ├─ rehypePlugins: [rehypeKatex]
  └─ components: mdComponents (h1, h2, blockquote, code, table...)
```

### 当前问题
- **无批注导出**：PDF 批注仅保存在 localStorage，无法导出或同步
- **切换标签丢失位置**：没有记忆滚动位置，切回原文后需要重新定位

---

## 3. AIToolPanel.tsx — AI 工具编排中枢

### 核心架构：相位状态机

```
idle (初始) → 用户选择 intent → gathering (可选，收集背景)
  │ (review 直接跳过)           │
  └───────────────────────────→ processing (SSE 管道进行中)
                                  │
                                  ↓
                            plan-preview (用户确认学习计划)
                                  │
                                  ↓
                            complete (显示模块列表)
                                  │
                              ←───┴─→ error (失败恢复)
```

### 六个相位的职责

| 相位 | 组件 | 触发条件 | 产出 |
|------|------|---------|------|
| **idle** | IdlePhase | 初始 / 点击"重新分析" | 三个意图按钮 |
| **gathering** | GatheringPhase | 选择 learn 或 exam | 背景信息表单 |
| **processing** | ProcessingView | 点击"开始分析" | SSE 进度时间线 |
| **plan-preview** | LearningPlanPreview | 管道完成 | 可自定义的学习步骤 |
| **complete** | CompletePhase | 用户确认计划 | 模块列表 + 手动工具 |
| **error** | ErrorPhase | 管道失败 | 错误消息 + 重试按钮 |

### 关键 Props & Callbacks

```typescript
interface AIToolPanelProps {
  materialId: string
  onModuleSelect?: (moduleId: string, moduleName: string, markdown: string) => void
  onQuizReady?: (questions: MCQuestion[]) => void
  autoSelectFirstModule?: boolean
}
```

### 学习计划生成逻辑

```typescript
function generatePlanSteps(modules, intent, profile): LearningPlanStep[] {
  // 为每个模块生成一个学习步骤
  // Intent 驱动策略选择:
  //   learn: 全覆盖，最后一个模块做测验
  //   exam:  高权重且掌握不足的做"深度理解"，其他的直接做测验
  //   review: 全部用闪卡，优先复习掌握度 <60% 的
}
```

### SSE 订阅机制
- `subscribeProgress(taskId, callback)` 订阅后端 Redis Pub/Sub 事件
- 事件类型：`progress` (进度更新)、`completed` (管道完成)、`failed` (失败)
- 完成后自动获取 `getAnalysisResult(taskId)` 并生成学习计划

### 自动检测已完成的分析
- 页面加载时检查 `getLatestAnalysis(materialId)`
- 如已完成 → 直接跳到 `complete` 相位，跳过整个分析流程
- 如无 PDF → 自动加载首个模块的精讲内容

### 当前问题
- **计划修改后无追踪**：用户跳过模块后，无法动态调整总时间估计
- **模块加载延迟**：点击模块 → 调用 API → 网络往返 → 显示，无法流式推送
- **缺乏失败恢复策略**：某个模块的 Specialist 生成失败，无法自动降级或提示用户
- **手动工具孤立**：8 个手动工具仅作占位符，点击后没有实际功能

---

## 4. IntentGatherer.tsx — 意图收集

### IdlePhase — 三个意图选项

| 意图 | 图标 | 标题 | 描述 |
|------|------|------|------|
| learn | BookOpen | 学透这份材料 | 深度理解，全面掌握 |
| exam | Target | 备考冲刺 | 聚焦考点，高效备考 |
| review | RefreshCw | 快速复习 | 间隔复习，巩固记忆 |

### GatheringPhase — 背景信息收集

| 意图 | 收集的信息 | 用途 |
|------|-----------|------|
| **learn** | 熟悉度 (zero/basic/advanced) | 调整说明详细程度 |
| **exam** | 考试日期、当前掌握程度 (%) | 计算倒计时、压缩计划时长 |
| **review** | （无，直接跳过） | 使用上次的 profile 数据 |

### 当前问题
- **收集字段过少**：缺乏"有多少小时可以学"、"是否有课本"等实用信息
- **不支持多选**：如果学生既要"学透"又要"备考"，无法表达

---

## 5. ProcessingView.tsx — 实时进度时间线

### 相位顺序
```
parsing → cartographer → specialist → examiner → done
```

### 时间线节点状态
| 状态 | 样式 | 含义 |
|------|------|------|
| pending | 灰色边框 | 未开始 |
| active | 红色边框 + 脉冲动画 | 当前运行中 |
| completed | 红色填充 + 白色勾 | 已完成 |
| error | 红色淡化背景 + X | 失败 |

### Sub-progress 显示
在 specialist 阶段显示: "3/7 模块"

### 当前问题
- **缺乏阶段详情**：无法看到已处理了哪些模块、当前模块名称、预计剩余时间
- **消息文本固定**：`currentStep` 来自后端，格式不统一

---

## 6. ModuleDisplay.tsx — 模块列表和手动工具

### CompletePhase
显示所有模块卡片，包含：
- 模块名称
- 页码范围
- 考点权重 Badge（高频/中频/低频）
- 点击加载精讲内容

### ManualToolSection — 8 个手动工具（全部为占位符）
```
1. 精读笔记 — 逐段精读，生成结构化笔记
2. 概念图谱 — 提取核心概念及其关联
3. 知识问答 — 基于材料内容的智能问答
4. 考点提取 — 识别高频考点与重点
5. 模拟测验 — 生成模拟试题检验掌握度
6. 易错总结 — 归纳常见错误与易混概念
7. 一键总结 — 快速生成材料摘要
8. 闪卡生成 — 提取关键知识点生成闪卡
```
**现状**：仅有 UI，点击后显示 3 秒加载动画，然后消失，无实际后端对接。

### 当前问题
- **手动工具全是摆设**：无后端支持，无 API 路由
- **无工具结果展示**：即使有后端，也不知道如何将结果呈现给用户
- **顺序随意**：工具列表固定，无法根据 intent 或 mastery 动态排序

---

## 7. QuizPanel.tsx — 自测验界面

### 四层架构
1. **题目卡片** (QuestionCard)
2. **选项按钮** (OptionButton)
3. **数学文本渲染** (MathText) — 支持希腊字母、下标、LaTeX
4. **分数总结** (ScoreSummary) — 评级: 80+优秀, 60-79良好, <60需加强

### 当前问题
- **单次作答限制**：已答题的选项禁用，无法改答
- **无错题归纳**：所有错题混在一起，无法按知识点分类
- **缺乏实时反馈**：答题完成后，无法看到与 profile 的对比

---

## 8. SocraticChat.tsx — 苏格拉底对话引擎

### 脚手架架构（ZPD + BKT Mastery）
```
Mastery < 0.3       → full (引导)：手把手分解、类比启蒙
0.3 ≤ Mastery < 0.7 → moderate (讨论)：追问深度、要求总结
Mastery ≥ 0.7       → minimal (挑战)：反例构造、跨学科连接
```

### 后端对接
- **前端完全独立实现**：使用本地模板库 + 随机选择，无需调用 LLM
- 速度快（800ms 模拟延迟），但缺乏个性化

### 当前问题
- **提示预制化**：所有提示都是模板，无法根据学生的具体回答生成针对性提示
- **无学习记录**：每次新对话都从头开始
- **缺乏错因分析**：Quiz 中犯错后，Socratic 无法自动引导重新思考

---

## 9. LearningPlanPreview.tsx — 学习计划预览与确认

### 数据结构
```typescript
interface LearningPlanStep {
  id: string
  moduleId: string
  moduleName: string
  action: 'read' | 'quiz' | 'flashcard' | 'review' | 'deep-dive'
  estimatedMin: number
  mastery: number
  priority: 'high' | 'medium' | 'low'
  skippable: boolean
}
```

### 支持的操作
- 跳过 skippable 步骤（mastery > 70% 或 priority = low）
- 查看总耗时（实时计算）
- 确认后进入 complete 相位

### 当前问题
- **计划修改不可追溯**：跳过步骤后无记录
- **无风险提示**：跳过"高权重+薄弱"的步骤时无警告
- **缺乏弹性调整**：一旦进入 complete 相位，无法返回修改

---

## 10. PdfAnnotator.tsx — PDF 批注工具

### 技术栈
- **库**：`react-pdf-highlighter-extended` (基于 pdf.js)
- **高亮类型**：文本选中 + 矩形框选
- **颜色**：5 种可选颜色
- **持久化**：localStorage (`zhijie_highlights_{materialId}`)

### 当前问题
- **localStorage 限制**：大 PDF 无法保存
- **批注无 AI 处理**：批注位置无法反馈给后端进行困惑区域推断
- **切换材料丢失**：不同材料的批注独立存储

---

## 11. 后端 API 层

### 管道架构（5 阶段）
```
POST /disassembly/start
  ↓
1️⃣ Parsing (PDF → text chunks)
  ↓
2️⃣ Cartographer (拆解为模块 + 映射考点)
  ↓
3️⃣ Specialist (逐模块生成精讲 Markdown)
  ↓
4️⃣ Examiner (生成 8-12 题 MCQ)
  ↓
✅ Done
```

### RESTful 端点
| 方法 | 路由 | 功能 |
|------|------|------|
| POST | `/disassembly/start` | 启动分析 |
| GET | `/disassembly/tasks/{taskId}/status` | SSE 订阅进度 |
| GET | `/disassembly/tasks/{taskId}/result` | 获取分析结果（模块 + quiz） |
| GET | `/disassembly/tasks/{taskId}/module/{moduleId}` | 获取特定模块精讲 |
| GET | `/disassembly/materials/{materialId}/latest` | 获取最新完成的分析 |
| GET | `/disassembly/showcase` | 公开展示材料列表 |
| POST | `/disassembly/tasks/{taskId}/cancel` | 取消分析 |

### 数据库模型
- `DisassemblyTask` — 管道执行追踪（status, phase, progress）
- `DisassemblyModule` — Cartographer 输出（name, page_range, exam_weight, sort_order）
- `ModuleDependency` — 模块前置关系
- `SpecialistOutput` — 精讲内容（markdown_s3_key, markdown_content, key_concepts, exam_traps）
- `QuizData` — 测验数据（questions JSON, total_questions）

### 当前问题
- **Intent 参数未使用**：后端接收 `intent` 但不改变输出
- **缺乏模块依赖信息**：Cartographer 的输出无前置知识映射
- **失败重试策略不完整**：某个阶段失败后无法从该阶段重试

---

## 12. 学生模型 (student-model.ts)

### BKT 实现（Bayesian Knowledge Tracing）
- `ModuleMastery`: moduleId, mastery (0-1), totalAttempts, correctAttempts
- `updateMasteryBKT(m, correct, params)`: 贝叶斯更新公式
- 默认参数: pL0=0.3, pT=0.09, pG=0.25, pS=0.10

### 脚手架等级（ZPD）
```
mastery < 0.3 → full (手把手)
0.3 ≤ mastery < 0.7 → moderate (讨论)
mastery ≥ 0.7 → minimal (挑战)
```

### Profile 持久化
- `LearningProfile`: goal, modules (Record<string, ModuleMastery>), totalStudyMinutes, streakDays
- localStorage key: `zhijie_profile_local-user`

### 当前问题
- **未驱动动态调整**：mastery 更新不会自动调整后续学习步骤
- **缺乏问卷反馈**：无法处理主观反馈
- **跨课程关联缺失**：每个模块独立追踪

---

## 13. FSRS 集成 (fsrs.ts)

### 当前状态：已集成但未充分使用
- `ts-fsrs` 已安装，ReviewSession 和 DeckList 组件存在
- 闪卡生成入口（QuizPanel 的"生成闪卡"按钮）未实现
- 闪卡自进化机制未实现

---

## 14. 已实现的工具 vs 占位符工具

### 已实现（生产就绪）
1. ✅ **Cartographer** — 模块拆解
2. ✅ **Specialist** — 精讲生成
3. ✅ **Examiner** — 测验生成
4. ✅ **Socratic 对话** — 脚手架引导（模板制，无 LLM）

### 占位符（仅有 UI，无后端）
5. ❌ 精读笔记
6. ❌ 概念图谱
7. ❌ 知识问答
8. ❌ 考点提取
9. ❌ 模拟测验
10. ❌ 易错总结
11. ❌ 一键总结
12. ❌ 闪卡生成

---

## 15. 数据流完整图

```
┌─ WorkbenchPage ──────────────────────────────────────────┐
│                                                            │
│  state: {material, course, specialistMarkdown,            │
│          quizQuestions, activeTab, currentModuleId,        │
│          showSocratic, hasPdf}                            │
│                                                            │
│  ┌─────────────────────┐    ┌──────────────────────┐     │
│  │ MaterialReader      │    │ AIToolPanel          │     │
│  │ (70%)               │◄───┤ (30%, sticky)        │     │
│  │                     │    │                      │     │
│  │ ├─ Tabs:           │    │ State Machine:       │     │
│  │ │  original        │    │  idle → gathering    │     │
│  │ │  specialist      │    │     → processing     │     │
│  │ │  quiz            │    │     → plan-preview   │     │
│  │ ├─ PdfAnnotator    │    │     → complete       │     │
│  │ ├─ Markdown        │    │     → error          │     │
│  │ ├─ QuizPanel       │    │                      │     │
│  │ └─ SocraticChat    │    │ Components:          │     │
│  └─────────────────────┘    │  IdlePhase           │     │
│                              │  GatheringPhase      │     │
│                              │  ProcessingView      │     │
│                              │  LearningPlanPreview│     │
│                              │  CompletePhase      │     │
│                              │  ManualToolSection   │     │
│                              └──────────────────────┘     │
└─────────────────────────────────────────────────────────┘
                            ▲
                            │
            ┌───────────────┼───────────────┐
            ▼               ▼               ▼
        ┌─────────┐   ┌──────────┐   ┌───────────┐
        │ Backend │   │ SSE      │   │localStorage│
        │  API    │   │ Stream   │   │ (Profile,  │
        │ 7 端点  │   │(progress)│   │ Highlights)│
        └─────────┘   └──────────┘   └───────────┘
```

---

## 16. 核心问题汇总

### 架构层面
1. **工作台编排缺失**：各组件独立，无统一的"学习编排引擎"协调工具使用顺序
2. **状态分散**：profile / plan steps / modules / quiz 等状态分散在不同组件，无单一信源
3. **反馈环路断裂**：Quiz 答题 → BKT 更新 mastery，但不触发计划调整或推荐

### 功能层面
1. **手动工具虚化**：8 个高级工具无后端实现
2. **模块加载延迟**：每个模块需手动点击 + 网络往返
3. **计划修改不可追踪**：用户跳过模块后无记录
4. **自动化不足**：无 auto-next 逻辑

### 学习体验层面
1. **缺乏个性化**：所有学生看到同样的模块顺序
2. **脚手架孤立**：Socratic 对话无法与 Quiz 失败、概念图等集成
3. **进度可视化弱**：无全局进度视图
4. **缺乏成就感**：无徽章、无进度条

### 后端集成层面
1. **Intent 参数未充分使用**：传给后端但不影响输出质量
2. **失败恢复缺失**：无降级、重试或跳过机制
3. **高级工具无 API**：考点提取、易错总结等无对应后端

---

## 17. 重设计建议（供 Codex 讨论）

### A. 统一学习编排引擎（Learning Orchestrator）
```
新组件：LearningOrchestrator
  ├─ 中央状态机（orchestration state）
  │   ├─ 当前步骤 (currentStep)
  │   ├─ 完成历史 (completedSteps)
  │   ├─ 动态推荐队列 (recommendedQueue)
  │   └─ 实时反馈信号 (feedbackSignals: Quiz/Flashcard/Socratic)
  ├─ 事件驱动
  │   ├─ onModuleCompleted(moduleId, score) → auto-next or recommend
  │   ├─ onQuizScored(moduleId, correct%) → updateMastery → replan
  │   ├─ onFlashcardRated(cardId, rating) → updateMastery → trigger evolution
  │   └─ onSocraticFinished(moduleId, hints_used) → updateScaffoldLevel
  └─ 输出
      ├─ nextRecommendedAction: { type, target, reason }
      ├─ progressDashboard: { completed, total, time_spent, mastery_gains }
      └─ adaptiveUI: 根据当前状态渲染不同组件顺序
```

### B. 流式模块加载与预推送
```
改进方向：
  ├─ Specialist Agent 完成一个模块立即推送（不等全部完成）
  ├─ 前端订阅 module:specialist 事件
  │  ├─ 第 1 个模块完成 → 自动显示在 MaterialReader
  │  ├─ 第 2 个模块完成 → 加到推荐队列，显示通知
  │  └─ ...
  ├─ CompletePhase 中实时显示模块（边获取边显示）
  └─ UX 感受：看到实时进度，而非冗长的加载等待
```

### C. 学习路径动态调整（Dynamic Replanning）
```
触发条件：
  1. Quiz 完成 → 如果正确率 <60% → 自动重新规划
  2. Flashcard 连续忘记 → 提前前置知识复习
  3. Socratic 需要多次提示 → 降低难度或补充基础

实现：
  ├─ 在 complete 相位保留"修改计划"按钮
  ├─ 智能推荐替代固定模块列表
  └─ 记录所有调整，事后分析
```

---

## 18. 技术债清单

| 优先级 | 类别 | 具体问题 | 影响 | 工作量 |
|--------|------|---------|------|--------|
| 🔴 HIGH | 后端 | 手动工具无 API 实现 | 8 个高级工具不可用 | 3 weeks |
| 🔴 HIGH | 前端 | 缺乏全局学习编排 | 用户体验碎片化 | 2 weeks |
| 🟠 MED | 后端 | Intent 参数未充分使用 | 无法差异化学习路径 | 1 week |
| 🟠 MED | 前端 | 模块加载延迟无优化 | 每个模块等待 2-3s | 1 week |
| 🟠 MED | 后端 | 失败恢复机制不完整 | 管道失败需全部重来 | 3 days |
| 🟡 LOW | 前端 | 无学习进度仪表板 | 缺乏成就感和数据洞察 | 1 week |
| 🟡 LOW | 前端 | Flashcard 生成未完成 | 闪卡功能不可用 | 1 week |
| 🟡 LOW | 集成 | 批注无 AI 处理 | 无法识别困惑区域 | 3 days |

---

## 19. 总体评估

### 优点 ✅
- **架构清晰**：五层 HTTP+SSE 管道，前端状态机分离良好
- **设计系统落实好**：Editorial Academic 美学贯穿全系，无 AI slop
- **核心功能可用**：Cartographer/Specialist/Examiner 管道完整可用
- **前端工程质量高**：组件拆分合理，props 清晰，lazy loading 优化

### 不足 ⚠️
- **功能碎片化**：手动工具、Socratic、闪卡等分散，缺乏统一编排
- **学生模型轻量**：BKT 仅用于脚手架，未驱动动态路径调整
- **手动工具虚化**：占位符等待后端实现
- **反馈闭环不完整**：Quiz 答题无法自动触发计划调整

### 适配度评估
- **开发阶段**：✅ 充分（MVP 级别可用）
- **生产阶段**：⚠️ 需改进（功能不完整、体验碎片化）
- **长期迭代**：❌ 架构需重构（缺乏全局编排）

---

## 结论

WorkbenchPage 是一个**架构清晰、美学一致、但功能碎片化的学习工作台**。核心的 PDF 拆解和精讲生成功能已稳定可用，但高级工具尚未实现，学生模型的应用也仅限于对话脚手架。

为了实现 CLAUDE.md 中描述的"**5 层混合 AI 教师架构**"和"**HTN 学习路径规划**"，需要重点投入：

1. **学习编排引擎** — 统一协调各工具的使用顺序
2. **动态路径调整** — 根据实时反馈调整学习计划
3. **高级工具后端** — 实现占位符工具的 API
4. **流式加载优化** — 提升模块加载 UX

这些工作可以逐步进行，不需要颠覆现有架构。
