/**
 * ToastContainer — renders active toasts in a fixed bottom-right stack.
 * Editorial design: border-l-3 red accent, warm card background.
 * Uses Framer Motion for slide-in / fade-out.
 */
import { useSyncExternalStore } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { subscribe, getSnapshot } from '@/lib/toast-store'

export default function ToastContainer() {
  const toasts = useSyncExternalStore(subscribe, getSnapshot)

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none print:hidden">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 40 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="pointer-events-auto px-4 py-3 border-l-3 border-l-red-primary
                       bg-bg-card border border-border-warm rounded-sm
                       max-w-sm text-sm text-text-body"
          >
            {toast.message}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
