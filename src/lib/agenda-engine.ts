/**
 * Agenda Engine — generates unified daily learning plans.
 * Merges flashcard reviews, study tasks, exam prep, and manual todos.
 */
import { differenceInDays, format, isToday } from 'date-fns'
import type { FlashcardDeck } from '@/lib/fsrs'
import { getDueCards } from '@/lib/fsrs'
import type { ExamProfile } from '@/lib/exam-profile'
import type { LearningProfile } from '@/lib/student-model'
import { getWeakModules } from '@/lib/student-model'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface StudyItem {
  type: 'study'
  id: string
  courseId: string
  courseName: string
  moduleName: string
  estimatedMin: number
  priority: 'high' | 'medium' | 'low'
  completed: boolean
}

export interface FlashcardReviewItem {
  type: 'flashcard-review'
  id: string
  courseId: string
  courseName: string
  dueCount: number
  estimatedMin: number
  completed: boolean
}

export interface ExamPrepItem {
  type: 'exam-prep'
  id: string
  courseId: string
  courseName: string
  examDate: string
  daysLeft: number
  moduleName?: string
  estimatedMin: number
  completed: boolean
}

export interface TodoItem {
  type: 'todo'
  id: string
  title: string
  completed: boolean
}

export interface MilestoneItem {
  type: 'milestone'
  id: string
  title: string
  achievedAt?: number
}

export type AgendaItem =
  | StudyItem
  | FlashcardReviewItem
  | ExamPrepItem
  | TodoItem
  | MilestoneItem

export interface ExamConfig {
  courseId: string
  courseName: string
  examDate: string // ISO date string
}

export interface DailyAgenda {
  date: string
  items: AgendaItem[]
  totalMinutes: number
}

/* ------------------------------------------------------------------ */
/*  Agenda generation                                                  */
/* ------------------------------------------------------------------ */

/** Estimate review time: ~2 min per 6 cards */
function estimateReviewMinutes(dueCount: number): number {
  return Math.max(1, Math.ceil(dueCount / 3))
}

export function getFlashcardAgendaItems(decks: FlashcardDeck[], targetDate?: Date): FlashcardReviewItem[] {
  const items: FlashcardReviewItem[] = []
  const cutoff = targetDate ?? new Date()

  for (const deck of decks) {
    const due = getDueCards(deck.cards, cutoff)
    if (due.length > 0) {
      items.push({
        type: 'flashcard-review',
        id: `fc-review-${deck.courseId}`,
        courseId: deck.courseId,
        courseName: deck.courseName,
        dueCount: due.length,
        estimatedMin: estimateReviewMinutes(due.length),
        completed: false,
      })
    }
  }

  return items
}

export function getExamPrepItems(configs: ExamConfig[], targetDate?: Date): ExamPrepItem[] {
  const items: ExamPrepItem[] = []
  const refDate = targetDate ?? new Date()

  for (const config of configs) {
    const examDate = new Date(config.examDate)
    const daysLeft = differenceInDays(examDate, refDate)

    if (daysLeft >= 0 && daysLeft <= 14) {
      const estimatedMin = daysLeft <= 3 ? 30 : daysLeft <= 7 ? 20 : 15
      items.push({
        type: 'exam-prep',
        id: `exam-${config.courseId}`,
        courseId: config.courseId,
        courseName: config.courseName,
        examDate: config.examDate,
        daysLeft,
        estimatedMin,
        completed: false,
      })
    }
  }

  return items
}

/* ------------------------------------------------------------------ */
/*  Exam profile-driven weak module study items                        */
/* ------------------------------------------------------------------ */

/** Generate study items for weak modules, prioritized by exam profile */
export function getExamWeakModuleItems(
  learningProfile: LearningProfile,
  courseId: string,
  courseName: string,
  examProfile: ExamProfile | null,
): StudyItem[] {
  const weak = getWeakModules(learningProfile, courseId)
  if (weak.length === 0) return []

  // Get question type weights from exam profile for prioritization
  const typeWeights = new Map<string, number>()
  if (examProfile?.question_distribution) {
    for (const d of examProfile.question_distribution) {
      typeWeights.set(d.question_type, d.percentage)
    }
  }

  // Determine days left for urgency
  let daysLeft = Infinity
  if (examProfile?.exam_date) {
    daysLeft = differenceInDays(new Date(examProfile.exam_date), new Date())
  }

  // Limit to top 3 weakest modules
  return weak.slice(0, 3).map((mod, i) => {
    const priority: 'high' | 'medium' | 'low' =
      daysLeft <= 3 ? 'high' : daysLeft <= 7 && i === 0 ? 'high' : mod.mastery < 0.3 ? 'high' : 'medium'

    const estimatedMin = daysLeft <= 3 ? 20 : 15
    return {
      type: 'study' as const,
      id: `study-weak-${courseId}-${mod.moduleId}`,
      courseId,
      courseName,
      moduleName: mod.moduleName,
      estimatedMin,
      priority,
      completed: false,
    }
  })
}

/** Create exam countdown item from ExamProfile */
export function getExamCountdownItem(
  courseId: string,
  courseName: string,
  examProfile: ExamProfile,
): ExamPrepItem | null {
  if (!examProfile.exam_date) return null
  const daysLeft = differenceInDays(new Date(examProfile.exam_date), new Date())
  if (daysLeft < 0 || daysLeft > 30) return null

  const label = examProfile.is_open_book ? '开卷' : '闭卷'
  const duration = examProfile.duration_minutes ?? 120

  return {
    type: 'exam-prep',
    id: `exam-countdown-${courseId}`,
    courseId,
    courseName,
    examDate: examProfile.exam_date,
    daysLeft,
    moduleName: `${duration}分钟 · ${label}`,
    estimatedMin: daysLeft <= 3 ? 30 : daysLeft <= 7 ? 20 : 15,
    completed: false,
  }
}

/** Sort: exam-prep (daysLeft ASC) > flashcard-review (dueCount DESC) > study > todo */
function typePriority(item: AgendaItem): number {
  switch (item.type) {
    case 'exam-prep': return 0
    case 'flashcard-review': return 1
    case 'study': return 2
    case 'todo': return 3
    case 'milestone': return 4
    default: return 5
  }
}

export function sortAgendaItems(items: AgendaItem[]): AgendaItem[] {
  return [...items].sort((a, b) => {
    // Completed items go to bottom
    const aCompleted = 'completed' in a && a.completed ? 1 : 0
    const bCompleted = 'completed' in b && b.completed ? 1 : 0
    if (aCompleted !== bCompleted) return aCompleted - bCompleted

    const typeDiff = typePriority(a) - typePriority(b)
    if (typeDiff !== 0) return typeDiff

    // Within same type, sort by urgency
    if (a.type === 'exam-prep' && b.type === 'exam-prep') {
      return a.daysLeft - b.daysLeft
    }
    if (a.type === 'flashcard-review' && b.type === 'flashcard-review') {
      return b.dueCount - a.dueCount
    }

    return 0
  })
}

export function generateDailyAgenda(
  decks: FlashcardDeck[],
  examConfigs: ExamConfig[],
  studyItems: StudyItem[],
  todos: TodoItem[],
  targetDate?: Date,
): DailyAgenda {
  const refDate = targetDate ?? new Date()
  const fcItems = getFlashcardAgendaItems(decks, refDate)
  const examItems = getExamPrepItems(examConfigs, refDate)

  const allItems: AgendaItem[] = [...examItems, ...fcItems, ...studyItems, ...todos]
  const sorted = sortAgendaItems(allItems)

  const totalMinutes = sorted.reduce((sum, item) => {
    if ('estimatedMin' in item) return sum + item.estimatedMin
    return sum
  }, 0)

  return {
    date: format(refDate, 'yyyy-MM-dd'),
    items: sorted,
    totalMinutes,
  }
}

/* ------------------------------------------------------------------ */
/*  Persistence                                                        */
/* ------------------------------------------------------------------ */

import { STORAGE_KEYS } from './storage-keys'

export function loadExamConfigs(): ExamConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.EXAM_CONFIGS)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function saveExamConfigs(configs: ExamConfig[]): void {
  localStorage.setItem(STORAGE_KEYS.EXAM_CONFIGS, JSON.stringify(configs))
}

export function loadTodos(): TodoItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.AGENDA_TODOS)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function saveTodos(todos: TodoItem[]): void {
  localStorage.setItem(STORAGE_KEYS.AGENDA_TODOS, JSON.stringify(todos))
  // Debounced fire-and-forget backend sync (2s coalesce)
  import('@/lib/sync-service').then(({ debouncedSyncTodosUp }) => {
    debouncedSyncTodosUp(todos)
  })
}

/** Check if a date string represents today */
export function isDateToday(dateStr: string): boolean {
  return isToday(new Date(dateStr))
}
