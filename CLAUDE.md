# 智阶新版 - 项目指南

## 项目简介
智阶是一个面向大学生的**课程知识社区 + AI学习工作台**。
技术栈：Vite + React + TypeScript + Tailwind CSS + Framer Motion

## 产品架构（四层结构）
1. **知识网络** — 课程分类节点（离散数学、有机化学...）
2. **学校/班级节点** — 同一课程下按学校分（TUM、ETH...）
3. **材料库** — 带时间/类型 tag 的文档
4. **学习工作台** — 对任意材料调用工具（精读、考点提取、测验生成...）

## 核心决策
- **知识网络冷启动**：预置骨架 + 用户自建 + AI归并
- **社区模式**：课程知识社区，材料默认课程可见
- **工具调用**：意图引导（学透/备考/复习）为主 + 手动覆盖
- **后端**：保留 science1204 后端 API 作 provider
- **AI教师架构**：5层混合架构（学生模型 → 材料分析 → HTN规划 → 事件执行 → 苏格拉底对话）
- **记忆系统**：FSRS 间隔重复算法（ts-fsrs）+ AI 自进化闪卡

## AI 教师架构（5层混合）

### 架构概览
```
Layer 0: 学生模型（驱动所有决策）
  ├── 学习画像：目标(学透/备考/复习)、风格、强弱项
  ├── 知识状态：BKT per-module mastery（0-100%）
  └── 会话上下文：考试倒计时、已学时间、精力状态

Layer 1: 材料分析 + 知识图谱（已有后端 3-Agent 管道）
  ├── Cartographer → 课件拆解为模块
  ├── Specialist → 逐页精讲 Markdown
  └── Examiner → 8-12题结构化测验

Layer 2: HTN 学习路径规划器
  ├── 输入：知识图谱 + 学生模型
  ├── 策略选择：学透=拓扑序全覆盖 / 备考=高权重薄弱优先 / 复习=间隔重复
  └── 输出：可展示给学生确认/调整的个性化计划

Layer 3: 事件驱动执行器
  ├── 每个学习步骤 = 事件，通过 SSE → React 实时渲染
  ├── 支持长任务流式进度（拆解 2-5 分钟）
  └── 支持学生打断（interrupt）→ Agent 响应后恢复

Layer 4: 苏格拉底对话引擎
  ├── 不直接给答案，用结构化提问引导
  └── ZPD 脚手架衰减：mastery 高→少提示多提问
```

### Human-in-the-Loop 反馈信号
| 信号 | 类型 | 回流方式 |
|------|------|---------|
| 测验作答 | 隐式 | BKT 更新 mastery |
| PDF 批注位置 | 隐式（已实现） | 推断困惑区域 |
| 阅读行为 | 隐式 | 停留时间→难度推断 |
| 主动提问 | 显式 | 打断流程，Agent 响应 |
| 学习计划确认 | 显式 | 学生可修改规划 |
| 情绪/精力 | 间接 | 连续答错→降难度 |

### 三种学习模式差异
| 维度 | 学透 | 备考 | 复习 |
|------|------|------|------|
| 模块选择 | 全覆盖，拓扑排序 | 跳过 mastery>70%，优先 exam_weight=high | 只复习 mastery 衰减<60% |
| 工具链 | 精读→概念图→问答→测验 | 考点提取→易错总结→模拟测验 | 闪卡→快速测验 |
| 对话风格 | 耐心展开式 | 直接高密度 | 唤醒式 |
| 时间预期 | 不限 | 根据考试倒计时压缩 | 15-30分钟 |

### 动态策略调整
- **规划时**：根据意图+时间+水平选策略（用意图引导 UI 采集）
- **执行中**：测验后实时更新 mastery → 跳过已会/插入补讲
- **对话中**：mastery 驱动脚手架等级（30%→手把手，80%→只提问）

## 记忆闪卡系统（FSRS + AI 自进化）

### 技术选型
- **调度算法**：FSRS v6（`ts-fsrs` npm 包，599 stars，Anki 默认算法）
- **核心变量**：R(可检索性)、S(稳定性)、D(难度)、G(评分 1-4)
- **卡片 UI**：Framer Motion 自建（无成熟 React 组件库，且需匹配 editorial 设计系统）

### 数据模型
```typescript
// 参照 Anki Note/Card/ReviewLog 三层模型
interface FlashcardNote {
  id: string
  type: 'basic' | 'cloze' | 'reverse' | 'image-occlusion'
  fields: { front: string; back: string; extra?: string }
  tags: string[]                    // 课程/模块/概念标签
  sourceRef: {                      // 溯源
    materialId: string
    moduleId?: string
    slidePage?: number
  }
  createdAt: number
  generatedBy: 'ai' | 'user' | 'ai-evolved'  // 来源
}

interface FlashcardCard {
  id: string
  noteId: string
  // FSRS 状态（由 ts-fsrs 管理）
  due: Date
  stability: number
  difficulty: number
  state: 'new' | 'learning' | 'review' | 'relearning'
  reps: number
  lapses: number
  // 自进化追踪
  consecutiveAgain: number          // 连续"忘记"次数
  consecutiveEasy: number           // 连续"简单"次数
  averageResponseMs?: number        // 平均回答时间
}

interface ReviewLog {
  cardId: string
  rating: 1 | 2 | 3 | 4            // Again/Hard/Good/Easy
  reviewedAt: Date
  responseMs?: number               // 回答耗时
}
```

### AI 闪卡生成
- **来源**：Specialist 精讲 Markdown + Examiner 测验 + PDF 批注
- **卡片类型**：
  | 类型 | 适用场景 | 示例 |
  |------|---------|------|
  | Basic Q&A | 事实记忆 | "波函数的物理意义？" / "概率幅" |
  | Cloze | 公式/定义 | "薛定谔方程：iℏ∂ψ/∂t = {{c1::Ĥψ}}" |
  | Reverse | 双向映射 | 中英术语、符号含义 |
  | Image Occlusion | 图表/电路 | 遮挡图中某部分，要求回忆 |

### 自进化机制（trigger → LLM action）
| 触发条件 | 动作 | 实现 |
|---------|------|------|
| consecutiveAgain ≥ 3 | **拆分**为更简单的子卡 | LLM 分解概念为前置知识 |
| consecutiveEasy ≥ 5 | **退役**或合并 | 移出活跃轮转 |
| lapse_rate > 50% (reps>10) | **改写**问法 | LLM 生成替代表述 |
| 回答慢（>15s） | **加提示** | LLM 生成助记/上下文 |
| 相关卡片集体失败 | **补充前置卡** | LLM 识别缺失的基础概念 |

### 持久化
- **开发阶段**：localStorage（key = `zhijie_flashcards_${courseId}`）
- **正式版**：后端数据库 + 跨设备同步

## 统一日程系统（Agenda）

### 设计理念
将课程学习、闪卡复习、待办事项统一到一个智能日程视图，类似 "学习版 Things 3"。

### 日程项类型
```typescript
type AgendaItem =
  | { type: 'study'; courseId: string; moduleName: string; estimatedMin: number; priority: 'high' | 'medium' | 'low' }
  | { type: 'flashcard-review'; courseId: string; dueCount: number; estimatedMin: number }
  | { type: 'exam-prep'; courseId: string; examDate: string; daysLeft: number }
  | { type: 'todo'; title: string; completed: boolean }
  | { type: 'milestone'; title: string; achievedAt?: number }
```

### 日程生成逻辑
1. **闪卡复习**：FSRS 计算今日到期卡片数 → 自动加入日程
2. **学习计划**：HTN 规划器输出的下一步学习任务 → 自动加入
3. **考试倒计时**：用户设定考试日期 → 自动生成每日备考任务
4. **手动待办**：用户自行添加的学习任务
5. **智能排序**：紧急度（考试倒计时）> 遗忘风险（闪卡到期）> 常规学习

### 首页改造
```
当前首页：4 个静态统计 + 最近课程 + 推荐 + 时间线
     ↓ 改造为
新首页：
  ┌──────────────────────────────────────────┐
  │  📅 今日学习计划                          │
  │  ┌────────────────────────────────────┐  │
  │  │ 🔴 量子力学 备考（后天考试）         │  │
  │  │    模块2重点突破 · 预计15min        │  │
  │  ├────────────────────────────────────┤  │
  │  │ 🟡 离散数学 闪卡复习（24张到期）     │  │
  │  │    预计8min                        │  │
  │  ├────────────────────────────────────┤  │
  │  │ ⬜ 有机化学 继续学习模块3           │  │
  │  │    预计30min                       │  │
  │  └────────────────────────────────────┘  │
  │                                          │
  │  📊 学习数据    🏆 成就                  │
  │  ...                                     │
  └──────────────────────────────────────────┘
```

## 设计系统 — Editorial Academic

### 美学方向
学术期刊/杂志排版质感，区别于竞品的标准 SaaS UI。

### 字体（方案 A）
```css
--font-heading: 'Instrument Serif', 'LXGW WenKai', 'Noto Serif SC', serif;
--font-body: 'Satoshi', 'Noto Sans SC', system-ui, sans-serif;
--font-mono: 'JetBrains Mono', 'Menlo', 'Monaco', monospace;
```
**禁止使用 Inter、Roboto、Arial 等 AI slop 字体。**

### 配色
```
主色:
  red-primary: #A5192E    — 主操作、active、accent
  red-dark:    #7F0037    — hover、强调

背景（暖纸张色系）:
  bg-main:     #F7F5F2    — 全局背景
  bg-card:     #FFFEFB    — 卡片
  bg-accent:   #FFF8F0    — 暖色高亮

文字（墨水色系）:
  text-main:   #1A1A1A    — 标题
  text-body:   #3D3D3D    — 正文
  text-muted:  #8A8A8A    — 辅助

辅助:
  accent-gold: #C49A2A    — 成就/徽章
  border-warm: #E8E4DE    — 分割线
```

### 设计原则
- **Borders over Shadows** — 卡片用 border，不用 box-shadow
- **暖纸张质感** — 微弱 noise texture，非冷灰平面
- **衬线标题 + 无衬线正文** — 学术期刊经典搭配
- **非对称布局** — masonry grid、70:30 阅读比例、generous whitespace
- **红色存在感** — 侧边栏 active bar、装饰线、标题点缀
- **卡片悬浮** — border-left: 3px solid #A5192E（引用线风格）

### 动效
- 页面进入：staggered fade-in（animation-delay 递增）
- 路由切换：crossfade + 轻微 slide
- 卡片 hover：border 颜色过渡到 red-primary
- 加载态：暖色 shimmer 骨架屏
- 引擎：Framer Motion

## 页面路由
```
/                    首页（统一日程 + 学习数据 + 成就）
/explore             知识网络浏览
/course/:id          课程详情（材料库 + Tab分类）
/course/:id/material/:mid  材料工作台（70:30 布局）
/upload              上传（拖拽 + AI归类）
/my/courses          我的课程
/my/materials        我的材料
/my/notes            我的笔记
/my/flashcards       我的闪卡（按课程分 deck，今日复习入口）
/my/flashcards/:deckId/review  闪卡复习会话（FSRS 驱动）
/agenda              完整日程视图（周/月视图）
/auth/*              登录注册
/settings            设置
```

## 必须使用的 Skills
1. **frontend-design** (.claude/skills/) — 所有 UI 工作前必读 SKILL.md
2. **react-best-practices** (.claude/skills/) — 组件开发必读 SKILL.md

## 代码规范
- **零 barrel imports** — 不允许 `components/index.ts` 统一导出
- **重组件 lazy load** — PDF阅读器、图表等用 React.lazy
- **并行请求** — Promise.all，不允许瀑布流
- **长列表** — content-visibility: auto 或虚拟化
- **Suspense 边界** — 配合骨架屏
- **单文件 ≤ 400 行**，函数 ≤ 50 行

## 前端开发经验总结（v1 迭代沉淀）

以下经验来自智阶新版第一轮前端开发，供后续开发参考。

### 1. 设计系统落地要点

**"Editorial Academic" 美学落地清单**：
- 字体加载：Google Fonts 引入 Instrument Serif + Satoshi，中文 LXGW WenKai 用 CDN（字体文件大，避免打包）
- 配色一致性：所有颜色通过 Tailwind `extend.colors` 统一定义（`red-primary`, `bg-main`, `text-body` 等），**永远不硬编码 hex 到组件**
- Borders over Shadows：全局不用 `box-shadow`，卡片用 `border border-border-warm`
- 引用线风格：`border-l-3 border-l-red-primary` 作为强调元素反复使用（blockquote、h2、批注侧栏）
- **经验**：设计系统要在 `tailwind.config.ts` 的 `extend` 中 100% 定义完毕后再写组件，避免后期大面积替换

**使用的 Skill**：
- `frontend-design` — 避免 AI slop（紫色渐变、Inter 字体、无个性 card），确定 editorial 美学方向
- `react-best-practices` — 消除瀑布流请求、barrel imports 禁令、Suspense 边界

### 2. PDF 渲染与批注

**方案选型**：`react-pdf-highlighter-extended`（基于 pdf.js）
- 支持文本高亮选中 + Alt+拖拽区域选中
- 内置 PdfLoader/PdfHighlighter/TextHighlight/AreaHighlight 组件

**关键踩坑 — pdf.js API 与 Worker 版本不匹配**：
```
错误信息：The API version "4.10.38" does not match the Worker version "4.4.168"
原因：react-pdf-highlighter-extended 默认从 CDN 加载 4.4.168 worker，
      但项目 node_modules 中 pdfjs-dist 被提升到 4.10.38
解决：用 Vite 的 ?url 导入本地 worker，传给 PdfLoader 的 workerSrc prop
```
```tsx
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
<PdfLoader workerSrc={pdfjsWorker} ... />
```

**批注持久化**：localStorage，key = `zhijie_highlights_${materialId}`

### 3. Markdown 渲染

**库组合**：`react-markdown` + `remark-math` + `remark-gfm` + `rehype-katex`
- 支持 LaTeX 公式、表格、代码块
- `fixMarkdown()` 预处理函数修复常见问题（LaTeX 管道符、重复 `#`、缺失空格）
- 自定义 `components` 对象将 md 元素映射到 editorial 设计系统样式

### 4. 文件上传与本地持久化

**无后端时的 mock 策略**：
- 上传文件转 base64 存入 localStorage（key = `zhijie_uploaded_materials`）
- PDF 显示时将 base64 转回 Blob URL：`URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))`
- **注意**：localStorage 有 5-10MB 限制，大 PDF 会失败。正式版应改为后端存储

### 5. 组件架构模式

**已验证的模式**：
- **React.lazy + Suspense**：重组件（PdfAnnotator）懒加载，配合暖色 shimmer 骨架屏
- **零 barrel imports**：每个组件直接导入路径，不经过 `index.ts`
- **useMemo 缓存 Blob URL**：避免每次渲染重新解码 base64
- **useCallback + useRef**：PdfHighlighter 工具方法通过 ref 持有，回调函数稳定引用

**文件结构**：
```
src/
├── components/
│   ├── layout/          # Layout, Header, Sidebar
│   ├── workbench/       # MaterialReader, PdfAnnotator, AIToolPanel, RelatedMaterials
│   ├── upload/          # DropZone, FileList, UploadProgress, ClassifyForm
│   ├── flashcard/       # FlashcardDeck, FlashcardCard, ReviewSession, DeckList
│   ├── agenda/          # AgendaTimeline, AgendaItem, DailyPlan, ExamCountdown
│   └── intent/          # IntentGuide, LearningPlanPreview, ContextQuestions
├── lib/
│   ├── fsrs.ts          # ts-fsrs 封装：调度、卡片创建、复习处理
│   ├── student-model.ts # BKT 知识追踪 + 学习画像
│   └── agenda-engine.ts # 日程生成逻辑：合并闪卡/学习/待办
├── pages/               # 每个路由一个页面组件
├── mocks/               # 开发阶段 mock 数据
└── main.tsx
```

### 6. Framer Motion 动效规范

- 页面进入：`initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}`
- 列表 stagger：`transition={{ delay: index * 0.05 }}`
- 保持克制：只做 opacity + 轻微位移，不做夸张弹跳
- **禁止**：自动播放循环动画（分散注意力）

### 7. 多 Agent 协作经验

**Agent Teams 模式**（`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`）：
- 适合从零搭建项目骨架，4-5 个 agent 并行写不同模块
- 需要 `--dangerously-skip-permissions` 避免逐步审批阻塞
- Skill 文件必须**复制**到子项目的 `.claude/skills/` 下（symlink 在 agent subprocess 中无法解析）
- tmux 必须预安装（`brew install tmux`）

**经验**：Agent Teams 适合初期快速搭建，但细节打磨（样式微调、bug 修复）还是单 agent 更可控

### 8. 常见问题速查

| 问题 | 解决方案 |
|------|----------|
| pdf.js API/Worker 版本不匹配 | `import worker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'` + `workerSrc={worker}` |
| LaTeX 公式中 `\|` 渲染失败 | `fixMarkdown()` 将 `\|` 替换为 `\\vert` |
| localStorage 存大 PDF 爆容量 | 限制上传大小 or 改用 IndexedDB / 后端存储 |
| Tailwind 自定义色未生效 | 检查 `tailwind.config.ts` 的 `extend.colors` 是否正确定义 |
| React.lazy 组件白屏 | 确保 Suspense fallback 存在，检查 import 路径 |
| Vite dev server 挂掉 | `npx vite --host` 重启，检查端口 5173 是否被占用 |

## 实施路线图

### Phase 1：意图引导 + 工具接通（2周）
- [ ] AIToolPanel 升级：静态按钮 → 意图引导对话（追问考试时间、当前水平）
- [ ] 后端工具接通：前端调用 science1204 的 `/api/disassembly/start` + `/status/:taskId`
- [ ] 事件驱动流式展示：SSE 推送拆解进度到前端
- [ ] 产出物渲染：Specialist Markdown 嵌入 MaterialReader 的 Tab 中

### Phase 2：记忆闪卡系统（2周，需专门 Agent）
- [ ] `npm install ts-fsrs` 集成 FSRS v6 调度引擎
- [ ] FlashcardCard 组件：Framer Motion 翻转动效，editorial 设计系统
- [ ] ReviewSession 页面：FSRS 驱动的复习流程（Again/Hard/Good/Easy 四按钮）
- [ ] AI 闪卡生成：从 Specialist Markdown + Examiner QuizData 自动生成卡片
- [ ] DeckList 页面：按课程分组的闪卡管理
- [ ] localStorage 持久化（key = `zhijie_flashcards_${courseId}`）

### Phase 3：统一日程 + 首页改造（1周）
- [ ] AgendaEngine：合并闪卡到期 + 学习计划 + 待办 + 考试倒计时
- [ ] HomePage 改造：从静态统计 → 动态"今日学习计划"
- [ ] 考试日期设置 UI + 倒计时驱动的备考任务自动生成
- [ ] 智能排序：紧急度 > 遗忘风险 > 常规学习

### Phase 4：学生模型 + 动态调整（2周）
- [ ] BKT 知识追踪：per-module mastery，测验后自动更新
- [ ] HTN 学习路径规划器：根据 mastery + 目标 + 时间 生成个性化计划
- [ ] 动态重新规划：测验结果触发计划调整（跳过已会/插入补讲）
- [ ] 学习计划确认 UI：Agent 展示计划，学生可调整后执行

### Phase 5：闪卡自进化 + 苏格拉底对话（2周）
- [ ] 自进化触发器：连续忘记→拆分、连续简单→退役、反复错→改写
- [ ] LLM action executor：触发后调用 LLM 生成新卡/改写卡
- [ ] 苏格拉底对话引擎：概念讲解时用提问引导而非直接给答案
- [ ] ZPD 脚手架衰减：mastery 驱动帮助程度

### Phase 6：高级功能（远期）
- [ ] 视频生成接口（TTS + 文生视频 API）
- [ ] 知识图谱可视化（D3.js / react-force-graph）
- [ ] 跨设备同步（后端数据库替代 localStorage）
- [ ] 协作学习（同课程学生互相出题）

## 后端工具清单（science1204）

| 工具 | Agent | 输入 | 输出 | 模式适用 |
|------|-------|------|------|---------|
| Cartographer | 规划器 | 课件PDF+习题PDF | DisassemblyPlan（模块列表+考点映射） | 学透✅ 备考✅ |
| Specialist | 执行器 | 模块PDF+元数据 | 逐页精讲Markdown（含考试陷阱+自测题） | 学透✅ 备考⚠️(需精简) |
| Examiner | 出题器 | 精讲Markdown | 8-12题结构化MCQ（含溯源） | 学透✅ 备考✅ |
| 考点提取 | — | 精讲Markdown | 高频考点列表 | 学透⚠️ 备考✅ |
| 易错总结 | — | 测验结果+精讲 | 错因归纳+易混概念 | 学透⚠️ 备考✅ |
| 闪卡生成 | — | 精讲+测验 | FSRS FlashcardNote[] | 学透✅ 备考✅ 复习✅ |
| 概念图谱 | — | 精讲Markdown | 概念节点+关联边 | 学透✅ 备考⚠️ |
| 知识问答 | — | 精讲+PDF | 交互式问答 | 学透✅ 备考⚠️ |

## ⚠️ 工作区隔离
- 所有操作限制在 `/Users/ziway/Downloads/工程项目/智阶新版/` 内
- **禁止修改**此目录外的任何文件
- 本项目有独立 git 仓库，和父目录/其他项目完全隔离
