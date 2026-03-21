/**
 * FSRS v6 wrapper — thin layer over ts-fsrs for flashcard scheduling.
 * Handles card creation, review scheduling, and localStorage persistence.
 */
import {
  fsrs,
  createEmptyCard,
  Rating,
  State,
  type FSRS,
  type Card,
  type ReviewLog,
} from 'ts-fsrs'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type CardType = 'basic' | 'cloze' | 'reverse' | 'image-occlusion'

export interface FlashcardNote {
  id: string
  type: CardType
  fields: { front: string; back: string; extra?: string }
  tags: string[]
  sourceRef: {
    materialId: string
    moduleId?: string
    slidePage?: number
  }
  createdAt: number
  generatedBy: 'ai' | 'user' | 'ai-evolved'
}

export interface FlashcardCard {
  id: string
  noteId: string
  /** ts-fsrs Card state */
  card: Card
  /** Self-evolution tracking */
  consecutiveAgain: number
  consecutiveEasy: number
  averageResponseMs?: number
}

export interface FlashcardReviewLog {
  cardId: string
  rating: 1 | 2 | 3 | 4
  reviewedAt: string
  responseMs?: number
  log: ReviewLog
}

export interface FlashcardDeck {
  courseId: string
  courseName: string
  notes: FlashcardNote[]
  cards: FlashcardCard[]
  reviewLogs: FlashcardReviewLog[]
}

/* ------------------------------------------------------------------ */
/*  Singleton scheduler                                                */
/* ------------------------------------------------------------------ */

let _fsrs: FSRS | null = null

function getScheduler(): FSRS {
  if (!_fsrs) {
    _fsrs = fsrs()
  }
  return _fsrs
}

/* ------------------------------------------------------------------ */
/*  Card creation                                                      */
/* ------------------------------------------------------------------ */

export function createFlashcard(noteId: string): FlashcardCard {
  const card = createEmptyCard()
  return {
    id: `card-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    noteId,
    card,
    consecutiveAgain: 0,
    consecutiveEasy: 0,
  }
}

/* ------------------------------------------------------------------ */
/*  Review scheduling                                                  */
/* ------------------------------------------------------------------ */

export { Rating, State }

export interface SchedulingResult {
  card: Card
  log: ReviewLog
}

/**
 * Get scheduling options for all 4 ratings (Again/Hard/Good/Easy).
 * Returns a map: Rating → { card, log }
 */
export function getSchedulingChoices(
  card: Card,
  now?: Date,
): Record<1 | 2 | 3 | 4, SchedulingResult> {
  const f = getScheduler()
  const result = f.repeat(card, now ?? new Date())
  return {
    [Rating.Again]: result[Rating.Again],
    [Rating.Hard]: result[Rating.Hard],
    [Rating.Good]: result[Rating.Good],
    [Rating.Easy]: result[Rating.Easy],
  } as Record<1 | 2 | 3 | 4, SchedulingResult>
}

/**
 * Apply a rating to a card and return updated card + log.
 */
export function reviewCard(
  card: Card,
  rating: 1 | 2 | 3 | 4,
  now?: Date,
): SchedulingResult {
  const choices = getSchedulingChoices(card, now)
  return choices[rating]
}

/**
 * Format the next review interval for display.
 */
export function formatInterval(card: Card): string {
  const now = new Date()
  const due = new Date(card.due)
  const diffMs = due.getTime() - now.getTime()

  if (diffMs <= 0) return '现在'

  const minutes = Math.round(diffMs / 60000)
  if (minutes < 60) return `${minutes}分钟`

  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}小时`

  const days = Math.round(hours / 24)
  if (days < 30) return `${days}天`

  const months = Math.round(days / 30)
  return `${months}个月`
}

/**
 * Get cards due for review (due date <= now).
 */
export function getDueCards(cards: FlashcardCard[], now?: Date): FlashcardCard[] {
  const cutoff = now ?? new Date()
  return cards.filter((c) => new Date(c.card.due) <= cutoff)
}

/**
 * State label for display.
 */
export function stateLabel(state: number): string {
  switch (state) {
    case State.New:
      return '新卡'
    case State.Learning:
      return '学习中'
    case State.Review:
      return '复习'
    case State.Relearning:
      return '重学'
    default:
      return '未知'
  }
}

export function ratingLabel(rating: 1 | 2 | 3 | 4): string {
  switch (rating) {
    case Rating.Again:
      return '忘记'
    case Rating.Hard:
      return '困难'
    case Rating.Good:
      return '记得'
    case Rating.Easy:
      return '简单'
    default:
      return '未知'
  }
}

export function ratingColor(rating: 1 | 2 | 3 | 4): string {
  switch (rating) {
    case Rating.Again:
      return '#A5192E'
    case Rating.Hard:
      return '#C49A2A'
    case Rating.Good:
      return '#4CAF50'
    case Rating.Easy:
      return '#2196F3'
    default:
      return '#8A8A8A'
  }
}

/* ------------------------------------------------------------------ */
/*  Persistence                                                        */
/* ------------------------------------------------------------------ */

import { STORAGE_KEYS } from './storage-keys'

export function loadDeck(courseId: string): FlashcardDeck | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.FLASHCARDS(courseId))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function saveDeck(deck: FlashcardDeck): void {
  localStorage.setItem(STORAGE_KEYS.FLASHCARDS(deck.courseId), JSON.stringify(deck))
  // Debounced fire-and-forget backend sync (3s coalesce for rapid reviews)
  import('@/lib/sync-service').then(({ debouncedSyncDeckUp }) => {
    debouncedSyncDeckUp(deck)
  })
}

export function loadAllDecks(): FlashcardDeck[] {
  const decks: FlashcardDeck[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith(STORAGE_KEYS.FLASHCARDS_PREFIX)) {
      try {
        const raw = localStorage.getItem(key)
        if (raw) {
          const parsed = JSON.parse(raw)
          if (parsed && typeof parsed === 'object' && parsed.courseId) {
            decks.push(parsed)
          }
        }
      } catch {
        // skip corrupt data
      }
    }
  }
  return decks
}
