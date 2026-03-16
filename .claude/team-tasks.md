# Agent Team 任务清单 — 智阶新版 Phase 3-5 精细打磨

## 当前状态
- Phase 3-5 功能完成（Agenda、BKT、Flashcard Evolution、Socratic Chat）
- P0 基础修复已完成（DeckList 按钮加强、AgendaTimeline 去重、storage-keys 抽取、ErrorBoundary 创建）
- Build 通过（tsc + vite build 零错误）
- 18 个文件有未提交改动 + 3 个新文件

## 剩余问题

### 🎨 视觉协调（Teammate 1）
- [ ] 新增页面（Agenda、Flashcards）风格与原有页面不够统一
- [ ] 部分卡片仍用 shadow 而非 border
- [ ] 标题层级不一致（有的用 font-heading 有的没有）
- [ ] 某些页面缺少 staggered fade-in 入场动画

### 📦 Mock 数据质量（Teammate 2）
- [ ] 闪卡 mock 数据太少、内容不够真实
- [ ] 日程 mock 数据不够丰富
- [ ] 材料 mock 缺乏多样性
- [ ] 需要真实的大学课程学术内容

### ✨ 交互打磨（Teammate 3）
- [ ] FlashcardCard 翻牌动效需要 3D perspective
- [ ] SocraticChat 消息入场动画 + 打字指示器
- [ ] DailyPlan checkbox 完成动画
- [ ] 页面转场一致性

### 🔧 代码质量（Teammate 4）
- [ ] 文件行数检查（≤400行）
- [ ] 残留硬编码 localStorage key
- [ ] 未使用的 import
- [ ] console.log 清理

## 设计系统速查

```
配色:
  red-primary: #A5192E    — 主操作、accent
  red-dark:    #7F0037    — hover
  bg-main:     #F7F5F2    — 页面背景
  bg-card:     #FFFEFB    — 卡片背景
  bg-accent:   #FFF8F0    — 暖色高亮
  text-main:   #1A1A1A    — 标题
  text-body:   #3D3D3D    — 正文
  text-muted:  #8A8A8A    — 辅助
  accent-gold: #C49A2A    — 成就/徽章
  border-warm: #E8E4DE    — 分割线

字体:
  font-heading: Instrument Serif (衬线标题)
  font-body: Satoshi (无衬线正文)
  font-mono: JetBrains Mono (代码)

原则:
  ✅ Borders over Shadows
  ✅ border-l-3 border-l-red-primary 引用线
  ✅ 暖纸张质感背景
  ✅ staggered fade-in (delay: index * 0.05)
  ❌ 禁止 box-shadow
  ❌ 禁止 Inter/Roboto 字体
  ❌ 禁止紫色渐变
```

## 文件结构
```
src/
├── components/
│   ├── layout/        — Layout, Header, Sidebar
│   ├── workbench/     — MaterialReader, PdfAnnotator, SocraticChat, AIToolPanel(拆分)
│   ├── flashcard/     — FlashcardCard, ReviewSession, DeckList
│   ├── agenda/        — AgendaTimeline, AgendaItem, DailyPlan, ExamCountdown
│   ├── intent/        — LearningPlanPreview
│   └── ErrorBoundary.tsx, Skeleton.tsx
├── lib/
│   ├── storage-keys.ts — localStorage 键名常量
│   ├── fsrs.ts, student-model.ts, agenda-engine.ts, card-evolution.ts
│   └── api.ts
├── pages/             — 12 个页面路由
├── mocks/             — courses, materials, flashcards, agenda, activities
└── index.css          — Tailwind @theme 设计系统
```
