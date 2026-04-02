/**
 * toast-store — lightweight module-level toast notification system.
 * No context provider needed; components subscribe via useSyncExternalStore.
 */

export interface Toast {
  id: string
  message: string
}

type Listener = (toasts: Toast[]) => void

let toasts: Toast[] = []
const listeners = new Set<Listener>()

function notify() {
  const snapshot = [...toasts]
  listeners.forEach((l) => l(snapshot))
}

export function showToast(message: string, duration = 3000) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  toasts = [...toasts, { id, message }]
  notify()
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id)
    notify()
  }, duration)
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getSnapshot(): Toast[] {
  return toasts
}
