/**
 * useTutorSession — useReducer state machine for tutor chat.
 * Manages SSE connection lifecycle, message accumulation, and localStorage persistence.
 */

import { useReducer, useCallback, useRef, useEffect } from 'react'
import { startTutorChat, type ChatMessage } from '@/lib/api-tutor'
import type { SSEEvent } from '@/lib/sse-parser'
import type {
  PlanCompletedData,
  ToolResultData as SSEToolResultData,
  AnswerDeltaData,
  AnswerCompletedData,
  ErrorData,
} from '@/lib/api-tutor'

/* ── Types ──────────────────────────────────────────── */

export type TutorPhase =
  | 'idle'
  | 'connecting'
  | 'planning'
  | 'tool-running'
  | 'answering'
  | 'completed'
  | 'error'

export interface ToolResultItem {
  toolName: string
  ok: boolean
  data: Record<string, unknown> | null
  error: string | null
}

export interface PlanInfo {
  intent: string
  reasoning: string
  tools: string[]
}

export interface TutorMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  plan?: PlanInfo
  toolResults?: ToolResultItem[]
}

export interface TutorState {
  phase: TutorPhase
  messages: TutorMessage[]
  currentPlan: PlanInfo | null
  currentToolResults: ToolResultItem[]
  streamingContent: string
  error: string | null
}

/* ── Actions ────────────────────────────────────────── */

type TutorAction =
  | { type: 'SEND_MESSAGE'; content: string }
  | { type: 'SESSION_STARTED' }
  | { type: 'PLAN_COMPLETED'; data: PlanCompletedData }
  | { type: 'TOOL_RESULT'; data: SSEToolResultData }
  | { type: 'ANSWER_DELTA'; data: AnswerDeltaData }
  | { type: 'ANSWER_COMPLETED'; data: AnswerCompletedData }
  | { type: 'SESSION_COMPLETED' }
  | { type: 'SSE_ERROR'; data: ErrorData }
  | { type: 'CONNECTION_ERROR'; error: string }
  | { type: 'RESET' }

/* ── Reducer ────────────────────────────────────────── */

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

const INITIAL_STATE: TutorState = {
  phase: 'idle',
  messages: [],
  currentPlan: null,
  currentToolResults: [],
  streamingContent: '',
  error: null,
}

function tutorReducer(state: TutorState, action: TutorAction): TutorState {
  switch (action.type) {
    case 'SEND_MESSAGE': {
      const userMsg: TutorMessage = {
        id: genId(),
        role: 'user',
        content: action.content,
        timestamp: Date.now(),
      }
      return {
        ...state,
        phase: 'connecting',
        messages: [...state.messages, userMsg],
        currentPlan: null,
        currentToolResults: [],
        streamingContent: '',
        error: null,
      }
    }

    case 'SESSION_STARTED':
      return { ...state, phase: 'planning' }

    case 'PLAN_COMPLETED': {
      const plan: PlanInfo = {
        intent: action.data.intent,
        reasoning: action.data.reasoning,
        tools: action.data.tools_to_call,
      }
      const nextPhase = plan.tools.length > 0 ? 'tool-running' : 'answering'
      return { ...state, phase: nextPhase as TutorPhase, currentPlan: plan }
    }

    case 'TOOL_RESULT': {
      const item: ToolResultItem = {
        toolName: action.data.tool_name,
        ok: action.data.ok,
        data: action.data.data,
        error: action.data.error?.message ?? null,
      }
      return {
        ...state,
        phase: 'tool-running',
        currentToolResults: [...state.currentToolResults, item],
      }
    }

    case 'ANSWER_DELTA':
      return {
        ...state,
        phase: 'answering',
        streamingContent: state.streamingContent + action.data.content,
      }

    case 'ANSWER_COMPLETED': {
      const assistantMsg: TutorMessage = {
        id: genId(),
        role: 'assistant',
        content: state.streamingContent,
        timestamp: Date.now(),
        plan: state.currentPlan ?? undefined,
        toolResults:
          state.currentToolResults.length > 0
            ? state.currentToolResults
            : undefined,
      }
      return {
        ...state,
        phase: 'completed',
        messages: [...state.messages, assistantMsg],
        streamingContent: '',
      }
    }

    case 'SESSION_COMPLETED':
      return { ...state, phase: 'idle' }

    case 'SSE_ERROR': {
      const errMsg: TutorMessage = {
        id: genId(),
        role: 'system',
        content: action.data.message,
        timestamp: Date.now(),
      }
      return {
        ...state,
        phase: 'error',
        messages: [...state.messages, errMsg],
        error: action.data.message,
        streamingContent: '',
      }
    }

    case 'CONNECTION_ERROR': {
      const errMsg: TutorMessage = {
        id: genId(),
        role: 'system',
        content: `连接失败: ${action.error}`,
        timestamp: Date.now(),
      }
      return {
        ...state,
        phase: 'error',
        messages: [...state.messages, errMsg],
        error: action.error,
        streamingContent: '',
      }
    }

    case 'RESET':
      return { ...INITIAL_STATE }

    default:
      return state
  }
}

/* ── localStorage ───────────────────────────────────── */

const MAX_PERSISTED_MESSAGES = 50

function storageKey(materialId: string): string {
  return `zhijie:tutor:${materialId}:v1`
}

function loadPersistedMessages(materialId: string): TutorMessage[] {
  try {
    const raw = localStorage.getItem(storageKey(materialId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as { messages?: TutorMessage[] }
    return Array.isArray(parsed.messages) ? parsed.messages : []
  } catch {
    return []
  }
}

function persistMessages(materialId: string, messages: TutorMessage[]): void {
  try {
    const capped = messages.slice(-MAX_PERSISTED_MESSAGES)
    localStorage.setItem(
      storageKey(materialId),
      JSON.stringify({ messages: capped, lastUpdated: Date.now() }),
    )
  } catch {
    // localStorage full — silently skip
  }
}

/* ── Hook ───────────────────────────────────────────── */

export function useTutorSession(
  materialId: string,
  moduleId?: string | null,
) {
  const [state, dispatch] = useReducer(tutorReducer, INITIAL_STATE, () => {
    const saved = loadPersistedMessages(materialId)
    if (saved.length > 0) {
      return { ...INITIAL_STATE, messages: saved }
    }
    return INITIAL_STATE
  })

  const abortRef = useRef<AbortController | null>(null)
  const materialIdRef = useRef(materialId)
  materialIdRef.current = materialId

  // Persist on session completion
  useEffect(() => {
    if (state.phase === 'idle' && state.messages.length > 0) {
      persistMessages(materialIdRef.current, state.messages)
    }
  }, [state.phase, state.messages])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const sendMessage = useCallback(
    (content: string) => {
      const trimmed = content.trim()
      if (!trimmed) return
      if (state.phase !== 'idle' && state.phase !== 'completed' && state.phase !== 'error') return

      // Cancel any previous request
      abortRef.current?.abort()

      dispatch({ type: 'SEND_MESSAGE', content: trimmed })

      // Build conversation history from existing messages
      const history: ChatMessage[] = state.messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(-20)
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

      const controller = startTutorChat(
        {
          materialId,
          moduleId: moduleId ?? undefined,
          userMessage: trimmed,
          conversationHistory: history,
        },
        (event: SSEEvent) => {
          switch (event.event) {
            case 'session.started':
              dispatch({ type: 'SESSION_STARTED' })
              break
            case 'plan.completed':
              dispatch({ type: 'PLAN_COMPLETED', data: event.data as PlanCompletedData })
              break
            case 'tool.result':
              dispatch({ type: 'TOOL_RESULT', data: event.data as SSEToolResultData })
              break
            case 'answer.delta':
              dispatch({ type: 'ANSWER_DELTA', data: event.data as AnswerDeltaData })
              break
            case 'answer.completed':
              dispatch({ type: 'ANSWER_COMPLETED', data: event.data as AnswerCompletedData })
              break
            case 'session.completed':
              dispatch({ type: 'SESSION_COMPLETED' })
              break
            case 'error':
              dispatch({ type: 'SSE_ERROR', data: event.data as ErrorData })
              break
          }
        },
        (error) => {
          dispatch({ type: 'CONNECTION_ERROR', error: error.message })
        },
        () => {
          // SSE stream ended — if still answering, treat as completed
        },
      )

      abortRef.current = controller
    },
    [materialId, moduleId, state.phase, state.messages],
  )

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    dispatch({ type: 'RESET' })
    localStorage.removeItem(storageKey(materialId))
  }, [materialId])

  return { state, sendMessage, cancel, reset }
}
