/**
 * useAIToolPanel — useReducer state machine for the AI tool panel.
 * Manages phase transitions, progress tracking, and analysis results.
 * Follows the same pattern as useTutorSession.ts.
 */

import { useReducer, useCallback, useRef, useEffect } from 'react'
import {
  startDisassembly,
  subscribeProgress,
  getSpecialistResult,
  getAnalysisResult,
  getLatestAnalysis,
} from '@/lib/api'
import type { DisassemblyModule, MCQuestion, ProgressEvent } from '@/lib/api'
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
      return { ...state, activeTool: action.toolId }

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
  onModuleSelect?: (moduleId: string, moduleName: string, markdown: string) => void
  onQuizReady?: (questions: MCQuestion[]) => void
}

export function useAIToolPanel({
  materialId,
  courseId,
  onModuleSelect,
  onQuizReady,
}: UseAIToolPanelOptions) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE)

  const taskIdRef = useRef<string | null>(null)
  const unsubRef = useRef<(() => void) | null>(null)
  const skipAutoDetectRef = useRef(false)
  const onQuizReadyRef = useRef(onQuizReady)
  onQuizReadyRef.current = onQuizReady

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

  // Auto-detect existing completed analysis
  useEffect(() => {
    let cancelled = false
    if (skipAutoDetectRef.current) return

    getLatestAnalysis(materialId).then(async (task) => {
      if (cancelled || skipAutoDetectRef.current || !task || task.status !== 'completed') return
      try {
        const result = await getAnalysisResult(task.task_id)
        if (cancelled || skipAutoDetectRef.current) return
        taskIdRef.current = task.task_id
        dispatch({ type: 'RESTORE_COMPLETE', modules: result.modules as DisassemblyModule[] })
        if (result.quiz?.questions.length) {
          onQuizReadyRef.current?.(result.quiz.questions)
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
            dispatch({ type: 'PROCESSING_COMPLETE', modules: mods, planSteps: steps })
          }).catch(() => {
            dispatch({ type: 'PROCESSING_ERROR', errorMsg: '获取分析结果失败' })
          })
        }

        if (evt.status === 'failed') {
          dispatch({ type: 'PROCESSING_ERROR', errorMsg: evt.currentStep ?? '分析过程中出现错误' })
        }
      })
    } catch (err) {
      dispatch({
        type: 'PROCESSING_ERROR',
        errorMsg: err instanceof Error ? err.message : '启动失败',
      })
    }
  }, [materialId, state.examProfile])

  const handleIntentSelect = useCallback((intent: Intent) => {
    dispatch({ type: 'SELECT_INTENT', intent })
    if (intent === 'review') {
      startProcessing(intent, {})
    } else if (intent === 'exam') {
      dispatch({ type: 'ENTER_EXAM_SETUP' })
    } else {
      dispatch({ type: 'ENTER_GATHERING' })
    }
  }, [startProcessing])

  const handleGatheringSubmit = useCallback(() => {
    if (!state.intent) return
    startProcessing(state.intent, state.gathering)
  }, [state.intent, state.gathering, startProcessing])

  const handleModuleClick = useCallback(async (mod: DisassemblyModule) => {
    if (!taskIdRef.current || !onModuleSelect) return
    dispatch({ type: 'LOAD_MODULE', moduleId: mod.id })
    try {
      const result = await getSpecialistResult(taskIdRef.current, mod.id)
      onModuleSelect(mod.id, mod.name, result.markdown)
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
    dispatch({ type: 'RESET' })
    onQuizReady?.([])
  }, [onQuizReady])

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

  const handleToolClick = useCallback((toolId: string) => {
    dispatch({ type: 'SET_ACTIVE_TOOL', toolId })
    setTimeout(() => dispatch({ type: 'SET_ACTIVE_TOOL', toolId: null }), 3000)
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
      handleToggleManual,
    },
  }
}
