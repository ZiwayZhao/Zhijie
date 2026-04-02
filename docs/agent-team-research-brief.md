# Agent Team 研究任务书：智阶工作台升级方案

## 任务目标
对智阶学习工作台进行全面升级设计，超越竞品 OpenMAIC（清华开源AI课堂）。

## 竞品 OpenMAIC 核心能力
1. 多Agent课堂模拟：AI老师+AI助教+AI同学，LangGraph编排
2. 语音教学：TTS语音+白板标注+高亮同步
3. 28+原子操作：白板绘制、公式推导、激光笔、场景切换
4. 自动节奏控制：LangGraph状态机管理讲课/讨论/测验状态
5. 课堂结业率40%（传统MOOC仅5%）
6. 1个课件+2美元+30分钟=一堂完整AI课
7. PBL项目式学习+圆桌辩论模式

## 其他竞品
- Khanmigo（Khan Academy）：苏格拉底式LLM辅导
- NotebookLM（Google）：多源文档对话+播客生成
- Duolingo：极致游戏化+FSRS间隔重复

## 智阶现状（审计报告摘要）
- 技术栈：Vite+React+TypeScript+Tailwind+Framer Motion
- 后端：FastAPI+PostgreSQL+Redis
- 核心管道：Parsing→Cartographer→Specialist→Examiner（5阶段SSE管道）
- 设计系统：Editorial Academic（衬线标题+暖纸张色+红色主色调）
- ✅ 已实现：PDF拆解、精讲生成、测验生成、BKT知识追踪、FSRS闪卡集成
- ⚠️ 问题：8个手动工具无后端、苏格拉底对话是模板制非LLM、学习路径静态不调整、无语音/白板、无游戏化/社交

## 需要研究的方向

### 第一阶段：核心学习体验
1. 学习编排引擎设计（LearningOrchestrator）
2. AI教练对话（从模板升级为LLM驱动Socratic）
3. 流式模块加载（Specialist完成一个推送一个）
4. 动态学习路径（测验/闪卡反馈→自动调整计划）

### 第二阶段：闪卡+知识追踪
5. FSRS深度集成 + AI自进化闪卡
6. BKT→BKT+IRT混合知识追踪模型
7. 三种学习模式（学透/备考/复习）的差异化体验

### 第三阶段：前端交互体验
8. 工作台动态布局（阅读/训练/对话三种模式自动切换）
9. 进度可视化（ProgressRail + mastery热力图）
10. Framer Motion动效规范升级
11. 移动端适配

### 第四阶段：后端工具+多模态
12. 8个手动工具API设计（概念图谱/考点提取/易错总结/精读笔记/知识问答/闪卡生成/一键总结/模拟测验）
13. 统一LLM调用层（支持GLM/Qwen/OpenAI切换）
14. TTS语音朗读+高亮同步
15. D3.js概念图谱可视化

### 第五阶段：参与度+社交
16. 学术游戏化（Scholar Rank/徽章/Streak/周报）
17. 课程社区（排行/互相出题/学习伙伴）
18. 疲劳检测+自动节奏调整
19. "一键开始学习"零摩擦体验

## 关键文件位置
- 审计报告: docs/workbench-audit-2026-03-17.md
- 初步方案: docs/workbench-upgrade-plan-v10.md
- 前端核心: src/components/workbench/AIToolPanel.tsx
- 后端管道: backend/app/api/v1/disassembly.py
- 学生模型: src/lib/student-model.ts
- 闪卡系统: src/lib/fsrs.ts
- API层: src/lib/api.ts
- 项目指南: CLAUDE.md

## 要求
- 每个方向至少讨论3轮以上
- 给出具体的代码级实现方案
- 前端设计要符合 Editorial Academic 美学
- 所有方案必须考虑现有代码的兼容性
- 最终输出到 docs/agent-team-final-report.md
