/**
 * note-entry.ts — Unified note entry types for the cross-material notes center.
 * All knowledge artifacts (highlights, manual notes, AI excerpts) are represented
 * as NoteEntry instances for unified aggregation, filtering, and export.
 */

/* ── Note source discrimination ── */

export type NoteSource =
  | { type: 'highlight'; page?: number; color?: string }
  | { type: 'manual' }
  | { type: 'ai-excerpt'; moduleId: string; moduleName: string }
  | { type: 'quiz-reflection'; questionIndex: number }

/* ── Unified NoteEntry ── */

export interface NoteEntry {
  id: string
  /** Source material ID */
  materialId: string
  /** Display name of the material */
  materialName: string
  /** Course ID (if known) */
  courseId?: string
  /** Course display name (if known) */
  courseName?: string
  /** Source type + metadata */
  source: NoteSource
  /** Main text content (user's note or annotation comment) */
  content: string
  /** Original excerpt from the source (highlight text, AI lecture snippet) */
  excerpt?: string
  /** User-assigned tags */
  tags: string[]
  /** Linked flashcard IDs */
  linkedCardIds: string[]
  /** Creation timestamp */
  createdAt: number
  /** Last update timestamp */
  updatedAt: number
  /** Pinned to top */
  pinned: boolean
}

/* ── Filter & group types ── */

export type NoteGroupBy = 'material' | 'type' | 'course' | 'none'
export type NoteFilterType = 'all' | 'highlight' | 'manual' | 'ai-excerpt'
export type NoteSortBy = 'newest' | 'oldest' | 'material'

/* ── Helper to get display label for source type ── */

export function sourceTypeLabel(type: NoteSource['type']): string {
  switch (type) {
    case 'highlight': return 'PDF 批注'
    case 'manual': return '手动笔记'
    case 'ai-excerpt': return 'AI 摘录'
    case 'quiz-reflection': return '测验反思'
  }
}

export function sourceTypeIcon(type: NoteSource['type']): string {
  switch (type) {
    case 'highlight': return '📌'
    case 'manual': return '✏️'
    case 'ai-excerpt': return '🤖'
    case 'quiz-reflection': return '📝'
  }
}
