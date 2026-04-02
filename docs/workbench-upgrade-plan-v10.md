# 智阶学习工作台 升级设计方案（10轮迭代终稿）

> 日期：2026-03-18
> 迭代轮次：10轮专家评审
> 参与角色：产品策略师、AI教育研究员、前端UX架构师、后端架构师、学习参与度设计师
> 目标：全面超越 OpenMAIC，打造最佳 AI 学习体验

---

## 竞品深度分析

### OpenMAIC（清华开源）核心能力
| 能力 | 实现方式 | 效果 |
|------|---------|------|
| 多Agent课堂模拟 | AI老师+AI助教+AI同学，LangGraph编排 | 课堂结业率40%（MOOC仅5%） |
| 语音教学 | TTS语音+白板标注+高亮同步 | 多模态减少阅读疲劳 |
| 28+原子操作 | 白板绘制、公式推导、激光笔、场景切换 | 丰富的教学手段 |
| 自动节奏控制 | LangGraph状态机管理"讲/讨论/测验" | L4级自动驾驶课堂 |
| 互动白板 | HTML Canvas实时渲染 | 视觉化知识构建 |
| PBL项目式学习 | 里程碑追踪+任务分解 | 深度学习 |
| 低成本生成 | 1课件+2美元+30分钟 | 极低门槛 |

### 其他竞品
| 产品 | 核心优势 | 智阶可借鉴 |
|------|---------|-----------|
| Khanmigo | 苏格拉底式LLM辅导、作业批改 | 真正的LLM驱动对话 |
| NotebookLM | 多源文档整合、播客生成、FAQ自动生成 | 多材料交叉分析 |
| Duolingo | 极致游戏化、FSRS间隔重复、streaks | 游戏化+FSRS深度整合 |
| Coursera | 证书体系、同伴评估 | 社交学习+成就 |

### 智阶 vs OpenMAIC 功能对比
| 维度 | 智阶现状 | OpenMAIC | 差距 |
|------|---------|----------|------|
| 内容拆解 | ★★★★ Cartographer管道 | ★★★★ MinerU PDF解析 | 持平 |
| 精讲生成 | ★★★★ Specialist Markdown | ★★★★★ Slides+语音+白板 | -1 |
| 测验系统 | ★★★ MCQ（单次作答） | ★★★★ 多格式+即时反馈 | -1 |
| 对话引导 | ★★ 模板制Socratic | ★★★★ LLM驱动+AI同学 | -2 |
| 自适应学习 | ★★ BKT轻量 | ★★ 无显著自适应 | 持平 |
| 间隔重复 | ★★★ FSRS已集成 | ★ 无 | +2 |
| 游戏化 | ★ 无 | ★ 无 | 持平 |
| 社交学习 | ★ 无 | ★★★ AI同学互动 | -2 |
| 多模态 | ★ 纯文本 | ★★★★★ 语音+白板+动画 | -4 |
| 学习路径 | ★★ 静态计划 | ★★ 无个性化路径 | 持平 |
| 设计美学 | ★★★★★ Editorial Academic | ★★★ 标准UI | +2 |
| 课程社区 | ★★★★ 知识网络+材料库 | ★ 无社区 | +3 |

### 智阶差异化定位
> **OpenMAIC = "AI课堂播放器"（观看式）**
> **智阶 = "AI学习教练"（训练式）**

OpenMAIC模拟传统课堂（一个老师在讲，学生在听），本质仍是**被动接收**。
智阶的方向应是**主动训练**：不是"听AI讲课"，而是"AI教练带着你练"。

核心差异化：
1. **训练>讲授**：每一步都要求学生动手（回答、标注、出题），不是被动观看
2. **记忆>理解**：FSRS自进化闪卡 + 间隔重复 = 长期记忆锁定（OpenMAIC完全没有）
3. **个性化路径**：BKT→IRT升级，动态调整学习路径（OpenMAIC无自适应）
4. **知识社区**：同课程同学互相出题、共享笔记（OpenMAIC是孤立工具）
5. **备考专精**：考试倒计时+考点权重+易错归纳 = 备考利器（OpenMAIC不区分学习模式）

---

## 版本迭代记录

### V1（初始提案）— 产品策略师
**核心思路**：直接对标OpenMAIC，补齐所有功能差距。
**问题**：模仿OpenMAIC的"课堂模拟"会陷入跟随者陷阱，且技术投入大（TTS+白板+LangGraph）。

### V2（AI教育研究员评审）— 学习科学修正
**修正**：不应复制"课堂模拟"，应聚焦学习科学中效果更好的模式：
- **测试效应**（Testing Effect）：频繁低压力测试比重复学习更有效
- **交错练习**（Interleaving）：混合不同模块练习比块状练习好
- **生成效应**（Generation Effect）：让学生自己生成内容比被动接收好
- **间隔重复**（Spaced Repetition）：FSRS已有，但未充分利用

**关键洞察**：OpenMAIC的40%结业率来自"社会临场感"（Social Presence），但智阶可以通过"教练临场感"（Coach Presence）+ "训练成就感"（Achievement Mastery）达到更高留存。

### V3（前端UX架构师评审）— 布局重设计
**修正**：当前70:30固定布局过于死板，应支持多种学习场景下的动态布局。

**三种布局模式**：

```
模式A: 沉浸阅读（PDF为主）
┌──────────────────────────────┐
│  ┌──────────────┐  ┌───────┐ │
│  │  PDF/精讲     │  │ AI    │ │
│  │  (75%)       │  │ Coach │ │
│  │              │  │ (25%) │ │
│  │              │  │       │ │
│  └──────────────┘  └───────┘ │
└──────────────────────────────┘

模式B: 训练模式（测验/闪卡为主）
┌──────────────────────────────┐
│  ┌──────────────────────────┐ │
│  │  居中卡片区域 (60%)       │ │
│  │  [测验题 / 闪卡翻转]     │ │
│  └──────────────────────────┘ │
│  ┌───────┐  ┌───────────────┐ │
│  │进度条  │  │ 知识点快速参考 │ │
│  └───────┘  └───────────────┘ │
└──────────────────────────────┘

模式C: 对话学习（Socratic为主）
┌──────────────────────────────┐
│  ┌───────────┐  ┌───────────┐ │
│  │ 知识参考   │  │ AI对话    │ │
│  │ (精讲片段) │  │ (55%)    │ │
│  │ (45%)     │  │           │ │
│  │           │  │           │ │
│  └───────────┘  └───────────┘ │
└──────────────────────────────┘
```

### V4（后端架构师评审）— 流式+多Agent架构
**修正**：后端需要从"管道架构"升级为"事件驱动架构"。

**新架构**：
```
前端                   后端
  │                     │
  │ POST /learning/start │
  │────────────────────→│
  │                     ├→ 创建 LearningSession
  │                     │
  │ SSE /learning/stream│
  │←────────────────────│
  │                     │
  │  event: module_ready│  ← Specialist 完成一个模块立即推送
  │←────────────────────│
  │                     │
  │  event: quiz_ready  │  ← Examiner 完成测验
  │←────────────────────│
  │                     │
  │ POST /chat/socratic │  ← LLM驱动对话（非模板）
  │────────────────────→│
  │←────────────────────│
  │                     │
  │ POST /feedback      │  ← 测验/闪卡反馈
  │────────────────────→│
  │  event: plan_update │  ← 动态调整计划
  │←────────────────────│
```

### V5（学习参与度设计师评审）— 游戏化+留存
**修正**：缺乏"每日回来的理由"。

**学术游戏化框架**（非幼稚的XP）：
```
┌─ 智阶成长体系 ──────────────────────────────┐
│                                               │
│  学者等级（Scholar Rank）                      │
│    新生 → 学士 → 硕士 → 博士 → 教授           │
│    (基于累计学习行为，非简单XP)                 │
│                                               │
│  知识徽章（按课程领域）                         │
│    数学 🏛️ | 物理 ⚛️ | 化学 🧪 | CS 💻         │
│    每个领域有 Bronze/Silver/Gold/Platinum       │
│    解锁条件 = mastery ≥ 阈值 的模块数           │
│                                               │
│  学习连续天数（Streak）                         │
│    每日 ≥ 10分钟学习 = 1天                     │
│    7天连续 = 🔥 徽章                           │
│    30天连续 = 特殊称号                         │
│                                               │
│  周报（Weekly Digest）                         │
│    本周学习时长 / 新掌握模块 / 闪卡准确率变化   │
│    对比上周 + 课程内排名（可选匿名）            │
│                                               │
└───────────────────────────────────────────────┘
```

### V6（第2轮产品策略评审）— 核心体验重塑
**关键转变**：从"工具集合"到"学习旅程"。

**"一键开始"体验设计**：
```
用户打开工作台
      │
      ▼
  ┌───────────────────┐
  │ 今日学习建议      │  ← 基于FSRS到期+上次进度+考试倒计时
  │                   │
  │ 📖 量子力学 模块3  │  ← 继续上次
  │    预计 12min     │
  │                   │
  │ 🔴 [开始学习]     │  ← 一键进入，自动编排
  └───────────────────┘
      │
      ▼ 点击"开始学习"
  ┌───────────────────────────────────────┐
  │ 学习编排引擎自动执行：                  │
  │                                       │
  │ Step 1: 精讲阅读（5min）              │
  │   └─ 自动展示精讲Markdown              │
  │   └─ 阅读计时 + 关键段落高亮           │
  │                                       │
  │ Step 2: 快速检测（3min）              │
  │   └─ 4道MCQ检测理解                   │
  │   └─ 错题自动生成闪卡                  │
  │                                       │
  │ Step 3: 薄弱点强化（4min）            │
  │   └─ 错题触发Socratic对话             │
  │   └─ AI教练引导重新理解               │
  │                                       │
  │ Step 4: 记忆锁定（3min）              │
  │   └─ 本模块闪卡 + FSRS到期卡          │
  │                                       │
  │ → 自动切换到下一个模块                  │
  └───────────────────────────────────────┘
```

### V7（第2轮AI教育研究员评审）— 学生模型升级
**修正**：BKT参数过于简化，需要升级。

**混合知识追踪模型**：
```typescript
// 从纯BKT升级为 BKT + IRT 混合模型
interface EnhancedStudentModel {
  // BKT层：追踪每个知识点的掌握概率
  mastery: Record<string, {
    pL: number        // 掌握概率 P(L)
    history: boolean[] // 最近20次答题记录
    lastUpdated: number
  }>

  // IRT层：追踪学生总体能力 + 题目难度匹配
  ability: number      // θ 参数（-3 到 3）
  responsePattern: {
    avgResponseTimeMs: number
    consistencyScore: number  // 答题一致性
  }

  // 元认知层：追踪学习行为模式
  metacognition: {
    selfAssessmentAccuracy: number  // 自评 vs 实际mastery的一致性
    helpSeekingRate: number         // 主动求助频率
    studyTimeDistribution: number[] // 每日学习时段分布
  }

  // 遗忘曲线：与FSRS集成
  forgettingCurve: Record<string, {
    stability: number    // FSRS S 参数
    lastReview: number
    nextDue: number
  }>
}
```

**动态策略调整规则**：
| 信号 | 检测方式 | 调整动作 |
|------|---------|---------|
| 连续3题错 | quiz answer history | 降低难度 + 插入前置知识补讲 |
| 答题时间>15s | responseTimeMs | 标记为"犹豫概念"，加入闪卡 |
| 自评偏高 | self-assessment vs actual | 增加测验频率 |
| 连续5题对 | quiz answer history | 跳过当前模块，进入下一个 |
| 闪卡连续Again×3 | FSRS rating | 触发LLM拆分为子卡 |
| 学习时间>45min | session timer | 建议休息，切换到轻松模式 |

### V8（第2轮后端架构师评审）— 完整API设计
**8个手动工具的后端实现方案**：

```
# 新增API端点

## 1. 统一LLM对话（替代模板Socratic）
POST /api/v1/chat/socratic
Body: {
  moduleId: string,
  context: string,      // 精讲Markdown片段
  userMessage: string,
  scaffoldLevel: "full" | "moderate" | "minimal",
  conversationHistory: Message[]
}
Response: SSE stream → { content: string, hints: string[], followUp: string }

## 2. 概念图谱生成
POST /api/v1/tools/concept-map
Body: { moduleId: string, specialistMarkdown: string }
Response: {
  nodes: { id, label, type: "concept"|"formula"|"example" }[],
  edges: { source, target, relation: string }[]
}

## 3. 考点提取
POST /api/v1/tools/exam-points
Body: { moduleId: string, specialistMarkdown: string }
Response: {
  points: {
    concept: string,
    frequency: "high"|"medium"|"low",
    examTypes: ("选择"|"填空"|"计算"|"论述")[],
    relatedModules: string[]
  }[]
}

## 4. 易错总结
POST /api/v1/tools/mistake-analysis
Body: {
  moduleId: string,
  quizResults: { questionId, correct, userAnswer, correctAnswer }[],
  specialistMarkdown: string
}
Response: {
  mistakes: {
    category: string,        // "概念混淆"|"计算错误"|"理解偏差"
    description: string,
    correction: string,
    relatedConcepts: string[],
    practiceQuestions: MCQuestion[]
  }[]
}

## 5. 闪卡智能生成
POST /api/v1/tools/flashcard-generate
Body: {
  moduleId: string,
  specialistMarkdown: string,
  quizResults?: QuizResult[],  // 可选，基于错题生成
  cardTypes: ("basic"|"cloze"|"reverse")[]
}
Response: {
  cards: FlashcardNote[]
}

## 6. 知识问答（RAG）
POST /api/v1/chat/knowledge-qa
Body: {
  materialId: string,
  question: string,
  conversationHistory: Message[]
}
Response: SSE stream → {
  answer: string,
  sources: { page: number, snippet: string }[],
  followUpQuestions: string[]
}

## 7. 一键总结
POST /api/v1/tools/summary
Body: { moduleId: string, specialistMarkdown: string, style: "brief"|"detailed" }
Response: { summary: string, keyPoints: string[], wordCount: number }

## 8. 精读笔记
POST /api/v1/tools/reading-notes
Body: {
  moduleId: string,
  specialistMarkdown: string,
  highlights: { text: string, page: number }[]  // 用户PDF批注
}
Response: {
  notes: {
    section: string,
    keyIdea: string,
    details: string,
    myHighlights: string[],
    questions: string[]
  }[]
}

## 9. 学习反馈 + 动态调整
POST /api/v1/learning/feedback
Body: {
  sessionId: string,
  signal: FeedbackSignal  // quiz-answer / flashcard-rating / study-time
}
Response: {
  masteryUpdate: { moduleId, oldMastery, newMastery },
  planAdjustment?: {
    action: "skip"|"reinforce"|"add-prerequisite"|"slow-down",
    targetModuleId: string,
    reason: string
  }
}
```

### V9（第2轮前端+参与度联合评审）— 完整体验流设计

**学习编排引擎（LearningOrchestrator）前端架构**：

```typescript
// 新增：src/lib/learning-orchestrator.ts

type OrchestratorState = {
  sessionId: string
  currentStep: number
  steps: LearningStep[]
  mode: 'auto-pilot' | 'manual'  // 自动驾驶 or 手动
  pauseReason?: string
  totalTimeSpent: number
  masteryGains: Record<string, number>
}

type LearningStep = {
  id: string
  type: 'read' | 'quiz' | 'flashcard' | 'socratic' | 'concept-map' | 'summary'
  moduleId: string
  status: 'pending' | 'active' | 'completed' | 'skipped'
  estimatedMin: number
  actualMin?: number
  score?: number
}

// 核心事件循环
type OrchestratorEvent =
  | { type: 'STEP_COMPLETED'; stepId: string; result: StepResult }
  | { type: 'QUIZ_SCORED'; moduleId: string; score: number; details: QuizDetail[] }
  | { type: 'FLASHCARD_RATED'; cardId: string; rating: 1|2|3|4 }
  | { type: 'USER_PAUSE' }
  | { type: 'USER_SKIP'; stepId: string }
  | { type: 'USER_REQUEST_HELP' }
  | { type: 'FATIGUE_DETECTED' }  // 连续错误 or 答题变慢
  | { type: 'SESSION_TIMEOUT'; minutesElapsed: number }

// 状态机转换
function orchestratorReducer(state: OrchestratorState, event: OrchestratorEvent): OrchestratorState {
  switch (event.type) {
    case 'STEP_COMPLETED':
      // 标记当前步骤完成，激活下一步
      // 如果是quiz → 检查score → 可能插入reinforcement步骤
      break
    case 'QUIZ_SCORED':
      if (event.score < 0.6) {
        // 插入Socratic对话步骤 + 闪卡强化
        // 调用后端 POST /learning/feedback → 获取planAdjustment
      } else if (event.score > 0.9) {
        // 标记后续同类模块为skippable
      }
      break
    case 'FATIGUE_DETECTED':
      // 切换到轻松模式：闪卡复习 or 概念图浏览
      break
    case 'USER_REQUEST_HELP':
      // 插入Socratic对话步骤
      break
  }
}
```

**新增前端组件树**：
```
src/components/
├── orchestrator/
│   ├── LearningOrchestrator.tsx    # 核心编排组件
│   ├── StepRenderer.tsx            # 根据step.type渲染不同组件
│   ├── ProgressRail.tsx            # 顶部学习进度条
│   ├── AutoPilotControls.tsx       # 自动驾驶控制（暂停/加速/跳过）
│   └── SessionSummary.tsx          # 学习结束总结
├── coach/
│   ├── AICoachPanel.tsx            # 替代原SocraticChat，LLM驱动
│   ├── CoachMessage.tsx            # AI教练消息气泡
│   ├── HintReveal.tsx              # 渐进式提示
│   └── ConceptExplainer.tsx        # 概念快速解释弹窗
├── training/
│   ├── QuizTrainer.tsx             # 升级版测验（即时反馈+错题追踪）
│   ├── FlashcardDrill.tsx          # 闪卡训练模式
│   ├── ConceptMapView.tsx          # 概念图谱可视化
│   └── MistakeReview.tsx           # 易错回顾
├── engagement/
│   ├── ScholarRank.tsx             # 学者等级显示
│   ├── StreakCounter.tsx           # 连续天数
│   ├── AchievementBadge.tsx        # 成就徽章
│   └── WeeklyDigest.tsx            # 周报弹窗
└── social/
    ├── CourseLeaderboard.tsx        # 课程内排行
    ├── PeerChallenge.tsx            # 互相出题
    └── StudyBuddyStatus.tsx         # 学习伙伴在线状态
```

### V10（终审定稿）— 整合所有评审意见

---

## 最终方案：智阶工作台 2.0

### 一、产品定位（终稿）

**一句话**：智阶是一个**AI学习教练**，通过训练式学习（而非讲授式）帮大学生高效掌握课程知识。

**对比**：
| | OpenMAIC | 智阶 2.0 |
|---|---------|---------|
| 隐喻 | AI课堂（听课） | AI教练（训练） |
| 模式 | 被动接收 | 主动练习 |
| 核心循环 | 讲→听→互动 | 读→测→纠→记 |
| 长期记忆 | ❌ 无间隔重复 | ✅ FSRS自进化 |
| 个性化 | ❌ 统一课堂 | ✅ BKT+IRT动态调整 |
| 备考能力 | ❌ 无模式区分 | ✅ 三模式专精 |
| 社区 | ❌ 无 | ✅ 课程知识社区 |

### 二、核心体验升级（7大模块）

#### 模块1：学习编排引擎（Learning Orchestrator）

**现状**：手动点击模块 → 手动切换标签 → 手动发起工具
**升级**：一键开始 → 自动编排学习步骤 → 根据反馈动态调整

**核心流程**：
```
[一键开始] → 自动编排以下循环（每个模块）：
    │
    ├─ 1. 精讲阅读（3-8min）
    │     └─ 展示Specialist Markdown
    │     └─ 关键段落自动高亮
    │     └─ 阅读进度追踪
    │
    ├─ 2. 理解检测（2-4min）
    │     └─ 3-5题MCQ快速检测
    │     └─ 即时反馈 + 错题解析
    │     └─ BKT mastery 实时更新
    │
    ├─ 3. 薄弱强化（按需，0-5min）
    │     └─ 错题 → 触发AI教练对话
    │     └─ AI教练引导重新理解
    │     └─ 提供类比、简化解释
    │
    ├─ 4. 记忆锁定（2-3min）
    │     └─ 自动生成闪卡（基于精讲+错题）
    │     └─ 即时练习 + FSRS调度
    │
    └─ → 评估是否进入下一模块
          ├─ mastery ≥ 0.7 → 进入下一个
          ├─ mastery < 0.4 → 插入前置补讲
          └─ 连续45min → 建议休息
```

**前端实现**：
```typescript
// src/lib/learning-orchestrator.ts
// 使用 useReducer + Context 管理全局学习状态
// WorkbenchPage 将不再直接管理 specialistMarkdown/quizQuestions 等状态
// 而是通过 LearningOrchestrator 统一调度

const LearningContext = createContext<{
  state: OrchestratorState
  dispatch: (event: OrchestratorEvent) => void
  actions: {
    startSession: (materialId: string, intent: Intent) => void
    pauseSession: () => void
    skipStep: (stepId: string) => void
    requestHelp: () => void
  }
}>()
```

**后端支撑**：
```
POST /api/v1/learning/sessions          # 创建学习会话
GET  /api/v1/learning/sessions/:id/stream  # SSE学习事件流
POST /api/v1/learning/sessions/:id/feedback  # 提交反馈信号
POST /api/v1/learning/sessions/:id/replan    # 请求重新规划
```

#### 模块2：AI教练（替代模板Socratic）

**现状**：预制模板随机选择，无LLM调用
**升级**：LLM驱动的苏格拉底对话，结合精讲内容和学生mastery

**架构**：
```
用户提问 / 答题错误
     │
     ▼
┌─────────────────────────────────┐
│ AI教练 Context Assembly         │
│                                 │
│ System Prompt:                  │
│   你是一名苏格拉底式AI教练      │
│   学生当前mastery: {mastery}    │
│   脚手架等级: {scaffoldLevel}   │
│   当前模块: {moduleName}        │
│   知识背景: {specialistMarkdown}│
│                                 │
│ 策略:                           │
│   mastery<0.3 → 手把手引导      │
│   0.3-0.7 → 反问+类比          │
│   >0.7 → 反例挑战+拓展         │
│                                 │
│ 约束:                           │
│   - 不直接给答案                │
│   - 每次最多一个问题            │
│   - 用通俗语言解释专业概念      │
│   - 鼓励学生用自己的话复述      │
└─────────────────────────────────┘
     │
     ▼
  SSE 流式返回 → 前端逐字渲染
```

**关键设计**：
- 对话上下文自动注入当前模块的精讲内容（RAG）
- 错题自动触发对话（不需要手动打开）
- 对话结束后自动更新mastery
- 支持"求助"按钮 → 获得渐进式提示（hint → explanation → answer）

#### 模块3：流式模块加载

**现状**：等所有模块处理完才显示
**升级**：Specialist完成一个模块就推送到前端

**实现**：
```python
# 后端：pipeline_worker.py 修改
async def process_specialist(module, task_id, redis):
    markdown = await call_specialist_llm(module)
    # 保存到数据库
    await save_specialist_output(module.id, markdown)
    # 立即推送到前端
    await redis.publish(f"task:{task_id}", json.dumps({
        "type": "module_ready",
        "moduleId": module.id,
        "moduleName": module.name,
        "hasMarkdown": True
    }))
```

```typescript
// 前端：订阅模块就绪事件
subscribeProgress(taskId, (event) => {
  if (event.type === 'module_ready') {
    // 第一个模块完成 → 自动显示
    // 后续模块 → 加到列表，显示"新内容"标记
  }
})
```

#### 模块4：FSRS闪卡深度集成

**现状**：ts-fsrs已安装但未真正使用
**升级**：闪卡贯穿整个学习流程

**闪卡生成时机**：
1. **精讲完成时**：从Specialist Markdown自动提取关键概念 → 生成Basic/Cloze卡
2. **测验错误时**：错题 → 自动生成"错题闪卡"（正面=题目，背面=正确答案+解析）
3. **Socratic对话后**：AI教练解释的核心概念 → 生成"对话闪卡"
4. **用户标注PDF时**：高亮文本 → 一键生成闪卡

**自进化触发器**：
```typescript
// src/lib/flashcard-evolution.ts

async function checkEvolution(card: FlashcardCard, log: ReviewLog): Promise<EvolutionAction | null> {
  // 连续3次Again → 拆分
  if (card.consecutiveAgain >= 3) {
    return {
      action: 'split',
      prompt: `将这个概念"${card.note.fields.front}"拆分为2-3个更简单的前置知识闪卡`
    }
  }

  // 连续5次Easy → 退役
  if (card.consecutiveEasy >= 5) {
    return { action: 'retire' }
  }

  // 反复错（lapses > 50% 且 reps > 10）→ 改写
  if (card.lapses / card.reps > 0.5 && card.reps > 10) {
    return {
      action: 'rewrite',
      prompt: `改写这个闪卡的问法，使用不同的角度或类比来帮助记忆：\n原文：${card.note.fields.front}`
    }
  }

  // 回答慢 → 加提示
  if (log.responseMs && log.responseMs > 15000) {
    return {
      action: 'add-hint',
      prompt: `为这个概念生成一个助记口诀或联想提示：${card.note.fields.front}`
    }
  }

  return null
}
```

#### 模块5：工作台布局升级

**动态布局系统**：根据当前学习步骤自动切换布局

```typescript
// src/components/orchestrator/StepRenderer.tsx

function getLayoutForStep(step: LearningStep): Layout {
  switch (step.type) {
    case 'read':
      // 沉浸阅读：75% 精讲 + 25% AI教练（可折叠）
      return { type: 'reading', mainWidth: 75, sideWidth: 25 }

    case 'quiz':
      // 训练模式：居中测验卡片 + 底部进度条
      return { type: 'centered', cardWidth: 60 }

    case 'flashcard':
      // 闪卡模式：居中翻转卡片 + FSRS进度
      return { type: 'centered', cardWidth: 50 }

    case 'socratic':
      // 对话模式：50% 知识参考 + 50% 对话
      return { type: 'split', leftWidth: 45, rightWidth: 55 }

    case 'concept-map':
      // 图谱模式：全宽力导向图
      return { type: 'fullwidth' }
  }
}
```

**顶部进度轨道（ProgressRail）**：
```
┌──────────────────────────────────────────────────────────────┐
│ ● 模块1 ─── ● 模块2 ─── ◉ 模块3 ─── ○ 模块4 ─── ○ 模块5  │
│ ✅ 92%      ✅ 78%      🔴 进行中    ○ 待学习    ○ 待学习   │
│                                                              │
│ 总进度 ████████████░░░░░░░░░░░░ 45%  |  学习时间 23min      │
└──────────────────────────────────────────────────────────────┘
```

#### 模块6：多模态增强（渐进式）

**Phase 1（1个月内）**：TTS语音朗读精讲内容
```typescript
// 使用 Web Speech API 或 后端TTS（Edge TTS / 腾讯云TTS）
// 不需要完整的"AI课堂播放"，只需要"朗读+高亮同步"

interface VoiceNarration {
  text: string
  paragraphIndex: number
  onSpeaking: (charIndex: number) => void  // 高亮当前朗读位置
  onParagraphDone: () => void  // 自动滚动到下一段
}
```

**Phase 2（3个月内）**：互动可视化
- 概念图谱：D3.js 力导向图
- 公式推导动画：MathJax + GSAP逐步展示
- 数据可视化：Chart.js 统计图表

**Phase 3（6个月内）**：白板+手写
- Excalidraw集成（开源白板）
- 手写公式识别（MyScript/Mathpix API）

#### 模块7：社交学习层

**课程内排行（匿名可选）**：
```
本周 有机化学 学习榜
1. 匿名学者A  ████████████ 320min  mastery 78%
2. 你          ████████░░░░ 240min  mastery 65%
3. 匿名学者B  ████████░░░░ 235min  mastery 72%
```

**互相出题（Peer Challenge）**：
- 学生可以为自己掌握的模块出题
- 题目经AI审核后推送给同课程其他学生
- 出题者获得额外XP（教是最好的学）

**学习伙伴**：
- 系统匹配同课程、同进度的学习伙伴
- 可以看到对方的学习进度（匿名）
- 共享笔记和闪卡（opt-in）

### 三、技术架构升级（终稿）

```
┌─ 前端 (React + TypeScript) ──────────────────────────────────┐
│                                                                │
│  LearningOrchestrator (全局状态管理)                           │
│    ├─ useReducer + Context                                     │
│    ├─ SSE 订阅后端学习事件                                     │
│    └─ 自动步骤调度 + 布局切换                                   │
│                                                                │
│  组件层                                                        │
│    ├─ ProgressRail         (顶部进度)                          │
│    ├─ StepRenderer         (动态渲染当前步骤)                   │
│    ├─ AICoachPanel         (LLM驱动AI教练)                     │
│    ├─ QuizTrainer          (增强测验)                          │
│    ├─ FlashcardDrill       (FSRS闪卡训练)                      │
│    ├─ ConceptMapView       (D3概念图)                          │
│    └─ EngagementWidgets    (游戏化组件)                        │
│                                                                │
└────────────────────────────────────────────────────────────────┘
        │                    │                    │
        ▼                    ▼                    ▼
   REST API            SSE Stream            WebSocket
        │                    │               (可选,实时)
        ▼                    ▼                    ▼
┌─ 后端 (FastAPI + PostgreSQL + Redis) ─────────────────────────┐
│                                                                │
│  路由层                                                        │
│    ├─ /api/v1/learning/*     (学习会话管理)                    │
│    ├─ /api/v1/chat/*         (LLM对话：Socratic + QA)          │
│    ├─ /api/v1/tools/*        (8个学习工具)                     │
│    ├─ /api/v1/disassembly/*  (原有管道，保持不变)               │
│    └─ /api/v1/engagement/*   (成就、排行、统计)                 │
│                                                                │
│  服务层                                                        │
│    ├─ LearningSessionService (会话+步骤编排)                   │
│    ├─ LLMService             (统一LLM调用：GLM/Qwen/OpenAI)    │
│    ├─ StudentModelService    (BKT+IRT混合知识追踪)             │
│    ├─ FlashcardEvolutionService (自进化触发+执行)              │
│    └─ ToolExecutorService    (8个工具的统一执行器)              │
│                                                                │
│  数据层                                                        │
│    ├─ LearningSession        (学习会话记录)                    │
│    ├─ LearningStep           (每一步的完成记录)                 │
│    ├─ StudentProfile         (增强版学生画像)                   │
│    ├─ FlashcardNote/Card     (闪卡+FSRS状态)                  │
│    ├─ ChatConversation       (对话历史)                        │
│    └─ Achievement            (成就+徽章)                       │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### 四、实施路线图（终稿）

#### Phase 1（第1-2周）：学习编排引擎 + 流式加载
- [ ] `LearningOrchestrator` 前端状态机
- [ ] `ProgressRail` 顶部进度组件
- [ ] `StepRenderer` 动态布局渲染
- [ ] 后端流式模块推送（module_ready事件）
- [ ] "一键开始学习"入口

#### Phase 2（第3-4周）：AI教练 + LLM对话
- [ ] 后端 `POST /chat/socratic` LLM驱动对话
- [ ] 后端 `POST /chat/knowledge-qa` RAG知识问答
- [ ] 前端 `AICoachPanel` 替代模板SocraticChat
- [ ] 错题自动触发教练对话
- [ ] 对话上下文注入精讲内容

#### Phase 3（第5-6周）：FSRS闪卡深度集成
- [ ] 后端 `POST /tools/flashcard-generate` API
- [ ] 前端 `FlashcardDrill` 训练组件（Framer Motion翻转）
- [ ] 闪卡自进化触发器（拆分/退役/改写/加提示）
- [ ] 精讲→闪卡 / 错题→闪卡 / 标注→闪卡 三条生成路径
- [ ] ReviewSession FSRS驱动

#### Phase 4（第7-8周）：8个学习工具后端实现
- [ ] `POST /tools/concept-map` 概念图谱
- [ ] `POST /tools/exam-points` 考点提取
- [ ] `POST /tools/mistake-analysis` 易错总结
- [ ] `POST /tools/summary` 一键总结
- [ ] `POST /tools/reading-notes` 精读笔记
- [ ] 前端工具结果渲染组件

#### Phase 5（第9-10周）：学生模型升级 + 动态调整
- [ ] BKT → BKT+IRT混合模型
- [ ] 后端 `POST /learning/feedback` + `POST /learning/replan`
- [ ] 前端动态计划调整（quiz评分→自动插入/跳过步骤）
- [ ] 疲劳检测（连续错误/答题变慢→切换轻松模式）
- [ ] mastery热力图可视化

#### Phase 6（第11-12周）：游戏化 + 社交
- [ ] Scholar Rank等级系统
- [ ] 成就徽章（知识领域Bronze/Silver/Gold）
- [ ] Streak连续天数
- [ ] 周报（Weekly Digest）
- [ ] 课程内排行（匿名可选）
- [ ] 互相出题（Peer Challenge）基础版

#### Phase 7（第13-16周）：多模态增强
- [ ] TTS语音朗读 + 高亮同步
- [ ] D3.js概念图谱可视化
- [ ] 公式推导动画
- [ ] Excalidraw白板集成（可选）

### 五、关键设计决策摘要

| 决策 | 选择 | 理由 |
|------|------|------|
| 学习模式 | 训练式（非课堂模拟） | 测试效应+生成效应>被动听课 |
| 对话引擎 | LLM驱动（非模板） | 真正个性化苏格拉底 |
| 知识追踪 | BKT+IRT混合 | BKT追踪知识点，IRT追踪能力 |
| 闪卡系统 | FSRS+AI自进化 | 长期记忆=核心竞争力 |
| 布局 | 动态切换（非固定70:30） | 不同学习步骤需要不同布局 |
| 游戏化 | 学术风格（Scholar Rank） | 匹配大学生+Editorial设计 |
| 多模态 | 渐进式（TTS优先） | 先做高ROI，白板后做 |
| 社交 | 课程内社区（非全平台） | 精准社交>泛社交 |
| 后端LLM | 统一调用层（支持多模型） | 灵活切换GLM/Qwen/OpenAI |
| 状态管理 | useReducer+Context | 编排引擎需要集中式状态 |

### 六、智阶 2.0 vs OpenMAIC 终极对比

| 维度 | OpenMAIC | 智阶 2.0 | 优势方 |
|------|----------|---------|--------|
| 核心体验 | AI课堂（被动听） | AI教练（主动练） | **智阶** |
| 长期记忆 | ❌ | FSRS自进化闪卡 | **智阶** |
| 个性化 | 统一课堂 | BKT+IRT动态路径 | **智阶** |
| 备考能力 | 无 | 三模式+考点权重 | **智阶** |
| 多模态 | 语音+白板+动画 | TTS+概念图+公式动画 | OpenMAIC |
| 社交互动 | AI同学 | 课程社区+互相出题 | **智阶** |
| 游戏化 | 无 | Scholar Rank+徽章 | **智阶** |
| 一键开始 | ✅ | ✅（自动编排） | 持平 |
| 社区生态 | ❌ | 知识网络+材料库 | **智阶** |
| 设计美学 | 标准UI | Editorial Academic | **智阶** |
| 开源/成本 | 开源+2美元/课 | 自研 | OpenMAIC |

**结论**：智阶 2.0 在**训练效果、长期记忆、个性化、备考、社区**5个维度超越OpenMAIC，仅在**多模态丰富度**上暂时落后（通过渐进式升级追赶）。

---

## 附录：10轮迭代决策日志

| 轮次 | 专家角色 | 核心输出 | 关键修正 |
|------|---------|---------|---------|
| V1 | 产品策略师 | 功能对比表+差异化定位 | 确定"AI教练"而非"AI课堂" |
| V2 | AI教育研究员 | 学习科学理论支撑 | 测试效应>讲授，训练>听课 |
| V3 | 前端UX架构师 | 三种动态布局方案 | 抛弃固定70:30 |
| V4 | 后端架构师 | 事件驱动架构+流式推送 | 管道→事件驱动 |
| V5 | 参与度设计师 | 学术游戏化+留存框架 | Scholar Rank非幼稚XP |
| V6 | 产品策略师(2nd) | "一键开始"体验 | 学习旅程>工具集合 |
| V7 | AI研究员(2nd) | BKT+IRT混合模型 | 纯BKT太简化 |
| V8 | 后端架构师(2nd) | 8个工具完整API | 统一LLM调用层 |
| V9 | 前端+参与度联合 | LearningOrchestrator完整设计 | useReducer集中式状态 |
| V10 | 终审整合 | 最终方案+路线图 | 渐进式多模态 |
