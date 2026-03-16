/**
 * ProcessingView — shows animated progress during material analysis.
 * Handles the 'processing' phase of AIToolPanel.
 */
import { motion } from 'framer-motion'
import { Loader2 } from 'lucide-react'

/* ---------- Types ---------- */

interface ProcessingViewProps {
  progress: number
  step: string
}

/* ---------- Component ---------- */

export default function ProcessingView({ progress, step }: ProcessingViewProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="space-y-4"
    >
      <div className="flex items-center gap-2 text-sm text-text-main font-medium">
        <Loader2 size={16} className="animate-spin text-red-primary" />
        AI 正在分析材料
      </div>

      {/* Progress bar */}
      <div className="w-full h-2 bg-bg-accent rounded-full overflow-hidden border border-border-warm">
        <motion.div
          className="h-full bg-red-primary rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        />
      </div>

      <div className="flex items-center justify-between text-xs text-text-muted">
        <span>{step}</span>
        <span className="font-mono">{progress}%</span>
      </div>
    </motion.div>
  )
}
