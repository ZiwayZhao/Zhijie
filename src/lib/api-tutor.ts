/**
 * Tutor chat API client — sends POST to /chat/tutor, receives SSE stream.
 * Types aligned with backend app/schemas/tutor.py
 */

import { getAccessToken } from '@/lib/auth-api'
import { connectSSE, type SSEEvent, type SSEEventHandler } from '@/lib/sse-parser'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8003/api'

/* ---------- SSE Event Types (mirror backend) ---------- */

export interface SessionStartedData {
  session_id: string
  material_id: string
  module_id: string | null
  available_tools: string[]
}

export interface PlanCompletedData {
  intent: string
  reasoning: string
  tools_to_call: string[]
}

export interface ToolResultData {
  tool_name: string
  ok: boolean
  data: Record<string, unknown> | null
  error: { code: string; message: string } | null
}

export interface AnswerDeltaData {
  content: string
}

export interface AnswerCompletedData {
  total_tokens: number
}

export interface SessionCompletedData {
  session_id: string
}

export interface ErrorData {
  message: string
  phase: string
}

/* ---------- Request Types ---------- */

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface TutorChatParams {
  materialId: string
  moduleId?: string
  userMessage: string
  conversationHistory: ChatMessage[]
}

/* ---------- API Function ---------- */

/**
 * Start a tutor chat session via SSE.
 * Returns AbortController to cancel the request.
 */
export function startTutorChat(
  params: TutorChatParams,
  onEvent: SSEEventHandler,
  onError: (error: Error) => void,
  onComplete: () => void,
): AbortController {
  const token = getAccessToken()

  const body: Record<string, unknown> = {
    material_id: params.materialId,
    user_message: params.userMessage,
    conversation_history: params.conversationHistory.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  }

  if (params.moduleId) {
    body.module_id = params.moduleId
  }

  return connectSSE(
    `${API_BASE}/v1/chat/tutor`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    },
    onEvent,
    onError,
    onComplete,
  )
}

/* ---------- Event Type Guards ---------- */

export function isTutorEvent<K extends string>(
  event: SSEEvent,
  name: K,
): boolean {
  return event.event === name
}
