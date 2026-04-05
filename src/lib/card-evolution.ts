/**
 * Card Evolution — detects triggers and generates LLM-driven actions
 * for flashcard self-improvement (split, retire, rewrite, add hints).
 * Falls back to local heuristics if backend is unavailable.
 */
import type { FlashcardCard, FlashcardNote, FlashcardDeck } from '@/lib/fsrs'
import { createFlashcard } from '@/lib/fsrs'
import { authFetch, getAccessToken } from '@/lib/auth-api'

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
/*  LLM-driven evolution (with local fallback)                         */
/* ------------------------------------------------------------------ */

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8003/api'

interface EvolveApiResponse {
  action: string
  split_cards?: { front: string; back: string }[]
  rewritten_front?: string
  rewritten_back?: string
  hint?: string
}

/** Call backend LLM for evolution; returns null on failure */
async function callEvolveApi(
  triggerType: string,
  note: FlashcardNote,
): Promise<EvolveApiResponse | null> {
  if (!getAccessToken()) return null
  try {
    const res = await authFetch(`${API_BASE}/v1/flashcards/evolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        trigger_type: triggerType,
        note_front: note.fields.front,
        note_back: note.fields.back,
        note_tags: note.tags,
      }),
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

/** Local fallback: split note by sentences */
function splitNoteLocal(note: FlashcardNote): FlashcardNote[] {
  const backParts = note.fields.back.split(/[。；;.!！]/).filter((s) => s.trim().length > 4)

  if (backParts.length < 2) {
    return [{
      ...note,
      id: `note-split-${Date.now()}-1`,
      fields: { front: `${note.fields.front}（简化版）`, back: note.fields.back, extra: '由 AI 自动简化生成' },
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

/**
 * Generate evolution action — tries LLM backend first, falls back to local heuristics.
 */
export async function generateEvolutionAction(
  trigger: EvolutionTrigger,
  note: FlashcardNote,
): Promise<EvolutionAction> {
  // Retire is purely local — no LLM needed
  if (trigger.type === 'consecutive-easy') {
    return { type: 'retire', cardId: trigger.cardId }
  }

  // Try LLM backend
  const apiResult = await callEvolveApi(trigger.type, note)

  if (apiResult) {
    if (apiResult.action === 'split' && apiResult.split_cards) {
      const newNotes: FlashcardNote[] = apiResult.split_cards.map((c, i) => ({
        ...note,
        id: `note-split-${Date.now()}-${i}`,
        type: 'basic' as const,
        fields: { front: c.front, back: c.back, extra: `AI 拆分自：${note.fields.front.slice(0, 30)}` },
        tags: [...note.tags, 'ai-split'],
        generatedBy: 'ai-evolved' as const,
        createdAt: Date.now(),
      }))
      return { type: 'split', originalCardId: trigger.cardId, newNotes }
    }
    if (apiResult.action === 'rewrite' && apiResult.rewritten_front) {
      return {
        type: 'rewrite', cardId: trigger.cardId, noteId: trigger.noteId,
        newFields: { front: apiResult.rewritten_front, back: apiResult.rewritten_back ?? note.fields.back },
      }
    }
    if (apiResult.action === 'add-hint' && apiResult.hint) {
      return { type: 'add-hint', cardId: trigger.cardId, noteId: trigger.noteId, hint: apiResult.hint }
    }
  }

  // Local fallback
  switch (trigger.type) {
    case 'consecutive-again':
      return { type: 'split', originalCardId: trigger.cardId, newNotes: splitNoteLocal(note) }
    case 'high-lapse-rate':
      return {
        type: 'rewrite', cardId: trigger.cardId, noteId: trigger.noteId,
        newFields: { front: `请用自己的话解释：${note.fields.front}`, back: note.fields.back },
      }
    case 'slow-response':
      return {
        type: 'add-hint', cardId: trigger.cardId, noteId: trigger.noteId,
        hint: `提示：与「${note.tags[0] ?? '本知识点'}」相关`,
      }
    default:
      return { type: 'retire', cardId: (trigger as EvolutionTrigger).cardId }
  }
}

export async function generateSuggestion(
  trigger: EvolutionTrigger,
  note: FlashcardNote,
): Promise<EvolutionSuggestion> {
  const action = await generateEvolutionAction(trigger, note)
  let description = ''

  switch (trigger.type) {
    case 'consecutive-again':
      description = `连续忘记 ${trigger.count} 次，AI 建议拆分为更简单的子卡片`
      break
    case 'consecutive-easy':
      description = `连续标记为"简单" ${trigger.count} 次，建议退役此卡片`
      break
    case 'high-lapse-rate':
      description = `遗忘率 ${Math.round(trigger.lapseRate * 100)}%，AI 建议改写问法`
      break
    case 'slow-response':
      description = `平均回答时间 ${(trigger.avgMs / 1000).toFixed(1)}s，AI 建议添加记忆提示`
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

import { STORAGE_KEYS } from './storage-keys'

export function loadEvolutionLogs(courseId: string): EvolutionLog[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.EVOLUTION_LOGS(courseId))
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function saveEvolutionLog(courseId: string, log: EvolutionLog): void {
  const logs = loadEvolutionLogs(courseId)
  logs.push(log)
  localStorage.setItem(STORAGE_KEYS.EVOLUTION_LOGS(courseId), JSON.stringify(logs))
}
