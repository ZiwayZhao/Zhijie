# 功能完整性审核报告

## 审核结论

Phase 0+1 的核心功能**基本正确实现**，三条路径分叉、自动加载首模块、viewedModules 追踪、模块导航、intent 传递、流式推送均已到位。发现 **1 个 HIGH 问题** 和 **3 个 MEDIUM 问题**，无 CRITICAL 级别问题。

---

## 逐项检查

### 1. 三条路径分叉
**状态**: ✅ 正确

**发现**:

`AIToolPanel.tsx` 的 `handleIntentSelect` 函数（L247-280）正确实现了三条路径：

- **learn 路径**: `handleIntentSelect('learn')` → 跳过 gathering，直接调用 `startProcessing(i, {})` → 管道完成后进入 `plan-preview` phase（L226-229）→ 用户确认后进入 `complete` → 自动加载首模块
- **exam 路径**: `handleIntentSelect('exam')` → 跳过 gathering，直接调用 `startProcessing(i, {})` → 管道完成后跳过 plan-preview，直接进入 `complete`（L220-223）→ 自动加载首模块（按 examWeight 排序优先加载高权重模块）
- **review 路径**: `handleIntentSelect('review')` → 调用 `getLatestAnalysis` 检查是否有已完成分析 → 有则直接进入 `complete`（L255-265），无则显示友好错误信息（L268）

Phase state machine: `idle → processing → plan-preview(learn only) → complete` / `idle → processing → complete(exam)` / `idle → complete(review)`

GatheringPhase 组件保留在 `IntentGatherer.tsx` 中但未被 AIToolPanel 使用（已注释移除 gathering phase）。这是合理的——简化了用户交互流程。

### 2. 自动加载首模块
**状态**: ✅ 正确

**发现**:

两个自动加载机制：

1. **管道完成后**: `autoLoadFirstModule`（L182-191）在管道完成时被调用。exam 路径按 `examWeight` 排序选最高权重模块（L184-185），learn 路径选第一个模块（L186）。调用 `getSpecialistResult` 获取精讲内容后调用 `onModuleSelect` 将内容传到父组件。

2. **已有分析自动检测**: `useEffect`（L152-179）在组件挂载时检测已完成的分析，若 `autoSelectFirstModule` 为 true 且有模块，自动加载首模块精讲。`WorkbenchPage` 在 `!hasPdf` 时传入 `autoSelectFirstModule={true}`（L229），即无 PDF 时自动展示精讲。

3. **plan-preview 确认后**: 用户确认学习计划后（L347-350），同样调用 `autoLoadFirstModule`。

### 3. viewedModules 追踪
**状态**: ✅ 正确

**发现**:

- `WorkbenchPage` 维护 `viewedModules: Set<string>` 状态（L27）
- `handleModuleSelect` 回调（L84-95）和 `navigateToModule`（L41-59）都正确调用 `setViewedModules` 添加模块 ID
- 使用不可变 Set 更新模式（创建新 Set 而非修改原 Set）：L52-57
- `viewedModules` 传递到 `AIToolPanel` → `CompletePhase` 组件
- `CompletePhase`（ModuleDisplay.tsx L71-168）正确显示：
  - 进度条（L117-126）：已学习/总数
  - 每个模块的状态图标：未读=红色 FileText，已读=绿色 CheckCircle2，当前=金色高亮
  - 描述文本根据进度动态变化（L82-87）
- `handleModulesLoaded` 回调（L29-33）在新分析结果到达时重置 viewedModules

### 4. 下一模块导航
**状态**: ✅ 正确

**发现**:

- `WorkbenchPage` 计算 `currentModuleIndex`、`nextModule`、`prevModule`（L36-39）
- `navigateToModule` 回调（L41-59）通过 `getLatestAnalysis` + `getSpecialistResult` 加载目标模块精讲并切换 tab
- `MaterialReader` 的 `ModuleNavigation` 组件（L267-345）：
  - 显示进度条 `{currentIndex+1}/{total}`
  - "下一模块" 按钮（带模块名称）
  - "上一模块" 链接
  - "做测验" 按钮跳转到 quiz tab
  - 条件渲染正确：仅在 `currentModuleIndex` 和 `totalModules` 都有值时显示（L117）

### 5. 意图参数传递
**状态**: ⚠️ 部分实现

**发现**:

- **前端 → 后端**：`startDisassembly(materialId, mapped)` 在 `api-disassembly.ts:123-126` 发送 `{ material_id, intent }` 到 `/api/v1/disassembly/start`
- **Intent 映射**：`review` 被映射为 `learn`（AIToolPanel.tsx L200: `const mapped = i === 'review' ? 'learn' : i`）。但 review 路径实际不走 `startProcessing`，所以这个映射只在 review 路径 fallback 到新分析时才会触发——目前 review 路径不触发管道，所以这行代码永远不会以 `review` 进入。
- **后端接收**：`StartAnalysisRequest.intent` 定义为 `str | None`（schema L43），`DisassemblyTask.intent` 列存储（model L70）
- **问题**：后端 `pipeline_worker.py` 中 `_run_pipeline_async` **未使用 `task.intent` 做任何差异化处理**。learn 和 exam 走完全相同的管道（Cartographer → Specialist → Examiner），intent 仅被存储但未影响行为（如 exam 模式应跳过低权重模块的 specialist 生成、或精简输出）。这是 Phase 1 的后续工作，目前阶段可接受。

### 6. 流式 module_ready 推送
**状态**: ✅ 正确

**发现**:

- **后端**: `pipeline_worker.py` L306-318 在每个 specialist 输出保存后发送 `module_ready` 事件：
  ```python
  _publish_progress(..., event_type="module_ready")
  ```
  事件包含 `module_id`、`module_name`、`completed`、`total` 信息
- **Redis Pub/Sub**: 通过 `redis_client.publish(f"pipeline:{task_id}", ...)` 发送
- **SSE 转发**: `disassembly.py` L223-227 将 Redis 消息中的 `type` 字段作为 SSE event type 转发，因此 `module_ready` 事件会作为独立的 SSE event type 发送到前端
- **前端接收问题**: `api-disassembly.ts` 的 `subscribeProgress` 函数（L150-181）**只监听了 `status` 和 `progress` 两种 SSE event type**，**没有监听 `module_ready` 事件**。这意味着后端发送的 `module_ready` 事件在前端被静默丢弃。目前前端是在管道全部完成后通过 `getAnalysisResult` 一次性获取所有模块，所以功能上不受影响，但失去了增量渲染的能力。

---

## 问题清单

| 严重级别 | 问题描述 | 位置 | 建议修复 |
|---------|---------|------|---------|
| HIGH | 前端 SSE 未监听 `module_ready` 事件，后端发送的增量模块就绪通知被丢弃，无法实现模块级增量渲染 | `src/lib/api-disassembly.ts:150-181` | 添加 `evtSource.addEventListener('module_ready', ...)` 处理器，收到后调用回调通知 AIToolPanel 增量加载模块 |
| MEDIUM | 后端 pipeline_worker 未根据 intent 差异化处理（exam 应精简 specialist 输出或跳过低权重模块） | `backend/app/workers/pipeline_worker.py:95-420` | Phase 1 后续：在 specialist 阶段根据 task.intent 调整策略 |
| MEDIUM | `GatheringPhase` 组件已不再被使用但仍导出，`IntentGatherer.tsx` 中 `GatheringPhase` + `ExamGatheringFields` + `LearnGatheringFields` 为死代码 | `src/components/workbench/IntentGatherer.tsx:80-200` | 若确定移除 gathering 阶段，删除这些未使用的组件和类型 |
| MEDIUM | `navigateToModule` 每次调用都重新请求 `getLatestAnalysis` 查询最新任务，而 `taskIdRef` 在 AIToolPanel 中已持有当前 taskId | `src/pages/WorkbenchPage.tsx:41-59` | 将 taskId 从 AIToolPanel 通过 callback 或 prop 传递到 WorkbenchPage，避免重复查询 |

---

## 总结

Phase 0+1 的前端状态机设计清晰，三条学习路径的分叉逻辑正确，模块追踪和导航功能完整。最值得关注的是 `module_ready` SSE 事件未被前端消费（HIGH），这限制了用户在长时间管道运行中的增量体验。其他问题为代码清理和优化级别。
