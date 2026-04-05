/**
 * highlight-events.ts — Event-driven communication between PdfAnnotator and NotesPanel.
 * Replaces the 3-second polling mechanism with CustomEvents on `window`.
 */

/* ── Shared highlight type (extracted from PdfAnnotator) ── */

export interface CommentedHighlight {
  id: string
  content?: { text?: string; image?: string }
  position?: { pageNumber?: number; boundingRect?: unknown }
  comment?: string
  color?: string
}

/* ── Event names ── */

export const HIGHLIGHT_EVENTS = {
  CREATED: 'zhijie:highlight:created',
  DELETED: 'zhijie:highlight:deleted',
  UPDATED: 'zhijie:highlight:updated',
  SCROLL_TO: 'zhijie:highlight:scrollTo',
} as const

/* ── Event payloads ── */

export interface HighlightCreatedDetail {
  materialId: string
  highlight: CommentedHighlight
}

export interface HighlightDeletedDetail {
  materialId: string
  highlightId: string
}

export interface HighlightScrollToDetail {
  materialId: string
  highlightId: string
}

/* ── Dispatch helpers ── */

export function dispatchHighlightCreated(materialId: string, highlight: CommentedHighlight) {
  window.dispatchEvent(
    new CustomEvent(HIGHLIGHT_EVENTS.CREATED, {
      detail: { materialId, highlight } satisfies HighlightCreatedDetail,
    }),
  )
}

export function dispatchHighlightDeleted(materialId: string, highlightId: string) {
  window.dispatchEvent(
    new CustomEvent(HIGHLIGHT_EVENTS.DELETED, {
      detail: { materialId, highlightId } satisfies HighlightDeletedDetail,
    }),
  )
}

export function dispatchHighlightScrollTo(materialId: string, highlightId: string) {
  window.dispatchEvent(
    new CustomEvent(HIGHLIGHT_EVENTS.SCROLL_TO, {
      detail: { materialId, highlightId } satisfies HighlightScrollToDetail,
    }),
  )
}

/* ── Listener helpers (return cleanup function for useEffect) ── */

export function onHighlightCreated(handler: (detail: HighlightCreatedDetail) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<HighlightCreatedDetail>).detail)
  window.addEventListener(HIGHLIGHT_EVENTS.CREATED, listener)
  return () => window.removeEventListener(HIGHLIGHT_EVENTS.CREATED, listener)
}

export function onHighlightDeleted(handler: (detail: HighlightDeletedDetail) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<HighlightDeletedDetail>).detail)
  window.addEventListener(HIGHLIGHT_EVENTS.DELETED, listener)
  return () => window.removeEventListener(HIGHLIGHT_EVENTS.DELETED, listener)
}

export function onHighlightScrollTo(handler: (detail: HighlightScrollToDetail) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<HighlightScrollToDetail>).detail)
  window.addEventListener(HIGHLIGHT_EVENTS.SCROLL_TO, listener)
  return () => window.removeEventListener(HIGHLIGHT_EVENTS.SCROLL_TO, listener)
}
