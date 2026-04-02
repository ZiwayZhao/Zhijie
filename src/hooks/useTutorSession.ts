/**
 * useTutorSession — useReducer state machine for tutor chat.
 * Manages SSE connection lifecycle, message accumulation, and localStorage persistence.
 *
 * Wave 0 enhancements:
 * - Handle new SSE events: tool_call.start, context.compressed, degraded, usage
 * - Track tool call progress descriptions
 * - Context budget awareness
 * - Degradation status display
 */

import { useReducer, useCallback, useRef, useEffect } from 'react'
import { startTutorChat, type ChatMessage } from '@/lib/api-tutor'
import type { SSEEvent } from '@/lib/sse-parser'
import type {
  PlanCompletedData,
  PlanStepData,
  ToolCallStartData,
  ToolResultData as SSEToolResultData,
  AnswerDeltaData,
  AnswerCompletedData,
  ContextCompressedData,
  DegradedData,
  UsageData,
  LoopStepStartData,
  LoopStepCompleteData,
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
  /** Multi-step plan steps (Wave 1 QueryLoop) */
  steps?: PlanStepData[]
  isMultiStep?: boolean
}

export interface TutorMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  plan?: PlanInfo
  toolResults?: ToolResultItem[]
  /** Message type for visual styling (Wave 0: draft/proactive support) */
  messageType?: 'response' | 'proactive' | 'draft'
}

/** Context budget tracking (Wave 0) */
export interface ContextBudget {
  usedTokens: number
  maxTokens: number
  percentage: number
}

export interface TutorState {
  phase: TutorPhase
  messages: TutorMessage[]
  currentPlan: PlanInfo | null
  currentToolResults: ToolResultItem[]
  streamingContent: string
  error: string | null
  /** Currently active tool call description for UI progress indicator */
  activeToolDescription: string | null
  /** Context budget tracking (D5/D8) */
  contextBudget: ContextBudget | null
  /** Degradation status message (P1) */
  degradedMessage: string | null
  /** Multi-step loop progress (Wave 1) */
  currentStep: number | null
  totalSteps: number | null
  stepDescription: string | null
}

/* ── Actions ────────────────────────────────────────── */

type TutorAction =
  | { type: 'SEND_MESSAGE'; content: string }
  | { type: 'SESSION_STARTED' }
  | { type: 'PLAN_COMPLETED'; data: PlanCompletedData }
  | { type: 'TOOL_CALL_START'; data: ToolCallStartData }
  | { type: 'TOOL_RESULT'; data: SSEToolResultData }
  | { type: 'ANSWER_DELTA'; data: AnswerDeltaData }
  | { type: 'ANSWER_COMPLETED'; data: AnswerCompletedData }
  | { type: 'SESSION_COMPLETED' }
  | { type: 'CONTEXT_COMPRESSED'; data: ContextCompressedData }
  | { type: 'DEGRADED'; data: DegradedData }
  | { type: 'USAGE'; data: UsageData }
  | { type: 'LOOP_STEP_START'; data: LoopStepStartData }
  | { type: 'LOOP_STEP_COMPLETE'; data: LoopStepCompleteData }
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
  activeToolDescription: null,
  contextBudget: null,
  degradedMessage: null,
  currentStep: null,
  totalSteps: null,
  stepDescription: null,
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
        steps: action.data.steps,
        isMultiStep: action.data.is_multi_step,
      }
      const nextPhase = plan.tools.length > 0 ? 'tool-running' : 'answering'
      return { ...state, phase: nextPhase as TutorPhase, currentPlan: plan }
    }

    case 'TOOL_CALL_START':
      return {
        ...state,
        phase: 'tool-running',
        activeToolDescription: action.data.description,
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
        activeToolDescription: null,
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

    case 'SESSION_COMPLETED': {
      // If stream ended with un-finalized streaming content, commit it as an assistant message
      if (state.streamingContent.trim()) {
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
          phase: 'idle',
          messages: [...state.messages, assistantMsg],
          streamingContent: '',
          degradedMessage: null,
        }
      }
      return { ...state, phase: 'idle', degradedMessage: null }
    }

    case 'CONTEXT_COMPRESSED': {
      // Insert a system message showing compression happened (D5)
      const compressMsg: TutorMessage = {
        id: genId(),
        role: 'system',
        content: `对话已自动压缩（${action.data.trigger}）。已保留关键学习进度。`,
        timestamp: Date.now(),
        messageType: 'proactive',
      }
      return {
        ...state,
        messages: [...state.messages, compressMsg],
        contextBudget: {
          usedTokens: action.data.tokens_after,
          maxTokens: state.contextBudget?.maxTokens ?? 128000,
          percentage: state.contextBudget?.maxTokens
            ? Math.round((action.data.tokens_after / state.contextBudget.maxTokens) * 100)
            : 50,
        },
      }
    }

    case 'DEGRADED':
      return { ...state, degradedMessage: action.data.message }

    case 'USAGE':
      return {
        ...state,
        contextBudget: {
          usedTokens: action.data.used_tokens,
          maxTokens: action.data.max_tokens,
          percentage: action.data.percentage,
        },
      }

    case 'LOOP_STEP_START':
      return {
        ...state,
        currentStep: action.data.step,
        totalSteps: action.data.total_steps,
        stepDescription: action.data.description,
      }

    case 'LOOP_STEP_COMPLETE':
      return {
        ...state,
        stepDescription: null,
      }

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
    // Debounced fire-and-forget backend sync (5s coalesce)
    import('@/lib/sync-service').then(({ debouncedSyncTutorUp }) => {
      debouncedSyncTutorUp(materialId, capped)
    })
  } catch {
    // localStorage full — silently skip
  }
}

/* ── Hook ───────────────────────────────────────────── */

export function useTutorSession(
  materialId: string,
  moduleId?: string | null,
  examMaterialIds?: string[],
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
          examMaterialIds: examMaterialIds?.length ? examMaterialIds : undefined,
        },
        (event: SSEEvent) => {
          switch (event.event) {
            case 'session.started':
              dispatch({ type: 'SESSION_STARTED' })
              break
            case 'plan.completed':
              dispatch({ type: 'PLAN_COMPLETED', data: event.data as PlanCompletedData })
              break
            case 'tool_call.start':
              dispatch({ type: 'TOOL_CALL_START', data: event.data as ToolCallStartData })
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
            case 'context.compressed':
              dispatch({ type: 'CONTEXT_COMPRESSED', data: event.data as ContextCompressedData })
              break
            case 'degraded':
              dispatch({ type: 'DEGRADED', data: event.data as DegradedData })
              break
            case 'usage':
              dispatch({ type: 'USAGE', data: event.data as UsageData })
              break
            case 'loop.step_start':
              dispatch({ type: 'LOOP_STEP_START', data: event.data as LoopStepStartData })
              break
            case 'loop.step_complete':
              dispatch({ type: 'LOOP_STEP_COMPLETE', data: event.data as LoopStepCompleteData })
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
          // SSE stream ended without session.completed — finalize any in-progress answer
          dispatch({ type: 'SESSION_COMPLETED' })
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
