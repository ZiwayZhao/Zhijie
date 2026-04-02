# 代码质量审核报告

**审核范围**: Phase 0+1 前端代码
**审核日期**: 2026-03-18
**审核人**: code-quality-reviewer

---

## 概览

| 严重程度 | 数量 |
|---------|------|
| CRITICAL | 2 |
| HIGH | 4 |
| MEDIUM | 5 |
| LOW | 4 |

---

## CRITICAL 问题

### C1. SSE 回调中异步操作缺少取消机制（内存泄漏）

**文件**: `src/components/workbench/AIToolPanel.tsx:209-234`
**类别**: 内存泄漏

`subscribeProgress` 的回调中，当收到 `completed` 事件后调用 `getAnalysisResult(taskId)`，这是一个异步操作。如果用户在此异步请求进行中离开页面（组件卸载），`unsubRef.current?.()` 只会关闭 EventSource，但 `getAnalysisResult` 的 `.then()` 仍会执行，尝试在已卸载的组件上调用 `setModules`、`setPhase` 等状态更新。

**影响**: React 18 不再警告这种情况，但仍会导致无用的状态更新和潜在的逻辑错误。

**修复方案**:
```tsx
// 在组件内添加 mounted ref
const mountedRef = useRef(true)
useEffect(() => {
  return () => { mountedRef.current = false }
}, [])

// 在 startProcessing 的 subscribeProgress 回调中：
if (evt.status === 'completed') {
  getAnalysisResult(taskId).then(async (result) => {
    if (!mountedRef.current) return  // ← 添加这行
    const mods = result.modules as DisassemblyModule[]
    setModules(mods)
    // ... rest of logic
  }).catch(() => {
    if (!mountedRef.current) return  // ← 添加这行
    setErrorMsg('获取分析结果失败')
    setPhase('error')
  })
}
```

### C2. handleToolClick 中 setTimeout 无清理（内存泄漏）

**文件**: `src/components/workbench/AIToolPanel.tsx:309-312`
**类别**: 内存泄漏

```tsx
const handleToolClick = useCallback((toolId: string) => {
  setActiveTool(toolId)
  setTimeout(() => setActiveTool(null), 3000)  // ← 无清理
}, [])
```

如果组件在 3 秒内卸载，或用户快速点击多个工具，多个 timeout 同时存在。

**修复方案**:
```tsx
const toolTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

const handleToolClick = useCallback((toolId: string) => {
  setActiveTool(toolId)
  if (toolTimerRef.current) clearTimeout(toolTimerRef.current)
  toolTimerRef.current = setTimeout(() => setActiveTool(null), 3000)
}, [])

// 在 cleanup useEffect 中：
useEffect(() => {
  return () => {
    unsubRef.current?.()
    if (toolTimerRef.current) clearTimeout(toolTimerRef.current)
  }
}, [])
```

---

## HIGH 问题

### H1. `any` 类型使用 — API 响应未类型化

**文件**: `src/lib/api-disassembly.ts:228`
**类别**: TypeScript 类型安全

```tsx
modules: data.modules.map((m: any) => ({
  ...m, pages: `${m.page_range_start}-${m.page_range_end}`, examWeight: m.exam_weight,
})),
```

`any` 跳过了所有类型检查，如果后端 API 字段改名，前端不会在编译时报错。

**修复方案**:
```tsx
interface RawModule {
  id: string
  name: string
  description: string | null
  page_range_start: number
  page_range_end: number
  exam_weight: 'high' | 'medium' | 'low'
  sort_order: number
  has_specialist: boolean
}

// 在 getAnalysisResult 中：
modules: (data.modules as RawModule[]).map((m) => ({
  ...m,
  pages: `${m.page_range_start}-${m.page_range_end}`,
  examWeight: m.exam_weight,
})),
```

### H2. SSE Token 通过 Query Parameter 传递

**文件**: `src/lib/api-disassembly.ts:146-148`
**类别**: 安全

```tsx
const token = getAccessToken()
const sseUrl = new URL(...)
if (token) sseUrl.searchParams.set('token', token)
```

代码注释已承认这是 known limitation。Token 会出现在浏览器历史、服务器日志、Referer header 中。

**建议**:
- 确保后端 SSE endpoint 对 token query param 设置短过期时间
- 或改用 fetch-based SSE（使用 `fetch` + `ReadableStream` 可以带 Authorization header）

### H3. JSX 中每次渲染调用 localStorage（性能）

**文件**: `src/pages/WorkbenchPage.tsx:186`
**类别**: 重复渲染/性能

```tsx
mastery={loadProfile().modules[currentModuleId]?.mastery ?? 0.3}
```

`loadProfile()` 每次渲染都从 localStorage 解析 JSON。如果父组件频繁更新状态，这里会不必要地执行。

**修复方案**:
```tsx
const currentMastery = useMemo(() => {
  if (!currentModuleId) return 0.3
  return loadProfile().modules[currentModuleId]?.mastery ?? 0.3
}, [currentModuleId])

// JSX 中：
mastery={currentMastery}
```

### H4. useEffect 依赖中包含不稳定的回调 props

**文件**: `src/components/workbench/AIToolPanel.tsx:152-179`
**类别**: React Hooks 规范

```tsx
useEffect(() => {
  // ... auto-detect existing analysis
}, [materialId, onQuizReady, autoSelectFirstModule, onModuleSelect, onModulesLoaded])
```

依赖数组包含 5 个回调 prop。虽然当前 `WorkbenchPage` 对所有回调使用了 `useCallback`，但这是脆弱的——如果未来任何父组件忘记 memoize 这些回调，此 effect 会在每次渲染时重新执行，导致重复 API 请求。

**建议**: 使用 `useRef` 存储回调，effect 只依赖 `materialId`：
```tsx
const onModuleSelectRef = useRef(onModuleSelect)
onModuleSelectRef.current = onModuleSelect
// ... 类似处理其他回调

useEffect(() => {
  let cancelled = false
  getLatestAnalysis(materialId).then(async (task) => {
    if (cancelled || !task || task.status !== 'completed') return
    // 使用 onModuleSelectRef.current 代替 onModuleSelect
    // ...
  })
  return () => { cancelled = true }
}, [materialId])  // ← 只依赖 materialId
```

---

## MEDIUM 问题

### M1. 内联箭头函数造成子组件不必要重渲染

**文件**: `src/components/workbench/AIToolPanel.tsx:374`

```tsx
<ManualToolSection
  onToggle={() => setManualExpanded(!manualExpanded)}  // ← 每次渲染新引用
  ...
/>
```

**修复**: 使用 useCallback：
```tsx
const handleManualToggle = useCallback(() => setManualExpanded(prev => !prev), [])
```

### M2. QuizPanel QuestionCard 使用 index 作为 key

**文件**: `src/components/workbench/QuizPanel.tsx:500`

```tsx
{questions.map((q, i) => (
  <QuestionCard key={i} ... />
))}
```

如果 `questions` 数组顺序改变（如排序），会导致状态错位。应使用稳定 ID。

**建议**: 使用 `q.question` 或复合 key：
```tsx
key={`${q.source_module_name}-${i}`}
```

### M3. ScoreSummary 的 onGenerateFlashcards 返回值类型不匹配

**文件**: `src/components/workbench/QuizPanel.tsx:518-531`

```tsx
onGenerateFlashcards={materialId ? () => {
  // ...
  return count  // ← 返回 number
} : onGenerateFlashcards}  // ← 类型是 () => void
```

函数签名声明返回 `void`，但实际返回了 `number`。虽然 TypeScript 不会报错（void 兼容），但语义不清晰。

### M4. computeRecommendedIntent 在组件外读取 localStorage

**文件**: `src/components/workbench/AIToolPanel.tsx:92-123`

`computeRecommendedIntent` 是纯函数，但它直接读取 `localStorage`。如果 localStorage 在组件生命周期内被其他 tab 修改，不会触发重新计算（因为 `useMemo` 只依赖 `materialId`）。这是一个 stale data 风险。

**影响**: 低。只在组件首次挂载时影响推荐意图。

### M5. 多处 catch 块静默吞掉错误

**文件**: 多个文件

- `AIToolPanel.tsx:174` — `catch { /* ignore */ }`
- `AIToolPanel.tsx:176` — `catch { /* ignore — user can start fresh */ }`
- `AIToolPanel.tsx:291` — `catch { /* silently fail */ }`
- `WorkbenchPage.tsx:58` — `catch { /* ignore */ }`

**建议**: 至少添加 `console.warn` 用于开发调试，或使用环境判断：
```tsx
catch (e) {
  if (import.meta.env.DEV) console.warn('Non-critical error:', e)
}
```

---

## LOW 问题

### L1. 模块级可变变量 mockTaskCounter

**文件**: `src/lib/api-disassembly.ts:112`

```tsx
let mockTaskCounter = 0
```

Vite HMR 时此变量会被重置。开发环境下可能导致 mock task ID 冲突。影响极小（仅 mock 模式）。

### L2. GatheringPhase 组件已导出但未使用

**文件**: `src/components/workbench/IntentGatherer.tsx:80`

`GatheringPhase` 组件已导出，但 AIToolPanel 中 gathering 阶段已移除（注释说明 "gathering phase removed"）。属于死代码。

### L3. WeightBadge 未处理 undefined weight

**文件**: `src/components/workbench/ModuleDisplay.tsx:179`

```tsx
const { label, cls } = map[weight]  // ← 如果 weight 不在 map 中会 throw
```

虽然 `DisassemblyModule['examWeight']` 类型限制为 `'high' | 'medium' | 'low'`，但如果后端返回意外值，会崩溃。

**修复**:
```tsx
const { label, cls } = map[weight] ?? { label: weight, cls: 'text-text-muted border-border-warm' }
```

### L4. mdComponents 中 code 组件的 isBlock 检测不够稳健

**文件**: `src/components/workbench/MaterialReader.tsx:406`

```tsx
const isBlock = className?.startsWith('language-')
```

依赖 react-markdown 的实现细节。如果 react-markdown 更新改变 className 格式，逻辑会失效。目前可用。

---

## 总结

代码整体质量良好，组件拆分清晰，hooks 使用规范。主要风险集中在：

1. **SSE 回调中的异步操作缺少生命周期保护**（C1）— 最应优先修复
2. **setTimeout 未清理**（C2）— 简单修复
3. **`any` 类型**（H1）— 需要定义 API 响应类型
4. **不稳定回调 props 在 useEffect 依赖中**（H4）— 使用 ref 模式可根本解决

建议修复优先级：C1 > C2 > H1 > H4 > H3 > 其余
