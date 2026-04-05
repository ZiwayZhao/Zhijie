/**
 * note-aggregator.ts — Collects all note sources from localStorage,
 * converts them to unified NoteEntry[], and provides filter/group/sort utilities.
 * Pure functions, no React dependencies.
 */

import { STORAGE_KEYS } from '@/lib/storage-keys'
import type { NoteEntry, NoteGroupBy, NoteFilterType, NoteSortBy } from '@/lib/types/note-entry'

/* ── Material name resolution ── */

interface StoredMaterial {
  id: string
  title?: string
  filename?: string
  courseId?: string
}

function loadStoredMaterials(): StoredMaterial[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.USER_MATERIALS)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function resolveMaterialName(materialId: string, materials: StoredMaterial[]): string {
  const found = materials.find((m) => m.id === materialId)
  return found?.title || found?.filename || materialId.slice(0, 8)
}

function resolveCourseId(materialId: string, materials: StoredMaterial[]): string | undefined {
  return materials.find((m) => m.id === materialId)?.courseId
}

/* ── Highlight → NoteEntry conversion ── */

function convertHighlightToEntry(
  materialId: string,
  materialName: string,
  courseId: string | undefined,
  raw: Record<string, unknown>,
): NoteEntry | null {
  const text = (raw.content as Record<string, string>)?.text || (raw.text as string) || ''
  if (!text.trim()) return null

  const comment = typeof raw.comment === 'string'
    ? raw.comment
    : (raw.comment as Record<string, string>)?.text || ''

  return {
    id: (raw.id as string) || crypto.randomUUID(),
    materialId,
    materialName,
    courseId,
    source: {
      type: 'highlight',
      page: (raw.position as Record<string, number>)?.pageNumber,
      color: (raw.color as string) || '#FBDA83',
    },
    content: comment,
    excerpt: text,
    tags: [],
    linkedCardIds: [],
    createdAt: (raw.createdAt as number) || Date.now(),
    updatedAt: (raw.createdAt as number) || Date.now(),
    pinned: false,
  }
}

/* ── Manual note → NoteEntry conversion ── */

function convertManualNoteToEntry(
  materialId: string,
  materialName: string,
  courseId: string | undefined,
  raw: Record<string, unknown>,
): NoteEntry {
  return {
    id: (raw.id as string) || crypto.randomUUID(),
    materialId,
    materialName,
    courseId,
    source: { type: 'manual' },
    content: (raw.content as string) || '',
    excerpt: undefined,
    tags: [],
    linkedCardIds: [],
    createdAt: (raw.createdAt as number) || Date.now(),
    updatedAt: (raw.createdAt as number) || Date.now(),
    pinned: false,
  }
}

/* ── Main aggregator ── */

export function loadAllNoteEntries(): NoteEntry[] {
  const materials = loadStoredMaterials()
  const entries: NoteEntry[] = []

  // Scan all localStorage keys
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key) continue

    // Highlight entries
    if (key.startsWith(STORAGE_KEYS.HIGHLIGHTS_PREFIX)) {
      const materialId = key.replace(STORAGE_KEYS.HIGHLIGHTS_PREFIX, '')
      const materialName = resolveMaterialName(materialId, materials)
      const courseId = resolveCourseId(materialId, materials)
      try {
        const raw = JSON.parse(localStorage.getItem(key) || '[]')
        if (Array.isArray(raw)) {
          for (const h of raw) {
            const entry = convertHighlightToEntry(materialId, materialName, courseId, h)
            if (entry) entries.push(entry)
          }
        }
      } catch { /* skip corrupt data */ }
    }

    // Manual note entries
    if (key.startsWith(STORAGE_KEYS.NOTES_PREFIX)) {
      const materialId = key.replace(STORAGE_KEYS.NOTES_PREFIX, '')
      const materialName = resolveMaterialName(materialId, materials)
      const courseId = resolveCourseId(materialId, materials)
      try {
        const raw = JSON.parse(localStorage.getItem(key) || '[]')
        if (Array.isArray(raw)) {
          for (const n of raw) {
            entries.push(convertManualNoteToEntry(materialId, materialName, courseId, n))
          }
        }
      } catch { /* skip corrupt data */ }
    }
  }

  return entries
}

/* ── Filter ── */

export function filterNoteEntries(entries: NoteEntry[], filter: NoteFilterType, search?: string): NoteEntry[] {
  let result = entries

  if (filter !== 'all') {
    result = result.filter((e) => e.source.type === filter)
  }

  if (search && search.trim()) {
    const q = search.toLowerCase()
    result = result.filter((e) =>
      (e.content && e.content.toLowerCase().includes(q)) ||
      (e.excerpt && e.excerpt.toLowerCase().includes(q)) ||
      e.materialName.toLowerCase().includes(q),
    )
  }

  return result
}

/* ── Sort ── */

export function sortNoteEntries(entries: NoteEntry[], sortBy: NoteSortBy): NoteEntry[] {
  const sorted = [...entries]
  switch (sortBy) {
    case 'newest':
      sorted.sort((a, b) => b.createdAt - a.createdAt)
      break
    case 'oldest':
      sorted.sort((a, b) => a.createdAt - b.createdAt)
      break
    case 'material':
      sorted.sort((a, b) => a.materialName.localeCompare(b.materialName) || b.createdAt - a.createdAt)
      break
  }
  // Pinned items always first
  sorted.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))
  return sorted
}

/* ── Group ── */

export function groupNoteEntries(entries: NoteEntry[], groupBy: NoteGroupBy): Map<string, NoteEntry[]> {
  if (groupBy === 'none') {
    return new Map([['全部', entries]])
  }

  const groups = new Map<string, NoteEntry[]>()

  for (const entry of entries) {
    let key: string
    switch (groupBy) {
      case 'material':
        key = entry.materialName
        break
      case 'type':
        key = entry.source.type === 'highlight' ? 'PDF 批注'
            : entry.source.type === 'manual' ? '手动笔记'
            : entry.source.type === 'ai-excerpt' ? 'AI 摘录'
            : '测验反思'
        break
      case 'course':
        key = entry.courseName || entry.courseId || '未分类'
        break
    }
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(entry)
  }

  return groups
}
