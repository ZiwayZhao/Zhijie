/**
 * ConfirmDialog — editorial-styled confirmation modal.
 * Replaces native window.confirm() for consistent design.
 */
import { useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

interface ConfirmDialogProps {
  open: boolean
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = '确认',
  cancelLabel = '取消',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  // Focus trap: focus cancel button on open
  useEffect(() => {
    if (open) cancelRef.current?.focus()
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, onCancel])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/30" onClick={onCancel} />

          {/* Dialog */}
          <motion.div
            role="dialog"
            aria-modal="true"
            className="relative z-10 w-full max-w-sm mx-4 border border-border-warm rounded-md bg-bg-card p-6"
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ duration: 0.15 }}
          >
            <h3 className="font-heading text-lg text-text-main mb-2">{title}</h3>
            {description && (
              <p className="text-sm text-text-muted mb-5 leading-relaxed">{description}</p>
            )}
            <div className="flex gap-3 justify-end">
              <button
                ref={cancelRef}
                onClick={onCancel}
                className="px-4 py-2 text-sm border border-border-warm text-text-body rounded-sm
                           hover:bg-bg-accent transition-colors"
              >
                {cancelLabel}
              </button>
              <button
                onClick={onConfirm}
                className="px-4 py-2 text-sm bg-red-primary text-white rounded-sm
                           hover:bg-red-dark transition-colors"
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
