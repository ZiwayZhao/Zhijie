/**
 * LearningOrchestrator — useReducer-based central learning orchestration engine.
 * Pure logic layer (no React). Manages session state machine: step sequencing,
 * auto-advance, dynamic replanning, and progress tracking.
 */
import type { DisassemblyModule } from './api-disassembly'
import type { LearningProfile } from './student-model'

// --- Types ---

export type StepStatus = 'pending' | 'active' | 'completed' | 'skipped' | 'failed'
export type StepAction = 'read' | 'quiz' | 'flashcard' | 'socratic' | 'deep-dive'

export type StepResult =
  | { type: 'markdown'; content: string }
  | { type: 'quiz'; score: number; total: number; wrong: string[] }
  | { type: 'flashcard'; cardsGenerated: number }
  | { type: 'socratic'; hintsUsed: number }

export interface LearningStep {
  id: string
  moduleId: string
  moduleName: string
  action: StepAction
  status: StepStatus
  estimatedMin: number
  actualMin?: number
  mastery: number
  masteryAfter?: number
  priority: 'high' | 'medium' | 'low'
  skippable: boolean
  result?: StepResult
  insertedBy?: 'planner' | 'replan'
}

export type OrchestratorPhase = 'idle' | 'analyzing' | 'learning' | 'paused' | 'completed'
export type Intent = 'learn' | 'exam' | 'review'

export interface OrchestratorState {
  sessionId: string
  intent: Intent
  phase: OrchestratorPhase
  steps: LearningStep[]
  currentStepIndex: number
  totalTimeSpent: number
  startedAt: number | null
  pausedAt: number | null
  /** Timestamp when the current step became active (ms). Used for per-step actualMin. */
  stepStartedAt: number | null
}

export type OrchestratorEvent =
  | { type: 'START_SESSION'; intent: Intent; steps: LearningStep[] }
  | { type: 'STEP_COMPLETED'; stepId: string; result: StepResult }
  | { type: 'STEP_SKIPPED'; stepId: string }
  | { type: 'QUIZ_SCORED'; stepId: string; score: number; total: number; wrongModules: string[] }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'ADVANCE_TO_NEXT' }
  | { type: 'INSERT_STEP'; afterStepId: string; newStep: LearningStep }
  | { type: 'COMPLETE_SESSION' }

// --- Initial State ---

export function createInitialState(): OrchestratorState {
  return {
    sessionId: '', intent: 'learn', phase: 'idle', steps: [],
    currentStepIndex: -1, totalTimeSpent: 0, startedAt: null, pausedAt: null,
    stepStartedAt: null,
  }
}

// --- Internal helpers ---

function findNextPending(steps: LearningStep[], after: number): number {
  for (let i = after + 1; i < steps.length; i++) {
    if (steps[i].status === 'pending') return i
  }
  return -1
}

function setStatus(steps: LearningStep[], idx: number, status: StepStatus, patch?: Partial<LearningStep>): LearningStep[] {
  return steps.map((s, i) => i === idx ? { ...s, status, ...patch } : s)
}

function computeMasteryAfter(cur: number, r: StepResult): number {
  switch (r.type) {
    case 'quiz': return r.total === 0 ? cur : Math.min(1, cur * 0.6 + (r.score / r.total) * 0.4)
    case 'markdown': return Math.min(1, cur + 0.05)
    case 'flashcard': return Math.min(1, cur + 0.03)
    case 'socratic': return Math.min(1, cur + 0.08)
    default: return cur
  }
}

// --- Reducer ---

export function orchestratorReducer(
  state: OrchestratorState,
  event: OrchestratorEvent,
): OrchestratorState {
  switch (event.type) {
    case 'START_SESSION': {
      const now = Date.now()
      const steps = event.steps.map((s, i) =>
        i === 0 ? { ...s, status: 'active' as StepStatus } : s,
      )
      return {
        ...state, sessionId: `session-${now}`, intent: event.intent,
        phase: steps.length > 0 ? 'learning' : 'completed',
        steps, currentStepIndex: steps.length > 0 ? 0 : -1,
        totalTimeSpent: 0, startedAt: now, pausedAt: null,
        stepStartedAt: steps.length > 0 ? now : null,
      }
    }

    case 'STEP_COMPLETED': {
      const idx = state.steps.findIndex((s) => s.id === event.stepId)
      if (idx === -1) return state
      const now = Date.now()
      const step = state.steps[idx]
      const stepElapsed = Math.round((now - (state.stepStartedAt ?? now)) / 60000)
      const updated = setStatus(state.steps, idx, 'completed', {
        result: event.result, actualMin: stepElapsed,
        masteryAfter: computeMasteryAfter(step.mastery, event.result),
      })
      const nextIdx = findNextPending(updated, idx)
      if (nextIdx === -1) {
        return { ...state, steps: updated, currentStepIndex: -1, phase: 'completed',
          totalTimeSpent: state.totalTimeSpent + stepElapsed, stepStartedAt: null }
      }
      return { ...state, steps: setStatus(updated, nextIdx, 'active'),
        currentStepIndex: nextIdx, totalTimeSpent: state.totalTimeSpent + stepElapsed,
        stepStartedAt: now }
    }

    case 'STEP_SKIPPED': {
      const idx = state.steps.findIndex((s) => s.id === event.stepId)
      if (idx === -1) return state
      const steps = setStatus(state.steps, idx, 'skipped')
      if (idx === state.currentStepIndex) {
        const nextIdx = findNextPending(steps, idx)
        if (nextIdx === -1) return { ...state, steps, currentStepIndex: -1, phase: 'completed' }
        return { ...state, steps: setStatus(steps, nextIdx, 'active'), currentStepIndex: nextIdx }
      }
      return { ...state, steps }
    }

    case 'QUIZ_SCORED': {
      const idx = state.steps.findIndex((s) => s.id === event.stepId)
      if (idx === -1) return state
      const quizResult: StepResult = {
        type: 'quiz', score: event.score, total: event.total, wrong: event.wrongModules,
      }
      let next = orchestratorReducer(state, {
        type: 'STEP_COMPLETED', stepId: event.stepId, result: quizResult,
      })
      // Insert socratic reinforcement if score < 60%
      if (event.total > 0 && event.score / event.total < 0.6) {
        const qs = state.steps[idx]
        next = orchestratorReducer(next, {
          type: 'INSERT_STEP', afterStepId: event.stepId,
          newStep: {
            id: `replan-socratic-${qs.moduleId}-${Date.now()}`,
            moduleId: qs.moduleId, moduleName: qs.moduleName,
            action: 'socratic', status: 'pending', estimatedMin: 10,
            mastery: qs.mastery, priority: 'high', skippable: false, insertedBy: 'replan',
          },
        })
      }
      return next
    }

    case 'PAUSE':
      return state.phase === 'learning'
        ? { ...state, phase: 'paused', pausedAt: Date.now() }
        : state

    case 'RESUME': {
      if (state.phase !== 'paused') return state
      // Paused time is idle — do NOT add it to totalTimeSpent.
      // Shift stepStartedAt forward so the paused duration is excluded from per-step actualMin.
      const pausedMs = state.pausedAt ? Date.now() - state.pausedAt : 0
      return {
        ...state, phase: 'learning', pausedAt: null,
        stepStartedAt: state.stepStartedAt ? state.stepStartedAt + pausedMs : null,
      }
    }

    case 'ADVANCE_TO_NEXT': {
      if (state.currentStepIndex === -1) return state
      // Ensure the current step is no longer 'active' (mark as 'skipped' if still active)
      let steps = state.steps
      const cur = steps[state.currentStepIndex]
      if (cur && cur.status === 'active') {
        steps = setStatus(steps, state.currentStepIndex, 'skipped')
      }
      const nextIdx = findNextPending(steps, state.currentStepIndex)
      if (nextIdx === -1) return { ...state, steps, currentStepIndex: -1, phase: 'completed' }
      return { ...state, steps: setStatus(steps, nextIdx, 'active'), currentStepIndex: nextIdx, stepStartedAt: Date.now() }
    }

    case 'INSERT_STEP': {
      const afterIdx = state.steps.findIndex((s) => s.id === event.afterStepId)
      if (afterIdx === -1) return state
      const tagged: LearningStep = { ...event.newStep, insertedBy: event.newStep.insertedBy ?? 'replan' }
      const newSteps = [
        ...state.steps.slice(0, afterIdx + 1), tagged, ...state.steps.slice(afterIdx + 1),
      ]
      const adj = afterIdx < state.currentStepIndex ? state.currentStepIndex + 1 : state.currentStepIndex
      return { ...state, steps: newSteps, currentStepIndex: adj }
    }

    case 'COMPLETE_SESSION':
      return { ...state, phase: 'completed', currentStepIndex: -1 }

    default:
      return state
  }
}

// --- Step Generation ---

const WEIGHT: Record<string, number> = { high: 3, medium: 2, low: 1 }

function makeStep(mod: DisassemblyModule, action: StepAction, mastery: number): LearningStep {
  const mins: Record<StepAction, number> = { read: 10, 'deep-dive': 15, quiz: 5, flashcard: 5, socratic: 10 }
  return {
    id: `step-${mod.id}-${action}-${Date.now()}`,
    moduleId: mod.id, moduleName: mod.name, action, status: 'pending',
    estimatedMin: mins[action], mastery,
    priority: mod.examWeight === 'high' ? 'high' : mod.examWeight === 'medium' ? 'medium' : 'low',
    skippable: mastery > 0.7 || mod.examWeight === 'low', insertedBy: 'planner',
  }
}

export function createInitialSteps(
  modules: DisassemblyModule[], intent: Intent, profile: LearningProfile,
): LearningStep[] {
  if (intent === 'learn') return createLearnSteps(modules, profile)
  if (intent === 'exam') return createExamSteps(modules, profile)
  return createReviewSteps(modules, profile)
}

function createLearnSteps(modules: DisassemblyModule[], profile: LearningProfile): LearningStep[] {
  const steps: LearningStep[] = []
  for (const mod of modules) {
    const m = profile.modules[mod.id]?.mastery ?? 0.3
    steps.push(makeStep(mod, 'read', m))
    if (m < 0.5) steps.push(makeStep(mod, 'deep-dive', m))
  }
  if (modules.length > 0) {
    steps.push({
      id: `step-final-quiz-${Date.now()}`, moduleId: 'all', moduleName: '综合测验',
      action: 'quiz', status: 'pending', estimatedMin: 10, mastery: 0,
      priority: 'high', skippable: false, insertedBy: 'planner',
    })
  }
  return steps
}

function createExamSteps(modules: DisassemblyModule[], profile: LearningProfile): LearningStep[] {
  const steps: LearningStep[] = []
  const sorted = [...modules].sort((a, b) => (WEIGHT[b.examWeight] ?? 2) - (WEIGHT[a.examWeight] ?? 2))
  for (const mod of sorted) {
    const m = profile.modules[mod.id]?.mastery ?? 0.3
    if (m > 0.7) continue
    if (mod.examWeight === 'high' && m < 0.5) steps.push(makeStep(mod, 'deep-dive', m))
    else if (mod.examWeight === 'high') steps.push(makeStep(mod, 'quiz', m))
    else steps.push(makeStep(mod, 'flashcard', m))
  }
  return steps
}

function createReviewSteps(modules: DisassemblyModule[], profile: LearningProfile): LearningStep[] {
  const base = modules
    .filter((mod) => (profile.modules[mod.id]?.mastery ?? 0.3) < 0.6)
    .map((mod) => makeStep(mod, 'flashcard', profile.modules[mod.id]?.mastery ?? 0.3))
  const out: LearningStep[] = []
  for (let i = 0; i < base.length; i++) {
    out.push(base[i])
    if ((i + 1) % 5 === 0 && i < base.length - 1) {
      out.push({
        id: `step-review-quiz-${i}-${Date.now()}`, moduleId: 'mixed', moduleName: '复习检查',
        action: 'quiz', status: 'pending', estimatedMin: 3, mastery: 0,
        priority: 'medium', skippable: true, insertedBy: 'planner',
      })
    }
  }
  return out
}

// --- Query Helpers ---

export function getCurrentStep(state: OrchestratorState): LearningStep | null {
  const { currentStepIndex: i, steps } = state
  return i >= 0 && i < steps.length ? steps[i] : null
}

export function getProgress(state: OrchestratorState): number {
  if (state.steps.length === 0) return 0
  const done = state.steps.filter((s) => s.status === 'completed' || s.status === 'skipped').length
  return Math.round((done / state.steps.length) * 100)
}

export function getCompletedCount(state: OrchestratorState): number {
  return state.steps.filter((s) => s.status === 'completed').length
}

export function getRemainingMinutes(state: OrchestratorState): number {
  return state.steps
    .filter((s) => s.status === 'pending' || s.status === 'active')
    .reduce((sum, s) => sum + s.estimatedMin, 0)
}

export function shouldAutoAdvance(step: LearningStep): 'auto' | 'prompt' | 'pause' {
  if (!step.result) return 'pause'
  switch (step.result.type) {
    case 'markdown': return 'auto'
    case 'quiz': {
      if (step.result.total === 0) return 'auto'
      const pct = step.result.score / step.result.total
      return pct >= 0.8 ? 'auto' : pct >= 0.6 ? 'prompt' : 'pause'
    }
    case 'flashcard': return 'auto'
    case 'socratic': return step.result.hintsUsed > 3 ? 'prompt' : 'auto'
    default: return 'pause'
  }
}
