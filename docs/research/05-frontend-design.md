# 05 — 前端设计方案：新工作台组件树、布局系统、动效与美学

> 研究日期：2026-03-18
> 前置依赖：`docs/workbench-audit-2026-03-17.md`（现状审计）、CLAUDE.md 设计系统章节

---

## A. 新工作台组件树和文件结构

### A.1 完整目录结构

```
src/components/
├── layout/
│   ├── Header.tsx
│   ├── Layout.tsx
│   └── Sidebar.tsx
├── workbench/                     # 核心学习工作台
│   ├── MaterialReader.tsx         # [保留] 材料多视图阅读器
│   ├── PdfAnnotator.tsx           # [保留] PDF 批注（lazy）
│   ├── QuizPanel.tsx              # [保留] 测验面板
│   ├── SocraticChat.tsx           # [保留] 苏格拉底对话
│   ├── ProcessingView.tsx         # [保留] 管道进度时间线
│   ├── IntentGatherer.tsx         # [保留] 意图收集
│   ├── ModuleDisplay.tsx          # [保留] 模块列表
│   ├── RelatedMaterials.tsx       # [保留] 相关材料
│   ├── AICoachPanel.tsx           # [新增] AI 教练对话面板
│   ├── ProgressTrack.tsx          # [新增] 学习进度轨道
│   ├── MasteryMeter.tsx           # [新增] mastery 仪表盘
│   ├── StepNavigator.tsx          # [新增] 学习步骤导航器
│   └── WorkbenchLayout.tsx        # [新增] 动态布局容器
├── flashcard/
│   ├── FlashcardCard.tsx          # [升级] 3D 翻转卡片
│   ├── FlashcardDeck.tsx          # [新增] 卡组容器（滑动手势）
│   ├── DeckList.tsx               # [保留] 卡组管理
│   ├── ReviewSession.tsx          # [保留] 复习会话
│   └── CompletionScreen.tsx       # [保留] 完成画面
├── quiz/
│   ├── QuizQuestion.tsx           # [新增] 单题卡片（进入/退出动效）
│   ├── QuizOptionButton.tsx       # [新增] 选项按钮
│   ├── QuizScoreSummary.tsx       # [新增] 分数总结（含 mastery 变化）
│   └── QuizProgressBar.tsx        # [新增] 答题进度条
├── achievement/
│   ├── ScholarBadge.tsx           # [新增] 学术印章徽章
│   ├── AchievementToast.tsx       # [新增] 成就解锁通知
│   └── RankDisplay.tsx            # [新增] Scholar Rank 展示
├── multimodal/
│   ├── TTSReader.tsx              # [新增] TTS 语音朗读 + 高亮同步
│   ├── ConceptGraph.tsx           # [新增] D3.js 概念图谱
│   └── FormulaDerivation.tsx      # [新增] 公式推导动画
├── agenda/                        # [保留]
├── upload/                        # [保留]
├── intent/                        # [保留]
├── gaoling/                       # [保留]
├── auth/                          # [保留]
├── ErrorBoundary.tsx              # [保留]
├── FeatureGate.tsx                # [保留]
└── Skeleton.tsx                   # [保留]
```

### A.2 新组件职责与接口

#### WorkbenchLayout — 动态布局容器

```typescript
interface WorkbenchLayoutProps {
  mode: 'split' | 'focus-reader' | 'focus-coach'
  onModeChange: (mode: WorkbenchLayoutProps['mode']) => void
  readerSlot: ReactNode
  coachSlot: ReactNode
  trackSlot?: ReactNode   // 底部进度轨道（可选）
}
```

职责：根据 `mode` 切换三种布局模式，管理 CSS Grid 列宽过渡动画。
关键实现：使用 `grid-template-columns` + `transition` 实现平滑布局切换，而非条件渲染导致的重挂载。

#### AICoachPanel — AI 教练对话面板

```typescript
interface AICoachPanelProps {
  moduleId: string
  moduleName: string
  mastery: number                       // 0-1，驱动脚手架等级
  scaffoldLevel: 'full' | 'moderate' | 'minimal'
  messages: CoachMessage[]
  onSend: (text: string) => void
  onToolInvoke: (tool: string) => void  // 调用高级工具
  isStreaming?: boolean
}
```

职责：统一 Socratic 对话 + 高级工具调用入口。消息气泡使用 `border-l-3 border-l-red-primary` 引用线风格区分 AI 回复和用户输入。

#### ProgressTrack — 学习进度轨道

```typescript
interface ProgressTrackProps {
  steps: LearningPlanStep[]
  currentStepIndex: number
  completedStepIds: Set<string>
  onStepClick: (stepId: string) => void
}
```

职责：水平或垂直轨道，红色节点 + 暖色连线，显示每个学习步骤的完成状态。

#### MasteryMeter — mastery 仪表盘

```typescript
interface MasteryMeterProps {
  current: number    // 0-100
  previous: number   // 用于计算 delta 动画
  moduleCount: number
  completedCount: number
}
```

职责：环形进度 + 数字跳动动画展示综合 mastery。

#### StepNavigator — 学习步骤导航器

```typescript
interface StepNavigatorProps {
  currentStep: LearningPlanStep
  totalSteps: number
  currentIndex: number
  onPrev: () => void
  onNext: () => void
  onSkip: () => void
}
```

职责：底部固定的步骤导航栏，显示"上一步 / 下一步 / 跳过"，以及当前步骤标题。

### A.3 组件层级关系

```
WorkbenchPage
└── WorkbenchLayout (mode: split | focus-reader | focus-coach)
    ├── [readerSlot]
    │   └── MaterialReader
    │       ├── MaterialHeader
    │       ├── TabBar (原文 | AI精讲 | 测验 | 闪卡)
    │       ├── PdfAnnotator (lazy, Suspense)
    │       ├── ReactMarkdown (specialist)
    │       ├── QuizPanel → QuizQuestion → QuizOptionButton
    │       └── FlashcardDeck → FlashcardCard
    │
    ├── [coachSlot]
    │   ├── AIToolPanel (状态机: idle → gathering → processing → plan-preview → complete)
    │   │   ├── IdlePhase / GatheringPhase
    │   │   ├── ProcessingView (timeline)
    │   │   ├── LearningPlanPreview
    │   │   └── CompletePhase / ManualToolSection
    │   ├── AICoachPanel (Socratic 对话 + 工具调用)
    │   ├── MasteryMeter
    │   └── ProgressTrack
    │
    └── [trackSlot]
        └── StepNavigator (底部固定导航)
```

### A.4 与现有组件的兼容策略

1. **不破坏现有组件**：所有标记 `[保留]` 的组件保持接口不变，WorkbenchLayout 通过 slot 模式包裹现有组件。
2. **渐进式替换**：AICoachPanel 初期作为 SocraticChat 的增强包装，内部复用 SocraticChat 的对话逻辑。
3. **Props 向下传递**：WorkbenchPage 仍是状态枢纽，新组件通过 props 从 WorkbenchPage 获取数据，不引入全局状态管理。
4. **新 Tab 扩展**：MaterialReader 的 `tabs` 数组新增 `flashcard` 选项，仅当有闪卡时显示。

---

## B. 动态布局系统 CSS/Tailwind 实现

### B.1 三种布局模式的 Tailwind 类名

```typescript
const LAYOUT_CLASSES: Record<string, { grid: string; reader: string; coach: string }> = {
  'split': {
    grid:   'grid grid-cols-[7fr_3fr] gap-0',
    reader: 'overflow-y-auto',
    coach:  'border-l border-border-warm overflow-y-auto',
  },
  'focus-reader': {
    grid:   'grid grid-cols-[1fr_0fr] gap-0',
    reader: 'overflow-y-auto',
    coach:  'overflow-hidden opacity-0 pointer-events-none',
  },
  'focus-coach': {
    grid:   'grid grid-cols-[0fr_1fr] gap-0',
    reader: 'overflow-hidden opacity-0 pointer-events-none',
    coach:  'overflow-y-auto',
  },
}
```

### B.2 响应式断点设计

| 断点 | 宽度 | 布局行为 |
|------|------|---------|
| mobile | `< 768px` | 单列堆叠，底部 Tab 切换 reader/coach |
| tablet | `768px - 1279px` | 60:40 分栏，coach 可折叠 |
| desktop | `>= 1280px` | 70:30 分栏，三模式切换 |

```css
/* 在 WorkbenchLayout 中的响应式处理 */
.workbench-grid {
  /* Mobile: 单列 */
  display: flex;
  flex-direction: column;
  min-height: 0;
}

@media (min-width: 768px) {
  .workbench-grid {
    display: grid;
    grid-template-columns: 6fr 4fr;
    height: calc(100vh - 56px); /* 减去 Header 高度 */
  }
}

@media (min-width: 1280px) {
  .workbench-grid {
    grid-template-columns: 7fr 3fr;
    transition: grid-template-columns 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .workbench-grid[data-mode="focus-reader"] {
    grid-template-columns: 1fr 0fr;
  }

  .workbench-grid[data-mode="focus-coach"] {
    grid-template-columns: 0fr 1fr;
  }
}
```

### B.3 布局切换的 CSS Transition

```typescript
// WorkbenchLayout.tsx 中的过渡实现
export default function WorkbenchLayout({ mode, onModeChange, readerSlot, coachSlot, trackSlot }: WorkbenchLayoutProps) {
  return (
    <div className="flex flex-col h-[calc(100vh-56px)]">
      {/* Main grid — 布局过渡全靠 CSS transition */}
      <div
        data-mode={mode}
        className={[
          'flex-1 min-h-0',
          'flex flex-col',            // mobile 默认堆叠
          'lg:grid lg:gap-0',         // desktop 切换 grid
          'transition-[grid-template-columns] duration-400 ease-[cubic-bezier(0.4,0,0.2,1)]',
          mode === 'split'        && 'lg:grid-cols-[7fr_3fr]',
          mode === 'focus-reader' && 'lg:grid-cols-[1fr_0fr]',
          mode === 'focus-coach'  && 'lg:grid-cols-[0fr_1fr]',
        ].filter(Boolean).join(' ')}
      >
        {/* Reader 区域 */}
        <div className={[
          'flex-1 lg:flex-none overflow-y-auto',
          'transition-opacity duration-300',
          mode === 'focus-coach' && 'lg:opacity-0 lg:pointer-events-none lg:overflow-hidden',
        ].filter(Boolean).join(' ')}>
          {readerSlot}
        </div>

        {/* Coach 区域 */}
        <aside className={[
          'lg:border-l lg:border-border-warm overflow-y-auto',
          'transition-opacity duration-300',
          mode === 'focus-reader' && 'lg:opacity-0 lg:pointer-events-none lg:overflow-hidden',
        ].filter(Boolean).join(' ')}>
          {coachSlot}
        </aside>
      </div>

      {/* 底部步骤导航 */}
      {trackSlot && (
        <div className="border-t border-border-warm bg-bg-card px-4 py-2">
          {trackSlot}
        </div>
      )}
    </div>
  )
}
```

### B.4 布局 ASCII Art

#### Desktop (>= 1280px)

**Split 模式（默认 70:30）**
```
┌──────────────────────────────────────┬────────────────┐
│                                      │ border-l       │
│          MaterialReader              │   AICoachPanel │
│          (原文/精讲/测验/闪卡)        │   MasteryMeter │
│                                      │   ProgressTrack│
│          PdfAnnotator                │   ModuleList   │
│          ReactMarkdown               │                │
│          QuizPanel                   │   SocraticChat │
│          FlashcardDeck               │                │
│                                      │                │
├──────────────────────────────────────┴────────────────┤
│  StepNavigator: [< 上一步]  步骤 3/7: 模块精读  [下一步 >] │
└──────────────────────────────────────────────────────┘
```

**Focus-Reader 模式（阅读器全屏）**
```
┌─────────────────────────────────────────────────────┐
│                                                      │
│               MaterialReader (全宽)                   │
│               PdfAnnotator / ReactMarkdown           │
│               (coach 面板滑出视野)                      │
│                                                      │
│                                                      │
│                                                      │
├─────────────────────────────────────────────────────┤
│  StepNavigator: [< 上一步]  步骤 3/7  [展开教练 ▸]     │
└─────────────────────────────────────────────────────┘
```

**Focus-Coach 模式（教练全屏）**
```
┌─────────────────────────────────────────────────────┐
│                                                      │
│               AICoachPanel (全宽)                     │
│               苏格拉底对话气泡                          │
│               工具调用结果                             │
│               MasteryMeter 仪表盘                     │
│               ProgressTrack 进度轨道                   │
│                                                      │
├─────────────────────────────────────────────────────┤
│  StepNavigator: [◂ 展开阅读器]  正在对话: 量子纠缠     │
└─────────────────────────────────────────────────────┘
```

#### Mobile (< 768px)

```
┌─────────────────────────┐
│       Header            │
├─────────────────────────┤
│                         │
│   当前活跃面板           │
│   (Reader 或 Coach      │
│    通过底部 Tab 切换)    │
│                         │
│                         │
│                         │
├─────────────────────────┤
│  StepNavigator (简化)   │
├─────────────────────────┤
│ [阅读] [教练] [进度]     │
│  底部 Tab Bar            │
└─────────────────────────┘
```

#### Tablet (768px - 1279px)

```
┌────────────────────────┬───────────────────┐
│                        │                   │
│    MaterialReader      │   Coach Panel     │
│    (60%)               │   (40%)           │
│                        │  [折叠按钮 ▸]      │
│                        │                   │
├────────────────────────┴───────────────────┤
│  StepNavigator                             │
└────────────────────────────────────────────┘
```

---

## C. Framer Motion 动效升级方案

### C.1 学习步骤切换动画

```typescript
// StepNavigator 内的步骤切换
const stepVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 80 : -80,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: direction > 0 ? -80 : 80,
    opacity: 0,
  }),
}

// 使用
<AnimatePresence mode="wait" custom={direction}>
  <motion.div
    key={currentStep.id}
    custom={direction}
    variants={stepVariants}
    initial="enter"
    animate="center"
    exit="exit"
    transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
  >
    <StepContent step={currentStep} />
  </motion.div>
</AnimatePresence>
```

### C.2 测验题目进入/退出动效

```typescript
// QuizQuestion.tsx
const questionVariants = {
  initial: { opacity: 0, y: 20, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit:    { opacity: 0, y: -12, scale: 0.98 },
}

const optionVariants = {
  initial: { opacity: 0, x: -12 },
  animate: (i: number) => ({
    opacity: 1,
    x: 0,
    transition: { delay: 0.15 + i * 0.06, duration: 0.25 },
  }),
}

// 答题反馈动画
const feedbackVariants = {
  correct: {
    backgroundColor: ['#FFFEFB', '#E8F5E9', '#FFFEFB'],
    borderColor: ['#E8E4DE', '#4CAF50', '#4CAF50'],
    transition: { duration: 0.6 },
  },
  incorrect: {
    backgroundColor: ['#FFFEFB', '#FFEBEE', '#FFFEFB'],
    borderColor: ['#E8E4DE', '#A5192E', '#A5192E'],
    x: [0, -4, 4, -3, 3, 0],  // 微震动
    transition: { duration: 0.5 },
  },
}

// 使用
<motion.div
  variants={questionVariants}
  initial="initial"
  animate="animate"
  exit="exit"
  transition={{ duration: 0.35, ease: 'easeOut' }}
  className="border border-border-warm rounded-lg p-5 bg-bg-card"
>
  <h3 className="font-heading text-lg text-text-main mb-4">
    题目 {index + 1}
  </h3>
  {options.map((opt, i) => (
    <motion.button
      key={opt.id}
      custom={i}
      variants={optionVariants}
      initial="initial"
      animate="animate"
      className="..."
    >
      {opt.text}
    </motion.button>
  ))}
</motion.div>
```

### C.3 闪卡翻转动画（3D Perspective）

```typescript
// FlashcardCard.tsx — 3D 翻转
const FlashcardCard = ({ front, back, isFlipped, onFlip }: FlashcardCardProps) => {
  return (
    <div
      onClick={onFlip}
      className="w-full max-w-md mx-auto cursor-pointer"
      style={{ perspective: '1200px' }}
    >
      <motion.div
        animate={{ rotateY: isFlipped ? 180 : 0 }}
        transition={{
          duration: 0.5,
          ease: [0.4, 0, 0.2, 1],
          type: 'tween',
        }}
        style={{ transformStyle: 'preserve-3d' }}
        className="relative w-full min-h-[280px]"
      >
        {/* 正面 */}
        <div
          className={[
            'absolute inset-0 backface-hidden',
            'border border-border-warm rounded-lg bg-bg-card p-6',
            'flex flex-col items-center justify-center',
          ].join(' ')}
          style={{ backfaceVisibility: 'hidden' }}
        >
          <div className="w-8 h-px bg-red-primary mb-4" />
          <p className="font-heading text-xl text-text-main text-center leading-relaxed">
            {front}
          </p>
          <p className="text-xs text-text-muted mt-6">点击翻转</p>
        </div>

        {/* 背面 */}
        <div
          className={[
            'absolute inset-0 backface-hidden',
            'border border-red-primary rounded-lg bg-bg-accent p-6',
            'flex flex-col items-center justify-center',
          ].join(' ')}
          style={{
            backfaceVisibility: 'hidden',
            transform: 'rotateY(180deg)',
          }}
        >
          <p className="font-body text-base text-text-body text-center leading-relaxed">
            {back}
          </p>
        </div>
      </motion.div>
    </div>
  )
}
```

### C.4 进度条动画

```typescript
// QuizProgressBar.tsx
const QuizProgressBar = ({ current, total }: { current: number; total: number }) => {
  const percentage = (current / total) * 100

  return (
    <div className="flex items-center gap-3">
      <span className="text-xs font-mono text-text-muted w-12">
        {current}/{total}
      </span>
      <div className="flex-1 h-1 bg-bg-accent rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-red-primary rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
        />
      </div>
    </div>
  )
}

// ProgressTrack.tsx — 节点式进度轨道
const ProgressTrack = ({ steps, currentStepIndex, completedStepIds }: ProgressTrackProps) => {
  return (
    <div className="flex items-center gap-0 overflow-x-auto py-2 px-1">
      {steps.map((step, i) => {
        const isCompleted = completedStepIds.has(step.id)
        const isCurrent = i === currentStepIndex
        return (
          <Fragment key={step.id}>
            {/* 节点 */}
            <motion.button
              whileHover={{ scale: 1.15 }}
              whileTap={{ scale: 0.95 }}
              className={[
                'w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0',
                'transition-colors duration-300',
                isCompleted
                  ? 'border-red-primary bg-red-primary text-white'
                  : isCurrent
                    ? 'border-red-primary bg-bg-card text-red-primary'
                    : 'border-border-warm bg-bg-card text-text-muted',
              ].join(' ')}
            >
              {isCompleted ? <Check size={10} /> : <span className="text-[9px] font-mono">{i + 1}</span>}
            </motion.button>

            {/* 连线 */}
            {i < steps.length - 1 && (
              <div className={[
                'h-[2px] w-6 shrink-0',
                isCompleted ? 'bg-red-primary' : 'bg-border-warm',
              ].join(' ')} />
            )}
          </Fragment>
        )
      })}
    </div>
  )
}
```

### C.5 成就解锁动效

```typescript
// AchievementToast.tsx
const AchievementToast = ({ badge, title, onDismiss }: AchievementToastProps) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 50, scale: 0.8 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -20, scale: 0.9 }}
      transition={{
        type: 'spring',
        stiffness: 300,
        damping: 25,
      }}
      className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50"
    >
      <div className="flex items-center gap-3 px-5 py-3 bg-bg-card border border-accent-gold rounded-lg">
        {/* 徽章图标带旋转入场 */}
        <motion.div
          initial={{ rotate: -30, scale: 0 }}
          animate={{ rotate: 0, scale: 1 }}
          transition={{ delay: 0.2, type: 'spring', stiffness: 400 }}
          className="text-accent-gold"
        >
          {badge}
        </motion.div>

        <div>
          <p className="text-xs text-accent-gold font-medium tracking-wide uppercase">
            成就解锁
          </p>
          <p className="text-sm font-heading text-text-main">{title}</p>
        </div>

        {/* 金色微光扫过效果 */}
        <motion.div
          className="absolute inset-0 rounded-lg pointer-events-none"
          style={{
            background: 'linear-gradient(90deg, transparent, rgba(196,154,42,0.15), transparent)',
            backgroundSize: '200% 100%',
          }}
          animate={{ backgroundPosition: ['200% 0', '-200% 0'] }}
          transition={{ duration: 1.5, delay: 0.3 }}
        />
      </div>
    </motion.div>
  )
}
```

### C.6 Mastery 变化动画

```typescript
// MasteryMeter.tsx
const MasteryMeter = ({ current, previous }: MasteryMeterProps) => {
  const delta = current - previous
  const circumference = 2 * Math.PI * 42  // r=42 的圆周长
  const dashOffset = circumference * (1 - current / 100)

  return (
    <div className="relative w-28 h-28 mx-auto">
      {/* 背景环 */}
      <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="42" fill="none" stroke="#E8E4DE" strokeWidth="4" />
        <motion.circle
          cx="50" cy="50" r="42"
          fill="none"
          stroke="#A5192E"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference * (1 - previous / 100) }}
          animate={{ strokeDashoffset: dashOffset }}
          transition={{ duration: 1.2, ease: [0.4, 0, 0.2, 1] }}
        />
      </svg>

      {/* 中心数字 */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <motion.span
          key={current}
          initial={{ scale: 1.3, color: '#A5192E' }}
          animate={{ scale: 1, color: '#1A1A1A' }}
          transition={{ duration: 0.6 }}
          className="text-2xl font-heading"
        >
          {current}%
        </motion.span>

        {/* Delta 指示 */}
        {delta !== 0 && (
          <motion.span
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className={`text-xs font-mono ${delta > 0 ? 'text-success' : 'text-red-primary'}`}
          >
            {delta > 0 ? '+' : ''}{delta}%
          </motion.span>
        )}
      </div>
    </div>
  )
}
```

---

## D. Editorial Academic 美学在新组件中的应用

### D.1 AI 教练面板 — 引用线风格对话气泡

设计原则：AI 回复使用左侧红色引用线（`border-l-3 border-l-red-primary`），用户消息使用右对齐暖色背景。整体类似学术期刊中的 blockquote 排版。

```typescript
// AICoachPanel.tsx 中的消息气泡
function CoachBubble({ message }: { message: CoachMessage }) {
  if (message.role === 'assistant') {
    return (
      <div className="border-l-3 border-l-red-primary pl-4 py-2 my-3">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[11px] text-red-primary font-medium tracking-wide uppercase">
            AI 教练
          </span>
          <span className="text-[10px] text-text-muted font-mono">
            {message.timestamp}
          </span>
        </div>
        <div className="text-sm text-text-body leading-relaxed font-body">
          {message.content}
        </div>
      </div>
    )
  }

  return (
    <div className="flex justify-end my-3">
      <div className="max-w-[80%] bg-bg-accent border border-border-warm rounded-lg px-4 py-2.5">
        <p className="text-sm text-text-main">{message.content}</p>
      </div>
    </div>
  )
}
```

对话输入框使用 `.input-field` 基础样式，底部固定，配合发送按钮使用红色主色调。

### D.2 测验训练界面 — 衬线标题 + 无衬线选项

```
题目卡片布局：
┌─────────────────────────────────────────┐
│  border border-border-warm bg-bg-card   │
│                                         │
│  ┌─ 红色装饰线 ─┐                       │
│  │              │                       │
│  题目 3/8                  font-mono xs  │
│                                         │
│  用 Instrument Serif 渲染题干            │
│  "下列关于波函数的描述，                  │
│   哪一项是正确的？"       font-heading   │
│                                         │
│  ─── 红色细线分隔 ───                    │
│                                         │
│  ○ A. 选项内容  ← Satoshi 无衬线        │
│  ○ B. 选项内容  ← border hover→red      │
│  ● C. 选项内容  ← 选中: bg-bg-accent    │
│  ○ D. 选项内容                          │
│                                         │
└─────────────────────────────────────────┘
```

选项按钮的三态样式：
- 默认：`border border-border-warm bg-bg-card text-text-body`
- 悬停：`hover:border-red-primary`
- 选中：`border-red-primary bg-bg-accent text-text-main`
- 正确：`border-success bg-success/5 text-success`
- 错误：`border-red-primary bg-red-primary/5 text-red-primary`

### D.3 闪卡设计 — 纸张翻转质感

视觉要素：
- 卡片使用 `bg-bg-card` 暖白色，`border border-border-warm` 温暖边框
- 正面：`font-heading` 衬线字体显示问题，中央红色装饰线
- 背面：`bg-bg-accent` 微暖底色 + `border-red-primary` 红色边框强调
- 翻转时隐约可见纸张厚度（通过 `box-shadow` 的微妙使用模拟——这里作为例外允许极淡的阴影 `shadow-[0_1px_2px_rgba(0,0,0,0.04)]` 模拟纸张边缘）
- 底部四个评分按钮颜色编码：
  - Again (1): `text-red-primary border-red-primary`
  - Hard (2): `text-accent-gold border-accent-gold`
  - Good (3): `text-success border-success`
  - Easy (4): `text-info border-info`

```
闪卡正面：
╔═══════════════════════════════════╗
║                                   ║
║         ─── 红色线 ───             ║
║                                   ║
║    "波函数坍缩的物理含义          ║
║     是什么？"                     ║
║                                   ║
║     Instrument Serif · 居中       ║
║                                   ║
║         · 点击翻转 ·              ║
╚═══════════════════════════════════╝

闪卡背面：
╔═══════════════════════════════════╗
║  border-red-primary  bg-bg-accent ║
║                                   ║
║    观测行为导致量子系统从叠加态   ║
║    瞬间确定为某一本征态。         ║
║    Satoshi · 居中                 ║
║                                   ║
║    来源: 模块2 · 第14页           ║
║    text-text-muted font-mono xs   ║
║                                   ║
╠═══════════════════════════════════╣
║ [Again] [Hard]  [Good]  [Easy]   ║
╚═══════════════════════════════════╝
```

### D.4 进度轨道 — 红色节点 + 暖色轨道

```
进度轨道水平布局（desktop）：
                     当前步骤
                        ↓
●──────●──────●──────◉──────○──────○──────○
1      2      3      4      5      6      7
精读   精读   测验   精读   测验   闪卡   总结

● = 已完成 (bg-red-primary, 白色勾号)
◉ = 进行中 (border-red-primary, 脉冲动画)
○ = 待进行 (border-border-warm, 灰色数字)
── = 连线 (已完成段: bg-red-primary, 未完成段: bg-border-warm)
```

进度轨道垂直布局（coach 面板侧栏内）：
```
  ● 模块1: 基本概念       ✓ 已完成
  │ bg-red-primary
  ● 模块2: 量子态          ✓ 已完成
  │ bg-red-primary
  ◉ 模块3: 测不准原理      → 进行中
  │ bg-border-warm (虚线)
  ○ 模块4: 薛定谔方程      待进行
  │
  ○ 模块5: 总复习          待进行
```

### D.5 Scholar Rank / 徽章 — 学术印章风格

设计理念：参考大学学位证书上的圆形蜡封印章。使用 `accent-gold` (#C49A2A) 作为主色调。

```
徽章布局示意：
    ╭─────────────╮
   ╱ ╔═══════════╗ ╲
  │  ║  ★ ★ ★    ║  │     border: accent-gold
  │  ║           ║  │     font: Instrument Serif
  │  ║   Scholar  ║  │
  │  ║   Rank III ║  │
  │  ║           ║  │
  │  ║  85% 精通  ║  │     font-mono text-xs
   ╲ ╚═══════════╝ ╱
    ╰─────────────╯

rank 等级:
  I   — Novice     (mastery 0-30%)   1 颗星
  II  — Learner    (mastery 30-60%)  2 颗星
  III — Scholar    (mastery 60-85%)  3 颗星
  IV  — Master     (mastery 85-95%)  4 颗星
  V   — Sage       (mastery 95%+)   5 颗星
```

```typescript
// ScholarBadge.tsx
function ScholarBadge({ rank, mastery }: { rank: number; mastery: number }) {
  const RANKS = ['Novice', 'Learner', 'Scholar', 'Master', 'Sage']
  const stars = rank + 1

  return (
    <div className="flex flex-col items-center gap-1">
      {/* 印章圆环 */}
      <div className="relative w-16 h-16 rounded-full border-2 border-accent-gold flex items-center justify-center bg-bg-card">
        {/* 内圈装饰 */}
        <div className="absolute inset-1 rounded-full border border-accent-gold/30" />

        <div className="text-center">
          <div className="flex justify-center gap-0.5 mb-0.5">
            {Array.from({ length: stars }).map((_, i) => (
              <span key={i} className="text-accent-gold text-[8px]">&#9733;</span>
            ))}
          </div>
          <span className="text-[9px] font-heading text-accent-gold leading-none">
            {RANKS[rank]}
          </span>
        </div>
      </div>

      {/* mastery 数字 */}
      <span className="text-[10px] font-mono text-text-muted">
        {mastery}%
      </span>
    </div>
  )
}
```

---

## E. 多模态增强设计

### E.1 TTS 语音朗读 + 高亮同步

UI 布局：在 MaterialReader 的精讲内容顶部添加播放控制条。

```
┌──────────────────────────────────────────┐
│  ▶ ┃┃  ■   ───●──────────── 3:42 / 8:15 │
│  [0.75x] [1x] [1.25x] [1.5x]            │
│  声音: [女声 ▾]                           │
└──────────────────────────────────────────┘
```

高亮同步实现思路：
- 使用 Web Speech API 或 TTS 服务获取 word-level timestamps
- 当前朗读的段落添加 `bg-bg-accent` 背景高亮
- 当前朗读的句子添加 `text-text-main font-medium` 加粗
- 平滑滚动跟随：`scrollIntoView({ behavior: 'smooth', block: 'center' })`

```typescript
// TTSReader.tsx 关键接口
interface TTSReaderProps {
  markdown: string
  onHighlightChange: (paragraphIndex: number, sentenceIndex: number) => void
  className?: string
}
```

播放控制条样式遵循 Editorial Academic：
- 控制按钮：`text-red-primary` 图标，无背景
- 进度条：`bg-border-warm` 轨道 + `bg-red-primary` 已播放
- 速度按钮：`border border-border-warm` 默认，`border-red-primary bg-bg-accent` 选中
- 字体：时间显示用 `font-mono text-xs text-text-muted`

### E.2 概念图谱（D3.js）视觉风格

图谱应融入 Editorial Academic 暖色调，而非 D3.js 默认的冷蓝色。

```
节点样式映射：
  - 核心概念:  fill=#A5192E, r=24, font=Instrument Serif, white text
  - 一般概念:  fill=#FFFEFB, stroke=#E8E4DE, r=16, font=Satoshi, dark text
  - 已掌握:    fill=#FFFEFB, stroke=#4CAF50 (green), r=16
  - 薄弱概念:  fill=#FFF8F0, stroke=#A5192E (red dashed), r=16

连线样式：
  - 依赖关系:  stroke=#E8E4DE, stroke-width=1.5, 实线
  - 弱关联:    stroke=#E8E4DE, stroke-width=1, 虚线
  - 当前路径:  stroke=#A5192E, stroke-width=2, 实线

背景: #F7F5F2 (bg-main)
```

```typescript
// ConceptGraph.tsx 关键接口
interface ConceptGraphProps {
  nodes: ConceptNode[]
  edges: ConceptEdge[]
  highlightedPath?: string[]  // 当前学习路径上的节点 ID
  onNodeClick: (nodeId: string) => void
  width?: number
  height?: number
}
```

### E.3 公式推导动画

展示方式：逐步显示推导过程，每一步用 `AnimatePresence` 渐入，辅以文字解释。

```
推导过程布局：
┌─────────────────────────────────────────┐
│  font-heading: "薛定谔方程的推导"        │
│  ─── 红色线 ───                          │
│                                          │
│  步骤 1/4                font-mono xs    │
│                                          │
│       E = hv          KaTeX 渲染         │
│                                          │
│  "从普朗克量子假说出发，                  │
│   光子能量与频率成正比"   text-text-body  │
│                                          │
│         ↓  红色箭头                       │
│                                          │
│  步骤 2/4                                │
│       E = ℏω           渐入动画          │
│  "用角频率改写..."                        │
│                                          │
│  [上一步]              [下一步]           │
└─────────────────────────────────────────┘
```

```typescript
// FormulaDerivation.tsx
interface DerivationStep {
  formula: string     // KaTeX 格式
  explanation: string
}

const stepAnimation = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  exit:    { opacity: 0, y: -8 },
  transition: { duration: 0.35 },
}
```

---

## F. 移动端适配

### F.1 触摸优化

#### 闪卡滑动

使用 Framer Motion 的 `drag` 属性实现滑动评分：
- 向右滑动 = Good (3)
- 向左滑动 = Again (1)
- 向上滑动 = Easy (4)
- 轻点翻转

```typescript
// FlashcardDeck.tsx 移动端滑动
<motion.div
  drag="x"
  dragConstraints={{ left: 0, right: 0 }}
  dragElastic={0.8}
  onDragEnd={(_, info) => {
    if (Math.abs(info.offset.x) > 100) {
      onRate(info.offset.x > 0 ? 3 : 1)  // Good or Again
    }
  }}
  className="touch-none"
>
  <FlashcardCard ... />
</motion.div>
```

滑动时的视觉反馈：
- 向右滑动时卡片微微旋转 + 绿色边框渐显
- 向左滑动时卡片反向旋转 + 红色边框渐显

#### 测验点按

- 选项按钮最小高度 `min-h-[48px]`（符合 44px 触摸目标规范）
- 选中后的反馈使用 `active:scale-[0.98]` 触摸回弹
- 选项间距 `gap-3`（12px），防止误触

### F.2 底部导航栏设计

仅在 mobile (`< 768px`) 显示，替代 desktop 的侧栏切换。

```
┌─────────────────────────────────┐
│  [阅读]    [教练]    [进度]      │
│   📖        🎓        📊        │
│  active:                        │
│  text-red-primary               │
│  border-t-2 border-t-red-primary│
└─────────────────────────────────┘
```

```typescript
// MobileTabBar.tsx
const TABS = [
  { key: 'reader', label: '阅读', icon: BookOpen },
  { key: 'coach',  label: '教练', icon: GraduationCap },
  { key: 'progress', label: '进度', icon: BarChart3 },
] as const

function MobileTabBar({ active, onChange }: MobileTabBarProps) {
  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 bg-bg-card border-t border-border-warm flex lg:hidden">
      {TABS.map((tab) => {
        const Icon = tab.icon
        const isActive = active === tab.key
        return (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
            className={[
              'flex-1 flex flex-col items-center py-2 gap-0.5',
              'transition-colors duration-200',
              isActive
                ? 'text-red-primary border-t-2 border-t-red-primary -mt-[2px]'
                : 'text-text-muted',
            ].join(' ')}
          >
            <Icon size={20} strokeWidth={1.5} />
            <span className="text-[10px]">{tab.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
```

### F.3 紧凑布局方案

#### 移动端 MaterialReader 简化

- Tab 栏改为水平滚动（`overflow-x-auto whitespace-nowrap`）
- 标题字号缩小：`text-2xl` (mobile) vs `text-3xl` (desktop)
- 移除装饰性红色线，仅保留 Tab 下划线指示
- PDF 阅读器高度：`h-[70vh]` (mobile) vs `h-[80vh]` (desktop)

#### 移动端 AICoachPanel 简化

- 对话气泡引用线宽度：`border-l-2` (mobile) vs `border-l-3` (desktop)
- 消息间距压缩：`my-2` (mobile) vs `my-3` (desktop)
- 工具调用按钮改为水平滚动条而非网格

#### 移动端 ProgressTrack 简化

- 从水平轨道改为紧凑的步骤指示器：`1/7 · 模块精读`
- 仅显示当前步骤和左右箭头，不显示全部节点

```
Mobile StepNavigator (简化):
┌─────────────────────────────────┐
│  [◀] 步骤 3/7: 模块精读 [▶]    │
│       ● ● ● ◉ ○ ○ ○            │
│       (迷你点状指示器)           │
└─────────────────────────────────┘
```

#### 响应式工具类汇总

```css
/* 全局响应式调整 */
@media (max-width: 767px) {
  /* 增大触摸目标 */
  button, a, [role="button"] {
    min-height: 44px;
  }

  /* 底部导航栏高度预留 */
  .workbench-content {
    padding-bottom: 60px;
  }

  /* 闪卡容器全宽 */
  .flashcard-container {
    padding: 0 16px;
  }
}
```

---

## 附录：设计原则检查清单

在实现每个新组件时，必须核对以下清单：

| 检查项 | 要求 |
|--------|------|
| 标题字体 | `font-heading`（Instrument Serif） |
| 正文字体 | `font-body`（Satoshi） |
| 等宽字体 | `font-mono`（JetBrains Mono）仅用于数字、代码、时间 |
| 主色调 | `red-primary` (#A5192E) 用于 active/accent/CTA |
| 背景 | `bg-main` (#F7F5F2) 全局 / `bg-card` (#FFFEFB) 卡片 / `bg-accent` (#FFF8F0) 高亮 |
| 边框 | `border-border-warm` (#E8E4DE) 分割线和卡片 |
| 阴影 | 禁止使用 box-shadow（唯一例外：闪卡翻转时极淡纸张边缘） |
| 强调线 | `border-l-3 border-l-red-primary` 引用线风格 |
| 卡片 hover | `hover:border-red-primary` 边框颜色过渡 |
| 动效 | opacity + 轻微 y 位移，禁止夸张弹跳或循环动画 |
| 金色 | `accent-gold` (#C49A2A) 仅用于成就、徽章、里程碑 |
| 成功色 | `success` (#4CAF50) 仅用于正确答案、已完成状态 |
| 装饰线 | `w-10 h-px bg-red-primary` 红色细线作为视觉分隔 |
