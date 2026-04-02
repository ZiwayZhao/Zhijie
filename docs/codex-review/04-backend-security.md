# 04 — 后端安全性审核报告

**审核范围**: intent 参数 / SSE 推送 / 数据库迁移 / pipeline worker
**审核日期**: 2026-03-18
**审核文件**:
- `backend/app/api/v1/disassembly.py`
- `backend/app/models/disassembly.py`
- `backend/app/schemas/disassembly.py`
- `backend/app/workers/pipeline_worker.py`
- `backend/app/db/migrations/versions/0007_gaoling_embeddings.py`
- `backend/app/db/migrations/versions/0008_disassembly_task_intent.py`

---

## 总览

| 严重度 | 数量 |
|--------|------|
| CRITICAL | 1 |
| HIGH | 2 |
| MEDIUM | 3 |
| LOW | 2 |

---

## CRITICAL

### C1: `intent` 参数缺少枚举验证 — 任意字符串可入库

**位置**: `schemas/disassembly.py:43`, `models/disassembly.py:70`

**问题**: `StartAnalysisRequest.intent` 定义为 `str | None = None`，无枚举约束。模型层 `DisassemblyTask.intent` 是 `String(20)` 也无 CHECK 约束。用户可以传入任意字符串（如 `"<script>alert(1)</script>"` 或 20 字符以内的任何值），该值直接写入数据库。

虽然 SQLAlchemy 参数化查询防止了 SQL 注入，且 `intent` 未被拼入任何命令行/系统调用（无命令注入风险），但：
1. 存储型 XSS 风险：如果 `intent` 值在前端未转义展示，攻击者可注入恶意内容
2. 业务逻辑混乱：下游代码（如 pipeline_worker）可能依赖 intent 做策略分支，非法值导致不可预期行为
3. 数据污染：数据库中存在无意义/恶意 intent 值，影响数据分析

**修复（Pydantic schema 层 — 推荐）**:

```python
# schemas/disassembly.py
from typing import Literal

class StartAnalysisRequest(BaseModel):
    """POST /disassembly/start body."""
    material_id: uuid.UUID
    intent: Literal['learn', 'exam', 'review'] | None = None
```

**修复（数据库层 — 纵深防御）**:

```python
# models/disassembly.py — DisassemblyTask.__table_args__ 内新增
CheckConstraint(
    "intent IS NULL OR intent IN ('learn', 'exam', 'review')",
    name="ck_dtask_intent",
),
```

**修复（迁移 0008 追加约束）**:

```python
# 0008 migration upgrade() 末尾追加
op.create_check_constraint(
    "ck_dtask_intent",
    "disassembly_tasks",
    "intent IS NULL OR intent IN ('learn', 'exam', 'review')",
)
```

---

## HIGH

### H1: SSE 端点 token 在 URL 中暴露 — 日志/Referer 泄露风险

**位置**: `disassembly.py:166-189`

**问题**: SSE 端点通过 `?token=<JWT>` 查询参数传递认证 token。这是 EventSource 的已知限制（无法设置自定义 Header），但 JWT 会：
1. 被写入 Web 服务器访问日志（Nginx/ALB access log）
2. 出现在浏览器历史记录中
3. 可能通过 Referer header 泄露到第三方

**缓解方案（推荐）**:

```python
# 方案 A：短期一次性 token（推荐）
# 在 start_analysis 或新增端点中生成一个 5 分钟有效的 SSE 专用 token
# 该 token 绑定特定 task_id，用后即焚

@router.post("/tasks/{task_id}/sse-ticket")
async def create_sse_ticket(
    task_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Issue a short-lived, single-use ticket for SSE connection."""
    task = await _get_task_or_404(task_id, user, db)
    ticket = secrets.token_urlsafe(32)
    # Store in Redis with 5-min TTL, bound to user_id + task_id
    redis_client = aioredis.from_url(settings.redis_url)
    await redis_client.setex(
        f"sse_ticket:{ticket}",
        300,  # 5 minutes
        json.dumps({"user_id": str(user.id), "task_id": str(task_id)}),
    )
    await redis_client.close()
    return {"ticket": ticket}
```

**当前可接受性**: 如果 JWT 过期时间较短（< 1h）且部署环境受控（HTTPS + 无第三方脚本），风险可降低为 MEDIUM。但长期应迁移到 ticket 方案。

### H2: SSE 连接无并发限制 — 潜在资源耗尽

**位置**: `disassembly.py:193-242`

**问题**: 无限制的 SSE 连接数。攻击者可以用有效 token 打开大量 SSE 连接，每个连接持有一个 Redis Pub/Sub 订阅 + 一个长期运行的异步生成器。`SSE_TIMEOUT_SECONDS = 600`（10 分钟）意味着每个连接最多占用 10 分钟。

**影响**: Redis 连接池耗尽、服务器内存增长、asyncio 事件循环饱和。

**修复**:

```python
# 方案 1：基于 Redis 的连接计数器
async def task_status_sse(task_id: uuid.UUID, ...):
    # ... auth code ...

    # Rate limit: max 3 SSE connections per user
    redis_limit = aioredis.from_url(settings.redis_url)
    key = f"sse_connections:{user.id}"
    current = await redis_limit.incr(key)
    await redis_limit.expire(key, SSE_TIMEOUT_SECONDS + 60)
    if current > 3:
        await redis_limit.decr(key)
        await redis_limit.close()
        raise HTTPException(status_code=429, detail="Too many SSE connections")

    # ... existing code ...
    # In finally block: await redis_limit.decr(key)
```

---

## MEDIUM

### M1: pipeline_worker 错误消息可能泄露内部信息

**位置**: `pipeline_worker.py:404-417`

**问题**: 未预期异常的错误消息直接包含了 Python 异常类名和完整消息：
```python
error_message=f"Unexpected error: {type(e).__name__}: {e}",
```

这通过 SSE 推送给前端，可能泄露内部实现细节（包路径、数据库连接字符串等）。

**修复**:

```python
except Exception as e:
    logger.exception("Unexpected pipeline error for task %s", task_id_str)
    # 日志保留完整信息，但对外只返回通用消息
    await _update_task(
        session, task_id,
        status="failed",
        error_phase=task.phase or "unknown",
        error_message="Internal pipeline error",  # 不暴露内部细节
    )
    _publish_progress(
        redis_client, task_id_str, task.phase or "unknown", 0.0,
        "分析异常终止",
        status="failed",
    )
```

### M2: Redis Pub/Sub 通道名可预测 — 跨用户信息泄露

**位置**: `pipeline_worker.py:75`, `disassembly.py:208`

**问题**: Redis Pub/Sub 通道名为 `pipeline:{task_id}`。虽然 SSE 端点有 auth + ownership 检查，但如果攻击者有 Redis 直连能力（内网/配置泄露），可以直接订阅任意 `pipeline:*` 通道获取所有用户的分析进度信息（包含模块名、进度等）。

**缓解**: 确保 Redis 设置了密码认证（`requirepass`）+ 网络隔离（仅应用可达）。当前代码中 `settings.redis_url` 是否含密码需确认。

### M3: `_get_task_or_404` 的 `allow_completed` 逻辑允许越权读取已完成任务

**位置**: `disassembly.py:52-78`

**问题**: 当 `allow_completed=True` 时，任何认证用户可以访问任何已完成任务的详细结果（模块内容、测验题等）。这在 showcase 场景下是有意为之，但可能泄露其他用户的非公开教学内容。

**建议**: 如果有私有 material 概念，应增加 `material.is_public` 检查：

```python
if task.user_id != user.id:
    if not (allow_completed and task.status == "completed"):
        raise HTTPException(...)
    # 额外检查：非公开材料不允许他人访问
    material = await db.get(Material, task.material_id)
    if material and not getattr(material, 'is_public', True):
        raise HTTPException(status_code=404, ...)
```

---

## LOW

### L1: 迁移 0007 的 SAVEPOINT 模式在某些 PostgreSQL 配置下可能有问题

**位置**: `0007_gaoling_embeddings.py:33-41`

**问题**: 使用 `SAVEPOINT` + `ROLLBACK TO SAVEPOINT` 来优雅处理 pgvector 不可用的场景。这在大多数情况下工作良好，但在 autocommit 模式下 SAVEPOINT 不可用。

**当前评估**: Alembic 默认在事务内运行迁移，所以 SAVEPOINT 是安全的。代码设计合理，有 downgrade 函数。**无需修改。**

### L2: 迁移 0008 缺少 intent 值约束

**位置**: `0008_disassembly_task_intent.py:18-21`

**问题**: 迁移只添加了 `nullable=True` 的 `String(20)` 列，没有 CHECK 约束。与 C1 相关联 — 如果修复 C1 时在模型层添加了 CHECK 约束，迁移也应同步添加。

**修复**: 见 C1 的迁移修复代码。

---

## 已确认安全的方面

| 检查项 | 状态 | 说明 |
|--------|------|------|
| SQL 注入 | **安全** | 全部使用 SQLAlchemy ORM，参数化查询 |
| 命令注入 | **安全** | intent 未拼入任何 shell 命令或 subprocess 调用 |
| 路径遍历 | **安全** | S3 key 由服务端生成，用户不可控 |
| 认证覆盖 | **安全** | 所有写操作端点都有 `Depends(get_current_user)` |
| 所有权检查 | **安全** | `_get_task_or_404` 验证 `task.user_id == user.id` |
| 硬编码密钥 | **安全** | 未发现硬编码密钥/密码 |
| IDOR | **部分安全** | UUID 作为 ID 不可枚举，但 `allow_completed` 放宽了越权限制（见 M3） |
| Celery 任务安全 | **安全** | 有 `soft_time_limit` + `time_limit` 防止无限运行 |
| 幂等性 | **安全** | pipeline 每个阶段都检查已有结果，重复执行安全 |
| 迁移回滚 | **安全** | 两个迁移都有 `downgrade()` 函数 |
| worker 向后兼容 | **安全** | `module_ready` 是新增 event_type，旧客户端只监听 `progress`，不会崩溃 |
| intent 默认值 | **安全** | `intent` 是 `nullable=True`，旧任务 intent=NULL 不会报错 |

---

## 修复优先级建议

1. **立即修复**: C1（intent 枚举验证）— 最简单、影响最大
2. **短期修复**: H2（SSE 连接限流）— 防止资源耗尽攻击
3. **中期迁移**: H1（SSE ticket 机制）— 减少 token 暴露面
4. **长期优化**: M1（错误消息脱敏）+ M3（公开/私有权限细化）
