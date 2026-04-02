/**
 * Tutor chat API client — sends POST to /chat/tutor, receives SSE stream.
 * Types aligned with backend app/schemas/tutor.py
 *
 * Wave 0 expansion: Added new SSE event types for context management,
 * degradation signals, and usage tracking (inspired by Claude Code QueryEngine).
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

/** Plan step for multi-step queries (Wave 1 QueryLoop) */
export interface PlanStepData {
  step_id: number
  intent: string
  tools_to_call: string[]
  module_hint: string | null
  description: string
}

export interface PlanCompletedData {
  intent: string
  reasoning: string
  tools_to_call: string[]
  /** Multi-step plan (Wave 1). Empty for simple queries. */
  steps?: PlanStepData[]
  /** True if this is a multi-step plan */
  is_multi_step?: boolean
}

/** Loop step started — multi-step query progress (Wave 1) */
export interface LoopStepStartData {
  step: number
  total_steps: number
  description: string
}

/** Loop step completed (Wave 1) */
export interface LoopStepCompleteData {
  step: number
  total_steps: number
}

/** Tool call started — UI should show "正在查阅..." indicator */
export interface ToolCallStartData {
  tool_name: string
  description: string
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

/* ---------- Wave 0: New SSE Event Types ---------- */

/** Context was auto-compressed to prevent overflow (D5) */
export interface ContextCompressedData {
  /** Human-readable summary of what was preserved */
  summary: string
  /** Tokens before compression */
  tokens_before: number
  /** Tokens after compression */
  tokens_after: number
  /** Compression trigger: 'snip' | 'auto' | 'emergency' */
  trigger: 'snip' | 'auto' | 'emergency'
}

/** System degraded — rate limit, model fallback, etc. (P1) */
export interface DegradedData {
  message: string
  /** What triggered the degradation */
  reason: 'rate_limit' | 'model_overload' | 'context_overflow' | 'service_error'
  /** If model was downgraded, what model is now being used */
  fallback_model?: string
}

/** Token usage tracking — sent with each response (D8) */
export interface UsageData {
  /** Tokens used so far in this session */
  used_tokens: number
  /** Maximum tokens available (model context window) */
  max_tokens: number
  /** Usage percentage 0-100 */
  percentage: number
}

/** All possible SSE event type names */
export type TutorEventName =
  | 'session.started'
  | 'plan.completed'
  | 'tool_call.start'
  | 'tool.result'
  | 'answer.delta'
  | 'answer.completed'
  | 'session.completed'
  | 'context.compressed'
  | 'degraded'
  | 'usage'
  | 'loop.step_start'
  | 'loop.step_complete'
  | 'error'

/** Type-safe event data map */
export interface TutorEventMap {
  'session.started': SessionStartedData
  'plan.completed': PlanCompletedData
  'tool_call.start': ToolCallStartData
  'tool.result': ToolResultData
  'answer.delta': AnswerDeltaData
  'answer.completed': AnswerCompletedData
  'session.completed': SessionCompletedData
  'context.compressed': ContextCompressedData
  'degraded': DegradedData
  'usage': UsageData
  'loop.step_start': LoopStepStartData
  'loop.step_complete': LoopStepCompleteData
  'error': ErrorData
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
  /** IDs of exam/exercise materials to include as context for exam-aware answers */
  examMaterialIds?: string[]
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

  if (params.examMaterialIds?.length) {
    body.exam_material_ids = params.examMaterialIds
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
