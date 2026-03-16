# 智阶新版 — 完整开发规格文档

> 综合 Claude Opus 深度研究 + GPT-5.4 交叉验证 + WebSearch 行业对标
> 日期：2026-03-16 | 版本：v1.0

---

## 目录

1. [项目现状审计](#1-项目现状审计)
2. [统一后端架构](#2-统一后端架构)
3. [子系统 A：苏格拉底对话引擎](#3-子系统-a苏格拉底对话引擎)
4. [子系统 B：闪卡自进化系统](#4-子系统-b闪卡自进化系统)
5. [子系统 C：材料分析 3-Agent 管道](#5-子系统-c材料分析-3-agent-管道)
6. [子系统 D：游戏化激励系统](#6-子系统-d游戏化激励系统)
7. [子系统 E：真实学习统计](#7-子系统-e真实学习统计)
8. [子系统 F：四阶段考试备考](#8-子系统-f四阶段考试备考)
9. [子系统 G：知识网络](#9-子系统-g知识网络)
10. [子系统 H：文件上传+云存储](#10-子系统-h文件上传云存储)
11. [子系统 I：用户认证](#11-子系统-i用户认证)
12. [子系统 J：跨设备数据同步](#12-子系统-j跨设备数据同步)
13. [统一数据库 Schema](#13-统一数据库-schema)
14. [开发排期与优先级](#14-开发排期与优先级)
15. [成本预估](#15-成本预估)

---

## 1. 项目现状审计

### 已完成（前端，可直接复用）
| 功能 | 文件 | 状态 |
|------|------|------|
| FSRS v6 间隔重复 | `src/lib/fsrs.ts` | ✅ 完整 |
| BKT 知识追踪 | `src/lib/student-model.ts` | ✅ 完整 |
| 统一日程引擎 | `src/lib/agenda-engine.ts` | ✅ 完整 |
| 闪卡复习流程 | `src/components/flashcard/ReviewSession.tsx` | ✅ 完整 |
| PDF 批注 | `src/components/workbench/PdfAnnotator.tsx` | ✅ 完整 |
| 意图引导面板 | `src/components/workbench/AIToolPanel.tsx` | ✅ 完整 |
| Editorial 设计系统 | `tailwind.config.ts` + `src/index.css` | ✅ 完整 |
| Framer Motion 动效 | 全局 | ✅ 完整 |

### 需要做的（Mock → 真实）
| 功能 | 当前状态 | 目标 |
|------|---------|------|
| 苏格拉底对话 | 本地模板匹配 | LLM API 驱动 |
| 闪卡自进化 | Mock 模板 | LLM 驱动拆分/改写/退役 |
| 材料分析 | 假数据 | 3-Agent PDF 解析管道 |
| 学习统计 | `src/mocks/activities.ts` 硬编码 | FSRS reviewLogs 聚合 |
| 游戏化 | 无 | XP/等级/连续学习/成就 |
| 考试备考 | 简单倒计时 | 4 阶段认知科学模型 |
| 知识网络 | `src/mocks/courses.ts` 静态数据 | 课程社区 + 搜索 |
| 文件上传 | localStorage base64 | S3 云存储 |
| 用户认证 | 无 | JWT + OAuth2 |
| 跨设备同步 | localStorage 单设备 | Delta sync + 离线支持 |

---

## 2. 统一后端架构

### 技术栈（Claude + GPT 共识）
| 组件 | 选型 | 理由 |
|------|------|------|
| Web 框架 | **FastAPI** | 原生 async，SSE 支持好，Pydantic 集成 |
| ORM | **SQLAlchemy 2.0 + asyncpg** | 异步 PostgreSQL，成熟生态 |
| 迁移 | **Alembic** | SQLAlchemy 标配 |
| 数据库 | **PostgreSQL 16** | 全文搜索 tsvector，JSON 支持好 |
| 缓存/消息 | **Redis 7** | 缓存 + Pub/Sub + 任务队列 |
| 任务队列 | **Celery + Redis** | chain/chord 天然适配 3-Agent 管道（WebSearch 验证更优于 ARQ） |
| 文件存储 | **Cloudflare R2** (生产) / **MinIO** (开发) | S3 兼容，R2 免出口流量费 |
| LLM 主力 | **Claude Sonnet 4.5** | 教学对话、结构化输出 |
| LLM 备选 | **Claude Haiku 4.5** | 摘要压缩、轻量任务 |
| 搜索 | **Meilisearch** | 比 Typesense 更易部署，中文支持好 |

### 后端目录结构
```
backend/
├── app/
│   ├── main.py                    # FastAPI app + CORS + lifespan
│   ├── core/
│   │   ├── config.py              # pydantic-settings 配置
│   │   ├── security.py            # JWT + OAuth2
│   │   └── logging.py
│   ├── db/
│   │   ├── base.py                # SQLAlchemy async engine
│   │   ├── session.py             # async session maker
│   │   └── migrations/            # Alembic
│   ├── models/                    # SQLAlchemy models
│   │   ├── user.py
│   │   ├── course.py
│   │   ├── material.py
│   │   ├── flashcard.py
│   │   ├── conversation.py
│   │   ├── gamification.py
│   │   ├── analytics.py
│   │   └── exam_prep.py
│   ├── schemas/                   # Pydantic request/response
│   │   ├── user.py
│   │   ├── chat.py
│   │   ├── flashcard.py
│   │   ├── material.py
│   │   ├── gamification.py
│   │   ├── analytics.py
│   │   └── exam_prep.py
│   ├── api/v1/
│   │   ├── deps.py                # get_current_user, get_db
│   │   ├── auth.py                # 登录注册
│   │   ├── chat.py                # 苏格拉底对话 SSE
│   │   ├── flashcards.py          # CRUD + 进化
│   │   ├── materials.py           # 上传 + 分析
│   │   ├── disassembly.py         # 材料拆解管道
│   │   ├── gamification.py        # XP/等级/成就
│   │   ├── analytics.py           # 学习统计
│   │   ├── exam_prep.py           # 备考计划
│   │   ├── courses.py             # 知识网络
│   │   └── sync.py                # 数据同步
│   ├── services/                  # 业务逻辑
│   │   ├── llm_client.py          # Anthropic SDK 封装
│   │   ├── socratic_engine.py     # 对话引擎
│   │   ├── card_evolution.py      # 闪卡进化
│   │   ├── pipeline/              # 3-Agent 管道
│   │   │   ├── cartographer.py
│   │   │   ├── specialist.py
│   │   │   └── examiner.py
│   │   ├── gamification_service.py
│   │   ├── analytics_service.py
│   │   ├── exam_prep_service.py
│   │   └── sync_service.py
│   └── workers/
│       ├── pipeline_worker.py     # ARQ 材料分析
│       ├── evolution_worker.py    # ARQ 闪卡进化
│       ├── achievements.py        # 成就判定
│       └── daily_rollup.py        # 每日统计聚合
├── docker-compose.yml
├── Dockerfile
├── requirements.txt
├── alembic.ini
└── tests/
```

### Docker Compose
```yaml
version: '3.9'
services:
  api:
    build: .
    ports: ["8003:8003"]
    depends_on: [db, redis]
    environment:
      - DATABASE_URL=postgresql+asyncpg://zhijie:zhijie@db:5432/zhijie
      - REDIS_URL=redis://redis:6379
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - R2_ACCESS_KEY=${R2_ACCESS_KEY}
      - R2_SECRET_KEY=${R2_SECRET_KEY}

  worker:
    build: .
    command: celery -A app.workers.celery_app worker --loglevel=info
    depends_on: [db, redis]
    environment:
      - DATABASE_URL=postgresql+asyncpg://zhijie:zhijie@db:5432/zhijie
      - REDIS_URL=redis://redis:6379
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}

  db:
    image: postgres:16-alpine
    ports: ["5436:5432"]
    environment:
      POSTGRES_DB: zhijie
      POSTGRES_USER: zhijie
      POSTGRES_PASSWORD: zhijie
    volumes: [pgdata:/var/lib/postgresql/data]

  redis:
    image: redis:7-alpine
    ports: ["6383:6379"]

  meilisearch:
    image: getmeili/meilisearch:v1.7
    ports: ["7700:7700"]
    environment:
      MEILI_MASTER_KEY: ${MEILI_MASTER_KEY}
    volumes: [meilidata:/meili_data]

volumes:
  pgdata:
  meilidata:
```

---

## 3. 子系统 A：苏格拉底对话引擎

> 研究来源：Claude 深度研究 + GPT-5.4 验证 + WebSearch Khanmigo 对标

### 3.1 架构决策

| 决策项 | Claude 建议 | GPT 建议 | WebSearch 验证 | 最终方案 |
|--------|------------|----------|---------------|---------|
| LLM | Sonnet 主力 + Haiku 降级 | Sonnet 主力 + Haiku 摘要 | **Haiku 对话 + Sonnet 批处理** | **Haiku 4.5 实时对话 + Sonnet 4.5 批处理** |
| 流式 | FastAPI SSE | FastAPI SSE | sse-starlette 库 | **sse-starlette（非手写 StreamingResponse）** |
| 历史管理 | 滑动窗口 20 条 | 滑动窗口 + 摘要 | 最近 5 轮 + Haiku 摘要 | **最近 5 轮完整 + Haiku 摘要旧消息** |
| Mastery 驱动 | 3 级 system prompt | 3 级 system prompt | fuzzy logic 连续变量 | **3 级 scaffold + fuzzy 过渡** |
| 知识注入 | — | — | Khanmigo RAG 模式 | **Specialist Markdown 作为 RAG 上下文注入** |
| 防无限追问 | — | — | 终止条件+合成节点+逃生阀 | **连续正确3次→总结，连续错误2次→降级解释** |

> **重大发现**：WebSearch 验证发现 Haiku 4.5（$1/$5）完全能胜任苏格拉底对话（回复天然较短 ~200 tokens），月成本从 Claude/GPT 估算的 $400-2,400 降至 **$3-6**（1000 MAU）。Sonnet 仅用于闪卡生成、计划规划等需要更强推理的批处理任务。

### 3.2 System Prompt 模板（3 级）

**Level 1: 引导者 (mastery < 0.3)**
```
你是一位耐心细致的大学教师，正在通过苏格拉底式对话帮助学生理解「{topic}」。

教学原则：
1. 绝不直接给出完整答案
2. 使用简单的类比和生活实例来解释抽象概念
3. 每次只推进一个小概念点
4. 当学生回答错误时，不说"不对"，而是用引导性问题帮助他们自己发现错误
5. 积极肯定学生的每一步正确思考
6. 如果学生连续困惑，可以给出部分提示或框架

当前学生状态：
- 知识掌握度：{mastery_pct}%（初学阶段）
- 已学概念：{learned_concepts}
- 薄弱点：{weak_areas}

专业知识参考：
{specialist_context}

对话风格：温和鼓励，步步引导，多用"让我们想想..."、"如果我们换个角度..."这样的过渡语。
回复控制：每次回复不超过 150 字，以一个引导性问题结尾。
```

**Level 2: 教练 (mastery 0.3-0.7)**
```
你是一位苏格拉底式教练，正在与学生深入探讨「{topic}」。

教学原则：
1. 先提问，观察学生思路，再根据回答方向引导
2. 使用"反例法"——给出一个看似合理但有微妙错误的说法，让学生辨析
3. 鼓励学生用自己的话重新表述概念
4. 适当引入跨模块的联系，帮助构建知识网络
5. 对于已掌握的部分快速跳过，聚焦薄弱环节

当前学生状态：
- 知识掌握度：{mastery_pct}%（发展阶段）
- 强项：{strong_areas}
- 薄弱点：{weak_areas}

专业知识参考：
{specialist_context}

对话风格：干脆直接，适度挑战，多用"你觉得为什么..."、"如果条件变了会怎样..."。
回复控制：每次回复不超过 120 字，以一个有深度的思考题结尾。
```

**Level 3: 挑战者 (mastery > 0.7)**
```
你是一位严格的学术导师，正在用苏格拉底式追问测试学生对「{topic}」的深层理解。

教学原则：
1. 几乎不给提示，只用尖锐的追问推动思考
2. 提出边界条件、特殊情况、反直觉的场景
3. 要求学生证明或反驳某个命题
4. 引入学科前沿或争议话题
5. 只有在学生明确请求帮助时才给极简提示

当前学生状态：
- 知识掌握度：{mastery_pct}%（精通阶段）
- 可以挑战的高阶概念：{advanced_topics}

专业知识参考：
{specialist_context}

对话风格：简洁犀利，纯提问式，多用"证明..."、"如何解释这个矛盾..."、"给出一个反例..."。
回复控制：每次回复不超过 80 字，纯粹以追问结尾。
```

### 3.3 后端关键代码

**`app/services/socratic_engine.py`**
```python
import anthropic
from app.core.config import settings
from app.models.conversation import Conversation, Message
from app.services.llm_client import get_anthropic_client

SCAFFOLD_LEVELS = {
    "guide": {"max_mastery": 0.3, "template": "level1_guide"},
    "coach": {"max_mastery": 0.7, "template": "level2_coach"},
    "challenger": {"max_mastery": 1.0, "template": "level3_challenger"},
}

def get_scaffold_level(mastery: float) -> str:
    if mastery < 0.3: return "guide"
    if mastery < 0.7: return "coach"
    return "challenger"

async def build_messages(
    conversation: Conversation,
    recent_messages: list[Message],
    summary_text: str | None,
    specialist_context: str,
) -> list[dict]:
    """构建发送给 Claude 的消息列表"""
    scaffold = get_scaffold_level(conversation.mastery)
    system_prompt = load_template(scaffold, {
        "topic": conversation.title,
        "mastery_pct": int(conversation.mastery * 100),
        "specialist_context": specialist_context[:3000],
        # ... 其他变量
    })

    messages = []
    if summary_text:
        messages.append({"role": "user", "content": f"[对话摘要] {summary_text}"})
        messages.append({"role": "assistant", "content": "好的，我已了解之前的讨论内容。请继续。"})

    for msg in recent_messages:
        messages.append({"role": msg.role, "content": msg.content})

    return system_prompt, messages

async def stream_socratic_response(
    conversation_id: str,
    user_message: str,
    db_session,
):
    """SSE 流式苏格拉底对话"""
    client = get_anthropic_client()
    conversation = await get_conversation(db_session, conversation_id)
    recent = await get_recent_messages(db_session, conversation_id, limit=16)

    # 检查是否需要摘要压缩
    if len(recent) >= 16:
        summary = await compress_old_messages(conversation, recent[:8])
        recent = recent[8:]
    else:
        summary = conversation.latest_summary

    system_prompt, messages = await build_messages(
        conversation, recent, summary, conversation.specialist_context
    )
    messages.append({"role": "user", "content": user_message})

    # 选择模型
    model = "claude-sonnet-4-5-20250514"
    try:
        async with client.messages.stream(
            model=model,
            system=system_prompt,
            messages=messages,
            max_tokens=512,
        ) as stream:
            full_text = ""
            async for text in stream.text_stream:
                full_text += text
                yield f"data: {json.dumps({'type': 'text', 'content': text})}\n\n"

            # 保存 assistant 消息
            await save_message(db_session, conversation_id, "assistant", full_text)
            # 更新 mastery（基于对话质量判断）
            yield f"data: {json.dumps({'type': 'done', 'mastery': conversation.mastery})}\n\n"

    except anthropic.APIError:
        # 降级到 Haiku
        model = "claude-haiku-4-5-20251001"
        # ... 相同逻辑
```

**`app/api/v1/chat.py`**
```python
from fastapi import APIRouter, Depends
from sse_starlette.sse import EventSourceResponse

router = APIRouter(prefix="/chat", tags=["chat"])

@router.post("/conversations/{conv_id}/messages")
async def send_message(
    conv_id: str,
    body: ChatMessageRequest,
    db=Depends(get_db),
    user=Depends(get_current_user),
):
    # 保存用户消息
    await save_message(db, conv_id, "user", body.content)

    # 返回 SSE 流
    return EventSourceResponse(
        stream_socratic_response(conv_id, body.content, db)
    )

@router.post("/conversations/{conv_id}/interrupt")
async def interrupt(conv_id: str, db=Depends(get_db)):
    """学生打断当前回复"""
    await mark_interrupted(db, conv_id)
    return {"status": "interrupted"}

@router.post("/conversations/{conv_id}/feedback")
async def feedback(conv_id: str, body: FeedbackRequest, db=Depends(get_db)):
    """👍/👎 反馈"""
    await save_feedback(db, conv_id, body.message_id, body.rating)
    return {"status": "ok"}
```

### 3.4 前端组件改造

**`src/components/workbench/SocraticChat.tsx` — 重写方案**

需要从当前的模板匹配改为 SSE 流式：

```tsx
// 关键改动点
const sendMessage = async (content: string) => {
  const abortController = new AbortController()
  setAbortController(abortController)

  const response = await fetch(`/api/v1/chat/conversations/${convId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ content }),
    signal: abortController.signal,
  })

  const reader = response.body!.getReader()
  const decoder = new TextDecoder()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = decoder.decode(value)
    // 解析 SSE data: {...} 格式
    for (const line of chunk.split('\n')) {
      if (line.startsWith('data: ')) {
        const data = JSON.parse(line.slice(6))
        if (data.type === 'text') {
          setStreamingText(prev => prev + data.content)
        } else if (data.type === 'done') {
          // 完成，更新 mastery 显示
        }
      }
    }
  }
}

// 打断按钮
const handleInterrupt = () => {
  abortController?.abort()
  fetch(`/api/v1/chat/conversations/${convId}/interrupt`, { method: 'POST' })
}
```

### 3.5 数据库表

```sql
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  course_id TEXT NOT NULL,
  module_id TEXT,
  title TEXT,
  mastery NUMERIC(4,3) NOT NULL DEFAULT 0.500,
  specialist_context TEXT,         -- 缓存的精讲 Markdown
  latest_summary_id UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL CHECK (role IN ('system','user','assistant')),
  content TEXT NOT NULL,
  seq INTEGER NOT NULL,
  model TEXT,                      -- claude-sonnet-4-5 / claude-haiku-4-5
  input_tokens INTEGER,
  output_tokens INTEGER,
  latency_ms INTEGER,
  interrupted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX idx_messages_conv_seq ON messages(conversation_id, seq);

CREATE TABLE conversation_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id),
  start_seq INTEGER NOT NULL,
  end_seq INTEGER NOT NULL,
  summary_text TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE feedback_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id),
  message_id UUID REFERENCES messages(id),
  user_id UUID NOT NULL,
  rating SMALLINT NOT NULL CHECK (rating IN (-1, 1)),
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 3.6 成本预估 (1000 MAU)

**WebSearch 验证后的修正估算**（使用 Haiku 4.5 做对话）：

| 方案 | 对话成本/月 | 批处理成本/月 | 总计 |
|------|-----------|-------------|------|
| **推荐：Haiku 对话 + Sonnet 批处理** | ~$1.2 | ~$1.5 | **~$3-4** |
| 全用 Sonnet | ~$3.7 | ~$1.5 | **~$5-6** |
| GPT-5 mini 对话 + GPT-5.2 批处理 | ~$0.4 | ~$1.0 | **~$1.5-2** |

> 注：之前 Claude/GPT 估算的 $400-2,400/月 是基于 Sonnet 做全部对话且过高估计了 token 消耗。实际苏格拉底式回复很短（~200 tokens），且 Haiku 完全能胜任教学引导。

**降本手段**：Prompt caching（system prompt 缓存节省 ~40%）、Haiku 做摘要、限制输出 tokens

---

## 4. 子系统 B：闪卡自进化系统

> 研究来源：Claude 深度研究 + GPT-5.4 验证 + WebSearch SuperMemo 20 Rules 对标

### 4.1 进化触发器 & 动作

| 触发条件 | 检测逻辑 | LLM 动作 | 模型 |
|---------|---------|---------|------|
| consecutiveAgain ≥ 3 | 复习后检查 | **拆分**为 2-3 张子卡 | Sonnet |
| consecutiveEasy ≥ 5 | 复习后检查 | **退役**，移出活跃池 | 无需 LLM |
| lapseRate > 50% (reps>10) | 定期检查 | **改写**问法 | Sonnet |
| 平均回答时间 > 15s | 复习后检查 | **添加助记提示** | Haiku |
| 相关卡片集体失败 | 批次完成后 | **补充前置知识卡** | Sonnet |

### 4.2 LLM Prompt 模板（拆分场景为例）

```python
SPLIT_PROMPT = """你是闪卡教学专家。学生在以下闪卡上连续 {again_count} 次回答"忘记"：

正面：{front}
背面：{back}
标签：{tags}

请将这张卡片拆分为 2-3 张更简单的子卡片，遵循 SuperMemo 最小信息原则：
1. 每张子卡只考查一个原子概念
2. 子卡之间有逻辑递进关系
3. 保持原有标签

以 JSON 格式返回：
{
  "reasoning": "拆分原因分析",
  "cards": [
    {"front": "...", "back": "...", "order": 1},
    {"front": "...", "back": "...", "order": 2}
  ]
}"""
```

### 4.3 质量控制（Claude + GPT 共识）

1. **最小信息原则**：每张卡只考一个知识点，LLM prompt 中强制要求
2. **去重**：TF-IDF 余弦相似度 > 0.85 视为重复，拒绝创建
3. **人工确认**：所有进化建议先进入 `pending` 状态，用户在 EvolutionPreviewCard 中确认/拒绝
4. **回滚**：保留 `evolution_logs` 记录原始卡片状态，支持撤销

### 4.4 后端 API

```
POST /api/v1/flashcards/evolution/detect
  → 输入：{ card_ids: string[] }
  → 输出：{ triggers: EvolutionTrigger[] }

POST /api/v1/flashcards/evolution/generate
  → 输入：{ trigger: EvolutionTrigger }
  → 输出：{ action: EvolutionAction, preview: CardPreview[] }

POST /api/v1/flashcards/evolution/apply
  → 输入：{ action_id: string, approved: boolean }
  → 输出：{ applied: boolean, new_cards?: FlashcardNote[] }

GET  /api/v1/flashcards/evolution/logs?course_id=...
  → 输出：{ logs: EvolutionLog[] }
```

### 4.5 数据库表

```sql
CREATE TABLE evolution_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  card_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  trigger_type TEXT NOT NULL,       -- split/retire/rewrite/add_hint/add_prerequisite
  trigger_data JSONB NOT NULL,      -- 触发时的卡片状态快照
  action_type TEXT NOT NULL,
  action_data JSONB NOT NULL,       -- LLM 生成的动作详情
  status TEXT NOT NULL DEFAULT 'pending',  -- pending/approved/rejected/applied
  original_card JSONB NOT NULL,     -- 原始卡片备份（支持回滚）
  created_at TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
```

### 4.6 前端组件

**`EvolutionPreviewCard`**: 显示进化建议，左侧原卡 → 右侧新卡对比
**`EvolutionBadge`**: DeckList 中显示待处理进化数量
**`EvolutionHistory`**: 历史记录列表，支持回滚

---

## 5. 子系统 C：材料分析 3-Agent 管道

> 研究来源：Claude 深度研究 + GPT-5.4 验证 + 已有 `docs/material-analysis-pipeline-spec.md`

### 5.1 技术选型（综合 Claude + GPT + WebSearch）

| 组件 | 选型 | 来源 |
|------|------|------|
| PDF 解析 | **pymupdf4llm** (主) + **pdfplumber** (表格) + **marker-pdf** (高保真回退) | Claude+GPT+WebSearch 三方一致 |
| 任务队列 | **Celery + Redis** | WebSearch 验证：chain/chord 天然适配多 Agent 串并混合管道 |
| 进度推送 | **sse-starlette** (非手写 StreamingResponse) | WebSearch 验证：处理断连、心跳等边界情况 |
| LLM | **Claude Sonnet 4.6** + Structured Outputs | Claude+GPT 一致 |
| 文件存储 | **MinIO** (开发) → **S3/R2** (生产)，统一 boto3 API | 三方一致 |

> **任务队列选型说明**：Claude 和 GPT 推荐 ARQ（轻量 async），但 WebSearch 对比研究发现 Celery 的 `chain()` / `chord()` 原语天然适配 Cartographer→Specialist(并行)→Examiner 的管道模式，且提供 Flower 监控面板、死信队列、定时任务（Celery Beat）。对于 2-10 分钟的长任务链，Celery 生态更成熟。

### 5.1.1 Specialist 并行化（WebSearch 发现的关键优化）

Cartographer 输出 N 个模块后，Specialist 应**并行**处理而非串行：

```python
from celery import chain, chord

def run_pipeline(pdf_path: str, course_id: str):
    # Step 1: Cartographer 串行
    # Step 2: Specialist 并行 (chord)
    # Step 3: Examiner 串行
    workflow = chain(
        cartographer_task.s(pdf_path, course_id),
        parallel_specialist.s(),   # chord 内部并行
        examiner_task.s(),
    )
    return workflow.apply_async()
```

### 5.2 三个 Agent 的职责

**Cartographer（规划者）**
- 输入：PDF Markdown 全文
- 输出：`DisassemblyPlan`（模块列表 + 页码范围 + 考点映射）
- Token 消耗：~5K input / ~2K output

**Specialist（精讲者）**
- 输入：单模块 PDF Markdown + DisassemblyPlan context
- 输出：精讲 Markdown（含 LaTeX、考试陷阱、自测题）
- Token 消耗：~8K input / ~4K output per module
- **并行执行**：多模块同时处理

**Examiner（出题者）**
- 输入：精讲 Markdown
- 输出：8-12 道结构化 MCQ（JSON Schema 强制）
- Token 消耗：~6K input / ~3K output

### 5.3 成本预估（每份 50 页课件）

| Agent | 调用次数 | Input tokens | Output tokens | 成本 |
|-------|---------|-------------|--------------|------|
| Cartographer | 1 | ~15K | ~3K | $0.06 |
| Specialist | ~6 模块 | ~48K | ~24K | $0.22 |
| Examiner | ~6 模块 | ~36K | ~18K | $0.16 |
| **合计** | | | | **~$0.44** |

### 5.4 详细规格

已有完整文档：`docs/material-analysis-pipeline-spec.md`（~80K 字）

---

## 6. 子系统 D：游戏化激励系统

> 研究来源：Claude 深度研究 + GPT-5.4 验证（GPT 读取了项目代码后对齐设计）

### 6.1 核心机制

**XP 获取规则**：
| 行为 | XP |
|------|-----|
| 完成闪卡复习（per card） | +3 |
| 复习评分 Good/Easy | +5 / +8 |
| 完成学习模块 | +20 |
| 完成考试模拟 | +30 |
| 连续学习第 N 天 | +5×N (封顶 +50) |
| 首次发现进化触发 | +10 |

**等级公式**：`required_xp(level) = 100 × level^1.5`
- Level 1: 0 XP
- Level 10: 3,162 XP
- Level 25: 12,500 XP
- Level 50: 35,355 XP

**Streak 机制**：
- 每自然日完成 ≥1 次有效学习 → streak +1
- 断签时：先消耗 streak_freeze（最多存 3 个）
- streak_freeze 获取：连续 7 天奖励 1 个

**成就系统**：
```python
ACHIEVEMENT_DEFINITIONS = [
    {"code": "first_review", "name": "初次复习", "trigger": "review_count >= 1", "xp": 10},
    {"code": "streak_7", "name": "连续7天", "trigger": "streak >= 7", "xp": 50},
    {"code": "streak_30", "name": "月度学霸", "trigger": "streak >= 30", "xp": 200},
    {"code": "mastery_80", "name": "精通之路", "trigger": "any_module_mastery >= 0.8", "xp": 100},
    {"code": "cards_100", "name": "百卡大师", "trigger": "total_reviews >= 100", "xp": 50},
    {"code": "evolution_first", "name": "进化先驱", "trigger": "evolution_applied >= 1", "xp": 30},
    {"code": "exam_ace", "name": "考试达人", "trigger": "mock_exam_score >= 90", "xp": 150},
]
```

### 6.2 后端 API

```
POST /api/v1/gamification/events         → 记录 XP 事件，返回升级/成就
GET  /api/v1/gamification/profile        → 当前等级/XP/streak
POST /api/v1/gamification/streak/check-in → 每日结算
GET  /api/v1/gamification/achievements   → 成就列表
POST /api/v1/gamification/freezes/purchase → 购买冻结
```

### 6.3 游戏化设计原则（WebSearch 研究验证）

| 原则 | 做法 | 避免 |
|------|------|------|
| XP 绑定真实学习 | 完成模块/测验/复习给 XP | 不给"仅登录"奖励 |
| Streak 防焦虑 | freeze 机制 + "和自己比"视图 | 不过度惩罚断签 |
| 成就有意义 | mastery 达标才给徽章 | 不堆砌无意义成就 |
| 庆祝克制 | 仅里程碑触发 confetti | 不是每个小动作都触发 |
| 排行榜可选 | 提供"个人进步"替代 | 不强制竞争（伤低水平学生） |

> 依据：PMC 2023 meta-analysis 效果量 g=0.822（大），但前提是"游戏元素与学习行为深度绑定"

### 6.4 前端组件

- **`GamificationHeader`**: 固定在顶部，显示 Level / XP bar / Streak 火焰
- **`XPToast`**: Framer Motion 弹出 `+N XP`
- **`AchievementDrawer`**: 侧边抽屉显示所有成就（已解锁/进行中/锁定）
- **`CelebrationLayer`**: `canvas-confetti` 升级/成就庆祝（颜色用 `['#A5192E', '#C49A2A', '#FFF8F0']` 匹配设计系统）

### 6.4 数据库表

```sql
CREATE TABLE gamification_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  total_xp INTEGER NOT NULL DEFAULT 0,
  current_level INTEGER NOT NULL DEFAULT 1 CHECK (current_level BETWEEN 1 AND 50),
  current_streak INTEGER NOT NULL DEFAULT 0,
  longest_streak INTEGER NOT NULL DEFAULT 0,
  streak_freeze_count INTEGER NOT NULL DEFAULT 0 CHECK (streak_freeze_count <= 3),
  last_activity_date DATE,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE xp_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  source_type TEXT NOT NULL,       -- review/session/exam/achievement
  source_id UUID,
  xp_delta INTEGER NOT NULL,
  meta JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE user_achievements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  achievement_code TEXT NOT NULL,
  unlocked_at TIMESTAMPTZ DEFAULT now(),
  progress JSONB,
  UNIQUE(user_id, achievement_code)
);
```

---

## 7. 子系统 E：真实学习统计

> 替代当前 `src/mocks/activities.ts` 的硬编码数据

### 7.1 数据源

从以下真实数据聚合：
- **FSRS reviewLogs** → 复习次数、正确率、时间
- **study_sessions** → 学习时长
- **module_mastery_snapshots** → 掌握度趋势

### 7.2 后端 API

```
GET /api/v1/analytics/overview?range=day|week|month
  → { todayMinutes, weekMinutes, monthMinutes, todayReviews, accuracy7d }

GET /api/v1/analytics/review-trend?days=30
  → [{ date, reviewCount, accuracy, studyMinutes }]

GET /api/v1/analytics/mastery-radar?course_id=...
  → [{ moduleName, masteryPct }]

GET /api/v1/analytics/activity-heatmap?days=365
  → [{ date, count, level }]  // 用于 react-activity-calendar
```

### 7.3 前端组件

| 组件 | 库 | 用途 |
|------|-----|------|
| `StudyStatsOverview` | 原生 | 今日/周/月统计卡片 |
| `AccuracyTrendChart` | **recharts** `AreaChart` | 30 天正确率趋势 |
| `CourseMasteryRadar` | **recharts** `RadarChart` | 各模块掌握度 |
| `LearningHeatmap` | **react-activity-calendar** | GitHub 风格热力图 |
| `StudyDistribution` | **recharts** `BarChart` | 课程间时间分布 |

### 7.4 数据库表

```sql
CREATE TABLE review_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  course_id TEXT NOT NULL,
  module_id TEXT,
  card_id TEXT NOT NULL,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 4),
  response_ms INTEGER,
  reviewed_at TIMESTAMPTZ NOT NULL,
  is_correct BOOLEAN GENERATED ALWAYS AS (rating >= 3) STORED
);

CREATE TABLE study_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  course_id TEXT NOT NULL,
  module_id TEXT,
  session_type TEXT NOT NULL,      -- review/read/practice/mock_exam
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ NOT NULL,
  duration_seconds INTEGER NOT NULL
);

CREATE TABLE mastery_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  course_id TEXT NOT NULL,
  module_id TEXT NOT NULL,
  mastery NUMERIC(5,4) NOT NULL,
  snapshot_date DATE NOT NULL
);
```

### 7.5 FSRS 考试模式调度（WebSearch 发现）

根据 StudyLess 的实现，FSRS 在考试模式下应动态调整 `desired_retention`：

```typescript
// src/lib/fsrs.ts 中增加
function getDesiredRetention(examDate: Date | null): number {
  if (!examDate) return 0.9       // 默认
  const daysLeft = differenceInDays(examDate, new Date())
  if (daysLeft > 14) return 0.85  // Maintenance：正常间隔
  if (daysLeft > 7) return 0.92   // Consolidation：缩短间隔
  return 0.95                      // Cram：密集复习
}
```

### 7.6 npm 依赖

```bash
npm install recharts @uiw/react-heat-map canvas-confetti --legacy-peer-deps
```

> 注：热力图用 `@uiw/react-heat-map` 替代 `react-activity-calendar`（WebSearch 验证：更活跃维护、颜色完全可自定义）
> 颜色映射：`['#F7F5F2', '#FDDEB5', '#E8A87C', '#C49A2A', '#A5192E']`（纸张色→红色主色）

---

## 8. 子系统 F：四阶段考试备考

> 基于 SQ3R + PQ4R 认知科学方法（Claude + GPT 一致推荐）

### 8.1 四个阶段

| 阶段 | 时间段 | 核心活动 | 时间占比 |
|------|-------|---------|---------|
| **Survey** | D-30 ~ D-21 | 诊断测验，识别盲点 | 70% 诊断 + 30% 复习 |
| **Learn** | D-20 ~ D-11 | 薄弱模块集中突破 | 60% 学习 + 25% 复习 + 15% 测验 |
| **Consolidate** | D-10 ~ D-4 | 闪卡强化 + 错题回顾 | 33% 闪卡 + 33% 错题 + 33% 混合测验 |
| **Sprint** | D-3 ~ D-0 | 模拟考试冲刺 | 60% 模拟卷 + 25% 复盘 + 15% 闪卡 |

### 8.2 动态时间分配

```python
def allocate_daily_minutes(days_left: int, weak_ratio: float) -> dict:
    """根据倒计时和薄弱比例动态分配每日学习时间"""
    base = 60 if days_left > 14 else 90 if days_left > 5 else 120
    phase = phase_by_days_left(days_left)

    if phase == "survey":
        return {"diagnostic": int(base*0.7), "review": int(base*0.3)}
    elif phase == "learn":
        learn_ratio = 0.6 + weak_ratio * 0.2  # 薄弱越多，学习时间越多
        return {"learn": int(base*learn_ratio), "review": base//4, "quiz": base//6}
    elif phase == "consolidate":
        return {"flashcards": base//3, "mistakes": base//3, "mixed_quiz": base - 2*(base//3)}
    else:  # sprint
        return {"mock_exam": int(base*0.6), "error_review": int(base*0.25), "flashcards": int(base*0.15)}
```

### 8.3 后端 API

```
POST /api/v1/exam-prep/plans                    → 创建考试计划
GET  /api/v1/exam-prep/plans/{course_id}        → 获取当前计划+阶段
POST /api/v1/exam-prep/plans/{id}/refresh       → 重算任务（mastery 变化后）
GET  /api/v1/exam-prep/plans/{id}/daily-agenda  → 今日备考任务
POST /api/v1/exam-prep/mock-exams/{id}/submit   → 提交模拟考试
GET  /api/v1/exam-prep/mock-exams/{id}/analysis → 错题分析
```

### 8.4 前端组件

- **`ExamPrepDashboard`**: 总览（当前阶段、倒计时、今日目标进度）
- **`PhaseStepper`**: 4 阶段横向步骤条
- **`BlindSpotScanPanel`**: Survey 阶段诊断结果
- **`WeakModuleFocusList`**: 按 `exam_weight × (1 - mastery)` 排序
- **`SprintSimulatorCard`**: 模拟卷入口，成绩趋势图

### 8.5 数据库表

```sql
CREATE TABLE exam_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  course_id TEXT NOT NULL,
  exam_date DATE NOT NULL,
  target_score INTEGER,
  current_phase TEXT NOT NULL DEFAULT 'survey',
  daily_minutes_target INTEGER NOT NULL DEFAULT 60,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE exam_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES exam_plans(id),
  phase TEXT NOT NULL,
  module_id TEXT,
  task_type TEXT NOT NULL,         -- diagnostic/deep_learn/flashcard/mock_exam/error_review
  title TEXT NOT NULL,
  estimated_minutes INTEGER NOT NULL,
  priority INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'todo'
);

CREATE TABLE mock_exam_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES exam_plans(id),
  score NUMERIC(5,2),
  duration_seconds INTEGER,
  mistakes JSONB DEFAULT '[]',
  taken_at TIMESTAMPTZ DEFAULT now()
);
```

---

## 9. 子系统 G：知识网络

### 9.1 数据结构

```
课程分类（数学/计算机/化学/物理...）
  └── 课程节点（离散数学/有机化学...）
       └── 学校节点（TUM/ETH/LMU...）
            └── 材料（课件/习题/笔记...）
```

### 9.2 搜索选型

| 方案 | 优势 | 劣势 | 最终 |
|------|------|------|------|
| PostgreSQL tsvector | 零额外依赖 | 中文分词差 | 初期可用 |
| **Meilisearch** | 中文好、typo-tolerant、易部署 | 额外服务 | **推荐** |
| Typesense | 性能好 | 中文分词配置复杂 | 备选 |

### 9.3 冷启动策略

1. 预置骨架：50+ 常见大学课程（数学、CS、物理、化学等）
2. 用户自建：搜索不到时可创建新课程节点
3. AI 归并：定期用 LLM 识别相似课程名，建议合并

### 9.4 数据库表

```sql
CREATE TABLE course_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  icon TEXT,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID REFERENCES course_categories(id),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  tags TEXT[] DEFAULT '{}',
  material_count INTEGER DEFAULT 0,
  student_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE school_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES courses(id),
  school_name TEXT NOT NULL,
  semester TEXT,                    -- "WS2025/26"
  professor TEXT,
  student_count INTEGER DEFAULT 0,
  UNIQUE(course_id, school_name, semester)
);

CREATE TABLE materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES courses(id),
  school_node_id UUID REFERENCES school_nodes(id),
  uploader_id UUID NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL,               -- lecture/exercise/exam/notes
  file_key TEXT NOT NULL,           -- S3/R2 object key
  file_size_bytes BIGINT,
  page_count INTEGER,
  visibility TEXT DEFAULT 'course', -- course/school/private
  analysis_status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 9.5 前端可视化

- **列表视图**（默认）：分类 → 课程卡片网格
- **图谱视图**（高级）：`react-force-graph-2d`，节点 = 课程，边 = 标签关联
- 搜索栏：Meilisearch instant search，支持拼音/模糊匹配

---

## 10. 子系统 H：文件上传+云存储

### 10.1 选型（Claude + GPT 共识）

| 方案 | 成本 | 优势 | 最终 |
|------|------|------|------|
| AWS S3 | 标准 | 最成熟 | 备选 |
| **Cloudflare R2** | 免出口费 | PDF 下载量大时省钱 | **推荐** |
| MinIO | 免费 | 本地开发 | **开发阶段** |

### 10.2 上传流程

```
< 10MB: 前端 → 后端直传 → MinIO/R2
≥ 10MB: 前端 → presigned URL → 分片直传 MinIO/R2 → 回调确认
```

1. `POST /api/v1/materials/upload/presign` → 返回 presigned URL（大文件分片）
2. 前端直传到 R2/MinIO（`useChunkedUpload` Hook，支持 pause/resume）
3. `POST /api/v1/materials/upload/confirm` → 后端记录元数据 + SHA-256 去重

### 10.3 后端 API

```
POST /api/v1/materials/upload/presign   → { presigned_url, object_key }
POST /api/v1/materials/upload/confirm   → { material_id }
GET  /api/v1/materials/{id}/download    → 302 redirect to presigned GET URL
DELETE /api/v1/materials/{id}
```

### 10.4 前端组件

- **`DropZone`**（已有，需改造）: 从 base64 localStorage → presigned URL 直传
- 文件类型校验：PDF/DOCX/PPTX，max 50MB
- 上传进度条（XHR `progress` 事件）

---

## 11. 子系统 I：用户认证

### 11.1 方案

- **JWT Access Token**: 15 分钟有效期
- **Refresh Token**: 7 天，HttpOnly cookie
- **第三方登录**: Google OAuth2（优先）+ 微信（后期）

### 11.2 后端实现

```python
# app/core/security.py
from jose import jwt
from argon2 import PasswordHasher  # argon2id: 比 bcrypt 更抗 GPU/ASIC

ph = PasswordHasher()  # argon2id 默认参数已足够安全

def create_access_token(user_id: str) -> str:
    expire = datetime.utcnow() + timedelta(minutes=15)
    return jwt.encode({"sub": user_id, "exp": expire}, SECRET_KEY, algorithm="HS256")

def create_refresh_token(user_id: str) -> str:
    expire = datetime.utcnow() + timedelta(days=7)
    return jwt.encode({"sub": user_id, "exp": expire, "type": "refresh"}, SECRET_KEY)
```

### 11.3 API

```
POST /api/v1/auth/register          → 注册
POST /api/v1/auth/login             → 登录（返回 access + refresh）
POST /api/v1/auth/refresh           → 刷新 access token
POST /api/v1/auth/logout            → 注销（黑名单 refresh）
GET  /api/v1/auth/google/authorize  → Google OAuth2 跳转
GET  /api/v1/auth/google/callback   → Google 回调
GET  /api/v1/users/me               → 当前用户信息
```

### 11.4 数据库表

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE,
  password_hash TEXT,               -- NULL for OAuth-only users
  name TEXT NOT NULL,
  avatar_url TEXT,
  auth_provider TEXT DEFAULT 'email', -- email/google/wechat
  provider_id TEXT,                 -- OAuth provider's user ID
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 11.5 前端

- **`AuthContext`**: React Context 管理 token 状态
- **`ProtectedRoute`**: 路由守卫，未登录跳转 `/auth/login`
- **`LoginPage`** / **`RegisterPage`**: 表单 + Google 按钮

---

## 12. 子系统 J：跨设备数据同步

### 12.1 同步数据

| 数据 | 策略 | 冲突解决 |
|------|------|---------|
| 闪卡 FSRS 状态 | Delta sync (timestamp) | **Last-Write-Wins** |
| 学习进度 | Delta sync | LWW |
| 笔记/批注 | Delta sync | LWW（后期考虑 CRDT） |
| 日程 | Delta sync | LWW |
| 用户设置 | 全量覆盖 | LWW |

### 12.2 增量同步 API

```
POST /api/v1/sync/push
  → { entity_type, changes: [{id, data, updated_at}] }
  → { accepted: number, conflicts: [{id, server_version}] }

GET /api/v1/sync/pull?since={timestamp}&entity_type=flashcards
  → { changes: [{id, data, updated_at}], server_time }
```

### 12.3 离线支持

- **IndexedDB**: 使用 `idb` 库作为本地缓存
- **Service Worker**: 缓存静态资源 + 队列离线操作
- 上线时自动 push 离线期间的变更

### 12.4 数据库表

```sql
CREATE TABLE sync_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  entity_type TEXT NOT NULL,       -- flashcard/note/agenda/setting
  entity_id TEXT NOT NULL,
  data JSONB NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted BOOLEAN DEFAULT FALSE,
  UNIQUE(user_id, entity_type, entity_id)
);
CREATE INDEX idx_sync_user_type_time ON sync_ledger(user_id, entity_type, updated_at);
```

---

## 13. 统一数据库 Schema 总览

共 **22 张表**，按域分组：

| 域 | 表数量 | 表名 |
|----|-------|------|
| 用户认证 | 2 | users, refresh_tokens |
| 知识网络 | 3 | course_categories, courses, school_nodes |
| 材料 | 1 | materials |
| 对话 | 4 | conversations, messages, conversation_summaries, feedback_events |
| 闪卡 | 3 | flashcard_notes, flashcard_cards, evolution_logs |
| 复习 | 2 | review_logs, study_sessions |
| 分析 | 1 | mastery_snapshots |
| 游戏化 | 3 | gamification_profiles, xp_events, user_achievements |
| 备考 | 3 | exam_plans, exam_tasks, mock_exam_attempts |
| 同步 | 1 | sync_ledger |

---

## 14. 开发排期与优先级

### Sprint 1（Week 1-2）：基础设施 + 认证
> 所有后续功能的基础

- [x] 后端项目骨架（FastAPI + SQLAlchemy + Alembic）
- [x] Docker Compose（PostgreSQL + Redis + MinIO）
- [x] 用户认证（JWT + Google OAuth2）
- [x] 前端 AuthContext + 路由守卫
- [x] 文件上传 presigned URL 流程

### Sprint 2（Week 3-4）：材料分析管道
> 核心价值——把 PDF 变成结构化学习内容

- [ ] pymupdf4llm PDF 解析
- [ ] Cartographer → Specialist → Examiner 3-Agent
- [ ] ARQ 异步任务 + Redis Pub/Sub
- [ ] 前端 SSE 进度条 + 结果渲染
- [ ] 前端从 mock 数据切换到真实 API

### Sprint 3（Week 5-6）：苏格拉底对话 + 闪卡进化
> AI 驱动的核心学习体验

- [ ] 苏格拉底对话后端（Claude SSE）
- [ ] 3 级 scaffold system prompt
- [ ] 对话历史摘要压缩
- [ ] 闪卡进化后端（5 种触发器 + LLM 动作）
- [ ] 前端 SocraticChat 重写 + EvolutionPreview

### Sprint 4（Week 7-8）：统计 + 游戏化 + 备考
> 激励留存 + 考试场景

- [ ] 真实学习统计 API + recharts 图表
- [ ] 游戏化系统（XP/等级/streak/成就）
- [ ] 四阶段考试备考
- [ ] HomePage 从 mock 切换到真实数据

### Sprint 5（Week 9-10）：知识网络 + 同步 + 打磨
> 社区功能 + 跨设备

- [ ] 知识网络 CRUD + Meilisearch 搜索
- [ ] 跨设备 Delta sync
- [ ] IndexedDB 离线缓存
- [ ] 全链路测试 + 性能优化

### 依赖图

```
Sprint 1 (认证+上传)
    ↓
Sprint 2 (材料管道) ──→ Sprint 3 (对话+进化)
    ↓                        ↓
Sprint 4 (统计+游戏化+备考) ←─┘
    ↓
Sprint 5 (网络+同步+打磨)
```

---

## 15. 成本预估

### 月度成本（1000 MAU）

| 项目 | 低 | 中 | 高 |
|------|-----|-----|-----|
| 苏格拉底对话 LLM (Haiku) | $1 | $3 | $6 |
| 批处理 LLM (Sonnet: 闪卡/计划) | $2 | $5 | $15 |
| 材料分析 LLM (Sonnet) | $44 | $132 | $440 |
| 闪卡进化 LLM | $10 | $30 | $100 |
| Cloudflare R2 存储 | $5 | $15 | $50 |
| 服务器（2 vCPU） | $20 | $40 | $80 |
| PostgreSQL | $15 | $30 | $60 |
| Redis | $10 | $20 | $40 |
| Meilisearch | $0 | $0 | $30 |
| **合计** | **~$107** | **~$275** | **~$821** |

> 对话成本从之前估算的 $400-2,400 降至 $1-6（WebSearch 验证：Haiku 4.5 完全胜任苏格拉底式教学对话）

### 降本策略

1. **Prompt caching**: 对话 system prompt 缓存（节省 ~40%）
2. **Haiku 降级**: 摘要、简单任务用 Haiku（成本 1/3）
3. **批处理 API**: 材料分析用 Anthropic Batch API（成本 50%）
4. **本地缓存**: 前端缓存精讲 Markdown，减少重复请求

---

## 附录 A：npm 新增依赖

```bash
npm install recharts react-activity-calendar canvas-confetti idb --legacy-peer-deps
npm install -D @types/canvas-confetti
```

## 附录 B：Python 后端依赖

```txt
# requirements.txt
fastapi>=0.115.0
uvicorn[standard]>=0.34.0
sqlalchemy[asyncio]>=2.0.36
asyncpg>=0.30.0
alembic>=1.14.0
pydantic-settings>=2.7.0
python-jose[cryptography]>=3.3.0
argon2-cffi>=23.1.0     # argon2id 密码哈希（比 bcrypt 更安全）
anthropic>=0.47.0
celery[redis]>=5.4.0
flower>=2.0.0              # Celery 监控面板
redis>=5.2.0
sse-starlette>=2.2.0
python-multipart>=0.0.19
httpx>=0.28.0
boto3>=1.36.0           # S3/R2 兼容
pymupdf4llm>=0.0.17
pdfplumber>=0.11.0
meilisearch>=0.33.0
```

## 附录 C：环境变量

```bash
# .env
DATABASE_URL=postgresql+asyncpg://zhijie:zhijie@localhost:5436/zhijie
REDIS_URL=redis://localhost:6383
ANTHROPIC_API_KEY=sk-ant-xxx
JWT_SECRET_KEY=your-256-bit-secret
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxx
R2_ENDPOINT_URL=https://xxx.r2.cloudflarestorage.com
R2_ACCESS_KEY=xxx
R2_SECRET_KEY=xxx
R2_BUCKET_NAME=zhijie-materials
MEILI_URL=http://localhost:7700
MEILI_MASTER_KEY=xxx
```
