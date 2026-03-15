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
- **工具调用**：意图引导（学透/备考）为主 + 手动覆盖
- **后端**：保留 science1204 后端 API 作 provider

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
/                    首页（dashboard / 发现）
/explore             知识网络浏览
/course/:id          课程详情（材料库 + Tab分类）
/course/:id/material/:mid  材料工作台（70:30 布局）
/upload              上传（拖拽 + AI归类）
/my/courses          我的课程
/my/materials        我的材料
/my/notes            我的笔记
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

## ⚠️ 工作区隔离
- 所有操作限制在 `/Users/ziway/Downloads/工程项目/智阶新版/` 内
- **禁止修改**此目录外的任何文件
- 本项目有独立 git 仓库，和父目录/其他项目完全隔离
