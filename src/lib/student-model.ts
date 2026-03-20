/**
 * Student Model — BKT knowledge tracing + learning profile.
 * Tracks per-module mastery, processes feedback signals,
 * and provides scaffold level for Socratic dialogue.
 */

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ModuleMastery {
  moduleId: string
  moduleName: string
  courseId: string
  mastery: number // 0-1 probability of mastery
  lastUpdated: number
  totalAttempts: number
  correctAttempts: number
}

export interface BKTParams {
  pL0: number // P(L0) initial mastery probability
  pT: number  // P(T)  transition probability
  pG: number  // P(G)  guess probability
  pS: number  // P(S)  slip probability
}

export interface LearningProfile {
  userId: string
  goal: 'learn' | 'exam' | 'review' | null
  modules: Record<string, ModuleMastery>
  totalStudyMinutes: number
  streakDays: number
  lastActiveDate: string // ISO date
}

export type FeedbackSignal =
  | { type: 'quiz-answer'; moduleId: string; courseId: string; correct: boolean; moduleName?: string }
  | { type: 'quiz-answer-v2'; moduleId: string; questionType: string; correct: boolean; points: number; maxPoints: number }
  | { type: 'flashcard-rating'; moduleId: string; courseId: string; rating: 1 | 2 | 3 | 4; moduleName?: string }
  | { type: 'study-time'; courseId: string; durationMin: number }

/* ------------------------------------------------------------------ */
/*  BKT defaults                                                       */
/* ------------------------------------------------------------------ */

const DEFAULT_BKT: BKTParams = {
  pL0: 0.3,
  pT: 0.09,
  pG: 0.25,
  pS: 0.10,
}

/* ------------------------------------------------------------------ */
/*  Profile management                                                 */
/* ------------------------------------------------------------------ */

export function createDefaultProfile(userId?: string): LearningProfile {
  return {
    userId: userId ?? 'local-user',
    goal: null,
    modules: {},
    totalStudyMinutes: 0,
    streakDays: 0,
    lastActiveDate: new Date().toISOString().slice(0, 10),
  }
}

function ensureModule(
  profile: LearningProfile,
  moduleId: string,
  courseId: string,
  moduleName?: string,
): ModuleMastery {
  if (profile.modules[moduleId]) return profile.modules[moduleId]
  return {
    moduleId,
    moduleName: moduleName ?? moduleId,
    courseId,
    mastery: DEFAULT_BKT.pL0,
    lastUpdated: Date.now(),
    totalAttempts: 0,
    correctAttempts: 0,
  }
}

/* ------------------------------------------------------------------ */
/*  Core BKT update                                                    */
/* ------------------------------------------------------------------ */

export function updateMasteryBKT(
  m: ModuleMastery,
  correct: boolean,
  params: BKTParams = DEFAULT_BKT,
): ModuleMastery {
  const { pT, pG, pS } = params
  const pL = m.mastery

  let pLGivenObs: number
  if (correct) {
    const pCorrect = pL * (1 - pS) + (1 - pL) * pG
    pLGivenObs = pCorrect > 0 ? (pL * (1 - pS)) / pCorrect : pL
  } else {
    const pIncorrect = pL * pS + (1 - pL) * (1 - pG)
    pLGivenObs = pIncorrect > 0 ? (pL * pS) / pIncorrect : pL
  }

  // Apply transition (learning)
  const newMastery = pLGivenObs + (1 - pLGivenObs) * pT

  return {
    ...m,
    mastery: Math.min(Math.max(newMastery, 0), 1),
    lastUpdated: Date.now(),
    totalAttempts: m.totalAttempts + 1,
    correctAttempts: m.correctAttempts + (correct ? 1 : 0),
  }
}

/* ------------------------------------------------------------------ */
/*  Multi-type question BKT weights                                    */
/* ------------------------------------------------------------------ */

/** Different question types carry different BKT weight signals */
const QUESTION_TYPE_WEIGHT: Record<string, number> = {
  mcq: 1.0,           // standard — 25% guess rate
  true_false: 0.7,     // easier — 50% guess rate
  fill_blank: 1.3,     // harder — no options to choose from
  short_answer: 1.5,   // much harder, stronger mastery signal
  calculation: 1.5,    // multi-step, strong signal
}

function getTypeWeight(questionType: string): number {
  return QUESTION_TYPE_WEIGHT[questionType] ?? 1.0
}

/** Determine correctness for partial-credit question types */
function isPartialCorrect(
  questionType: string,
  points: number,
  maxPoints: number,
): boolean {
  if (maxPoints <= 0) return false
  const ratio = points / maxPoints
  // short_answer: correct if > 60% of points
  if (questionType === 'short_answer') return ratio > 0.6
  // calculation: correct if > 50% of points (partial credit for steps)
  if (questionType === 'calculation') return ratio > 0.5
  // everything else: use the raw correct flag (caller decides)
  return ratio >= 1.0
}

/* ------------------------------------------------------------------ */
/*  Weighted BKT update for multi-type questions                       */
/* ------------------------------------------------------------------ */

export function updateMasteryBKTWeighted(
  m: ModuleMastery,
  correct: boolean,
  weight: number,
  params: BKTParams = DEFAULT_BKT,
): ModuleMastery {
  const { pT, pG, pS } = params
  const pL = m.mastery

  let pLGivenObs: number
  if (correct) {
    const pCorrect = pL * (1 - pS) + (1 - pL) * pG
    pLGivenObs = pCorrect > 0 ? (pL * (1 - pS)) / pCorrect : pL
  } else {
    const pIncorrect = pL * pS + (1 - pL) * (1 - pG)
    pLGivenObs = pIncorrect > 0 ? (pL * pS) / pIncorrect : pL
  }

  // Apply weighted transition: stronger signal → larger pT step
  const weightedPT = Math.min(pT * weight, 0.5)
  const newMastery = pLGivenObs + (1 - pLGivenObs) * weightedPT

  return {
    ...m,
    mastery: Math.min(Math.max(newMastery, 0), 1),
    lastUpdated: Date.now(),
    totalAttempts: m.totalAttempts + 1,
    correctAttempts: m.correctAttempts + (correct ? 1 : 0),
  }
}

/* ------------------------------------------------------------------ */
/*  Quiz v2 feedback processing                                        */
/* ------------------------------------------------------------------ */

export interface QuizV2Result {
  moduleId: string
  questionType: string
  correct: boolean
  points: number
  maxPoints: number
}

/** Process a single multi-type quiz answer and update mastery */
export function processQuizV2Feedback(
  profile: LearningProfile,
  moduleId: string,
  questionType: string,
  correct: boolean,
  points: number,
  maxPoints: number,
): LearningProfile {
  const updated = { ...profile, modules: { ...profile.modules } }

  // For partial-credit types, override correct based on score ratio
  const effectiveCorrect = ['short_answer', 'calculation'].includes(questionType)
    ? isPartialCorrect(questionType, points, maxPoints)
    : correct

  const weight = getTypeWeight(questionType)
  const mod = ensureModule(updated, moduleId, '', moduleId)
  updated.modules[moduleId] = updateMasteryBKTWeighted(mod, effectiveCorrect, weight)

  return updated
}

/** Batch process all quiz results from a QuizPanelV2 session */
export function processQuizResults(
  profile: LearningProfile,
  results: QuizV2Result[],
): LearningProfile {
  let current = profile
  for (const r of results) {
    current = processQuizV2Feedback(
      current,
      r.moduleId,
      r.questionType,
      r.correct,
      r.points,
      r.maxPoints,
    )
  }
  return current
}

/* ------------------------------------------------------------------ */
/*  Feedback processing                                                */
/* ------------------------------------------------------------------ */

export function processFeedback(
  profile: LearningProfile,
  signal: FeedbackSignal,
): LearningProfile {
  const updated = { ...profile, modules: { ...profile.modules } }

  switch (signal.type) {
    case 'quiz-answer': {
      const mod = ensureModule(updated, signal.moduleId, signal.courseId, signal.moduleName)
      updated.modules[signal.moduleId] = updateMasteryBKT(mod, signal.correct)
      break
    }
    case 'quiz-answer-v2': {
      return processQuizV2Feedback(
        updated, signal.moduleId, signal.questionType,
        signal.correct, signal.points, signal.maxPoints,
      )
    }
    case 'flashcard-rating': {
      const mod = ensureModule(updated, signal.moduleId, signal.courseId, signal.moduleName)
      // Rating 1-2 = incorrect, 3-4 = correct
      const correct = signal.rating >= 3
      updated.modules[signal.moduleId] = updateMasteryBKT(mod, correct)
      break
    }
    case 'study-time': {
      updated.totalStudyMinutes += signal.durationMin
      break
    }
  }

  // Update streak
  const today = new Date().toISOString().slice(0, 10)
  if (updated.lastActiveDate !== today) {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayStr = yesterday.toISOString().slice(0, 10)
    updated.streakDays = updated.lastActiveDate === yesterdayStr
      ? updated.streakDays + 1
      : 1
    updated.lastActiveDate = today
  }

  return updated
}

/* ------------------------------------------------------------------ */
/*  Mastery helpers                                                    */
/* ------------------------------------------------------------------ */

export type MasteryLevel = 'beginner' | 'developing' | 'proficient' | 'expert'

export function getMasteryLevel(mastery: number): MasteryLevel {
  if (mastery < 0.3) return 'beginner'
  if (mastery < 0.6) return 'developing'
  if (mastery < 0.8) return 'proficient'
  return 'expert'
}

export function getMasteryLabel(level: MasteryLevel): string {
  switch (level) {
    case 'beginner': return '入门'
    case 'developing': return '进展中'
    case 'proficient': return '熟练'
    case 'expert': return '精通'
  }
}

export function getMasteryColor(level: MasteryLevel): string {
  switch (level) {
    case 'beginner': return '#A5192E'
    case 'developing': return '#C49A2A'
    case 'proficient': return '#4CAF50'
    case 'expert': return '#2196F3'
  }
}

export type ScaffoldLevel = 'full' | 'moderate' | 'minimal'

/** ZPD scaffold level for Socratic dialogue */
export function getScaffoldLevel(mastery: number): ScaffoldLevel {
  if (mastery < 0.3) return 'full'
  if (mastery < 0.7) return 'moderate'
  return 'minimal'
}

/** Get weak modules for a course (mastery < 0.6) sorted ascending */
export function getWeakModules(
  profile: LearningProfile,
  courseId: string,
): ModuleMastery[] {
  return Object.values(profile.modules)
    .filter((m) => m.courseId === courseId && m.mastery < 0.6)
    .sort((a, b) => a.mastery - b.mastery)
}

/** Get all modules for a course */
export function getCourseModules(
  profile: LearningProfile,
  courseId: string,
): ModuleMastery[] {
  return Object.values(profile.modules)
    .filter((m) => m.courseId === courseId)
    .sort((a, b) => a.mastery - b.mastery)
}

/* ------------------------------------------------------------------ */
/*  Persistence                                                        */
/* ------------------------------------------------------------------ */

import { STORAGE_KEYS } from './storage-keys'

/**
 * Load profile from localStorage.
 * If userId is provided and differs from stored profile, creates a new one
 * (prevents cross-user data leakage on login switch).
 */
export function loadProfile(userId?: string): LearningProfile {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.LEARNING_PROFILE)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && parsed.userId) {
        // If authenticated userId is provided and differs, create fresh profile
        if (userId && parsed.userId !== userId && parsed.userId !== 'local-user') {
          const fresh = createDefaultProfile(userId)
          saveProfile(fresh)
          return fresh
        }
        // Migrate legacy 'local-user' to real userId if available
        if (userId && parsed.userId === 'local-user') {
          parsed.userId = userId
          saveProfile(parsed)
        }
        return parsed
      }
    }
  } catch {
    // fall through
  }
  return createDefaultProfile(userId)
}

export function saveProfile(profile: LearningProfile): void {
  localStorage.setItem(STORAGE_KEYS.LEARNING_PROFILE, JSON.stringify(profile))
}
