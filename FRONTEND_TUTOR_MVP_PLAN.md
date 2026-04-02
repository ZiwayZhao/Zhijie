# Tutor MVP 前端开发方案

> 后端已验证通过：57 tests green（39 unit + 18 integration），Docker E2E 9/9 pass
> API: `POST /api/v1/chat/tutor` → SSE stream（7 event types）
> 分支：`feature/tutor-mvp`

---

## 一、架构总览

### 集成方式：Tab 共存（非替换）

```
WorkbenchPage (70:30 split)
├── Left 70%: MaterialReader (不变)
│   tabs: [Original, Specialist, Quiz]
│
└── Right 30%: 侧边栏 (改造)
    ├── Tab切换: [🔧 分析工具 | 💬 AI助教]
    │                ↑现有           ↑新增
    ├── tab=tools: AIToolPanel（完全不变）
    └── tab=tutor: TutorSidebar（新组件）
```

**关键决策**：
- AIToolPanel（分析管道，重任务）和 TutorSidebar（对话，轻交互）**并列 Tab**
- 用户可自由切换；默认 tab 根据是否有已完成分析自动判定
- TutorSidebar 的 tool.result 可以联动 MaterialReader 的 Tab 切换（如 specialist 内容自动展示）

### 状态管理

```
useReducer (useTutorSession.ts)
  ├── state machine: idle → connecting → planning → tool-running → answering → completed/error
  ├── messages: TutorMessage[] （累积的聊天消息列表）
  ├── plan: {intent, tools, reasoning} | null
  └── toolResults: TutorToolResult[]

localStorage 持久化:
  key: `zhijie:tutor:${materialId}:v1`
  value: { messages, lastUpdated }
  cap: 50 messages, 10 toolResults
```

---

## 二、新增文件清单

| 文件 | 行数预估 | 职责 |
|------|---------|------|
| `src/lib/sse-parser.ts` | ~60 | 通用 typed SSE 解析器 |
| `src/lib/api-tutor.ts` | ~80 | Tutor API 客户端（发请求 + 接 SSE） |
| `src/hooks/useTutorSession.ts` | ~180 | useReducer 状态机 + localStorage 持久化 |
| `src/components/tutor/TutorSidebar.tsx` | ~200 | 主容器：消息列表 + 输入框 + 状态指示 |
| `src/components/tutor/TutorMessage.tsx` | ~120 | 单条消息渲染（用户/AI/系统） |
| `src/components/tutor/ToolResultCard.tsx` | ~100 | 工具结果展示卡片（specialist/quiz） |
| `src/components/tutor/PlanIndicator.tsx` | ~50 | Plan 阶段动画指示器 |

**修改文件**：
| 文件 | 改动量 | 内容 |
|------|--------|------|
| `WorkbenchPage.tsx` | ~30行 | 增加 Tab 切换 + TutorSidebar |

**总计**：~820 行新代码 + ~30 行修改

---

## 三、开发步骤（按依赖顺序）

### Step 1: SSE 解析器（纯工具函数，零依赖）

**文件**: `src/lib/sse-parser.ts`

```typescript
// 接口定义
export interface SSEEvent<T = unknown> {
  event: string
  data: T
}

export type SSEEventHandler = (event: SSEEvent) => void
export type SSEErrorHandler = (error: Error) => void

/**
 * 连接 SSE 端点，逐事件回调。
 * 返回 AbortController 用于取消。
 */
export function connectSSE(
  url: string,
  options: {
    method: 'POST'
    headers: Record<string, string>
    body: string
  },
  onEvent: SSEEventHandler,
  onError: SSEErrorHandler,
  onComplete: () => void,
): AbortController
```

**实现要点**：
- 用 `fetch()` + `response.body.getReader()` 手动解析 SSE（不用 EventSource，因为要 POST + headers）
- 处理 `event:` 和 `data:` 行拼接（多行 data 用 `\n` 合并）
- UTF-8 TextDecoder 处理中文
- AbortController 支持用户切换页面时取消

### Step 2: Tutor API 客户端

**文件**: `src/lib/api-tutor.ts`

```typescript
import { getAccessToken } from '@/lib/auth-api'
import { connectSSE, type SSEEvent } from '@/lib/sse-parser'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8003/api'

// 后端 SSE 事件类型（与 backend schemas/tutor.py 对齐）
export interface TutorSSEEvents {
  'session.started': { session_id: string; material_id: string; module_id: string | null; available_tools: string[] }
  'plan.completed': { intent: string; reasoning: string; tools_to_call: string[] }
  'tool.result': { tool_name: string; ok: boolean; data: Record<string, unknown> | null; error: { code: string; message: string } | null }
  'answer.delta': { content: string }
  'answer.completed': { total_tokens: number }
  'session.completed': { session_id: string }
  'error': { message: string; phase: string }
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface TutorChatParams {
  materialId: string
  moduleId?: string
  userMessage: string
  conversationHistory: ChatMessage[]
}

/**
 * 发起 Tutor 聊天请求，返回 SSE 连接。
 */
export function startTutorChat(
  params: TutorChatParams,
  onEvent: (event: SSEEvent) => void,
  onError: (error: Error) => void,
  onComplete: () => void,
): AbortController
```

**关键**：
- 复用 `getAccessToken()` 拿 token
- body 字段映射：`material_id`, `module_id`, `user_message`, `conversation_history`
- 不需要 mock 模式（后端已 Docker 运行）

### Step 3: useTutorSession Hook（核心状态机）

**文件**: `src/hooks/useTutorSession.ts`

```typescript
// ── State ────────────────────────────────────────────
type Phase = 'idle' | 'connecting' | 'planning' | 'tool-running' | 'answering' | 'completed' | 'error'

interface TutorMessage {
  id: string           // nanoid
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  // 附加数据（仅部分消息有）
  plan?: { intent: string; reasoning: string; tools: string[] }
  toolResults?: ToolResultData[]
  isStreaming?: boolean
}

interface ToolResultData {
  toolName: string
  ok: boolean
  data: Record<string, unknown> | null
  error: string | null
}

interface TutorState {
  phase: Phase
  messages: TutorMessage[]
  currentPlan: { intent: string; reasoning: string; tools: string[] } | null
  currentToolResults: ToolResultData[]
  streamingContent: string  // 当前正在流式接收的文本
  error: string | null
}

// ── Actions ──────────────────────────────────────────
type TutorAction =
  | { type: 'SEND_MESSAGE'; content: string }
  | { type: 'SSE_SESSION_STARTED'; data: TutorSSEEvents['session.started'] }
  | { type: 'SSE_PLAN_COMPLETED'; data: TutorSSEEvents['plan.completed'] }
  | { type: 'SSE_TOOL_RESULT'; data: TutorSSEEvents['tool.result'] }
  | { type: 'SSE_ANSWER_DELTA'; data: TutorSSEEvents['answer.delta'] }
  | { type: 'SSE_ANSWER_COMPLETED'; data: TutorSSEEvents['answer.completed'] }
  | { type: 'SSE_SESSION_COMPLETED' }
  | { type: 'SSE_ERROR'; data: TutorSSEEvents['error'] }
  | { type: 'CONNECTION_ERROR'; error: string }
  | { type: 'RESET' }

// ── Hook ─────────────────────────────────────────────
export function useTutorSession(materialId: string, moduleId?: string): {
  state: TutorState
  sendMessage: (content: string) => void
  reset: () => void
  cancel: () => void  // 取消当前请求
}
```

**实现要点**：

1. **useReducer** 管理状态，每个 SSE 事件 → dispatch 对应 action
2. **流式消息拼接**：`SSE_ANSWER_DELTA` 时 `streamingContent += delta`；`SSE_ANSWER_COMPLETED` 时将完整内容推入 `messages[]` 作为 assistant 消息
3. **Plan + ToolResult 附加到消息**：answer 完成时，将 `currentPlan` 和 `currentToolResults` 附加到该 assistant 消息上
4. **conversationHistory 构建**：从 `messages[]` 中提取 role=user/assistant 的最近 20 条
5. **localStorage 持久化**：
   - 每次 `SSE_SESSION_COMPLETED` 后写入
   - 初始化时从 localStorage 恢复
   - key: `zhijie:tutor:${materialId}:v1`
   - 超过 50 条消息时截断旧消息
6. **AbortController ref**：sendMessage 时存储，cancel() 时调用 `.abort()`
7. **cleanup**：useEffect return 中 abort 防止组件卸载后继续 dispatch

### Step 4: TutorSidebar 主容器

**文件**: `src/components/tutor/TutorSidebar.tsx`

```
┌──────────────────────────────┐
│  💬 AI 学习助教               │ ← 标题栏
├──────────────────────────────┤
│                              │
│  [历史消息列表]               │ ← 可滚动区域
│    UserMessage               │
│    AssistantMessage          │
│      ├─ PlanIndicator        │
│      ├─ ToolResultCard       │
│      └─ 正文（Markdown）      │
│                              │
│  [流式打字中...]              │ ← 当前 streaming
│                              │
├──────────────────────────────┤
│  [输入框]         [发送按钮]  │ ← 底部固定
│  · 发送中禁用                │
│  · Enter 发送 / Shift+Enter 换行
└──────────────────────────────┘
```

**设计系统映射**（Editorial Academic）：
- 容器：`bg-bg-card` 无 shadow，上方 `border-b border-border-warm` 分隔标题
- 用户消息：右对齐，`bg-bg-accent` 圆角气泡，`text-text-body`
- AI 消息：左对齐，无背景，`border-l-3 border-l-red-primary` 引用线风格
- 输入框：`border border-border-warm focus:border-red-primary` 过渡
- 发送按钮：`bg-red-primary text-white` 实心
- 加载状态：暖色 shimmer 脉冲（三个点动画）
- Plan 指示：`text-xs text-text-muted` 折叠展示意图和推理
- 工具结果卡片：`border border-border-warm bg-bg-main` 紧凑卡片

**关键交互**：
- 自动滚动到底部（新消息时）
- 输入框自动聚焦
- 空状态：欢迎引导（"有什么想了解的？试试问我关于课件内容的问题 💡"）
- phase 指示器：planning 时显示"思考中..."，tool-running 时显示"查阅资料..."

### Step 5: 子组件

#### TutorMessage.tsx
- 渲染单条消息，区分 user / assistant / system
- assistant 消息内的正文用 `react-markdown` + `remark-math` + `rehype-katex`（复用 MaterialReader 的 fixMarkdown + 自定义 components）
- 如果消息有 `plan` 附加数据，显示可折叠的 PlanIndicator
- 如果消息有 `toolResults`，显示 ToolResultCard 列表

#### ToolResultCard.tsx
- **get_specialist 成功**：显示模块名 + "📖 查看精讲" 按钮（点击联动 MaterialReader Tab 切换）
- **get_quiz 成功**：显示题目数量 + "📝 查看测验" 按钮（联动 Quiz Tab）
- **失败**：红色边框 + 错误信息
- 样式：紧凑，`px-3 py-2 border border-border-warm rounded-sm text-xs`

#### PlanIndicator.tsx
- 默认折叠，只显示 intent 标签（"💡 讲解" / "📝 测验" / "💬 直接回答"）
- 展开后显示 reasoning 和 tools_to_call
- `text-xs text-text-muted` 不抢 AI 回答的视觉权重

### Step 6: WorkbenchPage 集成

**修改**: `src/pages/WorkbenchPage.tsx` (~30行改动)

```tsx
// 新增 state
const [sidebarTab, setSidebarTab] = useState<'tools' | 'tutor'>('tools')

// 右侧 30% 侧边栏改造
<motion.aside className="flex-[3] ...">
  {/* Tab 切换 */}
  <div className="flex border-b border-border-warm mb-4">
    <button
      onClick={() => setSidebarTab('tools')}
      className={`px-4 py-2 text-sm ${
        sidebarTab === 'tools'
          ? 'border-b-2 border-red-primary text-red-primary'
          : 'text-text-muted hover:text-text-body'
      }`}
    >
      🔧 分析工具
    </button>
    <button
      onClick={() => setSidebarTab('tutor')}
      className={`px-4 py-2 text-sm ${
        sidebarTab === 'tutor'
          ? 'border-b-2 border-red-primary text-red-primary'
          : 'text-text-muted hover:text-text-body'
      }`}
    >
      💬 AI助教
    </button>
  </div>

  {/* 条件渲染 */}
  {sidebarTab === 'tools' ? (
    <AIToolPanel ... />
  ) : (
    <TutorSidebar
      materialId={material.id}
      moduleId={currentModuleId}
      onSpecialistView={(markdown) => {
        setSpecialistMarkdown(markdown)
        setActiveTab('specialist')
      }}
      onQuizView={(questions) => {
        setQuizQuestions(questions)
        setActiveTab('quiz')
      }}
    />
  )}
</motion.aside>
```

**联动回调**：
- TutorSidebar 的 `onSpecialistView`：get_specialist 结果中的 markdown → 推送到 MaterialReader 的 Specialist Tab
- TutorSidebar 的 `onQuizView`：get_quiz 结果中的 questions → 推送到 MaterialReader 的 Quiz Tab
- 这让 Tutor 对话的工具结果能直接在左侧 70% 区域展示，体验与 AIToolPanel 一致

### Step 7: 端到端验证

1. **基础对话**：发送"你好" → 无工具调用 → 流式回答 → 消息正确显示
2. **讲解请求**：发送"讲讲 JOIN" → plan=explain → get_specialist → markdown 联动到左侧 Tab
3. **出题请求**：发送"出几道题" → plan=quiz → get_quiz → quiz 联动到左侧 Tab
4. **流式效果**：answer.delta 逐 token 显示，打字机效果
5. **错误降级**：断网/后端停止 → error 事件 → 友好提示
6. **持久化**：刷新页面 → 聊天记录恢复
7. **Tab 切换**：tools ↔ tutor 切换，各自状态保持

---

## 四、SSE 事件 → UI 映射

| SSE Event | Reducer Action | UI 变化 |
|-----------|---------------|---------|
| `session.started` | `SSE_SESSION_STARTED` | phase → `planning`，显示"思考中..." |
| `plan.completed` | `SSE_PLAN_COMPLETED` | phase → `tool-running`（有工具）或 `answering`（无工具），显示 PlanIndicator |
| `tool.result` | `SSE_TOOL_RESULT` | 累积到 currentToolResults，显示 ToolResultCard |
| `answer.delta` | `SSE_ANSWER_DELTA` | phase → `answering`，streamingContent 拼接，实时显示 |
| `answer.completed` | `SSE_ANSWER_COMPLETED` | 将完整内容+plan+toolResults 推入 messages |
| `session.completed` | `SSE_SESSION_COMPLETED` | phase → `completed` → `idle`，写入 localStorage |
| `error` | `SSE_ERROR` | phase → `error`，显示错误提示 |

---

## 五、设计细节

### 配色与样式（严格遵循 Editorial Academic）

```
用户消息气泡:  bg-bg-accent (#FFF8F0) + border-border-warm
AI 消息:       border-l-3 border-l-red-primary（引用线风格）
AI 正文:       font-body (Satoshi), text-text-body (#3D3D3D)
Plan 标签:     bg-bg-main, text-xs, text-text-muted
工具卡片:      border border-border-warm, rounded-sm, 紧凑
输入框:        border-border-warm → focus:border-red-primary 过渡
发送按钮:      bg-red-primary hover:bg-red-dark, text-white
加载动画:      三点脉冲, 暖色 (#E8E4DE → #A5192E)
空状态:        font-heading (Instrument Serif), text-text-muted
Tab active:    border-b-2 border-red-primary, text-red-primary
Tab inactive:  text-text-muted
```

### 动效（Framer Motion，克制）

- 消息进入：`opacity: 0 → 1, y: 8 → 0`，duration 0.2s
- 流式文字：无特殊动效（CSS 即可，cursor 闪烁用 `animate-pulse`）
- Tab 切换：`AnimatePresence` + fade，不用 slide
- 工具卡片展开：`height: 0 → auto`，`opacity: 0 → 1`

### Markdown 渲染

复用 MaterialReader 已有的 markdown 处理链：
```
fixMarkdown() → react-markdown
  + remark-math + remark-gfm
  + rehype-katex
  + 自定义 components (editorial 样式映射)
```

但需要适配对话气泡的窄宽度：
- 减小 heading 字号（h1 → text-base, h2 → text-sm）
- 代码块用 `text-xs` + 横向滚动
- 表格缩放适配

---

## 六、性能考量

| 关注点 | 策略 |
|--------|------|
| SSE 高频 delta | requestAnimationFrame 批量更新 streamingContent |
| Markdown 重渲染 | useMemo(parsedMarkdown, [content])，只在消息完成后 parse |
| 流式时不 parse markdown | streaming 阶段用纯文本 + cursor；completed 后切换为 react-markdown |
| 长消息列表 | 超过 50 条时删旧消息（state + localStorage 同步） |
| 组件懒加载 | TutorSidebar 本身 < 1KB import，不需要 lazy |
| Tab 切换保活 | 用 CSS `display: none` 而非条件渲染，保持 TutorSidebar 和 AIToolPanel 状态 |

---

## 七、开发顺序与时间预估

| 步骤 | 内容 | 预估 | 前置 |
|------|------|------|------|
| 1 | `sse-parser.ts` | 15min | 无 |
| 2 | `api-tutor.ts` | 15min | Step 1 |
| 3 | `useTutorSession.ts` | 40min | Step 2 |
| 4 | `PlanIndicator.tsx` + `ToolResultCard.tsx` | 20min | 无 |
| 5 | `TutorMessage.tsx` | 25min | Step 4 |
| 6 | `TutorSidebar.tsx` | 35min | Step 3 + 5 |
| 7 | `WorkbenchPage.tsx` 集成 | 15min | Step 6 |
| 8 | 端到端验证 + 修 bug | 30min | Step 7 |

**总计**：约 3 小时

---

## 八、后续迭代（不在 MVP 范围）

- [ ] 消息中的"查看精讲"按钮 → 直接内联展开 markdown（而非 Tab 切换）
- [ ] 对话历史搜索（按知识点索引）
- [ ] 自动错题收集（tool.result 中 quiz → 答题后 → 错题本）
- [ ] 语音输入支持
- [ ] 多材料跨引用对话
- [ ] 消息 bookmark / 收藏功能
