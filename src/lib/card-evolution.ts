/**
 * Card Evolution — detects triggers and generates mock LLM actions
 * for flashcard self-improvement (split, retire, rewrite, add hints).
 */
import type { FlashcardCard, FlashcardNote, FlashcardDeck } from '@/lib/fsrs'
import { createFlashcard } from '@/lib/fsrs'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type EvolutionTrigger =
  | { type: 'consecutive-again'; cardId: string; noteId: string; count: number }
  | { type: 'consecutive-easy'; cardId: string; noteId: string; count: number }
  | { type: 'high-lapse-rate'; cardId: string; noteId: string; lapseRate: number }
  | { type: 'slow-response'; cardId: string; noteId: string; avgMs: number }

export type EvolutionAction =
  | { type: 'split'; originalCardId: string; newNotes: FlashcardNote[] }
  | { type: 'retire'; cardId: string }
  | { type: 'rewrite'; cardId: string; noteId: string; newFields: { front: string; back: string } }
  | { type: 'add-hint'; cardId: string; noteId: string; hint: string }

export interface EvolutionSuggestion {
  trigger: EvolutionTrigger
  action: EvolutionAction
  description: string
}

export interface EvolutionLog {
  id: string
  trigger: EvolutionTrigger
  action: EvolutionAction
  timestamp: number
}

/* ------------------------------------------------------------------ */
/*  Trigger detection                                                  */
/* ------------------------------------------------------------------ */

const AGAIN_THRESHOLD = 3
const EASY_THRESHOLD = 5
const LAPSE_RATE_THRESHOLD = 0.5
const LAPSE_MIN_REPS = 10
const SLOW_RESPONSE_MS = 15000

export function detectTriggers(card: FlashcardCard, deck: FlashcardDeck): EvolutionTrigger[] {
  const triggers: EvolutionTrigger[] = []

  // Consecutive "Again" (forgot)
  if (card.consecutiveAgain >= AGAIN_THRESHOLD) {
    triggers.push({
      type: 'consecutive-again',
      cardId: card.id,
      noteId: card.noteId,
      count: card.consecutiveAgain,
    })
  }

  // Consecutive "Easy"
  if (card.consecutiveEasy >= EASY_THRESHOLD) {
    triggers.push({
      type: 'consecutive-easy',
      cardId: card.id,
      noteId: card.noteId,
      count: card.consecutiveEasy,
    })
  }

  // High lapse rate
  const cardLogs = deck.reviewLogs.filter((l) => l.cardId === card.id)
  if (cardLogs.length >= LAPSE_MIN_REPS) {
    const lapses = cardLogs.filter((l) => l.rating === 1).length
    const lapseRate = lapses / cardLogs.length
    if (lapseRate > LAPSE_RATE_THRESHOLD) {
      triggers.push({
        type: 'high-lapse-rate',
        cardId: card.id,
        noteId: card.noteId,
        lapseRate,
      })
    }
  }

  // Slow response
  if (card.averageResponseMs && card.averageResponseMs > SLOW_RESPONSE_MS) {
    triggers.push({
      type: 'slow-response',
      cardId: card.id,
      noteId: card.noteId,
      avgMs: card.averageResponseMs,
    })
  }

  return triggers
}

/* ------------------------------------------------------------------ */
/*  Mock LLM action generation                                         */
/* ------------------------------------------------------------------ */

function splitNote(note: FlashcardNote): FlashcardNote[] {
  const backParts = note.fields.back.split(/[。；;.!！]/).filter((s) => s.trim().length > 4)

  if (backParts.length < 2) {
    // Can't split meaningfully, create a simpler version
    return [{
      ...note,
      id: `note-split-${Date.now()}-1`,
      fields: {
        front: `${note.fields.front}（简化版）`,
        back: note.fields.back,
        extra: '由 AI 自动简化生成',
      },
      generatedBy: 'ai-evolved',
      createdAt: Date.now(),
    }]
  }

  return backParts.slice(0, 3).map((part, i) => ({
    ...note,
    id: `note-split-${Date.now()}-${i}`,
    type: 'basic' as const,
    fields: {
      front: `关于"${note.fields.front.slice(0, 20)}..."，${part.trim().slice(0, 15)}... 是什么？`,
      back: part.trim(),
      extra: `拆分自原卡片：${note.fields.front.slice(0, 30)}`,
    },
    tags: [...note.tags, 'ai-split'],
    generatedBy: 'ai-evolved' as const,
    createdAt: Date.now(),
  }))
}

function rewriteNote(note: FlashcardNote): { front: string; back: string } {
  // Simple rephrasing strategy
  const front = note.type === 'cloze'
    ? note.fields.front.replace(/\{\{c\d+::(.+?)\}\}/g, '{{c1::____}}')
    : `请用自己的话解释：${note.fields.front}`

  return { front, back: note.fields.back }
}

function generateHint(note: FlashcardNote): string {
  const backWords = note.fields.back.split(/\s+/)
  if (backWords.length > 5) {
    return `提示：答案的关键词包含"${backWords[0]}"和"${backWords[Math.floor(backWords.length / 2)]}"`
  }
  return `提示：答案与"${note.tags[0] ?? '本知识点'}"相关`
}

export function generateEvolutionAction(
  trigger: EvolutionTrigger,
  note: FlashcardNote,
): EvolutionAction {
  switch (trigger.type) {
    case 'consecutive-again':
      return {
        type: 'split',
        originalCardId: trigger.cardId,
        newNotes: splitNote(note),
      }
    case 'consecutive-easy':
      return { type: 'retire', cardId: trigger.cardId }
    case 'high-lapse-rate':
      return {
        type: 'rewrite',
        cardId: trigger.cardId,
        noteId: trigger.noteId,
        newFields: rewriteNote(note),
      }
    case 'slow-response':
      return {
        type: 'add-hint',
        cardId: trigger.cardId,
        noteId: trigger.noteId,
        hint: generateHint(note),
      }
  }
}

export function generateSuggestion(
  trigger: EvolutionTrigger,
  note: FlashcardNote,
): EvolutionSuggestion {
  const action = generateEvolutionAction(trigger, note)
  let description = ''

  switch (trigger.type) {
    case 'consecutive-again':
      description = `连续忘记 ${trigger.count} 次，建议拆分为更简单的子卡片`
      break
    case 'consecutive-easy':
      description = `连续标记为"简单" ${trigger.count} 次，建议退役此卡片`
      break
    case 'high-lapse-rate':
      description = `遗忘率 ${Math.round(trigger.lapseRate * 100)}%，建议改写问法`
      break
    case 'slow-response':
      description = `平均回答时间 ${(trigger.avgMs / 1000).toFixed(1)}s，建议添加记忆提示`
      break
  }

  return { trigger, action, description }
}

/* ------------------------------------------------------------------ */
/*  Apply evolution                                                    */
/* ------------------------------------------------------------------ */

export function applyEvolution(deck: FlashcardDeck, action: EvolutionAction): FlashcardDeck {
  const updated = {
    ...deck,
    notes: [...deck.notes],
    cards: [...deck.cards],
  }

  switch (action.type) {
    case 'split': {
      // Add new notes and cards
      for (const note of action.newNotes) {
        updated.notes.push(note)
        updated.cards.push(createFlashcard(note.id))
      }
      break
    }
    case 'retire': {
      // Remove card from active rotation (keep note for history)
      updated.cards = updated.cards.filter((c) => c.id !== action.cardId)
      break
    }
    case 'rewrite': {
      const noteIdx = updated.notes.findIndex((n) => n.id === action.noteId)
      if (noteIdx >= 0) {
        updated.notes[noteIdx] = {
          ...updated.notes[noteIdx],
          fields: {
            ...updated.notes[noteIdx].fields,
            ...action.newFields,
          },
          generatedBy: 'ai-evolved',
        }
      }
      break
    }
    case 'add-hint': {
      const noteIdx = updated.notes.findIndex((n) => n.id === action.noteId)
      if (noteIdx >= 0) {
        updated.notes[noteIdx] = {
          ...updated.notes[noteIdx],
          fields: {
            ...updated.notes[noteIdx].fields,
            extra: action.hint,
          },
        }
      }
      break
    }
  }

  return updated
}

/* ------------------------------------------------------------------ */
/*  Persistence                                                        */
/* ------------------------------------------------------------------ */

const LOG_PREFIX = 'zhijie_evolution_logs_'

export function loadEvolutionLogs(courseId: string): EvolutionLog[] {
  try {
    const raw = localStorage.getItem(LOG_PREFIX + courseId)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function saveEvolutionLog(courseId: string, log: EvolutionLog): void {
  const logs = loadEvolutionLogs(courseId)
  logs.push(log)
  localStorage.setItem(LOG_PREFIX + courseId, JSON.stringify(logs))
}
