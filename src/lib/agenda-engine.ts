/**
 * Agenda Engine — generates unified daily learning plans.
 * Merges flashcard reviews, study tasks, exam prep, and manual todos.
 */
import { differenceInDays, format, isToday } from 'date-fns'
import type { FlashcardDeck } from '@/lib/fsrs'
import { getDueCards } from '@/lib/fsrs'

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

export function getFlashcardAgendaItems(decks: FlashcardDeck[]): FlashcardReviewItem[] {
  const items: FlashcardReviewItem[] = []
  const now = new Date()

  for (const deck of decks) {
    const due = getDueCards(deck.cards, now)
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

export function getExamPrepItems(configs: ExamConfig[]): ExamPrepItem[] {
  const items: ExamPrepItem[] = []
  const today = new Date()

  for (const config of configs) {
    const examDate = new Date(config.examDate)
    const daysLeft = differenceInDays(examDate, today)

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
): DailyAgenda {
  const fcItems = getFlashcardAgendaItems(decks)
  const examItems = getExamPrepItems(examConfigs)

  const allItems: AgendaItem[] = [...examItems, ...fcItems, ...studyItems, ...todos]
  const sorted = sortAgendaItems(allItems)

  const totalMinutes = sorted.reduce((sum, item) => {
    if ('estimatedMin' in item) return sum + item.estimatedMin
    return sum
  }, 0)

  return {
    date: format(new Date(), 'yyyy-MM-dd'),
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
}

/** Check if a date string represents today */
export function isDateToday(dateStr: string): boolean {
  return isToday(new Date(dateStr))
}
