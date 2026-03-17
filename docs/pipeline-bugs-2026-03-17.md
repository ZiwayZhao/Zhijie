# Pipeline Bug Report — 2026-03-17

## Bug 1: OpenRouter 双重序列化 (Double Serialization)

**严重程度**: High — 导致 ~40% 的 pipeline 任务失败

**表现**: Specialist Agent 返回的 `self_test_questions` 字段是一个 JSON **字符串** `"[{\"question\": ...}]"` 而不是数组 `[{"question": ...}]`。Pydantic 校验时报 `Input should be a valid list, input_type=str`。

**根因**: OpenRouter 的 function calling 实现在处理嵌套复杂对象时，有概率将数组/对象字段序列化为字符串。这不是 prompt 问题，而是 API 层的 tool use 实现缺陷。

**当前补丁**: 在 `llm_client.py` 中加了 `_fix_double_serialized()` 预处理，检测字符串开头是否为 `[` 或 `{`，如果是则尝试 `json.loads` 解析。

**正式修复方案**:
1. **切换到原生 Anthropic API** — 直接用 `anthropic` SDK 的 tool_use 而非 OpenRouter，Anthropic 原生 tool use 严格遵循 schema
2. **Structured Output 模式** — 使用 Anthropic 的 response_format JSON schema 而非 function calling
3. **备选: 加 JSON 修复层** — 用 `json-repair` 库处理 malformed JSON

## Bug 2: 单模块超时 (Specialist Timeout)

**严重程度**: Medium — 大材料（>30页）容易超时

**表现**: MIT 18.01 Unit 1（41页）在 Specialist 阶段超时。单模块 timeout 为 120s，对于内容密集的模块不够。

**根因**: Specialist 对大页数模块需要生成 1500-4000 字的中文精讲 + LaTeX 公式，Claude Sonnet 生成时间与输入 token 数正相关。41 页的材料每个模块约 8-10 页，生成 8192 token 的结构化 JSON 需要 3-5 分钟。

**当前补丁**: timeout 从 120s 调到 300s。Celery task time_limit 从 600s 调到 1800s。

**正式修复方案**:
1. **自适应 timeout** — 根据 `page_range_end - page_range_start` 动态计算 timeout（e.g. `base_120 + pages * 30`）
2. **流式生成 + 心跳** — 改用 streaming mode，边生成边追踪进度，不依赖固定 timeout
3. **大模块自动拆分** — Cartographer 输出的模块如果页数 > 15，自动拆分为子模块

## Bug 3: Examiner 字段缺失 (Missing `questions` Field)

**严重程度**: High — Examiner 阶段 100% 失败（在 6.006 首次运行时）

**表现**: ExaminerResult 校验报 `questions: Field required`。LLM 返回的 JSON 没有 `questions` 这个 key。

**根因**: 同 Bug 1，OpenRouter function calling 对嵌套数组的处理不稳定。在某些情况下，整个 `questions` 字段被省略或被放到了其他字段名下。

**当前补丁**: 加了 ValidationError 自动重试 + 错误反馈给 LLM 的机制。

**正式修复方案**: 同 Bug 1 — 切换到 Anthropic 原生 API。

## Bug 4: Celery Worker 重启后任务状态不一致

**严重程度**: Low — 仅影响开发体验

**表现**: Celery worker 重启后，之前 "running" 状态的任务永远不会被更新为 failed，新任务因为检测到 "同一材料有 running 任务" 而无法创建。

**当前补丁**: 手动通过 SQL UPDATE 标记为 failed。

**正式修复方案**:
1. **启动时清理** — Worker 启动时扫描所有 status='running' 的任务，如果 celery_task_id 在 broker 中不存在，标记为 failed
2. **心跳机制** — 任务每 30s 更新 `updated_at`，定时任务检测超过 5 分钟未更新的 running 任务自动标记为 stale
3. **幂等重试** — 允许对 failed 任务直接重试，跳过已完成的阶段（当前已部分实现）

## 总结: 版本升级路径

| 优先级 | 改动 | 影响 |
|--------|------|------|
| P0 | 从 OpenRouter function calling 迁移到 Anthropic 原生 tool_use | 解决 Bug 1, 3 |
| P1 | Specialist 自适应 timeout + 大模块拆分 | 解决 Bug 2 |
| P2 | Celery 任务状态健康检查 | 解决 Bug 4 |
| P3 | 端到端错误恢复 — 任何阶段失败自动重试 | 提升整体可靠性 |
