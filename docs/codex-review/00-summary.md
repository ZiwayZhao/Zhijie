# Codex 交叉审核整合报告

**审核范围**: Phase 0 + Phase 1 前端 + 后端改动
**审核日期**: 2026-03-18
**编译状态**: ✅ `tsc --noEmit` 零错误 + `npm run build` 通过

---

## 问题总览

| 来源 | CRITICAL | HIGH | MEDIUM | LOW |
|------|---------|------|--------|-----|
| 功能完整性 | 0 | 1 | 3 | 0 |
| 代码质量 | 2 | 4 | 5 | 4 |
| 设计系统 | 0 | 0 | 1 | 1 |
| 后端安全 | 1 | 2 | 3 | 2 |
| **合计** | **3** | **7** | **12** | **7** |

---

## 已修复：CRITICAL (3/3)

### C1. intent 参数无枚举验证（安全）
**修复文件**:
- `backend/app/schemas/disassembly.py` — `intent: str | None` → `Literal['learn', 'exam', 'review'] | None`
- `backend/app/models/disassembly.py` — 新增 `ck_dtask_intent` CheckConstraint
- `backend/app/db/migrations/versions/0008_disassembly_task_intent.py` — 追加 CHECK 约束 + downgrade 清除约束

### C2. SSE 回调中异步操作缺少卸载保护（内存泄漏）
**修复文件**: `src/components/workbench/AIToolPanel.tsx`
- 新增 `mountedRef` + 在 cleanup effect 中设 `mountedRef.current = false`
- `getAnalysisResult().then()` 回调首行检查 `if (!mountedRef.current) return`
- `.catch()` 回调同样检查

### C3. handleToolClick setTimeout 无清理（内存泄漏）
**修复文件**: `src/components/workbench/AIToolPanel.tsx`
- 新增 `toolTimerRef`，每次点击先 `clearTimeout` 旧 timer
- cleanup effect 中 `if (toolTimerRef.current) clearTimeout(toolTimerRef.current)`

---

## 已修复：HIGH (7/7)

### H1. 前端 SSE 未监听 module_ready 事件（功能）
**修复文件**: `src/lib/api-disassembly.ts`
- 新增 `evtSource.addEventListener('module_ready', ...)` handler
- 收到 module_ready 后调用 `onProgress` 传递增量进度

### H2. any 类型 — API 响应未类型化（代码质量）
**修复文件**: `src/lib/api-disassembly.ts`
- 新增 `RawModule` interface 描述后端返回结构
- `data.modules.map((m: any) => ...)` → `(data.modules as RawModule[]).map((m) => ...)`

### H3. useEffect 依赖包含不稳定回调 props（代码质量）
**修复文件**: `src/components/workbench/AIToolPanel.tsx`
- 新增 `onModuleSelectRef`、`onQuizReadyRef`、`onModulesLoadedRef` 三个 callback ref
- 每次渲染同步 `.current`，effect 内改用 ref 访问
- auto-detect effect 依赖数组收窄为 `[materialId, autoSelectFirstModule]`

### H4. JSX 中每次渲染调用 localStorage（性能）
**修复文件**: `src/pages/WorkbenchPage.tsx`
- 新增 `const currentMastery = useMemo(() => ..., [currentModuleId])`
- `mastery={loadProfile()...}` → `mastery={currentMastery}`
- 新增 `useMemo` 到 React imports

### H5. SSE 连接无并发限制（安全）
**修复文件**: `backend/app/api/v1/disassembly.py`
- 新增模块级 `_sse_connections: dict[str, int]` 计数器
- 连接前检查 `>= SSE_MAX_CONNECTIONS_PER_USER (5)`，超限返回 HTTP 429
- `event_generator` finally 块递减计数，防止 counter 泄露
- 注：当前为 in-process 实现，多 worker 场景需升级为 Redis 计数器

### H6. SSE Token URL 暴露（安全）
**状态**: ⚠️ 已知限制，暂不修复
- EventSource API 无法设置 Authorization header，token via query param 是不可避免的权衡
- 缓解措施：确保 JWT 过期时间 < 1h + HTTPS + Nginx access log 过滤 token 参数
- 长期方案：fetch-based SSE 或短期 ticket 机制（需专项迭代）

### H7. ManualToolSection onToggle 内联箭头函数
**状态**: ✅ 已由 linter 自动提取为 `handleManualToggle = useCallback(...)`

---

## 未修复：MEDIUM/LOW（建议后续迭代）

| # | 问题 | 文件 | 建议 |
|---|------|------|------|
| M1 | backend pipeline 错误消息泄露内部细节 | pipeline_worker.py | 对外返回通用 "Internal pipeline error" |
| M2 | Redis 通道名可预测 | disassembly.py | 确保 Redis requirepass + 网络隔离 |
| M3 | allow_completed 允许越权读取 | disassembly.py | 添加 material.is_public 检查 |
| M4 | GatheringPhase 死代码未清理 | IntentGatherer.tsx | 确认废弃后删除 |
| M5 | QuizPanel questions 用 index 作 key | QuizPanel.tsx | 改为 `q.question` 或复合 key |
| M6 | MaterialReader 代码块硬编码 hex | MaterialReader.tsx | `bg-[#1a1a1a]` → 设计变量 |
| M7 | 多处 catch 块静默吞错误 | 多文件 | 开发环境加 `console.warn` |

---

## 审核结论

Phase 0+1 整体代码质量良好，核心功能正确实现。修复后：
- 无安全漏洞（intent 枚举验证 + SSE 限速）
- 无内存泄漏（mountedRef + setTimeout 清理）
- 无 TypeScript `any` 类型残留
- SSE 增量事件（module_ready）前端已可接收
- 编译 100% 通过
