/**
 * useAIToolPanel — useReducer state machine for the AI tool panel.
 * Manages phase transitions, progress tracking, and analysis results.
 * Follows the same pattern as useTutorSession.ts.
 */

import { useReducer, useCallback, useRef, useEffect } from 'react'
import { showToast } from '@/lib/toast-store'
import {
  startDisassembly,
  subscribeProgress,
  getSpecialistResult,
  getAnalysisResult,
  getLatestAnalysis,
  getKnowledgeCards,
} from '@/lib/api'
import type { DisassemblyModule, MCQuestion, ProgressEvent } from '@/lib/api'
import {
  toolSummary,
  toolExamPoints,
  toolMistakeAnalysis,
  toolConceptMap,
  toolReadingNotes,
} from '@/lib/api-tools'
import type {
  ToolSummaryResult,
  ToolExamPointsResult,
  ToolMistakeAnalysisResult,
  ToolConceptMapResult,
  ToolReadingNotesResult,
} from '@/lib/api-tools'
import type { LearningPlanStep } from '@/components/intent/LearningPlanPreview'
import { loadProfile } from '@/lib/student-model'
import type { Intent, GatheringData } from '@/components/workbench/IntentGatherer'
import type { PipelinePhase } from '@/components/workbench/ProcessingView'
import type { ExamProfile } from '@/lib/exam-profile'
import { loadExamProfile } from '@/lib/exam-profile'

/* ── Types ──────────────────────────────────────────── */

export type Phase =
  | 'idle'
  | 'gathering'
  | 'exam-setup'
  | 'processing'
  | 'plan-preview'
  | 'complete'
  | 'error'

export type ToolResult =
  | { toolId: 'summary'; data: ToolSummaryResult }
  | { toolId: 'key-points'; data: ToolExamPointsResult }
  | { toolId: 'pitfalls'; data: ToolMistakeAnalysisResult }
  | { toolId: 'concept-map'; data: ToolConceptMapResult }
  | { toolId: 'deep-read'; data: ToolReadingNotesResult }

export interface AIToolPanelState {
  phase: Phase
  intent: Intent | null
  gathering: GatheringData
  examProfile: ExamProfile | null

  // Processing progress
  progress: number
  currentStep: string
  pipelinePhase: PipelinePhase
  progressDetail: { completed?: number; total?: number } | undefined

  // Results
  modules: DisassemblyModule[]
  planSteps: LearningPlanStep[]
  loadingModule: string | null
  errorMsg: string

  // UI state
  manualExpanded: boolean
  activeTool: string | null
  toolResult: ToolResult | null
  toolError: string | null
}

export type AIToolPanelAction =
  | { type: 'SELECT_INTENT'; intent: Intent }
  | { type: 'SET_GATHERING'; data: GatheringData }
  | { type: 'SET_EXAM_PROFILE'; profile: ExamProfile }
  | { type: 'ENTER_GATHERING' }
  | { type: 'ENTER_EXAM_SETUP' }
  | { type: 'START_PROCESSING' }
  | { type: 'UPDATE_PROGRESS'; progress: number; currentStep?: string; pipelinePhase?: PipelinePhase; detail?: { completed?: number; total?: number } }
  | { type: 'PROCESSING_COMPLETE'; modules: DisassemblyModule[]; planSteps: LearningPlanStep[] }
  | { type: 'PROCESSING_ERROR'; errorMsg: string }
  | { type: 'CONFIRM_PLAN' }
  | { type: 'LOAD_MODULE'; moduleId: string }
  | { type: 'MODULE_LOADED' }
  | { type: 'SET_ACTIVE_TOOL'; toolId: string | null }
  | { type: 'TOOL_RESULT'; result: ToolResult }
  | { type: 'TOOL_ERROR'; error: string }
  | { type: 'CLEAR_TOOL_RESULT' }
  | { type: 'TOGGLE_MANUAL' }
  | { type: 'RESTORE_COMPLETE'; modules: DisassemblyModule[] }
  | { type: 'RESET' }

/* ── Initial state ──────────────────────────────────── */

const INITIAL_STATE: AIToolPanelState = {
  phase: 'idle',
  intent: null,
  gathering: {},
  examProfile: null,
  progress: 0,
  currentStep: '',
  pipelinePhase: 'init',
  progressDetail: undefined,
  modules: [],
  planSteps: [],
  loadingModule: null,
  errorMsg: '',
  manualExpanded: false,
  activeTool: null,
  toolResult: null,
  toolError: null,
}

/* ── localStorage persistence for analysis state ───── */

const CACHE_KEY_PREFIX = 'zhijie_analysis_'

interface CachedAnalysis {
  taskId: string
  modules: DisassemblyModule[]
}

function getCacheKey(materialId: string): string {
  return `${CACHE_KEY_PREFIX}${materialId}`
}

function saveAnalysisCache(materialId: string, taskId: string, modules: DisassemblyModule[]): void {
  try {
    const data: CachedAnalysis = { taskId, modules }
    localStorage.setItem(getCacheKey(materialId), JSON.stringify(data))
  } catch { /* quota exceeded, ignore */ }
}

function loadAnalysisCache(materialId: string): CachedAnalysis | null {
  try {
    const raw = localStorage.getItem(getCacheKey(materialId))
    if (!raw) return null
    return JSON.parse(raw) as CachedAnalysis
  } catch { return null }
}

function clearAnalysisCache(materialId: string): void {
  try { localStorage.removeItem(getCacheKey(materialId)) } catch { /* ignore */ }
}

/** Create initial state, restoring from localStorage if available */
function createInitialState(materialId: string): AIToolPanelState {
  const cached = loadAnalysisCache(materialId)
  if (cached && cached.modules.length > 0) {
    return {
      ...INITIAL_STATE,
      phase: 'complete',
      modules: cached.modules,
    }
  }
  return INITIAL_STATE
}

/* ── Reducer ────────────────────────────────────────── */

function reducer(state: AIToolPanelState, action: AIToolPanelAction): AIToolPanelState {
  switch (action.type) {
    case 'SELECT_INTENT':
      return { ...state, intent: action.intent }

    case 'SET_GATHERING':
      return { ...state, gathering: action.data }

    case 'SET_EXAM_PROFILE':
      return { ...state, examProfile: action.profile }

    case 'ENTER_GATHERING':
      return { ...state, phase: 'gathering', gathering: {} }

    case 'ENTER_EXAM_SETUP':
      return { ...state, phase: 'exam-setup' }

    case 'START_PROCESSING':
      return {
        ...state,
        phase: 'processing',
        progress: 0,
        currentStep: '正在启动分析...',
        pipelinePhase: 'init',
        progressDetail: undefined,
        errorMsg: '',
      }

    case 'UPDATE_PROGRESS':
      return {
        ...state,
        progress: action.progress,
        currentStep: action.currentStep ?? state.currentStep,
        pipelinePhase: action.pipelinePhase ?? state.pipelinePhase,
        progressDetail: action.detail ?? state.progressDetail,
      }

    case 'PROCESSING_COMPLETE':
      return {
        ...state,
        phase: 'plan-preview',
        modules: action.modules,
        planSteps: action.planSteps,
      }

    case 'PROCESSING_ERROR':
      return {
        ...state,
        phase: 'error',
        errorMsg: action.errorMsg,
      }

    case 'CONFIRM_PLAN':
      return { ...state, phase: 'complete' }

    case 'LOAD_MODULE':
      return { ...state, loadingModule: action.moduleId }

    case 'MODULE_LOADED':
      return { ...state, loadingModule: null }

    case 'SET_ACTIVE_TOOL':
      return { ...state, activeTool: action.toolId, toolError: null }

    case 'TOOL_RESULT':
      return { ...state, activeTool: null, toolResult: action.result, toolError: null }

    case 'TOOL_ERROR':
      return { ...state, activeTool: null, toolError: action.error }

    case 'CLEAR_TOOL_RESULT':
      return { ...state, toolResult: null, toolError: null }

    case 'TOGGLE_MANUAL':
      return { ...state, manualExpanded: !state.manualExpanded }

    case 'RESTORE_COMPLETE':
      return {
        ...state,
        phase: 'complete',
        modules: action.modules,
      }

    case 'RESET':
      return {
        ...INITIAL_STATE,
        examProfile: state.examProfile, // Preserve exam profile across resets
      }

    default:
      return state
  }
}

/* ── Plan generation helper ─────────────────────────── */

function generatePlanSteps(
  modules: DisassemblyModule[],
  intent: Intent,
  profile: { modules: Record<string, { mastery: number }> },
): LearningPlanStep[] {
  return modules.map((mod, i) => {
    const mastery = profile.modules[mod.id]?.mastery ?? 0.3
    const isWeak = mastery < 0.6
    const isHighWeight = mod.examWeight === 'high'

    let action: LearningPlanStep['action'] = 'read'
    let priority: LearningPlanStep['priority'] = 'medium'
    let estimatedMin = 10

    if (intent === 'exam') {
      action = isWeak ? 'deep-dive' : 'quiz'
      priority = isHighWeight && isWeak ? 'high' : isHighWeight ? 'medium' : 'low'
      estimatedMin = isWeak ? 15 : 5
    } else if (intent === 'review') {
      action = 'flashcard'
      priority = mastery < 0.3 ? 'high' : mastery < 0.6 ? 'medium' : 'low'
      estimatedMin = 5
    } else {
      action = i === modules.length - 1 ? 'quiz' : 'read'
      priority = isHighWeight ? 'high' : 'medium'
      estimatedMin = 10
    }

    return {
      id: `step-${mod.id}`,
      moduleId: mod.id,
      moduleName: mod.name,
      action,
      estimatedMin,
      mastery,
      priority,
      skippable: mastery > 0.7 || priority === 'low',
    }
  })
}

/* ── Hook ───────────────────────────────────────────── */

interface UseAIToolPanelOptions {
  materialId: string
  courseId?: string
  specialistMarkdown?: string | null
  currentModuleName?: string | null
  onModuleSelect?: (moduleId: string, moduleName: string, markdown: string, keyConcepts?: string[], examTraps?: string[]) => void
  onQuizReady?: (questions: MCQuestion[]) => void
  onKnowledgeCardsReady?: (data: import('@/lib/types/knowledge-card').KnowledgeCardResult) => void
  onSwitchToTutor?: (context?: string) => void
  onModuleQuiz?: (moduleId: string, moduleName: string) => void
  onGenerateFlashcards?: () => void
}

export function useAIToolPanel({
  materialId,
  courseId,
  specialistMarkdown,
  currentModuleName,
  onModuleSelect,
  onQuizReady,
  onKnowledgeCardsReady,
  onSwitchToTutor,
  onModuleQuiz,
  onGenerateFlashcards,
}: UseAIToolPanelOptions) {
  // Lazy initializer: restore from localStorage synchronously on mount
  const [state, dispatch] = useReducer(reducer, materialId, createInitialState)

  const taskIdRef = useRef<string | null>(null)
  const unsubRef = useRef<(() => void) | null>(null)
  const skipAutoDetectRef = useRef(false)
  const onQuizReadyRef = useRef(onQuizReady)
  onQuizReadyRef.current = onQuizReady
  const onKnowledgeCardsReadyRef = useRef(onKnowledgeCardsReady)
  onKnowledgeCardsReadyRef.current = onKnowledgeCardsReady
  const onSwitchToTutorRef = useRef(onSwitchToTutor)
  onSwitchToTutorRef.current = onSwitchToTutor
  const onModuleQuizRef = useRef(onModuleQuiz)
  onModuleQuizRef.current = onModuleQuiz
  const onGenerateFlashcardsRef = useRef(onGenerateFlashcards)
  onGenerateFlashcardsRef.current = onGenerateFlashcards

  // If restored from cache, populate taskId ref
  useEffect(() => {
    if (state.phase === 'complete' && state.modules.length > 0 && !taskIdRef.current) {
      const cached = loadAnalysisCache(materialId)
      if (cached) {
        taskIdRef.current = cached.taskId
        // Also load quiz questions + knowledge cards from backend for restored state
        getAnalysisResult(cached.taskId)
          .then((result) => {
            if (result.quiz?.questions.length) {
              onQuizReadyRef.current?.(result.quiz.questions)
            }
            if (result.knowledge_cards) {
              onKnowledgeCardsReadyRef.current?.(result.knowledge_cards)
            }
          })
          .catch(() => { /* non-blocking */ })
        // Also try standalone knowledge cards endpoint
        getKnowledgeCards(cached.taskId)
          .then((data) => { onKnowledgeCardsReadyRef.current?.(data) })
          .catch(() => { /* non-blocking */ })
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materialId])

  // Load saved exam profile on mount
  useEffect(() => {
    if (courseId) {
      const saved = loadExamProfile(courseId)
      if (saved) dispatch({ type: 'SET_EXAM_PROFILE', profile: saved })
    }
  }, [courseId])

  // Cleanup SSE subscription
  useEffect(() => {
    return () => { unsubRef.current?.() }
  }, [])

  // Auto-detect existing completed analysis (only if not already restored from cache)
  useEffect(() => {
    let cancelled = false
    if (skipAutoDetectRef.current) return
    // Skip if already restored from localStorage cache
    if (state.phase === 'complete' && state.modules.length > 0) return

    getLatestAnalysis(materialId).then(async (task) => {
      if (cancelled || skipAutoDetectRef.current || !task || task.status !== 'completed') return
      try {
        const result = await getAnalysisResult(task.task_id)
        if (cancelled || skipAutoDetectRef.current) return
        taskIdRef.current = task.task_id
        // Save to localStorage for future mounts
        saveAnalysisCache(materialId, task.task_id, result.modules as DisassemblyModule[])
        dispatch({ type: 'RESTORE_COMPLETE', modules: result.modules as DisassemblyModule[] })
        if (result.quiz?.questions.length) {
          onQuizReadyRef.current?.(result.quiz.questions)
        }
        if (result.knowledge_cards) {
          onKnowledgeCardsReadyRef.current?.(result.knowledge_cards)
        } else {
          // Try standalone endpoint
          getKnowledgeCards(task.task_id)
            .then((data) => { if (!cancelled) onKnowledgeCardsReadyRef.current?.(data) })
            .catch(() => {})
        }
      } catch { /* ignore */ }
    }).catch(() => {})

    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materialId])

  // ── Actions ────────────────────────────────────────

  const startProcessing = useCallback(async (intent: Intent, data: GatheringData) => {
    dispatch({ type: 'START_PROCESSING' })

    try {
      const mapped = intent === 'review' ? 'learn' : intent
      const profile = data.examProfile ?? state.examProfile ?? undefined
      const { taskId } = await startDisassembly(materialId, mapped, {
        examProfile: profile,
        referenceMaterialIds: data.referenceMaterialIds,
      })
      taskIdRef.current = taskId

      unsubRef.current = subscribeProgress(taskId, (evt: ProgressEvent) => {
        dispatch({
          type: 'UPDATE_PROGRESS',
          progress: evt.progress,
          currentStep: evt.currentStep,
          pipelinePhase: evt.phase as PipelinePhase | undefined,
          detail: evt.detail,
        })

        if (evt.status === 'completed') {
          getAnalysisResult(taskId).then((result) => {
            const mods = result.modules as DisassemblyModule[]
            const studentProfile = loadProfile()
            const steps = generatePlanSteps(mods, intent, studentProfile)
            // Persist to localStorage so future mounts restore instantly
            saveAnalysisCache(materialId, taskId, mods)
            dispatch({ type: 'PROCESSING_COMPLETE', modules: mods, planSteps: steps })
            showToast(`课件分析完成，发现 ${mods.length} 个知识模块`)
            // Load knowledge cards (non-blocking)
            if (result.knowledge_cards) {
              onKnowledgeCardsReadyRef.current?.(result.knowledge_cards)
            } else {
              getKnowledgeCards(taskId)
                .then((data) => { onKnowledgeCardsReadyRef.current?.(data) })
                .catch(() => {})
            }
          }).catch(() => {
            dispatch({ type: 'PROCESSING_ERROR', errorMsg: '获取分析结果失败' })
          })
        }

        if (evt.status === 'failed') {
          dispatch({ type: 'PROCESSING_ERROR', errorMsg: evt.currentStep ?? '分析过程中出现错误' })
        }
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : '启动失败'
      // If analysis already exists, try to load existing results
      if (msg.toLowerCase().includes('already') || msg.includes('已存在')) {
        try {
          const task = await getLatestAnalysis(materialId)
          if (task && task.status === 'completed') {
            const result = await getAnalysisResult(task.task_id)
            taskIdRef.current = task.task_id
            const mods = result.modules as DisassemblyModule[]
            saveAnalysisCache(materialId, task.task_id, mods)
            dispatch({ type: 'RESTORE_COMPLETE', modules: mods })
            if (result.quiz?.questions.length) {
              onQuizReadyRef.current?.(result.quiz.questions)
            }
            if (result.knowledge_cards) {
              onKnowledgeCardsReadyRef.current?.(result.knowledge_cards)
            } else {
              getKnowledgeCards(task.task_id)
                .then((data) => { onKnowledgeCardsReadyRef.current?.(data) })
                .catch(() => {})
            }
            return
          }
        } catch { /* fall through to error */ }
      }
      dispatch({
        type: 'PROCESSING_ERROR',
        errorMsg: msg,
      })
    }
  }, [materialId, state.examProfile])

  // Try to restore existing completed analysis before starting a new one
  const tryRestoreExisting = useCallback(async (): Promise<boolean> => {
    try {
      const task = await getLatestAnalysis(materialId)
      if (task && task.status === 'completed') {
        const result = await getAnalysisResult(task.task_id)
        taskIdRef.current = task.task_id
        const mods = result.modules as DisassemblyModule[]
        saveAnalysisCache(materialId, task.task_id, mods)
        dispatch({ type: 'RESTORE_COMPLETE', modules: mods })
        if (result.quiz?.questions.length) {
          onQuizReadyRef.current?.(result.quiz.questions)
        }
        if (result.knowledge_cards) {
          onKnowledgeCardsReadyRef.current?.(result.knowledge_cards)
        } else {
          getKnowledgeCards(task.task_id)
            .then((data) => { onKnowledgeCardsReadyRef.current?.(data) })
            .catch(() => {})
        }
        return true
      }
    } catch { /* ignore */ }
    return false
  }, [materialId])

  const handleIntentSelect = useCallback((intent: Intent) => {
    dispatch({ type: 'SELECT_INTENT', intent })
    if (intent === 'review') {
      // Try restore first, fall back to starting new analysis
      tryRestoreExisting().then(restored => {
        if (!restored) startProcessing(intent, {})
      })
    } else if (intent === 'exam') {
      dispatch({ type: 'ENTER_EXAM_SETUP' })
    } else {
      dispatch({ type: 'ENTER_GATHERING' })
    }
  }, [startProcessing, tryRestoreExisting])

  const handleGatheringSubmit = useCallback(async () => {
    if (!state.intent) return
    // Try to restore existing analysis first
    const restored = await tryRestoreExisting()
    if (!restored) {
      startProcessing(state.intent, state.gathering)
    }
  }, [state.intent, state.gathering, startProcessing, tryRestoreExisting])

  const handleModuleClick = useCallback(async (mod: DisassemblyModule) => {
    if (!taskIdRef.current || !onModuleSelect) return
    dispatch({ type: 'LOAD_MODULE', moduleId: mod.id })
    try {
      const result = await getSpecialistResult(taskIdRef.current, mod.id)
      onModuleSelect(mod.id, mod.name, result.markdown, result.key_concepts, result.exam_traps)
    } catch { /* silently fail */ }
    dispatch({ type: 'MODULE_LOADED' })
  }, [onModuleSelect])

  const handleExamConfirm = useCallback((profile: ExamProfile) => {
    dispatch({ type: 'SET_EXAM_PROFILE', profile })
    const data: GatheringData = { examProfile: profile }
    dispatch({ type: 'SET_GATHERING', data })
    startProcessing('exam', data)
  }, [startProcessing])

  const handleExamSkip = useCallback(() => {
    startProcessing('exam', {})
  }, [startProcessing])

  const handleExamUploadProfile = useCallback((profile: ExamProfile) => {
    dispatch({ type: 'SET_EXAM_PROFILE', profile })
  }, [])

  const handleReset = useCallback(() => {
    unsubRef.current?.()
    unsubRef.current = null
    taskIdRef.current = null
    skipAutoDetectRef.current = true
    clearAnalysisCache(materialId)
    dispatch({ type: 'RESET' })
    onQuizReady?.([])
  }, [materialId, onQuizReady])

  const handleConfirmPlan = useCallback(() => {
    dispatch({ type: 'CONFIRM_PLAN' })
    if (taskIdRef.current && onQuizReady) {
      getAnalysisResult(taskIdRef.current)
        .then((result) => {
          if (result.quiz?.questions.length) {
            onQuizReady(result.quiz.questions)
          }
        })
        .catch(() => { /* non-blocking */ })
    }
  }, [onQuizReady])

  const handleToolClick = useCallback(async (toolId: string) => {
    // qa → switch sidebar to Tutor tab with current module context
    if (toolId === 'qa') {
      onSwitchToTutorRef.current?.(currentModuleName || undefined)
      dispatch({ type: 'SET_ACTIVE_TOOL', toolId: null })
      return
    }

    // mock-quiz → filter quiz questions to current module and show quiz tab
    if (toolId === 'mock-quiz') {
      if (!currentModuleName) {
        dispatch({ type: 'TOOL_ERROR', error: '请先选择一个模块查看 AI 精讲' })
        return
      }
      onModuleQuizRef.current?.(currentModuleName, currentModuleName)
      dispatch({ type: 'SET_ACTIVE_TOOL', toolId: null })
      return
    }

    // flashcards → generate flashcards from current specialist content
    if (toolId === 'flashcards') {
      if (!specialistMarkdown) {
        dispatch({ type: 'TOOL_ERROR', error: '请先选择一个模块查看 AI 精讲' })
        return
      }
      onGenerateFlashcardsRef.current?.()
      dispatch({ type: 'SET_ACTIVE_TOOL', toolId: null })
      return
    }

    if (!specialistMarkdown) {
      dispatch({ type: 'TOOL_ERROR', error: '请先选择一个模块查看 AI 精讲' })
      return
    }

    dispatch({ type: 'SET_ACTIVE_TOOL', toolId })
    const modName = currentModuleName || ''

    try {
      let result: ToolResult
      switch (toolId) {
        case 'summary':
          result = { toolId: 'summary', data: await toolSummary(specialistMarkdown) }
          break
        case 'key-points':
          result = { toolId: 'key-points', data: await toolExamPoints(specialistMarkdown, modName) }
          break
        case 'pitfalls':
          result = { toolId: 'pitfalls', data: await toolMistakeAnalysis(specialistMarkdown, modName) }
          break
        case 'concept-map':
          result = { toolId: 'concept-map', data: await toolConceptMap(specialistMarkdown, modName) }
          break
        case 'deep-read':
          result = { toolId: 'deep-read', data: await toolReadingNotes(specialistMarkdown, modName) }
          break
        default:
          dispatch({ type: 'SET_ACTIVE_TOOL', toolId: null })
          return
      }
      dispatch({ type: 'TOOL_RESULT', result })
      const toolLabels: Record<string, string> = {
        summary: '一键总结',
        'key-points': '考点提取',
        pitfalls: '易错总结',
        'concept-map': '概念图谱',
        'deep-read': '精读笔记',
      }
      showToast(`${toolLabels[toolId] || toolId} 已生成`)
    } catch (err) {
      dispatch({ type: 'TOOL_ERROR', error: err instanceof Error ? err.message : '工具调用失败' })
    }
  }, [specialistMarkdown, currentModuleName])

  const handleClearToolResult = useCallback(() => {
    dispatch({ type: 'CLEAR_TOOL_RESULT' })
  }, [])

  const handleToggleManual = useCallback(() => {
    dispatch({ type: 'TOGGLE_MANUAL' })
  }, [])

  const handleGatheringChange = useCallback((data: GatheringData) => {
    dispatch({ type: 'SET_GATHERING', data })
  }, [])

  return {
    state,
    dispatch,
    actions: {
      handleIntentSelect,
      handleGatheringSubmit,
      handleGatheringChange,
      handleModuleClick,
      handleExamConfirm,
      handleExamSkip,
      handleExamUploadProfile,
      handleReset,
      handleConfirmPlan,
      handleToolClick,
      handleClearToolResult,
      handleToggleManual,
    },
  }
}
