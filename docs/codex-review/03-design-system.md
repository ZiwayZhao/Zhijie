# 设计系统一致性审核报告：Editorial Academic

**审核范围**：workbench 组件（6 个文件）
**审核日期**：2026-03-18
**严重等级**：CRITICAL / HIGH / MEDIUM / LOW / INFO

---

## 设计系统基线

颜色变量定义于 `src/index.css` `@theme {}` 块，使用 Tailwind v4 CSS 变量格式：
- `--color-red-primary`, `--color-red-dark`, `--color-bg-main`, `--color-bg-card`, `--color-bg-accent`
- `--color-text-main`, `--color-text-body`, `--color-text-muted`
- `--color-accent-gold`, `--color-border-warm`
- `--color-success` (#4CAF50), `--color-info` (#2196F3)

字体：`--font-heading` (Instrument Serif), `--font-body` (Satoshi), `--font-mono` (JetBrains Mono)

---

## 违规清单

### 1. [MEDIUM] 硬编码 HEX 颜色 — MaterialReader.tsx:410

**文件**：`src/components/workbench/MaterialReader.tsx`
**行号**：410
**代码**：
```tsx
className="block bg-[#1a1a1a] text-[#e5e5e5] p-4 rounded-md overflow-x-auto text-sm font-mono my-4"
```

**问题**：代码块背景和文字使用硬编码 hex 值 `#1a1a1a` 和 `#e5e5e5`，违反"永远不硬编码 hex 到组件"的规则。

**修复建议**：
在 `src/index.css` 的 `@theme {}` 中添加代码块专用变量：
```css
--color-code-bg: #1a1a1a;
--color-code-text: #e5e5e5;
```
然后替换为：
```tsx
className="block bg-code-bg text-code-text p-4 rounded-md overflow-x-auto text-sm font-mono my-4"
```

---

### 2. [LOW] 未使用设计系统定义的 success 颜色 — ModuleDisplay.tsx:98

**文件**：`src/components/workbench/ModuleDisplay.tsx`
**行号**：98
**代码**：
```tsx
<CheckCircle2 size={16} className="text-green-600" />
```

**问题**：`text-green-600` 是 Tailwind 默认色，设计系统已定义 `--color-success: #4CAF50`，应使用 `text-success`。

**修复建议**：
```tsx
<CheckCircle2 size={16} className="text-success" />
```

---

### 3. [INFO] Tailwind 内置语义色使用 — QuizPanel.tsx, ModuleDisplay.tsx

多处使用 Tailwind 内置的 `emerald-*` 和 `amber-*` 色系作为正确/错误/中等状态反馈色：

| 文件 | 行号 | 类名 | 用途 |
|------|------|------|------|
| QuizPanel.tsx | 113 | `bg-emerald-50 text-emerald-700 border-emerald-200` | 难度 badge (easy) |
| QuizPanel.tsx | 114 | `bg-amber-50 text-amber-700 border-amber-200` | 难度 badge (medium) |
| QuizPanel.tsx | 145 | `border-emerald-500 bg-emerald-50/50` | 正确选项 |
| QuizPanel.tsx | 182 | `text-emerald-800` | 正确选项文字 |
| QuizPanel.tsx | 270 | `border-l-emerald-500 bg-emerald-50/50 text-emerald-800` | 正确解释 |
| QuizPanel.tsx | 391 | `text-emerald-600` / `text-amber-600` | 成绩等级 |
| QuizPanel.tsx | 490 | `text-emerald-600` | 正确率百分比 |
| ModuleDisplay.tsx | 145 | `border-l-emerald-500/60` | 已学模块边框 |
| ModuleDisplay.tsx | 152 | `text-emerald-500` | 已学模块图标 |

**评估**：这些是测验反馈和状态指示的语义色，在 UI/UX 中有明确含义（绿=正确、黄=中等、红=错误）。当前设计系统仅定义了 `--color-success` (#4CAF50)，未定义完整的语义色阶（50/100/200/500/700/800）。

**建议**：
- 短期：可接受，这些是功能性语义色而非品牌色
- 长期：在 `@theme {}` 中定义完整的语义色系（success-50, success-500, warning-50, warning-500 等），统一管理

---

## 合规项（通过审核）

### 硬编码颜色
除 MaterialReader.tsx:410 外，**其余 5 个文件均无硬编码 hex/rgb 值**。所有颜色通过 Tailwind 类名引用设计变量（`text-text-main`, `bg-bg-card`, `border-border-warm`, `text-red-primary` 等）。

### 禁用字体
**全部 6 个文件均未使用 Inter、Roboto、Arial**。标题使用 `font-heading`，正文使用 `font-body`，等宽使用 `font-mono`。

### box-shadow
**全部 6 个文件均未使用 `shadow-*` Tailwind 类**。所有卡片和容器使用 `border border-border-warm` 分割。完全遵守 "Borders over Shadows" 原则。

### 紫色/蓝色
**全部 6 个文件均未使用 `purple`、`violet`、`indigo`、`blue` 类名**。主色调为红色系（`red-primary`, `red-dark`）。

### 引用线风格
正确使用 `border-l-3 border-l-red-primary` 引用线风格：
- MaterialReader.tsx:356 — h2 标题
- MaterialReader.tsx:382 — blockquote
- QuizPanel.tsx:268-271 — 答题解释
- ModuleDisplay.tsx:141, 286, 289 — 模块卡片和工具卡片

### 动效规范
所有 Framer Motion 动效遵守规范：
- 页面进入：`opacity: 0, y: 8-12` → `opacity: 1, y: 0`（轻微位移）
- 列表 stagger：`delay: index * 0.05-0.06`
- ProcessingView.tsx:123 有 `scale: [1, 1.4, 1]` 脉冲效果，用于活跃状态指示环，属于功能性微动效，可接受
- **无**夸张弹跳、旋转、spring 动画
- **无**自动播放循环装饰动画（pulse 用于加载指示，功能性）

---

## 总结

| 等级 | 数量 | 说明 |
|------|------|------|
| CRITICAL | 0 | — |
| HIGH | 0 | — |
| MEDIUM | 1 | 硬编码 hex (MaterialReader code block) |
| LOW | 1 | `text-green-600` 应改为 `text-success` |
| INFO | 1 | 语义色使用 Tailwind 内置色系，建议长期统一 |

**整体评价**：设计系统一致性良好。6 个文件中绝大部分元素正确使用了 Editorial Academic 设计变量。主要问题仅限于代码块的硬编码颜色和一处 success 色未引用设计变量。无 CRITICAL 或 HIGH 级别违规。
