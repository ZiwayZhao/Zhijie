/**
 * Sync Service — unified backend sync layer for localStorage data.
 *
 * Strategy: localStorage remains primary store (offline-first).
 * After each local save, we fire-and-forget sync to backend.
 * On login / app boot, we pull from backend → merge → update localStorage.
 *
 * Each domain has its own sync function matching the backend API contract.
 */

import { authFetch, getAccessToken } from '@/lib/auth-api'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8003/api'
const API_V1 = `${API_BASE}/v1`

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Check if user is authenticated (has access token) */
function isAuthenticated(): boolean {
  return !!getAccessToken()
}

/** Flag to suppress sync-up during boot sync (prevents redundant round-trip) */
let _suppressSyncUp = false

/**
 * Debounced sync: coalesces rapid calls into a single backend request.
 * Returns a debounced version of an async function keyed by a string.
 */
const _debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()

function debouncedSync<T extends unknown[]>(
  key: string,
  fn: (...args: T) => Promise<void>,
  delayMs = 2000,
): (...args: T) => void {
  return (...args: T) => {
    const existing = _debounceTimers.get(key)
    if (existing) clearTimeout(existing)
    _debounceTimers.set(
      key,
      setTimeout(() => {
        _debounceTimers.delete(key)
        fn(...args).catch(() => {})
      }, delayMs),
    )
  }
}

/** Safe JSON POST with authFetch — returns null on failure (fire-and-forget) */
async function syncPost<T>(url: string, body: unknown): Promise<T | null> {
  if (!isAuthenticated()) return null
  try {
    const res = await authFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      console.warn(`[sync] POST ${url} failed: ${res.status}`)
      return null
    }
    return await res.json()
  } catch (err) {
    console.warn(`[sync] POST ${url} error:`, err)
    return null
  }
}

/** Safe JSON PUT with authFetch */
async function syncPut<T>(url: string, body: unknown): Promise<T | null> {
  if (!isAuthenticated()) return null
  try {
    const res = await authFetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      console.warn(`[sync] PUT ${url} failed: ${res.status}`)
      return null
    }
    return await res.json()
  } catch (err) {
    console.warn(`[sync] PUT ${url} error:`, err)
    return null
  }
}

/** Safe JSON GET with authFetch */
async function syncGet<T>(url: string): Promise<T | null> {
  if (!isAuthenticated()) return null
  try {
    const res = await authFetch(url)
    if (!res.ok) {
      console.warn(`[sync] GET ${url} failed: ${res.status}`)
      return null
    }
    return await res.json()
  } catch (err) {
    console.warn(`[sync] GET ${url} error:`, err)
    return null
  }
}

/* ------------------------------------------------------------------ */
/*  1. Student Profile sync                                            */
/* ------------------------------------------------------------------ */

import type { LearningProfile } from '@/lib/student-model'

interface StudentProfileBackend {
  user_id: string
  goal: string | null
  total_study_minutes: number
  streak_days: number
  last_active_date: string | null
  modules: Record<string, {
    module_id: string
    module_name: string
    course_id: string
    mastery: number
    total_attempts: number
    correct_attempts: number
    last_updated: number
  }>
}

/** Push student profile to backend (debounced when called from save) */
export async function syncStudentProfileUp(profile: LearningProfile): Promise<void> {
  if (_suppressSyncUp) return
  const modules: Record<string, {
    module_name: string
    course_id: string
    mastery: number
    total_attempts: number
    correct_attempts: number
  }> = {}

  for (const [modId, mod] of Object.entries(profile.modules)) {
    modules[modId] = {
      module_name: mod.moduleName,
      course_id: mod.courseId,
      mastery: mod.mastery,
      total_attempts: mod.totalAttempts,
      correct_attempts: mod.correctAttempts,
    }
  }

  await syncPut(`${API_V1}/student/profile`, {
    goal: profile.goal,
    total_study_minutes: profile.totalStudyMinutes,
    streak_days: profile.streakDays,
    last_active_date: profile.lastActiveDate,
    modules,
  })
}

/** Pull student profile from backend (for login / boot) */
export async function syncStudentProfileDown(): Promise<LearningProfile | null> {
  const data = await syncGet<StudentProfileBackend>(`${API_V1}/student/profile`)
  if (!data) return null

  const modules: LearningProfile['modules'] = {}
  for (const [modId, mod] of Object.entries(data.modules || {})) {
    modules[modId] = {
      moduleId: mod.module_id,
      moduleName: mod.module_name,
      courseId: mod.course_id,
      mastery: mod.mastery,
      totalAttempts: mod.total_attempts,
      correctAttempts: mod.correct_attempts,
      lastUpdated: mod.last_updated,
    }
  }

  return {
    userId: data.user_id,
    goal: data.goal as LearningProfile['goal'],
    modules,
    totalStudyMinutes: data.total_study_minutes,
    streakDays: data.streak_days,
    lastActiveDate: data.last_active_date || new Date().toISOString().slice(0, 10),
  }
}

/* ------------------------------------------------------------------ */
/*  2. Flashcard Deck sync                                             */
/* ------------------------------------------------------------------ */

import type { FlashcardDeck, FlashcardNote, FlashcardCard, FlashcardReviewLog } from '@/lib/fsrs'

/** Map ts-fsrs numeric State enum to backend string values */
const STATE_NUM_TO_STR: Record<number, string> = {
  0: 'new',
  1: 'learning',
  2: 'review',
  3: 'relearning',
}

interface FlashcardDeckBackend {
  course_id: string
  notes: Array<{
    id: string
    card_type: string
    front: string
    back: string
    extra: string | null
    tags: string[]
    generated_by: string
    source_material_id: string | null
    source_module_id: string | null
    source_page: number | null
    created_at: number
  }>
  cards: Array<{
    id: string
    note_id: string
    due: string
    stability: number
    difficulty: number
    state: number
    reps: number
    lapses: number
    consecutive_again: number
    consecutive_easy: number
    average_response_ms: number | null
    fsrs_card_json: Record<string, unknown> | null
  }>
  review_logs: Array<{
    card_id: string
    rating: number
    reviewed_at: string
    response_ms: number | null
    fsrs_log_json: Record<string, unknown> | null
  }>
  total_notes: number
  due_count: number
}

/** Push flashcard deck to backend */
export async function syncFlashcardDeckUp(deck: FlashcardDeck): Promise<void> {
  const notes = deck.notes.map((n) => ({
    id: n.id,
    card_type: n.type,
    front: n.fields.front,
    back: n.fields.back,
    extra: n.fields.extra || null,
    tags: n.tags,
    generated_by: n.generatedBy,
    source_material_id: n.sourceRef?.materialId || null,
    source_module_id: n.sourceRef?.moduleId || null,
    source_page: n.sourceRef?.slidePage ?? null,
    created_at: n.createdAt,
  }))

  const cards = deck.cards.map((c) => ({
    id: c.id,
    note_id: c.noteId,
    due: c.card.due instanceof Date ? c.card.due.toISOString() : String(c.card.due),
    stability: c.card.stability,
    difficulty: c.card.difficulty,
    state: STATE_NUM_TO_STR[c.card.state] ?? 'new',
    reps: c.card.reps,
    lapses: c.card.lapses,
    consecutive_again: c.consecutiveAgain,
    consecutive_easy: c.consecutiveEasy,
    average_response_ms: c.averageResponseMs ?? null,
    fsrs_card_json: c.card as unknown as Record<string, unknown>,
  }))

  const reviewLogs = deck.reviewLogs.slice(-500).map((l) => ({
    card_id: l.cardId,
    rating: l.rating,
    reviewed_at: l.reviewedAt,
    response_ms: l.responseMs ?? null,
    fsrs_log_json: l.log as unknown as Record<string, unknown>,
  }))

  await syncPost(`${API_V1}/flashcards/${encodeURIComponent(deck.courseId)}/sync`, {
    course_id: deck.courseId,
    course_name: deck.courseName || '',
    notes,
    cards,
    review_logs: reviewLogs,
  })
}

/** Pull flashcard deck from backend */
export async function syncFlashcardDeckDown(
  courseId: string,
): Promise<FlashcardDeckBackend | null> {
  return syncGet<FlashcardDeckBackend>(
    `${API_V1}/flashcards/${encodeURIComponent(courseId)}/deck`,
  )
}

/* ------------------------------------------------------------------ */
/*  3. Annotations (PDF highlights) sync                               */
/* ------------------------------------------------------------------ */

interface AnnotationBackend {
  client_id: string
  highlight_data: Record<string, unknown>
  color: string | null
  comment: string | null
}

/** Push annotations to backend (full-replace strategy) */
export async function syncAnnotationsUp(
  materialId: string,
  highlights: Array<{
    id: string
    [key: string]: unknown
  }>,
): Promise<void> {
  const annotations = highlights.map((h) => ({
    client_id: h.id as string,
    highlight_data: h as Record<string, unknown>,
    color: (h.color as string) || null,
    comment: (h.comment as string) || null,
  }))

  await syncPost(`${API_V1}/materials/${materialId}/annotations/sync`, {
    annotations,
  })
}

/** Pull annotations from backend */
export async function syncAnnotationsDown(
  materialId: string,
): Promise<AnnotationBackend[] | null> {
  const data = await syncGet<{ material_id: string; annotations: AnnotationBackend[] }>(
    `${API_V1}/materials/${materialId}/annotations`,
  )
  return data?.annotations ?? null
}

/* ------------------------------------------------------------------ */
/*  4. Agenda Todos sync                                               */
/* ------------------------------------------------------------------ */

import type { TodoItem } from '@/lib/agenda-engine'

/** Push todos to backend (full-replace) */
export async function syncTodosUp(todos: TodoItem[]): Promise<void> {
  if (_suppressSyncUp) return
  const items = todos.map((t) => ({
    client_id: t.id,
    title: t.title,
    completed: t.completed,
  }))

  await syncPost(`${API_V1}/agenda/todos/sync`, { todos: items })
}

/** Pull todos from backend */
export async function syncTodosDown(): Promise<TodoItem[] | null> {
  const data = await syncGet<{
    todos: Array<{ client_id: string; title: string; completed: boolean }>
  }>(`${API_V1}/agenda/todos`)
  if (!data) return null

  return data.todos.map((t) => ({
    type: 'todo' as const,
    id: t.client_id,
    title: t.title,
    completed: t.completed,
  }))
}

/* ------------------------------------------------------------------ */
/*  5. Tutor Messages sync                                             */
/* ------------------------------------------------------------------ */

interface TutorMessageBackend {
  id: string
  role: string
  content: string
  timestamp: number
  plan?: Record<string, unknown> | null
  tool_results?: Array<Record<string, unknown>> | null
}

/** Push tutor messages to backend (full-replace, capped at 50) */
export async function syncTutorMessagesUp(
  materialId: string,
  messages: Array<{
    id: string
    role: string
    content: string
    timestamp?: number
    plan?: unknown
    toolResults?: unknown[]
  }>,
): Promise<void> {
  const capped = messages.slice(-50).map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    timestamp: m.timestamp ?? Date.now(),
    plan: m.plan ? (m.plan as Record<string, unknown>) : null,
    tool_results: m.toolResults
      ? (m.toolResults as Array<Record<string, unknown>>)
      : null,
  }))

  await syncPost(`${API_V1}/tutor/${materialId}/messages/sync`, {
    messages: capped,
  })
}

/** Pull tutor messages from backend */
export async function syncTutorMessagesDown(
  materialId: string,
): Promise<TutorMessageBackend[] | null> {
  const data = await syncGet<{
    material_id: string
    messages: TutorMessageBackend[]
  }>(`${API_V1}/tutor/${materialId}/messages`)
  return data?.messages ?? null
}

/* ------------------------------------------------------------------ */
/*  6. SSE Ticket (for pipeline streaming)                             */
/* ------------------------------------------------------------------ */

/** Get a short-lived SSE ticket for a pipeline task */
export async function getStreamTicket(taskId: string): Promise<string | null> {
  const data = await syncPost<{ ticket: string }>(
    `${API_V1}/disassembly/tasks/${taskId}/stream-ticket`,
    {},
  )
  return data?.ticket ?? null
}

/* ------------------------------------------------------------------ */
/*  Boot sync — called after login                                     */
/* ------------------------------------------------------------------ */

import { loadProfile, saveProfile } from '@/lib/student-model'
import { loadTodos, saveTodos } from '@/lib/agenda-engine'
import { STORAGE_KEYS } from '@/lib/storage-keys'

/**
 * Full sync on login: pull everything from backend → merge with local.
 * Strategy: backend wins for student profile (since it's the merge point).
 * Local wins for flashcards/annotations (frontend is source of truth).
 */
export async function bootSync(): Promise<void> {
  if (!isAuthenticated()) return

  // Suppress sync-up during boot to avoid redundant save→push round-trips
  _suppressSyncUp = true
  try {
    // Pull student profile (backend wins — may have data from other devices)
    const remoteProfile = await syncStudentProfileDown()
    if (remoteProfile) {
      const local = loadProfile(remoteProfile.userId)
      // Merge: take whichever has more data
      const merged = mergeProfiles(local, remoteProfile)
      saveProfile(merged)
    }

    // Pull todos
    const remoteTodos = await syncTodosDown()
    if (remoteTodos && remoteTodos.length > 0) {
      const localTodos = loadTodos()
      if (localTodos.length === 0) {
        saveTodos(remoteTodos)
      }
      // If local has todos, keep local (frontend is source of truth)
    }
  } catch (err) {
    console.warn('[sync] Boot sync failed:', err)
  } finally {
    _suppressSyncUp = false
  }
}

/** Merge two learning profiles — take the one with more study data */
function mergeProfiles(
  local: import('@/lib/student-model').LearningProfile,
  remote: import('@/lib/student-model').LearningProfile,
): import('@/lib/student-model').LearningProfile {
  // If local is empty (just created), use remote
  const localModCount = Object.keys(local.modules).length
  const remoteModCount = Object.keys(remote.modules).length

  if (localModCount === 0 && remoteModCount > 0) return remote
  if (remoteModCount === 0 && localModCount > 0) return local

  // Both have data: merge modules (keep whichever has more attempts per module)
  const merged = { ...local, userId: remote.userId }
  merged.modules = { ...local.modules }

  for (const [modId, remoteMod] of Object.entries(remote.modules)) {
    const localMod = merged.modules[modId]
    if (!localMod || remoteMod.totalAttempts > localMod.totalAttempts) {
      merged.modules[modId] = remoteMod
    }
  }

  // Take the higher study time and streak
  merged.totalStudyMinutes = Math.max(local.totalStudyMinutes, remote.totalStudyMinutes)
  merged.streakDays = Math.max(local.streakDays, remote.streakDays)

  return merged
}

/* ------------------------------------------------------------------ */
/*  Debounced sync wrappers (used by persistence save functions)       */
/* ------------------------------------------------------------------ */

/** Debounced student profile sync (2s delay) */
export const debouncedSyncProfileUp = debouncedSync(
  'student-profile',
  syncStudentProfileUp,
  2000,
)

/** Debounced flashcard deck sync (3s delay — coalesces rapid card reviews) */
export const debouncedSyncDeckUp = debouncedSync(
  'flashcard-deck',
  syncFlashcardDeckUp,
  3000,
)

/** Debounced todos sync (2s delay) */
export const debouncedSyncTodosUp = debouncedSync(
  'todos',
  syncTodosUp,
  2000,
)

/** Debounced annotations sync (2s delay) */
export const debouncedSyncAnnotationsUp = debouncedSync(
  'annotations',
  (materialId: string, highlights: Array<{ id: string; [key: string]: unknown }>) =>
    syncAnnotationsUp(materialId, highlights),
  2000,
)

/** Debounced tutor messages sync (5s delay — messages come in bursts) */
export const debouncedSyncTutorUp = debouncedSync(
  'tutor-messages',
  (materialId: string, messages: Array<{ id: string; role: string; content: string; timestamp?: number; plan?: unknown; toolResults?: unknown[] }>) =>
    syncTutorMessagesUp(materialId, messages),
  5000,
)
