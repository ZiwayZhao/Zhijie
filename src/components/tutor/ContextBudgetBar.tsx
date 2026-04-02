/**
 * ContextBudgetBar -- shows context window usage as a thin progress bar.
 *
 * Colors follow the editorial design system:
 * - < 80%:  text-muted (subtle, low visual weight)
 * - 80-90%: accent-gold (warning)
 * - > 90%:  red-primary (danger, context nearly full)
 *
 * Only render when contextBudget is available in tutor state.
 * Shows "已用 X / Y tokens" on hover via a title tooltip.
 */

import { useMemo } from 'react'
import { motion } from 'framer-motion'

export interface ContextBudgetBarProps {
  usedTokens: number
  maxTokens: number
  percentage: number
}

function formatTokenCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

export function ContextBudgetBar({
  usedTokens,
  maxTokens,
  percentage,
}: ContextBudgetBarProps) {
  const clamped = Math.min(Math.max(percentage, 0), 100)

  const colorClass = useMemo(() => {
    if (clamped > 90) return 'bg-red-primary'
    if (clamped >= 80) return 'bg-accent-gold'
    return 'bg-text-muted'
  }, [clamped])

  const labelColor = useMemo(() => {
    if (clamped > 90) return 'text-red-primary'
    if (clamped >= 80) return 'text-accent-gold'
    return 'text-text-muted'
  }, [clamped])

  const tooltipText = `已用 ${formatTokenCount(usedTokens)} / ${formatTokenCount(maxTokens)} tokens`

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="w-full px-1 py-1.5"
      title={tooltipText}
    >
      {/* Track */}
      <div className="h-1 w-full bg-border-warm rounded-full overflow-hidden">
        <motion.div
          className={`h-full rounded-full ${colorClass}`}
          initial={{ width: 0 }}
          animate={{ width: `${clamped}%` }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        />
      </div>

      {/* Label (only shown at >= 70% to avoid clutter) */}
      {clamped >= 70 && (
        <p className={`text-[10px] mt-0.5 text-right ${labelColor}`}>
          {clamped}%
        </p>
      )}
    </motion.div>
  )
}
