# AI 教练与知识追踪系统设计方案

> 研究日期：2026-03-18
> 基于：SocraticChat.tsx、student-model.ts、disassembly.py、workbench-audit-2026-03-17.md 的完整分析

---

## A. LLM 驱动 Socratic 对话引擎

### A.1 现状分析

当前 `SocraticChat.tsx` 采用**纯模板制**：按 scaffold level（full/moderate/minimal）维护三组 `ResponseTemplate[]`，每次用户发送消息后随机选取一条模板填入 `moduleName` 和消息片段，800ms 延迟后返回。优点是零延迟、零成本；缺点是无法理解学生的实际回答内容，所有"追问"都是预设的，hint 也是固定文本。

升级目标：保留 ZPD 脚手架等级机制，将模板响应替换为真正的 LLM 调用，同时注入精讲 Markdown 作为知识背景，使教练能针对学生的具体困惑给出个性化引导。

### A.2 System Prompt 设计

System Prompt 分为**固定骨架**和**动态注入段**两部分。固定骨架定义角色和行为规范；动态段根据 scaffold level、当前模块、精讲内容实时拼接。

```python
# backend/app/services/socratic_prompt.py

SYSTEM_PROMPT_TEMPLATE = """你是一位苏格拉底式 AI 教练，专门辅导大学生学习。

## 核心原则
- 永远不直接给出答案，用提问引导学生自己发现
- 每次回复最多提出 1-2 个引导性问题
- 如果学生明确要求直接解释，可以给出简要解释后立即追问理解
- 用中文回复，学术术语保留原文并附中文解释

## 当前脚手架等级：{scaffold_level}

{scaffold_instructions}

## 当前学习模块
- 模块名称：{module_name}
- 学生掌握度：{mastery_percent}%
- 学习目标：{learning_goal}

## 知识背景（精讲内容摘要）
以下是本模块的精讲 Markdown，你可以基于这些内容提问和引导：

<knowledge_context>
{specialist_markdown_truncated}
</knowledge_context>

## 回复格式
- 控制在 150 字以内（挑战模式可更短）
- 如果学生的回答涉及误解，温和指出并用问题引导纠正
- 可以使用 LaTeX 公式（用 $ 包裹行内，$$ 包裹独立公式）
"""

SCAFFOLD_INSTRUCTIONS = {
    "full": """引导模式（mastery < 30%）：
- 从最基础的概念开始，一步一步构建理解
- 使用类比和日常生活例子
- 每个问题只涉及一个知识点
- 如果学生连续答不上来，主动给出脚手架提示
- 鼓励为主，避免让学生感到挫败""",

    "moderate": """讨论模式（30% <= mastery < 70%）：
- 假设学生有基础知识，追问深层理解
- 要求学生总结、比较、找关联
- 适当引入反例和边界条件
- 可以挑战学生的表述精确度""",

    "minimal": """挑战模式（mastery >= 70%）：
- 提出高阶思维问题：应用、分析、评价、创造
- 要求学生构造反例或解释设计动机
- 鼓励跨学科联想
- 问题简短直接，不需要过多铺垫
- 偶尔故意给出"错误"观点让学生纠正""",
}
```

### A.3 对话上下文管理

精讲 Markdown 可能有数千字，直接全量注入会浪费 token。采用**截断 + 相关段落检索**的混合策略：

```python
# backend/app/services/context_manager.py

import re
from typing import list

MAX_CONTEXT_CHARS = 3000  # 约 1500 token（中文）

def extract_relevant_sections(
    specialist_markdown: str,
    user_message: str,
    max_chars: int = MAX_CONTEXT_CHARS,
) -> str:
    """从精讲 Markdown 中提取与用户问题最相关的段落。

    策略：
    1. 按 ## 标题拆分为段落
    2. 用关键词匹配计分（简单 TF 方式，避免引入向量模型）
    3. 取 top-k 段落，拼接后截断
    """
    sections = re.split(r'\n(?=##\s)', specialist_markdown)
    if not sections:
        return specialist_markdown[:max_chars]

    # 简单关键词匹配打分
    keywords = set(user_message.lower().split())
    scored = []
    for section in sections:
        score = sum(1 for kw in keywords if kw in section.lower())
        scored.append((score, section))

    # 按相关度降序，取满 max_chars
    scored.sort(key=lambda x: x[0], reverse=True)
    result_parts = []
    total = 0
    for _, section in scored:
        if total + len(section) > max_chars:
            remaining = max_chars - total
            if remaining > 100:
                result_parts.append(section[:remaining] + "...")
            break
        result_parts.append(section)
        total += len(section)

    return "\n\n".join(result_parts)


def build_message_history(
    messages: list[dict],
    max_turns: int = 10,
) -> list[dict]:
    """截取最近 N 轮对话，保持上下文窗口可控。"""
    # 始终保留第一条（欢迎消息提供上下文）
    if len(messages) <= max_turns:
        return messages
    return [messages[0]] + messages[-(max_turns - 1):]
```

### A.4 后端 API 设计

```python
# backend/app/api/v1/chat.py

import json
import logging
from typing import AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.services.socratic_prompt import (
    SYSTEM_PROMPT_TEMPLATE,
    SCAFFOLD_INSTRUCTIONS,
)
from app.services.context_manager import (
    extract_relevant_sections,
    build_message_history,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/chat", tags=["chat"])


class SocraticChatRequest(BaseModel):
    module_id: str
    module_name: str
    mastery: float                    # 0-1
    learning_goal: str                # "learn" | "exam" | "review"
    specialist_markdown: str | None   # 精讲内容（可选，用于知识背景注入）
    messages: list[dict]              # [{"role": "user"|"assistant", "content": "..."}]
    # 可选：错题触发场景
    trigger_context: dict | None = None  # {"type": "quiz_error", "question": "...", "wrong_answer": "...", "correct_answer": "..."}


class SocraticChatChunk(BaseModel):
    """SSE 单个 chunk"""
    type: str         # "token" | "hint" | "done" | "error"
    content: str      # token 文本 或 hint 文本 或 空
    hint: str | None = None


@router.post("/socratic")
async def socratic_chat(
    body: SocraticChatRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """苏格拉底对话 — SSE 流式响应。

    请求体包含完整对话历史 + 模块上下文，
    后端构建 system prompt 后调用 LLM，流式返回。
    """
    # 确定脚手架等级
    if body.mastery < 0.3:
        scaffold = "full"
    elif body.mastery < 0.7:
        scaffold = "moderate"
    else:
        scaffold = "minimal"

    # 构建知识背景
    knowledge_context = ""
    if body.specialist_markdown:
        last_user_msg = ""
        for msg in reversed(body.messages):
            if msg.get("role") == "user":
                last_user_msg = msg["content"]
                break
        knowledge_context = extract_relevant_sections(
            body.specialist_markdown, last_user_msg
        )

    # 构建 system prompt
    system_prompt = SYSTEM_PROMPT_TEMPLATE.format(
        scaffold_level=scaffold,
        scaffold_instructions=SCAFFOLD_INSTRUCTIONS[scaffold],
        module_name=body.module_name,
        mastery_percent=round(body.mastery * 100),
        learning_goal={"learn": "深度理解", "exam": "备考冲刺", "review": "巩固复习"}.get(body.learning_goal, "学习"),
        specialist_markdown_truncated=knowledge_context or "(暂无精讲内容)",
    )

    # 错题触发：在 system prompt 末尾追加上下文
    if body.trigger_context and body.trigger_context.get("type") == "quiz_error":
        ctx = body.trigger_context
        system_prompt += f"""

## 错题触发上下文
学生刚在测验中答错了以下题目，请围绕这个知识点展开引导：
- 题目：{ctx.get('question', '')}
- 学生选择：{ctx.get('wrong_answer', '')}
- 正确答案：{ctx.get('correct_answer', '')}
请不要直接告诉学生正确答案，而是用苏格拉底式提问引导学生理解为什么自己的选择有误。"""

    # 截取对话历史
    trimmed_messages = build_message_history(body.messages, max_turns=10)

    # 构建 LLM 请求
    llm_messages = [{"role": "system", "content": system_prompt}]
    llm_messages.extend(trimmed_messages)

    async def stream_response() -> AsyncGenerator:
        try:
            import httpx
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(
                    f"{settings.llm_api_base}/chat/completions",
                    headers={"Authorization": f"Bearer {settings.llm_api_key}"},
                    json={
                        "model": settings.socratic_model or "glm-4-flash",
                        "messages": llm_messages,
                        "stream": True,
                        "temperature": 0.7,
                        "max_tokens": 500,
                    },
                )
                full_response = ""
                async for line in response.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    data = line[6:]
                    if data == "[DONE]":
                        break
                    chunk = json.loads(data)
                    delta = chunk.get("choices", [{}])[0].get("delta", {})
                    token = delta.get("content", "")
                    if token:
                        full_response += token
                        yield {
                            "event": "token",
                            "data": json.dumps({"type": "token", "content": token}),
                        }

                # 流结束后，生成渐进式提示（如果是 full scaffold）
                if scaffold == "full" and body.specialist_markdown:
                    hint = _generate_hint(body.module_name, knowledge_context)
                    yield {
                        "event": "hint",
                        "data": json.dumps({"type": "hint", "content": hint}),
                    }

                yield {
                    "event": "done",
                    "data": json.dumps({"type": "done", "content": ""}),
                }

        except Exception as e:
            logger.error("Socratic chat error: %s", e)
            yield {
                "event": "error",
                "data": json.dumps({"type": "error", "content": str(e)}),
            }

    return EventSourceResponse(stream_response())


def _generate_hint(module_name: str, context: str) -> str:
    """基于知识背景生成简短提示（非 LLM，直接提取关键概念）。"""
    # 简单实现：提取 ** 包裹的关键词
    import re
    bold_terms = re.findall(r'\*\*(.+?)\*\*', context)
    if bold_terms:
        terms = "、".join(bold_terms[:3])
        return f"提示：回忆一下 {module_name} 中这些关键概念——{terms}。它们之间有什么联系？"
    return f"提示：试着回忆 {module_name} 课件中的核心定义，从最基础的概念出发。"
```

### A.5 前端 AICoachPanel 组件设计

替代当前 `SocraticChat`，核心改动：(1) 调用后端 SSE 而非本地模板；(2) 支持流式渲染；(3) 错题触发入口。

```typescript
// src/components/workbench/AICoachPanel.tsx — 关键接口与 hook

interface AICoachPanelProps {
  moduleId: string
  moduleName: string
  mastery: number
  learningGoal: 'learn' | 'exam' | 'review'
  specialistMarkdown?: string | null
  triggerContext?: QuizErrorTrigger | null  // 错题触发
  onClose: () => void
  onMasteryUpdate?: (moduleId: string, newMastery: number) => void
}

interface QuizErrorTrigger {
  type: 'quiz_error'
  question: string
  wrongAnswer: string
  correctAnswer: string
}

// 核心 hook：管理 SSE 流式对话
function useSocraticStream() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [currentHint, setCurrentHint] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const sendMessage = useCallback(async (
    userMessage: string,
    context: {
      moduleId: string
      moduleName: string
      mastery: number
      learningGoal: string
      specialistMarkdown?: string | null
      triggerContext?: QuizErrorTrigger | null
    }
  ) => {
    // 添加用户消息
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: userMessage,
    }
    setMessages(prev => [...prev, userMsg])
    setIsStreaming(true)
    setCurrentHint(null)

    // 构建 SSE 请求
    const allMessages = [...messages, userMsg].map(m => ({
      role: m.role,
      content: m.content,
    }))

    abortRef.current = new AbortController()
    const assistantId = `assistant-${Date.now()}`
    let fullContent = ''

    try {
      const response = await fetch('/api/v1/chat/socratic', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getToken()}`,
        },
        body: JSON.stringify({
          module_id: context.moduleId,
          module_name: context.moduleName,
          mastery: context.mastery,
          learning_goal: context.learningGoal,
          specialist_markdown: context.specialistMarkdown,
          messages: allMessages,
          trigger_context: context.triggerContext,
        }),
        signal: abortRef.current.signal,
      })

      const reader = response.body!.getReader()
      const decoder = new TextDecoder()

      // 先添加空的 assistant 消息，后续逐 token 填充
      setMessages(prev => [...prev, {
        id: assistantId,
        role: 'assistant',
        content: '',
      }])

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const text = decoder.decode(value)
        for (const line of text.split('\n')) {
          if (!line.startsWith('data: ')) continue
          const data = JSON.parse(line.slice(6))

          if (data.type === 'token') {
            fullContent += data.content
            setMessages(prev =>
              prev.map(m =>
                m.id === assistantId ? { ...m, content: fullContent } : m
              )
            )
          } else if (data.type === 'hint') {
            setCurrentHint(data.content)
            setMessages(prev =>
              prev.map(m =>
                m.id === assistantId ? { ...m, hint: data.content } : m
              )
            )
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error('Socratic stream error:', err)
      }
    } finally {
      setIsStreaming(false)
    }
  }, [messages])

  const stopStream = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  return { messages, isStreaming, currentHint, sendMessage, stopStream, setMessages }
}
```

### A.6 错题自动触发教练对话

当学生在 QuizPanel 中答错时，自动弹出教练面板并注入错题上下文：

```typescript
// 在 WorkbenchPage.tsx 中的集成逻辑

function handleQuizAnswer(
  questionIndex: number,
  selectedOption: string,
  isCorrect: boolean,
  question: MCQuestion,
) {
  // 更新 BKT mastery
  const signal: FeedbackSignal = {
    type: 'quiz-answer',
    moduleId: currentModuleId!,
    courseId: course!.id,
    correct: isCorrect,
  }
  const updatedProfile = processFeedback(profile, signal)
  saveProfile(updatedProfile)

  // 如果答错，设置错题触发上下文
  if (!isCorrect) {
    setQuizErrorTrigger({
      type: 'quiz_error',
      question: question.stem,
      wrongAnswer: selectedOption,
      correctAnswer: question.options[question.answer_index],
    })
    // 连续答错 2 题以上，自动弹出教练面板
    consecutiveErrors.current += 1
    if (consecutiveErrors.current >= 2) {
      setShowCoach(true)  // 自动打开 AICoachPanel
    }
  } else {
    consecutiveErrors.current = 0
  }
}
```

### A.7 渐进式提示实现

在 full scaffold 模式下，教练采用三级提示策略：

```
用户提问 → 第 1 轮回复：纯引导性提问（不给任何实质信息）
         → 用户仍困惑 → 第 2 轮：给出方向性提示（hint）
         → 用户仍答不上 → 第 3 轮：给出部分解释 + 追问确认理解
```

后端通过在 system prompt 中追加对话轮次计数来控制：

```python
# 在 socratic_chat() 中，统计同一话题的连续轮次
user_turns_on_topic = sum(
    1 for m in trimmed_messages
    if m["role"] == "user"
)

if scaffold == "full" and user_turns_on_topic >= 4:
    system_prompt += """

## 渐进提示指令
学生已经在这个话题上提问了多轮，似乎遇到了较大困难。
现在可以适当给出部分解释（不超过 2 句），然后用一个确认性问题收尾，
例如"你理解了吗？能用自己的话复述一下这个概念的核心吗？"
"""
```

---

## B. BKT+IRT 混合知识追踪模型

### B.1 当前 BKT 实现分析

`student-model.ts` 实现了标准 BKT（Bayesian Knowledge Tracing），核心逻辑在 `updateMasteryBKT()`：

- **4 个参数**：pL0（初始掌握概率 0.3）、pT（转移概率 0.09）、pG（猜对概率 0.25）、pS（失误概率 0.10）
- **更新公式**：先根据答对/答错计算后验 P(L|obs)，再加 transition 得到新 mastery
- **局限性**：
  1. 所有模块共用同一组参数，无法区分"容易猜对"的选择题和"难以猜对"的应用题
  2. 不考虑题目难度——答对一道简单题和一道难题给 mastery 的提升相同
  3. 不考虑答题时间——快速正确和犹豫后正确含义不同

### B.2 IRT 集成方案

IRT（Item Response Theory）的核心思想：每道题有一个难度参数 b，学生有一个能力参数 theta，答对概率由两者的差决定。

选择 **2PL 模型**（Two-Parameter Logistic），因为它比 1PL 多了区分度参数 a，能更好地建模不同类型题目的信息量：

```
P(correct | theta, a, b) = 1 / (1 + exp(-a * (theta - b)))
```

- **theta**：学生能力值（实数，可正可负）
- **a**：题目区分度（>0，越大越能区分高低能力学生）
- **b**：题目难度（实数，值越大题目越难）

### B.3 混合模型 TypeScript 接口

```typescript
// src/lib/knowledge-tracker.ts

/** IRT 题目参数 */
export interface IRTItemParams {
  itemId: string
  difficulty: number      // b 参数，范围约 [-3, 3]
  discrimination: number  // a 参数，范围约 [0.5, 2.5]
  guessing: number        // c 参数（3PL 可选），默认 0.25 for MCQ
}

/** 混合模型的模块状态 */
export interface HybridModuleMastery {
  moduleId: string
  moduleName: string
  courseId: string

  // BKT 层
  bktMastery: number         // P(L) 0-1
  totalAttempts: number
  correctAttempts: number

  // IRT 层
  theta: number              // 能力参数，初始 0
  thetaSE: number            // 标准误，初始 1.0（不确定度高）

  // 融合层
  effectiveMastery: number   // 加权融合值，用于驱动 scaffold 和路径规划

  // 行为追踪
  avgResponseMs: number      // 平均答题时间
  recentResponseMs: number[] // 最近 10 次答题时间
  lastUpdated: number
}

/** 反馈信号扩展 */
export type EnhancedFeedbackSignal =
  | {
      type: 'quiz-answer'
      moduleId: string
      courseId: string
      correct: boolean
      itemParams?: IRTItemParams   // 题目 IRT 参数
      responseMs?: number          // 答题耗时
      moduleName?: string
    }
  | {
      type: 'flashcard-rating'
      moduleId: string
      courseId: string
      rating: 1 | 2 | 3 | 4
      responseMs?: number
      moduleName?: string
    }
  | {
      type: 'study-time'
      courseId: string
      durationMin: number
    }
  | {
      type: 'response-time'
      moduleId: string
      courseId: string
      responseMs: number
    }
```

### B.4 theta 估计算法

采用 **EAP（Expected A Posteriori）** 近似，比 MLE 更稳定（尤其是答题少时不会发散）：

```typescript
// src/lib/irt-estimator.ts

const THETA_GRID_MIN = -4
const THETA_GRID_MAX = 4
const THETA_GRID_STEPS = 81  // 0.1 步长

/** 2PL IRT 答对概率 */
export function irtProbCorrect(
  theta: number,
  a: number,
  b: number,
  c: number = 0,
): number {
  return c + (1 - c) / (1 + Math.exp(-a * (theta - b)))
}

/** EAP 估计：给定答题历史，估计 theta */
export function estimateThetaEAP(
  responses: Array<{ correct: boolean; item: IRTItemParams }>,
  priorMean: number = 0,
  priorSD: number = 1,
): { theta: number; se: number } {
  const step = (THETA_GRID_MAX - THETA_GRID_MIN) / THETA_GRID_STEPS
  let numerator = 0
  let denominator = 0
  let numerator2 = 0  // for variance

  for (let i = 0; i <= THETA_GRID_STEPS; i++) {
    const t = THETA_GRID_MIN + i * step

    // Prior: N(priorMean, priorSD^2)
    const prior = Math.exp(-0.5 * ((t - priorMean) / priorSD) ** 2)

    // Likelihood: product of P(response | theta) for each item
    let logLik = 0
    for (const { correct, item } of responses) {
      const p = irtProbCorrect(t, item.discrimination, item.difficulty, item.guessing)
      logLik += correct ? Math.log(p + 1e-10) : Math.log(1 - p + 1e-10)
    }
    const likelihood = Math.exp(logLik)

    const posterior = prior * likelihood
    numerator += t * posterior * step
    numerator2 += t * t * posterior * step
    denominator += posterior * step
  }

  if (denominator < 1e-20) {
    return { theta: priorMean, se: priorSD }
  }

  const thetaEAP = numerator / denominator
  const variance = numerator2 / denominator - thetaEAP ** 2
  const se = Math.sqrt(Math.max(variance, 0.01))

  return { theta: thetaEAP, se }
}
```

### B.5 BKT + IRT 融合更新

```typescript
// src/lib/knowledge-tracker.ts

const BKT_WEIGHT = 0.4   // BKT 在融合中的权重
const IRT_WEIGHT = 0.6   // IRT 在融合中的权重

export function updateHybridMastery(
  state: HybridModuleMastery,
  signal: EnhancedFeedbackSignal & { type: 'quiz-answer' },
  bktParams: BKTParams = DEFAULT_BKT,
): HybridModuleMastery {
  // 1. BKT 更新（沿用现有逻辑）
  const bktModule: ModuleMastery = {
    moduleId: state.moduleId,
    moduleName: state.moduleName,
    courseId: state.courseId,
    mastery: state.bktMastery,
    lastUpdated: state.lastUpdated,
    totalAttempts: state.totalAttempts,
    correctAttempts: state.correctAttempts,
  }
  const updatedBKT = updateMasteryBKT(bktModule, signal.correct, bktParams)

  // 2. IRT 更新（如果有题目参数）
  let newTheta = state.theta
  let newThetaSE = state.thetaSE
  if (signal.itemParams) {
    // 增量 EAP：用当前 theta 作为先验均值
    const result = estimateThetaEAP(
      [{ correct: signal.correct, item: signal.itemParams }],
      state.theta,
      state.thetaSE,
    )
    newTheta = result.theta
    newThetaSE = result.se
  }

  // 3. 融合 effectiveMastery
  // BKT mastery 是 [0,1]；IRT theta 需要映射到 [0,1]
  const irtMastery = 1 / (1 + Math.exp(-newTheta))  // logistic 映射
  const effectiveMastery = BKT_WEIGHT * updatedBKT.mastery + IRT_WEIGHT * irtMastery

  // 4. 更新答题时间追踪
  const recentMs = [...state.recentResponseMs]
  if (signal.responseMs) {
    recentMs.push(signal.responseMs)
    if (recentMs.length > 10) recentMs.shift()
  }
  const avgMs = recentMs.length > 0
    ? recentMs.reduce((a, b) => a + b, 0) / recentMs.length
    : state.avgResponseMs

  return {
    ...state,
    bktMastery: updatedBKT.mastery,
    totalAttempts: updatedBKT.totalAttempts,
    correctAttempts: updatedBKT.correctAttempts,
    theta: newTheta,
    thetaSE: newThetaSE,
    effectiveMastery: Math.min(Math.max(effectiveMastery, 0), 1),
    avgResponseMs: avgMs,
    recentResponseMs: recentMs,
    lastUpdated: Date.now(),
  }
}
```

### B.6 各反馈信号处理逻辑

| 信号类型 | BKT 处理 | IRT 处理 | 行为追踪 |
|---------|---------|---------|---------|
| quiz-answer | correct → 后验更新 + transition | 有 itemParams 时做 EAP 更新 theta | 记录 responseMs |
| flashcard-rating | rating>=3 视为 correct | 暂不参与（闪卡无 IRT 参数） | 记录 responseMs |
| study-time | 不参与 | 不参与 | 累加 totalStudyMinutes |
| response-time | 不参与 | 不参与 | 更新 recentResponseMs |

---

## C. 动态学习路径调整

### C.1 后端 API

```python
# backend/app/api/v1/learning.py

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.db.session import get_db
from app.models.user import User

router = APIRouter(prefix="/learning", tags=["learning"])


class FeedbackRequest(BaseModel):
    """学习反馈上报"""
    module_id: str
    course_id: str
    signal_type: str  # "quiz-answer" | "flashcard-rating" | "study-time" | "fatigue"
    payload: dict     # 信号特定数据


class FeedbackResponse(BaseModel):
    mastery_before: float
    mastery_after: float
    adjustment: dict | None  # 如果触发了路径调整，返回调整建议


@router.post("/feedback", response_model=FeedbackResponse)
async def submit_feedback(
    body: FeedbackRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """上报学习反馈，返回 mastery 变化和可能的路径调整建议。"""
    # 1. 加载用户的 LearningProfile（从 DB 或缓存）
    # 2. 应用 BKT+IRT 更新
    # 3. 检查是否触发路径调整
    # 4. 返回结果
    ...


class ReplanRequest(BaseModel):
    """请求重新规划学习路径"""
    course_id: str
    material_id: str
    task_id: str
    current_step_index: int    # 当前进行到第几步
    intent: str                # "learn" | "exam" | "review"
    time_remaining_min: int | None  # 剩余可用时间


class ReplanResponse(BaseModel):
    steps: list[dict]          # 新的学习步骤列表
    reason: str                # 调整原因
    changes_summary: str       # 人可读的变更摘要


@router.post("/replan", response_model=ReplanResponse)
async def replan_learning_path(
    body: ReplanRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """根据当前 mastery 状态重新规划学习路径。"""
    ...
```

### C.2 调整触发条件表

| 信号 | 检测条件 | 动作 | 优先级 |
|------|---------|------|--------|
| quiz-answer | 单模块正确率 < 40%（至少 5 题） | 插入前置模块复习 + 降低后续模块难度 | HIGH |
| quiz-answer | 单模块正确率 > 90%（至少 5 题） | 跳过该模块的深度学习步骤 | MEDIUM |
| flashcard-rating | 连续 3 张 rating=1 (Again) | 暂停当前 deck，切换到相关基础模块 | HIGH |
| flashcard-rating | 连续 5 张 rating=4 (Easy) | 建议退役该 deck，推进到下一模块 | LOW |
| response-time | 最近 5 题平均时间 > 2x 历史均值 | 触发疲劳检测，建议休息或降难度 | HIGH |
| study-time | 连续学习 > 45 分钟无休息 | 弹出休息建议，暂停自动推进 | MEDIUM |
| mastery-decay | 模块 mastery 从 >0.7 衰减到 <0.5 | 自动加入复习日程 | MEDIUM |
| cross-module | 依赖模块 mastery < 0.4，当前模块正确率下降 | 回退到依赖模块重新学习 | HIGH |

### C.3 前端路径调整展示

```typescript
// src/components/workbench/PathAdjustmentToast.tsx

interface PathAdjustmentProps {
  reason: string
  changesSummary: string
  newSteps: LearningPlanStep[]
  onAccept: () => void
  onDismiss: () => void
}

/**
 * 当后端返回路径调整建议时，以 toast 形式展示：
 *
 * ┌─────────────────────────────────────────┐
 * │ ⚡ 学习路径已调整                         │
 * │                                           │
 * │ 检测到"模块3"掌握度不足（35%），已为你    │
 * │ 插入前置知识复习步骤。                     │
 * │                                           │
 * │ 变更：+1 复习步骤，预计多花 10 分钟        │
 * │                                           │
 * │         [查看新计划]    [暂时跳过]          │
 * └─────────────────────────────────────────┘
 *
 * 用户点击"查看新计划"后展开完整的修改后步骤列表。
 */
```

前端接收调整信号的流程：

1. `QuizPanel` 每次答题后调用 `POST /api/v1/learning/feedback`
2. 如果响应中 `adjustment !== null`，触发 `PathAdjustmentToast`
3. 用户确认后，`AIToolPanel` 的 `LearningPlanPreview` 更新步骤列表
4. 用户拒绝后，记录 `dismissed_adjustment` 事件（不强制）

---

## D. 疲劳检测与自动节奏调整

### D.1 检测指标

```typescript
// src/lib/fatigue-detector.ts

export interface FatigueIndicators {
  consecutiveErrors: number       // 连续答错次数
  responseTimeRatio: number       // 最近5题均时 / 历史均时
  sessionDurationMin: number      // 当前会话持续时间
  errorRateRecent: number         // 最近10题错误率
  idleGaps: number                // 30秒以上无操作的次数
}

export type FatigueLevel = 'fresh' | 'mild' | 'moderate' | 'severe'

export function detectFatigue(indicators: FatigueIndicators): FatigueLevel {
  let score = 0

  // 连续答错：每连续错1题加1分，超过3题加速
  if (indicators.consecutiveErrors >= 5) score += 4
  else if (indicators.consecutiveErrors >= 3) score += 2
  else if (indicators.consecutiveErrors >= 2) score += 1

  // 答题变慢：比历史均值慢 50% 以上
  if (indicators.responseTimeRatio > 2.0) score += 3
  else if (indicators.responseTimeRatio > 1.5) score += 2
  else if (indicators.responseTimeRatio > 1.2) score += 1

  // 学习时间过长
  if (indicators.sessionDurationMin > 90) score += 3
  else if (indicators.sessionDurationMin > 60) score += 2
  else if (indicators.sessionDurationMin > 45) score += 1

  // 最近错误率偏高
  if (indicators.errorRateRecent > 0.7) score += 2
  else if (indicators.errorRateRecent > 0.5) score += 1

  // 频繁发呆（idle gaps）
  if (indicators.idleGaps >= 3) score += 1

  // 评级
  if (score >= 7) return 'severe'
  if (score >= 4) return 'moderate'
  if (score >= 2) return 'mild'
  return 'fresh'
}
```

### D.2 自动调整策略

```typescript
// src/lib/fatigue-actions.ts

export interface FatigueAction {
  type: 'reduce_difficulty' | 'switch_mode' | 'suggest_break' | 'encourage'
  message: string       // 展示给学生的消息
  autoApply: boolean    // 是否自动执行（不需要确认）
}

export function getFatigueActions(level: FatigueLevel): FatigueAction[] {
  switch (level) {
    case 'fresh':
      return []

    case 'mild':
      return [
        {
          type: 'encourage',
          message: '你已经学了一段时间了，表现不错！继续保持节奏。',
          autoApply: true,
        },
      ]

    case 'moderate':
      return [
        {
          type: 'reduce_difficulty',
          message: '检测到最近几道题有点吃力，已为你切换到更基础的练习。',
          autoApply: true,
        },
        {
          type: 'switch_mode',
          message: '要不要换种方式？可以切换到闪卡复习，换换脑子。',
          autoApply: false,
        },
      ]

    case 'severe':
      return [
        {
          type: 'suggest_break',
          message: '你已经连续学习较长时间了，建议休息 10 分钟再继续。研究表明适当休息能显著提高记忆效果。',
          autoApply: false,
        },
        {
          type: 'reduce_difficulty',
          message: '已自动降低练习难度，帮你找回信心。',
          autoApply: true,
        },
      ]
  }
}
```

### D.3 实现方案：FatigueMonitor 组件

```typescript
// src/components/workbench/FatigueMonitor.tsx — 隐式监控组件

interface FatigueMonitorProps {
  children: React.ReactNode
  onFatigueDetected: (level: FatigueLevel, actions: FatigueAction[]) => void
}

export function FatigueMonitor({ children, onFatigueDetected }: FatigueMonitorProps) {
  const sessionStartRef = useRef(Date.now())
  const responseTimes = useRef<number[]>([])
  const recentCorrect = useRef<boolean[]>([])
  const consecutiveErrors = useRef(0)
  const idleTimer = useRef<NodeJS.Timeout | null>(null)
  const idleGaps = useRef(0)
  const lastActivityRef = useRef(Date.now())
  const lastFatigueLevel = useRef<FatigueLevel>('fresh')

  // 监听用户活动（键盘、鼠标）重置 idle 计时器
  useEffect(() => {
    function resetIdle() {
      const now = Date.now()
      if (now - lastActivityRef.current > 30000) {
        idleGaps.current += 1
      }
      lastActivityRef.current = now
    }
    window.addEventListener('keydown', resetIdle)
    window.addEventListener('click', resetIdle)
    return () => {
      window.removeEventListener('keydown', resetIdle)
      window.removeEventListener('click', resetIdle)
    }
  }, [])

  // 每 60 秒检测一次疲劳状态
  useEffect(() => {
    const interval = setInterval(() => {
      const indicators: FatigueIndicators = {
        consecutiveErrors: consecutiveErrors.current,
        responseTimeRatio: calcResponseTimeRatio(responseTimes.current),
        sessionDurationMin: (Date.now() - sessionStartRef.current) / 60000,
        errorRateRecent: calcErrorRate(recentCorrect.current),
        idleGaps: idleGaps.current,
      }
      const level = detectFatigue(indicators)

      // 只在疲劳等级升高时触发
      if (fatigueRank(level) > fatigueRank(lastFatigueLevel.current)) {
        lastFatigueLevel.current = level
        const actions = getFatigueActions(level)
        onFatigueDetected(level, actions)
      }
    }, 60000)

    return () => clearInterval(interval)
  }, [onFatigueDetected])

  // 暴露 recordAnswer 方法供子组件调用
  // （通过 Context 或 callback prop）

  return <>{children}</>
}

function fatigueRank(level: FatigueLevel): number {
  return { fresh: 0, mild: 1, moderate: 2, severe: 3 }[level]
}

function calcResponseTimeRatio(times: number[]): number {
  if (times.length < 6) return 1.0
  const historical = times.slice(0, -5)
  const recent = times.slice(-5)
  const histAvg = historical.reduce((a, b) => a + b, 0) / historical.length
  const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length
  return histAvg > 0 ? recentAvg / histAvg : 1.0
}

function calcErrorRate(correct: boolean[]): number {
  const recent = correct.slice(-10)
  if (recent.length === 0) return 0
  return recent.filter(c => !c).length / recent.length
}
```

### D.4 与工作台的集成

疲劳检测的集成点位于 `WorkbenchPage`，作为包裹层：

```
<FatigueMonitor onFatigueDetected={handleFatigue}>
  <MaterialReader ... />
  <AIToolPanel ... />
  <AICoachPanel ... />
</FatigueMonitor>
```

当疲劳达到 moderate 以上时：
1. `autoApply: true` 的动作立即执行（如降难度）
2. `autoApply: false` 的动作以 toast 展示，等待用户选择
3. 降难度的具体实现：在 `generatePlanSteps()` 中将 `action` 从 `deep-dive` 降级为 `read`，将 `quiz` 的题目数量减半
4. 切换模式：自动打开闪卡复习面板，暂停测验流程

### D.5 疲劳恢复

当学生休息回来后（检测到 idle gap > 5 分钟后重新活跃），重置疲劳等级为 `fresh`，恢复正常难度。同时在教练对话中插入鼓励消息：

```
"欢迎回来！休息得怎么样？我们继续刚才的内容。
上次你在'模块3'有一些困惑，要不要从那里接着聊？"
```

---

## 总结

本文档设计了四个子系统的完整方案：

| 子系统 | 核心改动 | 依赖 | 优先级 |
|--------|---------|------|--------|
| A. Socratic 对话引擎 | 模板制 → LLM SSE 流式调用 | 后端 LLM API、精讲 Markdown | P0 |
| B. BKT+IRT 混合追踪 | 纯 BKT → BKT+IRT 融合 + theta 估计 | 题目 IRT 参数标注 | P1 |
| C. 动态路径调整 | 静态计划 → 反馈驱动的实时重规划 | B 的 mastery 输出 | P1 |
| D. 疲劳检测 | 无 → 隐式监控 + 自动调整 | 行为数据收集 | P2 |

建议实施顺序：A → B → C → D。A 是用户体验提升最大的改动（从"假"对话到"真"对话），B 和 C 互相依赖但可以先用简化版 BKT 驱动 C 的触发逻辑，D 可以在其他系统稳定后再加入。
