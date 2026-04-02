# Topic 3：动线简化方案
> 作者：flow-designer | 2026-03-18

## 核心策略：三条路径分叉 + "AI 先行，用户确认"

当前系统根本问题是**一条管道服务三种场景**。新策略：**在前端分叉路径，让每条路径只走自己需要的最短流程**。借鉴 OpenMAIC 的"帮用户做决策"理念，但保留智阶的个性化优势（mastery 驱动 + 材料级粒度）。

---

## 路径 A：考前冲刺（目标：2步，当前5步）

**新动线：**
```
[选"备考冲刺"] ──→ [考点速览 + 薄弱测验]
     (1步)              (直达学习)
```

**省略的步骤：**
- 省略 gathering 表单（数据被完全丢弃，mastery 由 BKT 自动推断）
- 省略 plan-preview 确认（考前时间紧迫，AI 直接按"高权重+薄弱"排序）
- 合并 processing + complete（边处理边展示，第一个模块完成即开始学习）

**AI 自动化：** 排序决策（按 exam_weight × (1-mastery) 降序），模块选择（自动打开第一个）

**最小可行前端改动：**
- [ ] `handleIntentSelect('exam')` 跳过 gathering，直接调用 `startProcessing`
- [ ] SSE `module_specialist_ready` 事件触发时立即调用 `onModuleSelect`（不等全部完成）
- [ ] 新增 `ExamFocusView` 替代 `CompletePhase`：按优先级排序 + "下一个薄弱点"按钮

**需要后端配合：**
- [ ] SSE 增加 `module_specialist_ready` 事件类型（某个模块完成即推送）
- [ ] （可选）`startDisassembly` 接受 `intent` 参数，考前模式 Specialist 输出更精简

---

## 路径 B：深度学习（目标：3步，当前6步）

**新动线：**
```
[选"学透"] ──→ [AI生成计划（含等待）] ──→ [确认计划，开始学习]
   (1步)           (自动，2-5min)              (1步确认)
```

**省略的步骤：**
- 省略 gathering 表单（熟悉度由 BKT 推断，新材料默认 mastery=0.3）
- 合并 processing + plan-preview 等待（管道完成后直接展示计划）
- 保留 plan-preview 确认（深度学习需要用户 ownership 感，是智阶差异化价值）

**最小可行前端改动：**
- [ ] `handleIntentSelect('learn')` 跳过 gathering，直接调用 `startProcessing`
- [ ] ProcessingView 增加"先看原文"按钮（切换到 original tab）
- [ ] 管道完成后自动跳转 plan-preview（已有此逻辑，省掉 gathering 即可）

---

## 路径 C：日常复习（目标：1步，当前走完整管道 5+步）

**新动线：**
```
[选"快速复习"] ──→ [闪卡复习会话]
     (1步)          (直接开始)
```

**省略的步骤：**
- 完全跳过 disassembly 管道（review 被映射为 learn 是根本 bug，复习不应触发 2-5 分钟全量分析）
- 省略 gathering + plan-preview（复习计划就是 FSRS 的到期队列）

**逻辑分支：**
- 有到期闪卡 → 直接进入 ReviewSession
- 有分析结果但无闪卡 → 自动从 Specialist + Quiz 生成闪卡，进入 ReviewSession
- 无分析结果 → 提示"请先分析材料"（不走 disassembly！）

**最小可行前端改动：**
- [ ] `handleIntentSelect('review')` 不调用 `startProcessing`，改为检查 localStorage 闪卡
- [ ] AIToolPanel 新增 review 相位：内嵌轻量版 ReviewSession
- [ ] 闪卡自动生成：从已完成的 SpecialistOutput + QuizData 批量生成 FlashcardNote

**需要后端配合：无！** 完全前端实现（FSRS + localStorage）

---

## AI 应该/不应该替用户做的决策

**AI 可以自动化（低风险）：**
- 模块排序（按 exam_weight × (1-mastery) 自动排序）
- 复习顺序（FSRS 算法自动调度）
- 起始模块选择（自动打开最需要学的模块）
- 学习计划初稿（AI 生成后展示，用户一键确认）
- gathering 数据推断（mastery 用 BKT 自动追踪）

**必须让用户决定（高影响力）：**
- 学习意图选择（learn/exam/review 三选一是核心分叉点）
- 学习计划确认（仅深度学习路径，长期学习需要 ownership 感）
- 跳过模块（AI 可标记"建议跳过"，但最终决定权在用户）
- 考试日期设定（只有用户知道）

---

## 与 OpenMAIC 的差异定位

| 维度 | OpenMAIC | 智阶（简化后） |
|------|----------|--------------|
| 核心策略 | 3步一刀切 | 3条分叉路径，每条2-3步 |
| AI 角色 | 替用户做所有决策 | 替低风险决策，高影响力决策给用户 |
| 个性化 | 无——所有学生同一流程 | BKT mastery 驱动排序+脚手架 |
| 材料粒度 | 整门课程 | 单份材料的模块级拆解 |
| 复习系统 | 无 | FSRS 间隔重复 |

**智阶核心竞争优势**：在接近 OpenMAIC 简洁度（2-3步）下，保持远超 OpenMAIC 的个性化深度。

---

## 步骤对比总结

| 路径 | 当前步骤数 | 新步骤数 | 削减 |
|------|-----------|---------|------|
| 考前冲刺 | 5 | 2 | -60% |
| 深度学习 | 6 | 3 | -50% |
| 日常复习 | 5+ | 1 | -80% |

---

## 实施优先级

| 改动 | 影响 | 难度 | 优先级 |
|------|------|------|--------|
| 省略 gathering 表单（三条路径） | 每条路径 -1 步 | 低（删代码） | **P0** |
| 复习路径绕过 disassembly 管道 | 复习从 5+步→1步 | 中（实现闪卡自动生成） | **P0** |
| 考前路径跳过 plan-preview | 考前从 5步→2步 | 低（条件跳过相位） | **P0** |
| 后端 SSE 增加 `module_specialist_ready` | 消除 2-5 分钟空等 | 中（后端改动） | **P1** |
| 第一个模块完成即自动展示 | 消除"干等"感 | 中（处理 partial completion） | **P1** |
| processing 加"先看原文"入口 | 让等待时间有价值 | 低（一个按钮） | **P1** |
| 考前路径 ExamFocusView 组件 | 替代通用 CompletePhase | 中（新组件） | **P2** |
| `startDisassembly` 接受 intent 参数 | 后端输出差异化 | 中（管道改造） | **P2** |
