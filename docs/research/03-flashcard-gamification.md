# 03 — 闪卡系统深度集成 + 学术游戏化框架

> 研究日期：2026-03-18
> 前置文档：`docs/workbench-audit-2026-03-17.md`、`CLAUDE.md` 闪卡/日程章节
> 范围：FSRS 深度集成、AI 自进化、Scholar Rank 游戏化、社交学习

---

## A. FSRS 深度集成方案

### A.1 当前实现状态分析

`src/lib/fsrs.ts` 已完成以下基础层：

| 模块 | 状态 | 说明 |
|------|------|------|
| 类型定义 | ✅ 完成 | `FlashcardNote`、`FlashcardCard`、`FlashcardDeck`、`FlashcardReviewLog` 完整定义 |
| 调度引擎 | ✅ 完成 | 单例 `FSRS` 实例，`getSchedulingChoices()` 返回四档调度结果 |
| 卡片创建 | ✅ 完成 | `createFlashcard(noteId)` 基于 `createEmptyCard()` |
| 复习处理 | ✅ 完成 | `reviewCard()` 应用评分并返回更新后的 Card + ReviewLog |
| 持久化 | ✅ 完成 | localStorage 按 courseId 分 deck 存储 |
| 显示辅助 | ✅ 完成 | `formatInterval()`、`stateLabel()`、`ratingLabel()`、`ratingColor()` |
| ReviewSession 组件 | ✅ 完成 | FSRS 驱动的复习流程，含 BKT 反馈和进化检测 |
| FlashcardCard 组件 | ✅ 完成 | Framer Motion 翻转动效，Editorial Academic 风格 |

**关键缺口**：

1. **闪卡生成入口未实现** — `MaterialReader` 的 `onGenerateFlashcards` prop 存在但未接通
2. **后端 API 缺失** — 无 `/api/v1/tools/flashcard-generate` 端点
3. **四条生成路径未建立** — 精讲/错题/对话/标注均无卡片生成逻辑
4. **Deck 管理粗糙** — `loadAllDecks()` 遍历全部 localStorage key，无索引

### A.2 闪卡生成的四条路径

#### 路径 1：精讲 Markdown → 闪卡

从 Specialist Agent 的精讲输出中提取知识点。

```typescript
// src/lib/flashcard-generator.ts

interface GenerateFromMarkdownParams {
  markdown: string
  moduleId: string
  materialId: string
  courseName: string
}

/**
 * 后端 API 调用：将精讲 Markdown 发送给 LLM，提取知识点生成闪卡。
 * 返回的 FlashcardNote[] 包含 basic / cloze / reverse 三种类型。
 */
async function generateFromMarkdown(
  params: GenerateFromMarkdownParams
): Promise<FlashcardNote[]> {
  const res = await fetch('/api/v1/tools/flashcard-generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: 'specialist-markdown',
      content: params.markdown,
      moduleId: params.moduleId,
      materialId: params.materialId,
      options: {
        maxCards: 15,
        types: ['basic', 'cloze', 'reverse'],
        difficulty: 'adaptive', // 根据 BKT mastery 调整
      },
    }),
  })
  return res.json()
}
```

LLM Prompt 设计（精讲 → 卡片）：

```
你是一位教育学专家，请从以下精讲内容中提取关键知识点，生成间隔重复闪卡。

规则：
1. 每张卡片只测试一个原子概念
2. 公式/定义用 cloze 格式：{{c1::答案}}
3. 术语映射用 reverse 格式（生成正反两张卡）
4. 避免"是什么"类万能问题，要求具体的操作性回忆
5. 输出 JSON 数组，每个元素符合 FlashcardNote schema

精讲内容：
{markdown}

模块：{moduleName}
```

#### 路径 2：错题 → 闪卡

Quiz 答错时自动提取错题要点。

```typescript
// 在 QuizPanel 组件中，答错后触发
function generateFromWrongAnswer(
  question: MCQuestion,
  selectedOption: string,
  correctOption: string,
  moduleId: string,
  materialId: string,
): FlashcardNote {
  return {
    id: `note-quiz-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: 'basic',
    fields: {
      front: question.question,
      back: correctOption,
      extra: `你选了「${selectedOption}」。易错点：${question.explanation ?? '注意区分相似概念'}`,
    },
    tags: ['quiz-error', moduleId],
    sourceRef: { materialId, moduleId },
    createdAt: Date.now(),
    generatedBy: 'ai',
  }
}
```

#### 路径 3：Socratic 对话 → 闪卡

对话中出现关键理解突破时，自动或手动生成卡片。

```typescript
// 对话消息中检测到概念澄清时，显示"保存为闪卡"按钮
interface DialogueTurnForCard {
  userQuestion: string
  aiClarification: string
  conceptTag: string
}

function generateFromDialogue(
  turn: DialogueTurnForCard,
  moduleId: string,
  materialId: string,
): FlashcardNote {
  return {
    id: `note-dialogue-${Date.now()}`,
    type: 'basic',
    fields: {
      front: turn.userQuestion,
      back: turn.aiClarification,
      extra: `来自苏格拉底对话 · ${turn.conceptTag}`,
    },
    tags: ['dialogue', turn.conceptTag],
    sourceRef: { materialId, moduleId },
    createdAt: Date.now(),
    generatedBy: 'ai',
  }
}
```

#### 路径 4：PDF 标注 → 闪卡

用户在 PdfAnnotator 中高亮的内容，转化为闪卡。

```typescript
// PdfAnnotator 的高亮数据结构已有 content.text
// 新增"生成闪卡"操作到标注工具栏

function generateFromHighlight(
  highlightText: string,
  comment: string | undefined,
  slidePage: number,
  materialId: string,
): FlashcardNote {
  return {
    id: `note-highlight-${Date.now()}`,
    type: 'cloze',
    fields: {
      front: highlightText.length > 80
        ? `在以下段落中，关键概念是什么？\n${highlightText}`
        : `{{c1::${highlightText}}}`, // 短文本直接做 cloze
      back: highlightText,
      extra: comment ?? undefined,
    },
    tags: ['pdf-highlight'],
    sourceRef: { materialId, slidePage },
    createdAt: Date.now(),
    generatedBy: 'user',
  }
}
```

### A.3 后端 API 设计

```
POST /api/v1/tools/flashcard-generate
```

**请求体**：

```json
{
  "source": "specialist-markdown" | "quiz-error" | "dialogue" | "highlight" | "batch",
  "content": "<原始文本>",
  "moduleId": "mod-001",
  "materialId": "mat-abc",
  "options": {
    "maxCards": 15,
    "types": ["basic", "cloze", "reverse"],
    "difficulty": "adaptive",
    "existingCardFronts": ["已有卡片正面文本..."]  // 去重
  }
}
```

**响应体**：

```json
{
  "notes": [
    {
      "id": "note-gen-xxx",
      "type": "cloze",
      "fields": { "front": "...", "back": "...", "extra": "..." },
      "tags": ["module-001", "definition"],
      "sourceRef": { "materialId": "mat-abc", "moduleId": "mod-001" },
      "generatedBy": "ai"
    }
  ],
  "meta": {
    "model": "glm-4-flash",
    "tokensUsed": 1200,
    "generationTimeMs": 3400
  }
}
```

**后端实现要点**：
- 使用 Z.AI GLM 模型（与现有管道一致）
- 去重逻辑：对比 `existingCardFronts` 的语义相似度（embedding cosine > 0.85 则跳过）
- 批量模式（`source: "batch"`）：一次性从完整精讲生成所有模块的卡片

### A.4 FlashcardDrill 前端组件设计

在 WorkbenchPage 的 MaterialReader 中新增 `flashcard` 标签页，嵌入轻量复习组件。

```typescript
// src/components/workbench/FlashcardDrill.tsx
// 与独立 ReviewSession 不同，这是嵌入式的"快速练习"版本

interface FlashcardDrillProps {
  notes: FlashcardNote[]
  courseId: string
  /** 练习完成回调，传回评分数据 */
  onDrillComplete: (ratings: Record<1 | 2 | 3 | 4, number>) => void
}

// 关键设计差异（vs ReviewSession）：
// 1. 嵌入 70% 区域，非全页
// 2. 最多 10 张卡（不做完整 deck 复习）
// 3. 无 CompletionScreen，仅显示 inline 统计
// 4. 翻转动效保持一致（perspective: 1200, rotateY 180°）
```

### A.5 ReviewSession FSRS 驱动流程

当前 `ReviewSession.tsx` 已实现完整流程，以下是其核心步骤的补充说明：

```
1. 初始化
   ├─ 从 deck 中筛选 dueCards（card.due <= now）
   ├─ 加载 BKT profile 快照（用于 session 结束时计算 mastery 变化）
   └─ 初始化 evolutionQueue（收集自进化建议）

2. 逐卡复习循环
   ├─ 显示 FlashcardCard（正面）
   ├─ 用户点击翻转 → 显示答案
   ├─ 显示 4 个评分按钮（忘记/困难/记得/简单）
   │   每个按钮显示预计下次复习间隔（formatInterval）
   ├─ 用户评分 →
   │   ├─ reviewCard(card, rating) → 更新 FSRS 状态
   │   ├─ 更新 consecutiveAgain / consecutiveEasy 计数器
   │   ├─ 追加 reviewLog
   │   ├─ saveDeck(deck) → localStorage 持久化
   │   ├─ processFeedback(profile, signal) → BKT mastery 更新
   │   ├─ detectTriggers(card, deck) → 检查自进化条件
   │   └─ 统计 ratings 分布 + 总耗时
   └─ 下一张 / 完成

3. 完成 → CompletionScreen
   ├─ 评分分布饼图
   ├─ mastery 变化（before → after）
   ├─ 自进化建议列表（可一键应用）
   └─ 返回 DeckList
```

### A.6 数据持久化迁移路径

| 阶段 | 存储方式 | 数据量上限 | 适用场景 |
|------|---------|-----------|---------|
| **Phase 1（当前）** | localStorage | ~5MB/域 | 单设备开发/Demo |
| **Phase 2** | IndexedDB | ~50MB+ | 单设备大量卡片 |
| **Phase 3** | 后端 PostgreSQL + 本地缓存 | 无限 | 跨设备同步 |

**Phase 2 迁移（IndexedDB）**：

```typescript
// src/lib/flashcard-storage.ts

import { openDB, type IDBPDatabase } from 'idb'

const DB_NAME = 'zhijie-flashcards'
const DB_VERSION = 1

async function getDB(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // Notes store
      const noteStore = db.createObjectStore('notes', { keyPath: 'id' })
      noteStore.createIndex('courseId', 'sourceRef.materialId')
      noteStore.createIndex('tags', 'tags', { multiEntry: true })

      // Cards store
      const cardStore = db.createObjectStore('cards', { keyPath: 'id' })
      cardStore.createIndex('noteId', 'noteId')
      cardStore.createIndex('due', 'card.due')

      // Review logs store
      const logStore = db.createObjectStore('reviewLogs', { keyPath: ['cardId', 'reviewedAt'] })
      logStore.createIndex('cardId', 'cardId')
    },
  })
}
```

**Phase 3 后端 API**：

```
GET    /api/v1/flashcards/decks                  → 所有 deck 列表
GET    /api/v1/flashcards/decks/:courseId         → 单个 deck 详情
POST   /api/v1/flashcards/decks/:courseId/notes   → 批量添加 notes
PUT    /api/v1/flashcards/cards/:cardId/review    → 提交复习评分
GET    /api/v1/flashcards/due?courseId=xxx        → 获取到期卡片
POST   /api/v1/flashcards/sync                   → 本地 ↔ 服务端同步
```

同步策略采用 **last-write-wins + conflict log**：每个 card 附带 `updatedAt` 时间戳，冲突时保留较新版本，同时将被覆盖版本写入 conflict log 供用户手动解决。

---

## B. AI 自进化闪卡系统

### B.1 当前实现状态

`src/lib/card-evolution.ts` 已实现以下模块：

| 功能 | 状态 | 说明 |
|------|------|------|
| 触发检测 | ✅ 完成 | `detectTriggers()` 检查 4 种条件 |
| Mock LLM 动作 | ✅ 完成 | `splitNote()`、`rewriteNote()`、`generateHint()` 为模板生成 |
| 建议生成 | ✅ 完成 | `generateSuggestion()` 组合 trigger + action + description |
| 进化应用 | ✅ 完成 | `applyEvolution()` 修改 deck（拆分/退役/改写/加提示） |
| 日志持久化 | ✅ 完成 | `EvolutionLog` 按 courseId 存储在 localStorage |
| ReviewSession 集成 | ✅ 完成 | 复习结束后在 CompletionScreen 显示建议 |

**关键缺口**：

1. **第 5 个触发条件未实现** — "相关卡片集体失败 → 补充前置卡"
2. **Mock LLM 而非真实 LLM** — `splitNote()` 等使用简单字符串操作，非 LLM 生成
3. **无用户审核机制** — 自进化建议在 CompletionScreen 显示但无"应用/拒绝"交互

### B.2 五个触发条件的完整实现

#### 触发 1：consecutiveAgain >= 3 → 拆分为子卡

已有检测逻辑。需升级 `splitNote()` 为 LLM 调用：

```typescript
// LLM Prompt: 拆分难卡
const SPLIT_PROMPT = `
你是记忆科学专家。学生对以下闪卡连续 {count} 次点击"忘记"，说明概念粒度过大。
请将这张卡片拆分为 2-3 张更简单的子卡片，每张只测试一个原子知识点。

原始卡片：
正面：{front}
背面：{back}
标签：{tags}

要求：
1. 子卡片应覆盖原卡片的所有要点
2. 每张子卡片的背面不超过 30 字
3. 如果原卡片涉及多步骤推理，按步骤拆分
4. 保持 sourceRef 不变，tags 中添加 "ai-split"
5. 输出 JSON 数组，符合 FlashcardNote schema
`
```

#### 触发 2：consecutiveEasy >= 5 → 退役

已完成。退役逻辑直接从 `cards` 数组中移除（保留 note 用于历史查询）。

可选增强：退役前询问用户是否合并为更高层级的综合卡。

#### 触发 3：lapse_rate > 50%（reps >= 10） → 改写问法

```typescript
// LLM Prompt: 改写问法
const REWRITE_PROMPT = `
学生在以下闪卡上的遗忘率高达 {lapseRate}%（{totalReps} 次复习中 {lapses} 次忘记）。
问题可能出在提问方式不利于记忆。请用不同的认知角度重新表述。

当前卡片：
正面：{front}
背面：{back}
类型：{type}

改写策略（按优先级选择一种）：
1. 从"定义提问"改为"应用场景提问"
2. 从"抽象概念"改为"具体例子"
3. 添加类比或视觉化线索
4. 如果是 cloze，改变遮挡位置
5. 如果涉及公式，改为"推导第 N 步"的形式

输出 JSON：{ "front": "...", "back": "..." }
`
```

#### 触发 4：averageResponseMs > 15000 → 加提示

```typescript
// LLM Prompt: 生成记忆辅助提示
const HINT_PROMPT = `
学生对以下闪卡平均回答时间 {avgSeconds} 秒（阈值 15 秒），说明检索困难但并非完全遗忘。
请生成一条简洁的记忆提示（助记词、首字母缩写、图像联想等）。

卡片正面：{front}
卡片背面：{back}
知识领域：{tags}

要求：
1. 提示不能直接包含答案
2. 使用助记术（谐音、故事、首字母等）
3. 如果是公式，提供推导的关键起始步
4. 不超过 50 字
5. 输出纯文本字符串
`
```

#### 触发 5（新增）：相关卡片集体失败 → 补充前置卡

```typescript
// src/lib/card-evolution.ts 新增

interface GroupFailureTrigger {
  type: 'group-failure'
  moduleId: string
  failedCardIds: string[]
  failedNoteIds: string[]
  failureRate: number
}

/**
 * 检测同一模块下多张卡片集体失败。
 * 条件：同一 moduleId 下 >=3 张卡在最近 5 次复习中 lapse_rate > 60%。
 */
function detectGroupFailure(deck: FlashcardDeck): GroupFailureTrigger[] {
  // 按 moduleId 分组
  const moduleCards = new Map<string, FlashcardCard[]>()
  for (const card of deck.cards) {
    const note = deck.notes.find(n => n.id === card.noteId)
    const modId = note?.sourceRef.moduleId
    if (modId) {
      const group = moduleCards.get(modId) ?? []
      group.push(card)
      moduleCards.set(modId, group)
    }
  }

  const triggers: GroupFailureTrigger[] = []

  for (const [moduleId, cards] of moduleCards) {
    const failedCards = cards.filter(card => {
      const recentLogs = deck.reviewLogs
        .filter(l => l.cardId === card.id)
        .slice(-5)
      if (recentLogs.length < 3) return false
      const lapses = recentLogs.filter(l => l.rating === 1).length
      return lapses / recentLogs.length > 0.6
    })

    if (failedCards.length >= 3) {
      triggers.push({
        type: 'group-failure',
        moduleId,
        failedCardIds: failedCards.map(c => c.id),
        failedNoteIds: failedCards.map(c => c.noteId),
        failureRate: failedCards.length / cards.length,
      })
    }
  }

  return triggers
}
```

LLM Prompt（补充前置卡）：

```
以下模块的 {failedCount} 张闪卡集体失败（遗忘率 > 60%），说明学生缺乏前置知识。

失败卡片内容：
{failedCardsJson}

模块名称：{moduleName}
课程：{courseName}

请分析这些卡片共同依赖的基础概念，生成 2-4 张前置知识闪卡：
1. 每张卡片测试一个基础概念（如术语定义、基本原理、前置公式）
2. 难度应低于失败卡片
3. tags 中添加 "prerequisite"
4. 输出 JSON 数组，符合 FlashcardNote schema
```

### B.3 LLM 调用统一封装

```typescript
// src/lib/evolution-llm.ts

type EvolutionLLMAction = 'split' | 'rewrite' | 'add-hint' | 'prerequisite'

interface EvolutionLLMRequest {
  action: EvolutionLLMAction
  card: { front: string; back: string; type: string; tags: string[] }
  context: Record<string, unknown>  // 触发条件的具体数据
}

/**
 * 调用后端 LLM 执行自进化动作。
 * 后端负责 prompt 组装 + LLM 调用 + 结果校验。
 */
async function callEvolutionLLM(
  req: EvolutionLLMRequest
): Promise<FlashcardNote[] | { front: string; back: string } | string> {
  const res = await fetch('/api/v1/tools/flashcard-evolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  return res.json()
}
```

### B.4 自进化日志追踪

当前 `EvolutionLog` 已有基础结构。增强方案：

```typescript
// 增强后的 EvolutionLog
interface EvolutionLogV2 extends EvolutionLog {
  /** 用户是否接受了建议 */
  accepted: boolean | null   // null = 未响应
  /** LLM 使用的 prompt 版本 */
  promptVersion: string
  /** 应用前后的卡片快照（用于回滚） */
  beforeSnapshot?: { front: string; back: string }
  afterSnapshot?: { front: string; back: string }
  /** 应用后的效果追踪 */
  postApplyMetrics?: {
    reviewsAfter: number
    lapseRateAfter: number
    avgResponseMsAfter: number
  }
}
```

自进化仪表板（`/my/flashcards/evolution`）展示：
- 总进化次数、各类型分布
- 成功率（应用后 lapse_rate 是否下降）
- 被拒绝最多的建议类型（指导 prompt 优化）

---

## C. 学术游戏化框架（Scholar Rank）

### C.1 设计哲学

智阶的游戏化必须服从"学术期刊"美学，杜绝幼稚化元素：

| 幼稚化（禁止） | 学术化（采用） |
|---------------|---------------|
| 卡通徽章、星星雨 | 学位衔级、期刊配色 |
| "恭喜升级！" 弹窗 | 衬线体通知条 |
| 经验条 + 数字等级 | 学术 milestone |
| 随机掉落奖励 | 确定性成就路径 |
| 霓虹色 / 渐变 | 金色 (`#C49A2A`) + 红色 (`#A5192E`) |

### C.2 等级体系：Scholar Rank

```typescript
// src/lib/scholar-rank.ts

type ScholarRank =
  | 'freshman'      // 新生
  | 'sophomore'     // 学者
  | 'bachelor'      // 学士
  | 'master'        // 硕士
  | 'doctor'        // 博士
  | 'professor'     // 教授

interface RankDefinition {
  rank: ScholarRank
  label: string
  labelEn: string
  /** 升级所需总 XP（累计） */
  xpThreshold: number
  /** 升级所需最低连续天数 */
  minStreakDays: number
  /** 升级所需最低课程掌握数（mastery > 0.6） */
  minCourseMastery: number
  /** 配色 — 用于 rank badge */
  color: string
  /** 装饰元素 */
  ornament: string
}

const RANK_DEFINITIONS: RankDefinition[] = [
  {
    rank: 'freshman',
    label: '新生',
    labelEn: 'Freshman',
    xpThreshold: 0,
    minStreakDays: 0,
    minCourseMastery: 0,
    color: '#8A8A8A',       // text-muted
    ornament: 'I',
  },
  {
    rank: 'sophomore',
    label: '学者',
    labelEn: 'Sophomore',
    xpThreshold: 500,
    minStreakDays: 7,
    minCourseMastery: 1,
    color: '#3D3D3D',       // text-body
    ornament: 'II',
  },
  {
    rank: 'bachelor',
    label: '学士',
    labelEn: 'Bachelor',
    xpThreshold: 2000,
    minStreakDays: 21,
    minCourseMastery: 3,
    color: '#A5192E',       // red-primary
    ornament: 'III',
  },
  {
    rank: 'master',
    label: '硕士',
    labelEn: 'Master',
    xpThreshold: 6000,
    minStreakDays: 60,
    minCourseMastery: 5,
    color: '#C49A2A',       // accent-gold
    ornament: 'IV',
  },
  {
    rank: 'doctor',
    label: '博士',
    labelEn: 'Doctor',
    xpThreshold: 15000,
    minStreakDays: 120,
    minCourseMastery: 8,
    color: '#7F0037',       // red-dark
    ornament: 'V',
  },
  {
    rank: 'professor',
    label: '教授',
    labelEn: 'Professor',
    xpThreshold: 40000,
    minStreakDays: 365,
    minCourseMastery: 12,
    color: '#1A1A1A',       // text-main
    ornament: 'VI',
  },
]
```

### C.3 XP（经验值）获取规则

```typescript
interface XPEvent {
  type: string
  xp: number
  description: string
}

const XP_RULES: Record<string, (ctx: unknown) => number> = {
  // 闪卡复习
  'flashcard-review': (ctx: { rating: number }) => {
    // Again=2, Hard=5, Good=10, Easy=8（简单略低于记得，避免刷分）
    return [0, 2, 5, 10, 8][ctx.rating] ?? 0
  },

  // 测验完成
  'quiz-complete': (ctx: { score: number; total: number }) => {
    const pct = ctx.score / ctx.total
    return Math.round(pct * 50)  // 满分 50 XP
  },

  // 精讲学习（按模块）
  'module-study': () => 30,

  // 苏格拉底对话
  'socratic-session': (ctx: { turnsCount: number }) => {
    return Math.min(ctx.turnsCount * 5, 40)  // 上限 40 XP
  },

  // 连续天数 bonus
  'streak-bonus': (ctx: { days: number }) => {
    if (ctx.days >= 30) return 50
    if (ctx.days >= 14) return 25
    if (ctx.days >= 7) return 10
    return 0
  },

  // 闪卡生成（用户主动创建）
  'card-created': () => 5,

  // 自进化建议被接受
  'evolution-applied': () => 15,
}
```

### C.4 升级算法

```typescript
function calculateRank(profile: ScholarProfile): ScholarRank {
  const { totalXP, streakDays, courseMasteryCount } = profile

  // 从最高等级往下检查，返回满足所有条件的最高等级
  for (let i = RANK_DEFINITIONS.length - 1; i >= 0; i--) {
    const def = RANK_DEFINITIONS[i]
    if (
      totalXP >= def.xpThreshold &&
      streakDays >= def.minStreakDays &&
      courseMasteryCount >= def.minCourseMastery
    ) {
      return def.rank
    }
  }
  return 'freshman'
}
```

升级通知采用 toast 通知条（非弹窗），符合 Editorial 美学：

```typescript
// 升级通知组件 — 顶部滑入的衬线体通知条
function RankUpNotification({ newRank }: { newRank: RankDefinition }) {
  return (
    <motion.div
      initial={{ y: -60, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: -60, opacity: 0 }}
      className="fixed top-4 left-1/2 -translate-x-1/2 z-50
        border border-accent-gold bg-bg-card px-8 py-4
        flex items-center gap-4"
    >
      <span
        className="font-heading text-2xl"
        style={{ color: newRank.color }}
      >
        {newRank.ornament}
      </span>
      <div>
        <p className="font-heading text-sm text-accent-gold tracking-widest uppercase">
          Scholar Rank Up
        </p>
        <p className="font-heading text-lg text-text-main">
          {newRank.label} · {newRank.labelEn}
        </p>
      </div>
    </motion.div>
  )
}
```

### C.5 知识徽章系统

按课程领域颁发徽章，四个等级：Bronze → Silver → Gold → Platinum。

```typescript
interface KnowledgeBadge {
  id: string
  courseId: string
  courseName: string
  tier: 'bronze' | 'silver' | 'gold' | 'platinum'
  earnedAt: number
  /** 获得条件的快照 */
  criteria: {
    mastery: number         // 该课程平均 mastery
    modulesStudied: number  // 已学模块数
    flashcardsReviewed: number
    quizScore: number       // 平均测验得分
  }
}

const BADGE_TIERS = {
  bronze:   { label: 'Bronze',   minMastery: 0.40, color: '#CD7F32', requirement: '完成 50% 模块' },
  silver:   { label: 'Silver',   minMastery: 0.60, color: '#8A8A8A', requirement: '平均掌握度 60%' },
  gold:     { label: 'Gold',     minMastery: 0.80, color: '#C49A2A', requirement: '平均掌握度 80%' },
  platinum: { label: 'Platinum', minMastery: 0.95, color: '#1A1A1A', requirement: '平均掌握度 95%+' },
}
```

徽章 UI 组件 — 学术论文风格的圆形印章：

```typescript
function BadgeIcon({ badge }: { badge: KnowledgeBadge }) {
  const tier = BADGE_TIERS[badge.tier]
  return (
    <div
      className="w-14 h-14 rounded-full border-2 flex items-center justify-center
        font-heading text-xs tracking-widest"
      style={{
        borderColor: tier.color,
        color: tier.color,
      }}
    >
      <div className="text-center leading-tight">
        <div className="text-[10px] uppercase">{tier.label}</div>
        <div className="text-[8px] mt-0.5 opacity-70 truncate max-w-[40px]">
          {badge.courseName.slice(0, 4)}
        </div>
      </div>
    </div>
  )
}
```

### C.6 连续天数（Streak）机制

当前 `student-model.ts` 已有 `streakDays` 和 `lastActiveDate` 字段。增强方案：

```typescript
interface StreakData {
  currentStreak: number
  longestStreak: number
  lastActiveDate: string
  /** 每日活动类型记录（用于周报） */
  dailyLog: Record<string, DailyActivity>
}

interface DailyActivity {
  date: string
  flashcardsReviewed: number
  modulesStudied: number
  quizzesTaken: number
  studyMinutes: number
  xpEarned: number
}
```

Streak 显示组件 — 类似 GitHub contribution graph 但用暖色系：

```typescript
function StreakCalendar({ data }: { data: StreakData }) {
  // 最近 12 周的活动热力图
  // 颜色梯度：bg-main → #FFF0E0 → #FFD4A8 → #C49A2A → #A5192E
  // 悬浮显示当日详情
  return (
    <div className="grid grid-cols-7 gap-[2px]">
      {last84Days.map(day => (
        <div
          key={day}
          className="w-3 h-3 border border-border-warm"
          style={{ backgroundColor: getHeatColor(data.dailyLog[day]) }}
          title={`${day}: ${data.dailyLog[day]?.studyMinutes ?? 0} 分钟`}
        />
      ))}
    </div>
  )
}
```

### C.7 周报（Weekly Digest）

每周一生成的学习总结，风格类似学术期刊的"编辑来信"。

```typescript
interface WeeklyDigest {
  weekStart: string
  weekEnd: string
  sections: {
    /** 本周亮点 */
    highlights: string[]
    /** 学习数据 */
    stats: {
      totalStudyMin: number
      flashcardsReviewed: number
      newCardsLearned: number
      modulesCompleted: number
      averageMastery: number
      masteryGrowth: number  // 与上周对比
    }
    /** 下周建议 */
    recommendations: string[]
    /** 本周最难的 3 张卡 */
    hardestCards: Array<{ front: string; lapseRate: number }>
    /** 掌握度提升最大的模块 */
    topImprovedModule: { name: string; before: number; after: number } | null
  }
}
```

周报渲染组件采用 Editorial 排版：

```
┌──────────────────────────────────────────────────┐
│  WEEKLY DIGEST                                    │
│  3月11日 — 3月17日                                │
│  ──────────────────────────────                   │
│                                                   │
│  § 本周亮点                                       │
│  · 量子力学掌握度从 42% 提升至 67%（+25%）         │
│  · 连续学习 12 天，解锁 Silver 量子力学徽章        │
│  · 闪卡复习 156 张，保持率 78%                    │
│                                                   │
│  § 数据概览                                       │
│  ┌────────────┬────────────┬────────────┐        │
│  │ 学习时间    │ 模块完成    │ 掌握增长    │        │
│  │ 4h 32min   │ 7 个       │ +18%       │        │
│  └────────────┴────────────┴────────────┘        │
│                                                   │
│  § 下周建议                                       │
│  1. 优先复习离散数学（24 张卡到期）                 │
│  2. 量子力学模块 4 掌握度较低，建议深入学习          │
│                                                   │
│  Scholar Rank: 学士 (III) · 2,340 / 6,000 XP     │
└──────────────────────────────────────────────────┘
```

### C.8 游戏化组件 UI 设计汇总

| 组件 | 位置 | 设计要点 |
|------|------|---------|
| `ScholarRankBadge` | Header / 侧边栏 | 罗马数字 + 衬线体等级名，border 而非 shadow |
| `XPProgressBar` | 个人中心 | 细线进度条（h-[2px]），red-primary 填充 |
| `BadgeGrid` | `/my/badges` | 圆形印章 grid，未获得的用虚线边框 |
| `StreakCalendar` | 首页 / 个人中心 | 12 周热力图，暖色梯度 |
| `WeeklyDigestCard` | 首页顶部 | 可展开的期刊风格卡片 |
| `RankUpNotification` | 全局 toast | 顶部滑入通知条，金色边框 |
| `AchievementToast` | 全局 toast | 轻量通知，显示徽章图标 + 文字 |

---

## D. 社交学习机制

### D.1 课程内排行榜

```typescript
interface LeaderboardEntry {
  userId: string
  displayName: string      // 支持匿名："学者 #7F3A"
  isAnonymous: boolean
  rank: ScholarRank
  weeklyXP: number
  totalMastery: number     // 该课程的平均 mastery
  streakDays: number
}

// 排行榜类型
type LeaderboardType =
  | 'weekly-xp'           // 本周 XP 排名
  | 'mastery'             // 课程掌握度排名
  | 'streak'              // 连续天数排名
  | 'flashcard-retention' // 闪卡保持率排名
```

**隐私设计**：
- 默认匿名参与（显示"学者 #XXXX"）
- 用户可选择公开真名
- 排名只显示相邻 5 名（避免排名焦虑）
- 不显示绝对分数，只显示相对位置和趋势箭头

排行榜 UI：

```typescript
function LeaderboardRow({
  entry,
  position,
  isCurrentUser,
}: {
  entry: LeaderboardEntry
  position: number
  isCurrentUser: boolean
}) {
  return (
    <div
      className={[
        'flex items-center gap-4 py-3 px-4 border-b border-border-warm',
        isCurrentUser ? 'bg-bg-accent' : '',
      ].join(' ')}
    >
      {/* 排名数字 — 衬线体 */}
      <span className="font-heading text-lg text-text-muted w-8 text-right">
        {position}
      </span>

      {/* 名称 + rank */}
      <div className="flex-1">
        <span className="text-sm text-text-body">
          {entry.isAnonymous ? `学者 #${entry.userId.slice(0, 4)}` : entry.displayName}
        </span>
        <span className="ml-2 text-[10px] text-text-muted font-mono">
          {RANK_DEFINITIONS.find(r => r.rank === entry.rank)?.ornament}
        </span>
      </div>

      {/* 指标 */}
      <span className="text-sm font-mono text-red-primary">
        {entry.weeklyXP} XP
      </span>
    </div>
  )
}
```

### D.2 互相出题（Peer Challenge）

同一课程内的学生可以互相出题挑战。

```typescript
interface PeerChallenge {
  id: string
  challengerId: string
  challengerName: string
  targetId: string
  courseId: string
  /** 出题者从自己的闪卡中选出 5 张 */
  cardIds: string[]
  /** 挑战状态 */
  status: 'pending' | 'accepted' | 'completed' | 'expired'
  /** 双方得分 */
  scores: {
    challenger: number | null  // 出题者自己也要答
    target: number | null
  }
  createdAt: number
  expiresAt: number  // 24 小时过期
}
```

**流程**：
1. 学生 A 从自己的闪卡 deck 中选 5 张"最难的"卡
2. 发送挑战给同课程的学生 B
3. B 接受后，双方各自在限时（每张 30s）内回答这 5 张卡
4. 对比得分，胜者获得 bonus XP（25 XP），双方都获得参与 XP（10 XP）
5. 挑战结果显示在课程排行榜中

**后端 API**：

```
POST   /api/v1/social/challenges          → 发起挑战
GET    /api/v1/social/challenges/pending   → 待接受的挑战
POST   /api/v1/social/challenges/:id/accept → 接受挑战
POST   /api/v1/social/challenges/:id/submit → 提交答题结果
GET    /api/v1/social/challenges/:id       → 查看结果
```

### D.3 学习伙伴匹配

基于以下维度自动匹配：

```typescript
interface MatchingCriteria {
  /** 共同课程数量（权重最高） */
  sharedCourses: number
  /** 掌握度互补性（一强一弱 > 两人都强/弱） */
  masteryComplementarity: number
  /** 学习时间重叠（同时在线的概率） */
  scheduleOverlap: number
  /** Scholar Rank 接近度 */
  rankProximity: number
}

// 匹配算法：加权评分
function calculateMatchScore(a: StudentProfile, b: StudentProfile): number {
  const shared = countSharedCourses(a, b)
  const complement = calculateComplementarity(a, b)
  const schedule = estimateScheduleOverlap(a, b)
  const rankDist = Math.abs(rankToNumber(a.rank) - rankToNumber(b.rank))

  return (
    shared * 0.4 +
    complement * 0.3 +
    schedule * 0.2 +
    (1 / (1 + rankDist)) * 0.1
  )
}
```

匹配后的功能：
- 共享学习日程（看到伙伴今日计划，互相激励）
- 互相出题快捷入口
- 学习进度对比（非竞争性，侧重"一起进步"）

### D.4 共享笔记和闪卡

```typescript
interface SharedDeck {
  id: string
  ownerId: string
  ownerName: string
  courseId: string
  courseName: string
  /** 公开 / 仅学习伙伴 / 仅课程内 */
  visibility: 'public' | 'buddies' | 'course'
  noteCount: number
  rating: number         // 其他学生的评分（1-5）
  ratingCount: number
  downloadCount: number
  /** 原始 notes（不含个人复习数据） */
  notes: FlashcardNote[]
  createdAt: number
}
```

**共享规则**：
- 只共享 `FlashcardNote`，不共享 `FlashcardCard`（FSRS 状态是个人化的）
- 导入他人的共享 deck 时，为每个 note 生成全新的 card（`createEmptyCard()`）
- AI 生成的卡片标注来源（"由 AI 从 XXX 精讲生成"），用户创建的标注"由 @用户名 创建"
- 共享 deck 的评分体系：使用后 7 天系统自动弹出评分请求

**后端 API**：

```
POST   /api/v1/social/decks                  → 发布共享 deck
GET    /api/v1/social/decks?courseId=xxx      → 浏览课程内共享 deck
POST   /api/v1/social/decks/:id/import       → 导入到个人 deck
POST   /api/v1/social/decks/:id/rate         → 评分
GET    /api/v1/social/decks/:id/notes        → 获取 notes 详情
```

---

## 附录：实施优先级

| 优先级 | 模块 | 工作量 | 依赖 |
|--------|------|--------|------|
| P0 | A.2 四条闪卡生成路径（前端） | 3 天 | 无 |
| P0 | A.3 后端 `/flashcard-generate` API | 3 天 | 后端 GLM 管道 |
| P1 | B.2 LLM 自进化替换 Mock | 2 天 | A.3 |
| P1 | B.2 第 5 触发条件（集体失败） | 1 天 | 无 |
| P1 | C.2-C.4 Scholar Rank + XP + Badge | 4 天 | 无 |
| P2 | C.6 Streak Calendar | 1 天 | 无 |
| P2 | C.7 Weekly Digest | 2 天 | C.2 |
| P2 | A.6 IndexedDB 迁移 | 2 天 | 无 |
| P3 | D.1 排行榜 | 3 天 | 后端用户系统 |
| P3 | D.2 Peer Challenge | 5 天 | D.1 |
| P3 | D.3 学习伙伴匹配 | 3 天 | 后端用户系统 |
| P3 | D.4 共享闪卡 | 4 天 | 后端用户系统 |

---

> 本文档为研究方案，具体实现时需结合后端排期和用户测试反馈调整。
