/**
 * Tool & Chat APIs for 智阶 workbench.
 * Extracted from api.ts to meet the 400-line file limit.
 *
 * - Tool APIs: regular JSON POST endpoints for summary, exam-points, etc.
 * - Chat APIs: SSE streaming endpoints for Socratic dialogue and knowledge QA.
 */

import { authFetch } from '@/lib/auth-api'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8003/api'
const AUTH_API = `${API_BASE}/v1`

/* ---------- Tool API Types (must match backend Pydantic schemas, snake_case) ---------- */

export interface ToolSummaryResult {
  summary: string
  key_points: string[]
  word_count: number
}

export interface ToolExamPoint {
  concept: string
  frequency: 'high' | 'medium' | 'low'
  exam_types: string[]
  tip: string
}

export interface ToolExamPointsResult {
  points: ToolExamPoint[]
}

export interface ToolMistakeItem {
  concept: string
  common_mistake: string
  correct_understanding: string
  confusion_pairs: string[]
}

export interface ToolMistakeAnalysisResult {
  items: ToolMistakeItem[]
}

export interface ToolConceptNode {
  id: string
  name: string
  description: string
}

export interface ToolConceptEdge {
  source: string
  target: string
  relation: string
}

export interface ToolConceptMapResult {
  nodes: ToolConceptNode[]
  edges: ToolConceptEdge[]
}

export interface ToolReadingNotesResult {
  title: string
  sections: { heading: string; content: string }[]
  key_formulas: string[]
  summary: string
}

/* ---------- Tool API Functions ---------- */

export async function toolSummary(
  specialistMarkdown: string,
  style: 'brief' | 'detailed' = 'brief',
): Promise<ToolSummaryResult> {
  const res = await authFetch(`${AUTH_API}/tools/summary`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ specialist_markdown: specialistMarkdown, style }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: '总结生成失败' }))
    throw new Error(err.detail || `Tool summary failed: ${res.status}`)
  }
  return res.json()
}

export async function toolExamPoints(
  specialistMarkdown: string,
  moduleName: string,
): Promise<ToolExamPointsResult> {
  const res = await authFetch(`${AUTH_API}/tools/exam-points`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ specialist_markdown: specialistMarkdown, module_name: moduleName }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: '考点提取失败' }))
    throw new Error(err.detail || `Tool exam-points failed: ${res.status}`)
  }
  return res.json()
}

export async function toolMistakeAnalysis(
  specialistMarkdown: string,
  moduleName: string,
): Promise<ToolMistakeAnalysisResult> {
  const res = await authFetch(`${AUTH_API}/tools/mistake-analysis`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ specialist_markdown: specialistMarkdown, module_name: moduleName }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: '易错分析失败' }))
    throw new Error(err.detail || `Tool mistake-analysis failed: ${res.status}`)
  }
  return res.json()
}

export async function toolConceptMap(
  specialistMarkdown: string,
  moduleName: string,
): Promise<ToolConceptMapResult> {
  const res = await authFetch(`${AUTH_API}/tools/concept-map`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ specialist_markdown: specialistMarkdown, module_name: moduleName }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: '概念图谱生成失败' }))
    throw new Error(err.detail || `Tool concept-map failed: ${res.status}`)
  }
  return res.json()
}

export async function toolReadingNotes(
  specialistMarkdown: string,
  moduleName: string,
): Promise<ToolReadingNotesResult> {
  const res = await authFetch(`${AUTH_API}/tools/reading-notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ specialist_markdown: specialistMarkdown, module_name: moduleName }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: '精读笔记生成失败' }))
    throw new Error(err.detail || `Tool reading-notes failed: ${res.status}`)
  }
  return res.json()
}

/* ---------- Chat API Functions (SSE streaming) ---------- */

export async function streamSocraticChat(
  params: {
    moduleId: string
    moduleName: string
    userMessage: string
    scaffoldLevel: 'full' | 'moderate' | 'minimal'
    mastery: number
    conversationHistory: { role: string; content: string }[]
    specialistContext: string
  },
  onToken: (text: string) => void,
): Promise<void> {
  const res = await authFetch(`${AUTH_API}/chat/socratic`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      module_id: params.moduleId,
      module_name: params.moduleName,
      user_message: params.userMessage,
      scaffold_level: params.scaffoldLevel,
      mastery: params.mastery,
      conversation_history: params.conversationHistory,
      specialist_context: params.specialistContext,
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: '对话启动失败' }))
    throw new Error(err.detail || `Socratic chat failed: ${res.status}`)
  }
  await consumeSSEStream(res, onToken)
}

export async function streamKnowledgeQA(
  params: {
    materialId: string
    question: string
    conversationHistory: { role: string; content: string }[]
  },
  onToken: (text: string) => void,
): Promise<void> {
  const res = await authFetch(`${AUTH_API}/chat/knowledge-qa`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      material_id: params.materialId,
      question: params.question,
      conversation_history: params.conversationHistory,
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: '知识问答启动失败' }))
    throw new Error(err.detail || `Knowledge QA failed: ${res.status}`)
  }
  await consumeSSEStream(res, onToken)
}

/* ---------- SSE Stream Consumer ---------- */

/**
 * Consume an SSE stream from sse-starlette, calling onToken for each text chunk.
 *
 * sse-starlette emits events in the format:
 *   event: token
 *   data: {"content": "..."}
 *
 *   event: done
 *   data: {"content": "", "total_tokens": N}
 *
 *   event: error
 *   data: {"message": "..."}
 */
async function consumeSSEStream(
  res: Response,
  onToken: (text: string) => void,
  onError?: (message: string) => void,
): Promise<void> {
  const reader = res.body?.getReader()
  if (!reader) throw new Error('No response body')
  const decoder = new TextDecoder()
  let buffer = ''
  let currentEvent = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim()
        } else if (line.startsWith('data: ')) {
          const data = line.slice(6)
          if (data === '[DONE]') return

          if (currentEvent === 'done') {
            // Stream completed
            currentEvent = ''
            return
          }

          if (currentEvent === 'error') {
            try {
              const parsed = JSON.parse(data)
              const msg = parsed.message || 'Unknown streaming error'
              if (onError) onError(msg)
              else throw new Error(msg)
            } catch (e) {
              if (e instanceof SyntaxError) {
                const msg = data.trim() || 'Unknown streaming error'
                if (onError) onError(msg)
                else throw new Error(msg)
              }
              throw e
            }
            currentEvent = ''
            return
          }

          // token event or fallback
          try {
            const parsed = JSON.parse(data)
            // Backend sends {"content": "..."} in token events
            if (parsed.content) onToken(parsed.content)
            // Fallback for other formats
            else if (parsed.token) onToken(parsed.token)
            else if (parsed.text) onToken(parsed.text)
          } catch {
            // Raw text token
            if (data.trim()) onToken(data)
          }
          currentEvent = ''
        } else if (line.trim() === '') {
          // Empty line separates events -- reset event type
          // (but don't reset if we haven't processed a data line yet)
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}
