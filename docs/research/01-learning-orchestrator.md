# LearningOrchestrator 学习编排引擎 — 架构设计文档

> 日期：2026-03-18
> 基于：workbench-audit-2026-03-17.md 审计报告
> 范围：AIToolPanel 重构 + 动态布局 + 进度可视化 + 零摩擦体验

---

## 现状分析

当前 `AIToolPanel` 采用简单的 `useState<Phase>` 管理 6 个相位（idle / gathering / processing / plan-preview / complete / error）。这种方式在 MVP 阶段足够清晰，但存在三个结构性问题：

1. **状态扁平化**：13 个独立 `useState` 彼此无约束，容易出现不一致状态（如 `phase='complete'` 但 `modules` 为空）。
2. **无步骤编排**：用户确认学习计划后直接进入 `complete` 相位，显示静态模块列表。没有"当前正在学哪一步"的概念，也没有 auto-next 逻辑。
3. **反馈断裂**：Quiz 答题、闪卡评分等信号不回流到学习路径，mastery 更新不触发计划调整。

本文档设计一个 `LearningOrchestrator`，以 `useReducer` 状态机为核心，统一管理学习编排，并与现有组件渐进式集成。

---

## A. LearningOrchestrator 学习编排引擎

### A.1 核心 TypeScript 接口

```typescript
/* ================================================================
 *  OrchestratorState — 编排引擎的完整状态
 * ================================================================ */

/** 学习步骤的执行状态 */
type StepStatus = 'pending' | 'active' | 'completed' | 'skipped' | 'failed'

/** 单个学习步骤 */
interface LearningStep {
  id: string
  moduleId: string
  moduleName: string
  action: 'read' | 'quiz' | 'flashcard' | 'deep-dive' | 'socratic' | 'concept-map'
  status: StepStatus
  estimatedMin: number
  actualMin?: number           // 实际耗时（步骤完成后填充）
  mastery: number              // 步骤开始时的掌握度快照
  masteryAfter?: number        // 步骤完成后的掌握度（用于 ProgressRail 热力图）
  priority: 'high' | 'medium' | 'low'
  skippable: boolean
  result?: StepResult          // 步骤产出物
  insertedBy?: 'planner' | 'replan'  // 标记是原始规划还是动态插入
}

/** 步骤产出物（不同 action 对应不同 result） */
type StepResult =
  | { type: 'markdown'; content: string }
  | { type: 'quiz'; score: number; total: number; details: QuizAnswerDetail[] }
  | { type: 'flashcard'; cardsGenerated: number; deckId: string }
  | { type: 'socratic'; hintsUsed: number; questionsAsked: number }

interface QuizAnswerDetail {
  questionId: string
  correct: boolean
  moduleId: string
}

/** 编排引擎的全局相位 */
type OrchestratorPhase =
  | 'idle'            // 等待用户选择意图
  | 'gathering'       // 收集背景信息
  | 'processing'      // 后端管道运行中
  | 'plan-preview'    // 用户确认学习计划
  | 'learning'        // 核心：正在执行学习步骤
  | 'paused'          // 用户暂停
  | 'completed'       // 所有步骤完成
  | 'error'           // 出错

/** 完整状态树 */
interface OrchestratorState {
  phase: OrchestratorPhase
  intent: 'learn' | 'exam' | 'review' | null
  gatheringData: GatheringData

  // 管道状态
  taskId: string | null
  pipelineProgress: number
  pipelinePhase: PipelinePhase
  pipelineMessage: string
  pipelineDetail?: { completed?: number; total?: number }

  // 学习步骤
  steps: LearningStep[]
  currentStepIndex: number       // -1 表示无活跃步骤
  completedStepIds: string[]

  // 模块数据缓存
  modules: DisassemblyModule[]
  moduleCache: Record<string, string>  // moduleId → specialist markdown

  // 学习统计
  sessionStartTime: number | null
  totalStudyMinutes: number

  // 错误
  errorMessage: string
}
```

### A.2 事件类型定义

```typescript
/* ================================================================
 *  OrchestratorEvent — 所有可能的状态转换事件
 * ================================================================ */

type OrchestratorEvent =
  // 意图阶段
  | { type: 'SELECT_INTENT'; intent: 'learn' | 'exam' | 'review' }
  | { type: 'UPDATE_GATHERING'; data: Partial<GatheringData> }
  | { type: 'SUBMIT_GATHERING' }

  // 管道阶段
  | { type: 'PIPELINE_STARTED'; taskId: string }
  | { type: 'PIPELINE_PROGRESS'; progress: number; message: string;
      phase?: PipelinePhase; detail?: { completed?: number; total?: number } }
  | { type: 'PIPELINE_COMPLETED'; modules: DisassemblyModule[]; quiz?: { questions: MCQuestion[] } }
  | { type: 'PIPELINE_FAILED'; error: string }

  // 计划阶段
  | { type: 'PLAN_GENERATED'; steps: LearningStep[] }
  | { type: 'PLAN_TOGGLE_SKIP'; stepId: string }
  | { type: 'PLAN_CONFIRMED' }
  | { type: 'PLAN_CANCELLED' }

  // 学习执行阶段
  | { type: 'STEP_STARTED'; stepId: string }
  | { type: 'STEP_COMPLETED'; stepId: string; result: StepResult; masteryAfter: number }
  | { type: 'STEP_FAILED'; stepId: string; error: string }
  | { type: 'STEP_SKIPPED'; stepId: string }
  | { type: 'AUTO_NEXT' }                          // 自动进入下一步
  | { type: 'REPLAN_INSERT'; newSteps: LearningStep[]; afterStepId: string }

  // 模块内容
  | { type: 'MODULE_CONTENT_LOADED'; moduleId: string; markdown: string }

  // 会话控制
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'RESET' }

  // 外部反馈
  | { type: 'QUIZ_SCORED'; moduleId: string; score: number; total: number; details: QuizAnswerDetail[] }
  | { type: 'FLASHCARD_RATED'; moduleId: string; rating: 1 | 2 | 3 | 4 }
  | { type: 'EXISTING_ANALYSIS_DETECTED'; taskId: string; modules: DisassemblyModule[];
      quiz?: { questions: MCQuestion[] } }
```

### A.3 useReducer 状态机实现

```typescript
/* ================================================================
 *  orchestratorReducer — 纯函数状态机
 * ================================================================ */

function orchestratorReducer(
  state: OrchestratorState,
  event: OrchestratorEvent,
): OrchestratorState {
  switch (event.type) {

    /* ---------- 意图阶段 ---------- */

    case 'SELECT_INTENT': {
      if (event.intent === 'review') {
        // review 模式跳过 gathering，直接开始处理
        return {
          ...state,
          phase: 'processing',
          intent: event.intent,
          pipelineProgress: 0,
          pipelineMessage: '正在启动分析...',
        }
      }
      return {
        ...state,
        phase: 'gathering',
        intent: event.intent,
        gatheringData: {},
      }
    }

    case 'UPDATE_GATHERING':
      return { ...state, gatheringData: { ...state.gatheringData, ...event.data } }

    case 'SUBMIT_GATHERING':
      return {
        ...state,
        phase: 'processing',
        pipelineProgress: 0,
        pipelineMessage: '正在启动分析...',
        errorMessage: '',
      }

    /* ---------- 管道阶段 ---------- */

    case 'PIPELINE_STARTED':
      return { ...state, taskId: event.taskId }

    case 'PIPELINE_PROGRESS':
      return {
        ...state,
        pipelineProgress: event.progress,
        pipelineMessage: event.message,
        pipelinePhase: event.phase ?? state.pipelinePhase,
        pipelineDetail: event.detail ?? state.pipelineDetail,
      }

    case 'PIPELINE_COMPLETED':
      return {
        ...state,
        modules: event.modules,
        // 不直接进入 plan-preview，等待 PLAN_GENERATED 事件
        // （plan generation 作为 side effect 在 middleware 中处理）
      }

    case 'PIPELINE_FAILED':
      return { ...state, phase: 'error', errorMessage: event.error }

    /* ---------- 计划阶段 ---------- */

    case 'PLAN_GENERATED':
      return { ...state, phase: 'plan-preview', steps: event.steps }

    case 'PLAN_TOGGLE_SKIP': {
      const steps = state.steps.map((s) =>
        s.id === event.stepId
          ? { ...s, status: (s.status === 'skipped' ? 'pending' : 'skipped') as StepStatus }
          : s,
      )
      return { ...state, steps }
    }

    case 'PLAN_CONFIRMED': {
      // 找到第一个非 skipped 的步骤，标记为 active
      const steps = [...state.steps]
      const firstActive = steps.findIndex((s) => s.status === 'pending')
      if (firstActive >= 0) {
        steps[firstActive] = { ...steps[firstActive], status: 'active' }
      }
      return {
        ...state,
        phase: 'learning',
        steps,
        currentStepIndex: firstActive,
        sessionStartTime: Date.now(),
      }
    }

    case 'PLAN_CANCELLED':
      return createInitialState()

    /* ---------- 学习执行 ---------- */

    case 'STEP_STARTED': {
      const steps = state.steps.map((s) =>
        s.id === event.stepId ? { ...s, status: 'active' as StepStatus } : s,
      )
      const idx = steps.findIndex((s) => s.id === event.stepId)
      return { ...state, steps, currentStepIndex: idx }
    }

    case 'STEP_COMPLETED': {
      const now = Date.now()
      const steps = state.steps.map((s) =>
        s.id === event.stepId
          ? {
              ...s,
              status: 'completed' as StepStatus,
              result: event.result,
              masteryAfter: event.masteryAfter,
              actualMin: s.status === 'active' && state.sessionStartTime
                ? Math.round((now - state.sessionStartTime) / 60000)
                : s.estimatedMin,
            }
          : s,
      )
      return {
        ...state,
        steps,
        completedStepIds: [...state.completedStepIds, event.stepId],
      }
    }

    case 'STEP_SKIPPED': {
      const steps = state.steps.map((s) =>
        s.id === event.stepId ? { ...s, status: 'skipped' as StepStatus } : s,
      )
      return { ...state, steps }
    }

    case 'STEP_FAILED': {
      const steps = state.steps.map((s) =>
        s.id === event.stepId ? { ...s, status: 'failed' as StepStatus } : s,
      )
      return { ...state, steps }
    }

    case 'AUTO_NEXT': {
      // 找到下一个 pending 步骤
      const nextIdx = state.steps.findIndex(
        (s, i) => i > state.currentStepIndex && s.status === 'pending',
      )
      if (nextIdx === -1) {
        // 所有步骤完成
        return { ...state, phase: 'completed', currentStepIndex: -1 }
      }
      const steps = state.steps.map((s, i) =>
        i === nextIdx ? { ...s, status: 'active' as StepStatus } : s,
      )
      return { ...state, steps, currentStepIndex: nextIdx }
    }

    case 'REPLAN_INSERT': {
      // 在指定步骤之后插入新步骤
      const afterIdx = state.steps.findIndex((s) => s.id === event.afterStepId)
      if (afterIdx === -1) return state
      const before = state.steps.slice(0, afterIdx + 1)
      const after = state.steps.slice(afterIdx + 1)
      const tagged = event.newSteps.map((s) => ({ ...s, insertedBy: 'replan' as const }))
      return { ...state, steps: [...before, ...tagged, ...after] }
    }

    /* ---------- 模块内容缓存 ---------- */

    case 'MODULE_CONTENT_LOADED':
      return {
        ...state,
        moduleCache: { ...state.moduleCache, [event.moduleId]: event.markdown },
      }

    /* ---------- 会话控制 ---------- */

    case 'PAUSE':
      return { ...state, phase: 'paused' }

    case 'RESUME':
      return { ...state, phase: 'learning' }

    case 'RESET':
      return createInitialState()

    /* ---------- 外部反馈 ---------- */

    case 'QUIZ_SCORED': {
      // Quiz 完成后，标记当前步骤完成
      const currentStep = state.steps[state.currentStepIndex]
      if (!currentStep) return state
      return orchestratorReducer(state, {
        type: 'STEP_COMPLETED',
        stepId: currentStep.id,
        result: {
          type: 'quiz',
          score: event.score,
          total: event.total,
          details: event.details,
        },
        masteryAfter: event.score / event.total,
      })
    }

    case 'FLASHCARD_RATED':
      // 闪卡评分仅更新 mastery，不改变步骤状态
      return state

    case 'EXISTING_ANALYSIS_DETECTED':
      return {
        ...state,
        phase: 'completed',
        taskId: event.taskId,
        modules: event.modules,
      }

    default:
      return state
  }
}

/* ---------- 初始状态工厂 ---------- */

function createInitialState(): OrchestratorState {
  return {
    phase: 'idle',
    intent: null,
    gatheringData: {},
    taskId: null,
    pipelineProgress: 0,
    pipelinePhase: 'init',
    pipelineMessage: '',
    pipelineDetail: undefined,
    steps: [],
    currentStepIndex: -1,
    completedStepIds: [],
    modules: [],
    moduleCache: {},
    sessionStartTime: null,
    totalStudyMinutes: 0,
    errorMessage: '',
  }
}
```

### A.4 与现有 AIToolPanel 的渐进式集成策略

**原则：不破坏现有功能，逐步迁移。**

分三个阶段：

**阶段 1 — 提取状态到 useReducer（纯重构，无新功能）**

将 AIToolPanel 中的 13 个 `useState` 替换为 `useReducer(orchestratorReducer, createInitialState())`，所有 callback 改为 `dispatch(event)`。这一步不改变任何 UI 或行为，仅让状态管理更结构化。

```typescript
// 改造前（当前代码）
const [phase, setPhase] = useState<Phase>('idle')
const [intent, setIntent] = useState<Intent | null>(null)
const [modules, setModules] = useState<DisassemblyModule[]>([])
// ... 11 个更多 useState

// 改造后
const [state, dispatch] = useReducer(orchestratorReducer, createInitialState())
// 所有子组件从 state 读取，通过 dispatch 触发状态变更
```

**测试方式**：所有现有 E2E 流程不变（idle → gathering → processing → plan-preview → complete）。

**阶段 2 — 添加 `learning` 相位（新功能）**

在 `plan-preview` 的"开始学习"按钮触发 `PLAN_CONFIRMED` 后，进入 `learning` 相位而非直接到 `complete`。`learning` 相位显示当前活跃步骤，步骤完成后触发 `AUTO_NEXT`。

向后兼容：保留手动模块列表作为 `complete` 相位的 fallback——如果用户在 `learning` 相位点"查看所有模块"，仍可切换到 `complete`。

**阶段 3 — 接入反馈闭环（增强功能）**

将 `QuizPanel` 的答题结果通过 `QUIZ_SCORED` 事件回流到 orchestrator，触发 mastery 更新和动态 replan。

### A.5 自动步骤调度算法

```typescript
/**
 * shouldAutoAdvance — 决定当前步骤完成后是否自动进入下一步
 *
 * 规则：
 * 1. read 步骤完成后 → 自动推进（用户已看完精讲）
 * 2. quiz 步骤完成后 → 根据分数决定
 *    - score >= 80% → 自动推进
 *    - score 60-79% → 提示"建议复习"，3 秒后自动推进
 *    - score < 60%  → 暂停，插入补讲步骤，等待用户确认
 * 3. flashcard 步骤完成后 → 自动推进
 * 4. deep-dive 步骤完成后 → 暂停，展示学习成果卡片
 * 5. socratic 步骤完成后 → 自动推进
 */
function shouldAutoAdvance(step: LearningStep): 'auto' | 'prompt' | 'pause' {
  if (!step.result) return 'pause'

  switch (step.result.type) {
    case 'markdown':
      return 'auto'

    case 'quiz': {
      const pct = step.result.score / step.result.total
      if (pct >= 0.8) return 'auto'
      if (pct >= 0.6) return 'prompt'
      return 'pause'
    }

    case 'flashcard':
      return 'auto'

    case 'socratic':
      return step.result.hintsUsed > 3 ? 'prompt' : 'auto'

    default:
      return 'pause'
  }
}

/**
 * generateReplanSteps — 当 quiz 分数低时，生成补讲步骤
 *
 * 策略：
 * 1. 找到错题涉及的模块
 * 2. 为 mastery < 0.5 的模块插入 deep-dive 步骤
 * 3. 插入一个 mini-quiz 用于验证补讲效果
 */
function generateReplanSteps(
  failedStep: LearningStep,
  quizResult: Extract<StepResult, { type: 'quiz' }>,
  profile: LearningProfile,
): LearningStep[] {
  const weakModules = quizResult.details
    .filter((d) => !d.correct)
    .map((d) => d.moduleId)
    .filter((id, i, arr) => arr.indexOf(id) === i) // 去重
    .filter((id) => (profile.modules[id]?.mastery ?? 0) < 0.5)

  const replanSteps: LearningStep[] = weakModules.map((moduleId) => ({
    id: `replan-${moduleId}-${Date.now()}`,
    moduleId,
    moduleName: profile.modules[moduleId]?.moduleName ?? moduleId,
    action: 'deep-dive',
    status: 'pending',
    estimatedMin: 10,
    mastery: profile.modules[moduleId]?.mastery ?? 0.3,
    priority: 'high',
    skippable: false,
    insertedBy: 'replan',
  }))

  return replanSteps
}
```

---

## B. 动态布局切换系统

### B.1 三种布局模式

工作台根据当前学习步骤的类型，动态调整左右分栏比例和内容位置。

**布局 1：阅读模式（read / deep-dive）**
左侧 70% 显示精讲 Markdown，右侧 30% 显示步骤导航和进度。

```
+------------------------------------------------------------+
| ProgressRail (全宽，固定顶部)                               |
| [===■■■■□□□□□□□□]  步骤 3/8  ·  已学 12min  ·  掌握 65%   |
+-------------------------------------------+----------------+
|                                           |                |
|  MaterialReader (70%)                     | StepNav (30%)  |
|                                           |                |
|  ┌─ AI 精讲 ─────────────────────┐       | ┌────────────┐ |
|  │                                │       | │ 当前步骤:  │ |
|  │  ## 1.2 波函数的物理意义       │       | │ 模块3 精读 │ |
|  │                                │       | │            │ |
|  │  波函数 ψ(x,t) 描述量子态...  │       | │ ■ 模块1 ✓  │ |
|  │                                │       | │ ■ 模块2 ✓  │ |
|  │  $i\hbar\frac{\partial}       │       | │ ▶ 模块3    │ |
|  │  {\partial t}\psi = H\psi$    │       | │ □ 模块4    │ |
|  │                                │       | │ □ 模块5    │ |
|  └────────────────────────────────┘       | │            │ |
|                                           | │ [下一步 →] │ |
|                                           | └────────────┘ |
+-------------------------------------------+----------------+
```

**布局 2：测验模式（quiz / flashcard）**
左侧 60% 显示测验/闪卡界面，右侧 40% 显示参考材料和上下文。

```
+------------------------------------------------------------+
| ProgressRail (全宽)                                         |
| [===■■■■■■□□□□□□]  步骤 5/8  ·  测验中  ·  掌握 72%       |
+---------------------------------+--------------------------+
|                                 |                          |
|  QuizPanel / FlashcardReview    |  ReferencePane (40%)     |
|  (60%)                          |                          |
|                                 |  ┌──────────────────┐   |
|  ┌──────────────────────┐      |  │ 相关精讲片段      │   |
|  │  Q3: 波函数坍缩后... │      |  │                    │   |
|  │                      │      |  │ > 测量导致波函数  │   |
|  │  ○ A. 叠加态         │      |  │   坍缩到本征态... │   |
|  │  ● B. 本征态         │      |  │                    │   |
|  │  ○ C. 混合态         │      |  │ 掌握度: 45%       │   |
|  │  ○ D. 纠缠态         │      |  │ 建议: 重读 1.3    │   |
|  │                      │      |  └──────────────────┘   |
|  │  [确认答案]          │      |                          |
|  └──────────────────────┘      |  ┌──────────────────┐   |
|                                 |  │ 苏格拉底提示      │   |
|  3/8 题 · 当前正确率 67%       |  │ "如果测量改变了   │   |
|                                 |  │  状态，这意味着   │   |
|                                 |  │  什么？"          │   |
|                                 |  └──────────────────┘   |
+---------------------------------+--------------------------+
```

**布局 3：沉浸模式（socratic / concept-map）**
全屏对话或图谱，右侧收起为窄条。

```
+------------------------------------------------------------+
| ProgressRail (全宽)                                         |
| [===■■■■■■■■□□□□]  步骤 7/8  ·  对话中  ·  掌握 81%       |
+-----------------------------------------------------+-----+
|                                                     | Nav |
|  SocraticChat / ConceptMap (全宽 - 48px)            |     |
|                                                     | ■ ✓ |
|  ┌────────────────────────────────────────────┐    | ■ ✓ |
|  │ 🤖 你提到波函数坍缩——如果我们不测量，     │    | ■ ✓ |
|  │    粒子处于什么状态？                       │    | ▶   |
|  │                                              │    | □   |
|  │ 👤 应该是叠加态吧？                         │    |     |
|  │                                              │    |     |
|  │ 🤖 很好。那么，是什么决定了坍缩后           │    |     |
|  │    粒子处于哪个本征态？                     │    |     |
|  │                                              │    |     |
|  │ [输入回答...]                                │    |     |
|  └────────────────────────────────────────────┘    |     |
+-----------------------------------------------------+-----+
```

### B.2 步骤类型到布局模式的映射

```typescript
type LayoutMode = 'reading' | 'testing' | 'immersive'

const STEP_LAYOUT_MAP: Record<LearningStep['action'], LayoutMode> = {
  'read':         'reading',
  'deep-dive':    'reading',
  'quiz':         'testing',
  'flashcard':    'testing',
  'socratic':     'immersive',
  'concept-map':  'immersive',
}

function getLayoutForStep(step: LearningStep | null): LayoutMode {
  if (!step) return 'reading'
  return STEP_LAYOUT_MAP[step.action]
}
```

### B.3 CSS/Tailwind 实现

```typescript
/** 布局容器 — 根据 mode 动态调整 flex 比例 */
function WorkbenchLayout({
  mode,
  left,
  right,
  rail,
}: {
  mode: LayoutMode
  left: React.ReactNode
  right: React.ReactNode
  rail: React.ReactNode
}) {
  const layoutClasses: Record<LayoutMode, { left: string; right: string }> = {
    reading: {
      left: 'flex-[7] min-w-0',
      right: 'flex-[3] lg:min-w-[360px]',
    },
    testing: {
      left: 'flex-[6] min-w-0',
      right: 'flex-[4] lg:min-w-[400px]',
    },
    immersive: {
      left: 'flex-1 min-w-0',
      right: 'w-12 lg:w-14',  // 收缩为图标栏
    },
  }

  const cls = layoutClasses[mode]

  return (
    <div className="flex flex-col h-screen">
      {/* 顶部进度轨道 */}
      <div className="shrink-0 border-b border-border-warm bg-bg-card">
        {rail}
      </div>

      {/* 主内容区域 */}
      <div className="flex flex-1 min-h-0">
        <motion.div
          layout
          className={`${cls.left} p-6 lg:py-8 lg:px-10 overflow-y-auto`}
          transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
        >
          {left}
        </motion.div>

        <motion.aside
          layout
          className={`${cls.right} border-l border-border-warm bg-bg-card overflow-y-auto
                      transition-all duration-400`}
          transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
        >
          {right}
        </motion.aside>
      </div>
    </div>
  )
}
```

### B.4 布局切换的 Framer Motion 过渡

```typescript
/**
 * 布局切换使用 Framer Motion 的 layout 动画 + AnimatePresence。
 * 关键点：
 * 1. 外层容器用 layout prop 自动插值 flex 变化
 * 2. 内层内容用 AnimatePresence mode="wait" 交叉淡入
 * 3. 右侧面板在 immersive 模式下折叠时，内容切换为图标式导航
 */

// 内容区域的切换动画
const contentVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit:    { opacity: 0, y: -8 },
}

// 使用方式
<AnimatePresence mode="wait">
  <motion.div
    key={`step-${currentStep?.id}-${layoutMode}`}
    variants={contentVariants}
    initial="initial"
    animate="animate"
    exit="exit"
    transition={{ duration: 0.25 }}
  >
    {/* 根据 layoutMode 渲染不同内容 */}
  </motion.div>
</AnimatePresence>
```

---

## C. ProgressRail 进度可视化

### C.1 组件设计

ProgressRail 是一个固定在工作台顶部的窄条组件（高度 48-56px），实时展示学习进度、当前步骤、mastery 变化和耗时。

```typescript
interface ProgressRailProps {
  steps: LearningStep[]
  currentStepIndex: number
  sessionStartTime: number | null
  intent: 'learn' | 'exam' | 'review' | null
  onStepClick: (stepIndex: number) => void
  className?: string
}
```

### C.2 视觉结构

```
┌────────────────────────────────────────────────────────────────┐
│ 步骤 3/8 · 量子力学模块3 精读    已学12min  掌握65%  [暂停]  │
│                                                                │
│  ■──■──■──▶──□──□──□──□                                       │
│ M1 M2 M3 M4 M5 M6 M7 M8                                      │
│ 82% 71% ▶  ·  ·  ·  ·  ·    ← mastery 热力图色条             │
└────────────────────────────────────────────────────────────────┘

图例：
  ■ = 已完成（填充红色 #A5192E）
  ▶ = 当前活跃（红色边框 + 脉冲动画）
  □ = 待完成（灰色边框 #E8E4DE）
  ╳ = 已跳过（灰色删除线）
```

### C.3 实现代码

```tsx
function ProgressRail({
  steps,
  currentStepIndex,
  sessionStartTime,
  intent,
  onStepClick,
  className,
}: ProgressRailProps) {
  const completedCount = steps.filter((s) => s.status === 'completed').length
  const activeStep = currentStepIndex >= 0 ? steps[currentStepIndex] : null
  const elapsed = sessionStartTime
    ? Math.round((Date.now() - sessionStartTime) / 60000)
    : 0

  // mastery 加权平均
  const avgMastery = steps.length > 0
    ? steps.reduce((sum, s) => sum + (s.masteryAfter ?? s.mastery), 0) / steps.length
    : 0

  return (
    <div className={`px-6 py-3 flex items-center gap-4 ${className ?? ''}`}>
      {/* 左侧：步骤信息 */}
      <div className="shrink-0">
        <p className="text-sm font-medium text-text-main">
          步骤 {completedCount + (activeStep ? 1 : 0)}/{steps.length}
          {activeStep && (
            <span className="text-text-muted font-normal ml-2">
              {activeStep.moduleName} · {actionLabels[activeStep.action]}
            </span>
          )}
        </p>
      </div>

      {/* 中间：步骤节点轨道 */}
      <div className="flex-1 flex items-center gap-1">
        {steps.map((step, i) => (
          <StepNode
            key={step.id}
            step={step}
            index={i}
            isCurrent={i === currentStepIndex}
            onClick={() => onStepClick(i)}
          />
        ))}
      </div>

      {/* 右侧：统计 */}
      <div className="shrink-0 flex items-center gap-4 text-xs text-text-muted">
        <span>已学 {elapsed}min</span>
        <MasteryIndicator value={avgMastery} />
      </div>
    </div>
  )
}

/** 单个步骤节点 */
function StepNode({
  step,
  index,
  isCurrent,
  onClick,
}: {
  step: LearningStep
  index: number
  isCurrent: boolean
  onClick: () => void
}) {
  // mastery → 颜色映射（热力图）
  const masteryValue = step.masteryAfter ?? step.mastery
  const heatColor = masteryToColor(masteryValue)

  const baseClasses = 'w-6 h-6 rounded-full flex items-center justify-center text-[10px] cursor-pointer transition-all'

  if (step.status === 'completed') {
    return (
      <button
        onClick={onClick}
        className={`${baseClasses} text-white`}
        style={{ backgroundColor: '#A5192E' }}
        title={`${step.moduleName} — 掌握 ${Math.round(masteryValue * 100)}%`}
      >
        <CheckIcon size={10} />
      </button>
    )
  }

  if (isCurrent) {
    return (
      <button
        onClick={onClick}
        className={`${baseClasses} border-2 border-red-primary bg-bg-card animate-pulse`}
        title={`当前: ${step.moduleName}`}
      >
        <span className="text-red-primary font-medium">{index + 1}</span>
      </button>
    )
  }

  if (step.status === 'skipped') {
    return (
      <button
        onClick={onClick}
        className={`${baseClasses} border border-border-warm bg-bg-main text-text-muted line-through`}
        title={`已跳过: ${step.moduleName}`}
      >
        {index + 1}
      </button>
    )
  }

  // pending
  return (
    <button
      onClick={onClick}
      className={`${baseClasses} border border-border-warm bg-bg-card text-text-muted hover:border-red-primary`}
      title={step.moduleName}
    >
      {index + 1}
    </button>
  )
}
```

### C.4 Mastery 热力图

```typescript
/**
 * 将 mastery 值 (0-1) 映射到 Editorial Academic 色系。
 * 使用红色主色调的深浅变化，而非传统的红绿双色。
 *
 * 0.0 - 0.3  → 浅灰暖色 (#E8E4DE)  — 未掌握
 * 0.3 - 0.5  → 暖米色 (#D4C5A9)    — 初步接触
 * 0.5 - 0.7  → 暖金色 (#C49A2A)    — 基本掌握
 * 0.7 - 0.9  → 浅红 (#D4738C)      — 良好掌握
 * 0.9 - 1.0  → 深红 (#A5192E)      — 精通
 */
function masteryToColor(mastery: number): string {
  if (mastery >= 0.9) return '#A5192E'
  if (mastery >= 0.7) return '#D4738C'
  if (mastery >= 0.5) return '#C49A2A'
  if (mastery >= 0.3) return '#D4C5A9'
  return '#E8E4DE'
}

/** MasteryIndicator — 圆弧式掌握度指示器 */
function MasteryIndicator({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  const color = masteryToColor(value)

  return (
    <div className="flex items-center gap-1.5">
      <svg width="20" height="20" viewBox="0 0 20 20">
        {/* 背景圆弧 */}
        <circle
          cx="10" cy="10" r="8"
          fill="none" stroke="#E8E4DE" strokeWidth="2.5"
        />
        {/* 进度圆弧 */}
        <circle
          cx="10" cy="10" r="8"
          fill="none" stroke={color} strokeWidth="2.5"
          strokeDasharray={`${value * 50.26} 50.26`}
          strokeLinecap="round"
          transform="rotate(-90 10 10)"
        />
      </svg>
      <span className="text-xs font-medium" style={{ color }}>
        {pct}%
      </span>
    </div>
  )
}
```

### C.5 学习时间追踪

```typescript
/**
 * useSessionTimer — 追踪学习时间
 *
 * 功能：
 * 1. 记录每个步骤的开始/结束时间
 * 2. 暂停时停止计时
 * 3. 总时间写入 LearningProfile
 */
function useSessionTimer(
  phase: OrchestratorPhase,
  currentStepIndex: number,
) {
  const stepStartRef = useRef<number | null>(null)
  const totalRef = useRef(0)

  useEffect(() => {
    if (phase === 'learning' && currentStepIndex >= 0) {
      stepStartRef.current = Date.now()
    }
    return () => {
      if (stepStartRef.current) {
        totalRef.current += (Date.now() - stepStartRef.current) / 60000
        stepStartRef.current = null
      }
    }
  }, [phase, currentStepIndex])

  // 暂停时保存已累积时间
  useEffect(() => {
    if (phase === 'paused' && stepStartRef.current) {
      totalRef.current += (Date.now() - stepStartRef.current) / 60000
      stepStartRef.current = null
    }
  }, [phase])

  const getElapsedMinutes = useCallback(() => {
    const current = stepStartRef.current
      ? (Date.now() - stepStartRef.current) / 60000
      : 0
    return Math.round(totalRef.current + current)
  }, [])

  return { getElapsedMinutes, totalMinutes: totalRef.current }
}
```

---

## D. "一键开始学习" 零摩擦体验

### D.1 完整用户旅程

当前流程（6 步才能看到第一个精讲内容）：

```
打开工作台 → 选择意图 → 填写背景 → 等待分析 → 确认计划 → 点击模块 → 阅读精讲
```

目标流程（2 步即可进入学习）：

```
打开工作台 → 一键"今日学习" → 自动进入第一个步骤
              ↓
         (后台异步: 检测已有分析 → 生成计划 → 预加载内容)
```

### D.2 实现方案

```typescript
/**
 * SmartStartButton — "一键开始学习" 组件
 *
 * 放在 AIToolPanel 的 idle 阶段最顶部，取代或置于意图按钮之上。
 * 根据用户历史自动推荐最佳学习模式。
 */
function SmartStartButton({
  materialId,
  onStart,
}: {
  materialId: string
  onStart: (intent: Intent, steps: LearningStep[]) => void
}) {
  const [recommendation, setRecommendation] = useState<SmartRecommendation | null>(null)

  useEffect(() => {
    // 后台异步计算推荐
    computeRecommendation(materialId).then(setRecommendation)
  }, [materialId])

  if (!recommendation) return null

  return (
    <motion.button
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={() => onStart(recommendation.intent, recommendation.precomputedSteps)}
      className="w-full flex items-center gap-4 p-4 border-l-3 border-l-red-primary
                 border border-border-warm bg-bg-card hover:bg-bg-accent
                 transition-colors text-left group"
    >
      <div className="w-10 h-10 rounded-full bg-red-primary/10 flex items-center justify-center
                      group-hover:bg-red-primary/20 transition-colors">
        <Zap size={18} className="text-red-primary" />
      </div>
      <div className="flex-1">
        <p className="text-sm font-medium text-text-main group-hover:text-red-primary transition-colors">
          {recommendation.label}
        </p>
        <p className="text-xs text-text-muted mt-0.5">
          {recommendation.description} · 约 {recommendation.estimatedMin} 分钟
        </p>
      </div>
      <ArrowRight size={16} className="text-text-muted group-hover:text-red-primary transition-colors" />
    </motion.button>
  )
}
```

### D.3 智能推荐算法

```typescript
interface SmartRecommendation {
  intent: 'learn' | 'exam' | 'review'
  label: string
  description: string
  estimatedMin: number
  precomputedSteps: LearningStep[]
  reason: string  // 推荐理由（内部调试用）
}

/**
 * computeRecommendation — 综合多个信号计算最佳推荐
 *
 * 信号优先级：
 * 1. 是否有已完成的分析？（可以跳过管道等待）
 * 2. 是否有到期闪卡？（优先复习）
 * 3. 学生上次的学习模式？（延续习惯）
 * 4. 距离考试还有多久？（紧急度）
 * 5. 各模块 mastery 分布？（薄弱环节）
 */
async function computeRecommendation(materialId: string): Promise<SmartRecommendation | null> {
  const profile = loadProfile()
  const existingAnalysis = await getLatestAnalysis(materialId).catch(() => null)

  // 信号 1：有到期闪卡 → 推荐复习
  const dueFlashcards = getDueFlashcardCount(materialId)
  if (dueFlashcards > 5) {
    return {
      intent: 'review',
      label: `复习 ${dueFlashcards} 张到期闪卡`,
      description: '间隔重复，巩固记忆',
      estimatedMin: Math.ceil(dueFlashcards * 0.5),
      precomputedSteps: generateFlashcardSteps(materialId, dueFlashcards),
      reason: `${dueFlashcards} flashcards due`,
    }
  }

  // 信号 2：有已完成的分析
  if (existingAnalysis?.status === 'completed') {
    const result = await getAnalysisResult(existingAnalysis.task_id).catch(() => null)
    if (result) {
      const modules = result.modules as DisassemblyModule[]

      // 找到最薄弱的模块
      const weakModules = modules.filter((m) => {
        const mastery = profile.modules[m.id]?.mastery ?? 0.3
        return mastery < 0.6
      })

      if (weakModules.length > 0) {
        const steps = generatePlanSteps(modules, 'learn', profile)
          .filter((s) => s.mastery < 0.6)
          .slice(0, 3)  // 最多推荐 3 个步骤
        return {
          intent: 'learn',
          label: '继续学习薄弱模块',
          description: `${weakModules.length} 个模块需要加强`,
          estimatedMin: steps.reduce((s, p) => s + p.estimatedMin, 0),
          precomputedSteps: steps,
          reason: `${weakModules.length} weak modules found`,
        }
      }

      // 所有模块 mastery >= 60% → 推荐测验
      return {
        intent: 'exam',
        label: '巩固测验',
        description: '检验整体掌握程度',
        estimatedMin: 15,
        precomputedSteps: generateQuizOnlySteps(modules),
        reason: 'all modules above 60% mastery',
      }
    }
  }

  // 信号 3：无分析 → 推荐全新学习
  return {
    intent: 'learn',
    label: '开始学习这份材料',
    description: 'AI 分析 + 个性化学习路径',
    estimatedMin: 30,
    precomputedSteps: [],  // 需要先运行分析管道
    reason: 'no existing analysis',
  }
}
```

### D.4 自动编排步骤的规则引擎

```typescript
/**
 * StepScheduler — 步骤编排规则引擎
 *
 * 根据 intent + mastery + 时间约束，自动安排学习步骤的类型和顺序。
 */
const SCHEDULING_RULES: Record<Intent, SchedulingRule[]> = {

  learn: [
    // 规则 1：按拓扑序遍历所有模块
    // 规则 2：每个模块先 read，然后检查 mastery
    // 规则 3：如果 mastery < 0.5，追加 deep-dive
    // 规则 4：最后一个模块后追加综合 quiz
    {
      name: '全覆盖拓扑序',
      condition: () => true,
      generate: (modules, profile) => {
        const steps: LearningStep[] = []
        for (const mod of modules) {
          const mastery = profile.modules[mod.id]?.mastery ?? 0.3
          steps.push(createStep(mod, 'read', mastery))
          if (mastery < 0.5) {
            steps.push(createStep(mod, 'deep-dive', mastery))
          }
        }
        // 综合测验
        steps.push({
          id: `step-final-quiz`,
          moduleId: 'all',
          moduleName: '综合测验',
          action: 'quiz',
          status: 'pending',
          estimatedMin: 10,
          mastery: 0,
          priority: 'high',
          skippable: false,
        })
        return steps
      },
    },
  ],

  exam: [
    // 规则 1：跳过 mastery > 70% 的模块
    // 规则 2：高权重 + 薄弱 → deep-dive
    // 规则 3：高权重 + 中等 → quiz 检验
    // 规则 4：低权重 → 闪卡快速过
    {
      name: '备考优先级排序',
      condition: () => true,
      generate: (modules, profile) => {
        const steps: LearningStep[] = []
        const sorted = [...modules].sort((a, b) => {
          const wa = a.examWeight === 'high' ? 3 : a.examWeight === 'medium' ? 2 : 1
          const wb = b.examWeight === 'high' ? 3 : b.examWeight === 'medium' ? 2 : 1
          return wb - wa
        })
        for (const mod of sorted) {
          const mastery = profile.modules[mod.id]?.mastery ?? 0.3
          if (mastery > 0.7) continue  // 跳过已掌握
          if (mod.examWeight === 'high' && mastery < 0.5) {
            steps.push(createStep(mod, 'deep-dive', mastery))
          } else if (mod.examWeight === 'high') {
            steps.push(createStep(mod, 'quiz', mastery))
          } else {
            steps.push(createStep(mod, 'flashcard', mastery))
          }
        }
        return steps
      },
    },
  ],

  review: [
    // 规则 1：只复习 mastery 衰减到 < 60% 的模块
    // 规则 2：使用 FSRS 优先级排序到期闪卡
    // 规则 3：每 5 张闪卡后插入一个快速 quiz
    {
      name: '间隔复习',
      condition: () => true,
      generate: (modules, profile) => {
        const steps: LearningStep[] = []
        const weak = modules.filter((m) => (profile.modules[m.id]?.mastery ?? 0.3) < 0.6)
        for (const mod of weak) {
          const mastery = profile.modules[mod.id]?.mastery ?? 0.3
          steps.push(createStep(mod, 'flashcard', mastery))
        }
        // 每 5 个闪卡步骤后插入 quiz
        const withQuiz: LearningStep[] = []
        for (let i = 0; i < steps.length; i++) {
          withQuiz.push(steps[i])
          if ((i + 1) % 5 === 0 && i < steps.length - 1) {
            withQuiz.push({
              id: `step-review-quiz-${i}`,
              moduleId: 'mixed',
              moduleName: '复习检查',
              action: 'quiz',
              status: 'pending',
              estimatedMin: 3,
              mastery: 0,
              priority: 'medium',
              skippable: true,
            })
          }
        }
        return withQuiz
      },
    },
  ],
}

/** 辅助：创建步骤 */
function createStep(
  mod: DisassemblyModule,
  action: LearningStep['action'],
  mastery: number,
): LearningStep {
  const estimatedMin =
    action === 'read' ? 10 :
    action === 'deep-dive' ? 15 :
    action === 'quiz' ? 5 :
    action === 'flashcard' ? 5 :
    action === 'socratic' ? 10 : 8

  return {
    id: `step-${mod.id}-${action}`,
    moduleId: mod.id,
    moduleName: mod.name,
    action,
    status: 'pending',
    estimatedMin,
    mastery,
    priority: mod.examWeight === 'high' ? 'high' : mod.examWeight === 'medium' ? 'medium' : 'low',
    skippable: mastery > 0.7 || mod.examWeight === 'low',
    insertedBy: 'planner',
  }
}
```

---

## 实施路线图

| 阶段 | 内容 | 工作量 | 依赖 |
|------|------|--------|------|
| **P0** | 将 AIToolPanel 的 13 个 useState 迁移到 useReducer | 1 天 | 无 |
| **P1** | 添加 `learning` 相位 + ProgressRail 组件 | 3 天 | P0 |
| **P2** | 实现 `AUTO_NEXT` 调度和 `shouldAutoAdvance` 逻辑 | 2 天 | P1 |
| **P3** | 三种布局模式 + Framer Motion 过渡 | 2 天 | P1 |
| **P4** | SmartStartButton + `computeRecommendation` | 2 天 | P1 |
| **P5** | Quiz → QUIZ_SCORED → REPLAN_INSERT 反馈闭环 | 3 天 | P2 |
| **P6** | mastery 热力图 + 学习时间追踪持久化 | 1 天 | P1 |

**总计约 14 个工作日**，可与后端工具 API 开发并行推进。

---

## 设计约束备忘

- **Editorial Academic 美学**：所有新组件使用红色主色调 `#A5192E`，暖纸张背景 `#F7F5F2`，border 而非 shadow，Instrument Serif 标题 + Satoshi 正文。
- **Framer Motion 动效**：仅 opacity + 轻微位移，不做夸张弹跳，不做自动循环动画。
- **零 barrel imports**：ProgressRail、StepNode、MasteryIndicator 等新组件各自独立文件，不通过 index.ts 导出。
- **单文件 <= 400 行**：orchestratorReducer 和类型定义分离到 `src/lib/orchestrator-types.ts` 和 `src/lib/orchestrator-reducer.ts`。
- **向后兼容**：P0 阶段完成后，现有 E2E 流程（idle → complete）必须完全不变。
