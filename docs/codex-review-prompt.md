# Codex 交叉审核任务

## 审核范围
Phase 0 + Phase 1 的所有代码改动（共约 700+ 行新增）。

## 改动文件清单
### 前端
1. src/components/workbench/AIToolPanel.tsx — 状态机改造（删gathering、exam跳过plan-preview、review绕过管道、自动加载首模块）
2. src/components/workbench/MaterialReader.tsx — 下一模块导航（ModuleNavigation组件）
3. src/components/workbench/ModuleDisplay.tsx — 完成标记+进度条（viewedModules/currentModuleId）
4. src/components/workbench/ProcessingView.tsx — 预估时间+阶段总结+30秒提示
5. src/components/workbench/QuizPanel.tsx — 答错行动引导+实时正确率+薄弱模块分析
6. src/components/workbench/IntentGatherer.tsx — 推荐意图标记
7. src/lib/api-disassembly.ts — intent参数传递
8. src/pages/WorkbenchPage.tsx — modules状态+viewedModules+导航props

### 后端
9. backend/app/api/v1/disassembly.py — intent参数接收
10. backend/app/models/disassembly.py — intent列
11. backend/app/schemas/disassembly.py — intent字段
12. backend/app/workers/pipeline_worker.py — 流式module_ready推送

## 审核要点

### Teammate 1：功能完整性审核
- Phase 0 的8项改动是否都正确实现？
- 三条路径（learn/exam/review）是否正确分叉？
- 自动加载首模块是否在所有场景下都work？
- viewedModules 追踪是否完整？

### Teammate 2：代码质量审核
- 有无 TypeScript 类型错误或隐患？
- React hooks 依赖数组是否完整？
- 有无内存泄漏（未清理的listener/timer）？
- 有无重复渲染问题？
- 错误处理是否充分？

### Teammate 3：设计系统一致性审核
- 新增的UI元素是否遵循 Editorial Academic 美学？
- 颜色是否使用 Tailwind 变量（red-primary/bg-main/text-body等）？
- 有无硬编码的hex颜色值？
- Framer Motion 动效是否克制？
- 字体使用是否正确（font-heading/font-body）？

### Teammate 4：后端安全性审核
- intent 参数有无注入风险？
- SSE 推送有无权限检查？
- pipeline_worker 改动是否向后兼容？
- 数据库迁移是否安全？

## 输出要求
1. 每个 teammate 写独立审核报告到 docs/codex-review/
2. 发现的问题分级：CRITICAL（必须修复）/ HIGH（应修复）/ MEDIUM（建议修复）/ LOW（可选）
3. 对每个 CRITICAL 和 HIGH 问题给出具体的修复代码
4. Team Lead 整合后直接修复所有 CRITICAL 和 HIGH 问题
5. 最终确认编译通过

所有内容用中文。
