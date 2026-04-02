/**
 * PlanIndicator — collapsible display of tutor plan intent + reasoning.
 * Compact, doesn't compete visually with the AI answer text.
 */

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, Lightbulb, FileQuestion, MessageCircle } from 'lucide-react'
import type { PlanInfo } from '@/hooks/useTutorSession'

const INTENT_CONFIG: Record<string, { label: string; icon: typeof Lightbulb }> = {
  explain: { label: '讲解', icon: Lightbulb },
  quiz: { label: '测验', icon: FileQuestion },
  answer_direct: { label: '直接回答', icon: MessageCircle },
}

interface PlanIndicatorProps {
  plan: PlanInfo
}

export default function PlanIndicator({ plan }: PlanIndicatorProps) {
  const [expanded, setExpanded] = useState(false)
  const config = INTENT_CONFIG[plan.intent] ?? INTENT_CONFIG.answer_direct
  const Icon = config.icon

  return (
    <div className="mb-2">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-body transition-colors"
      >
        <Icon size={12} strokeWidth={1.5} />
        <span>{config.label}</span>
        {plan.tools.length > 0 && (
          <span className="text-text-muted/60">
            · {plan.tools.join(', ')}
          </span>
        )}
        <ChevronDown
          size={10}
          strokeWidth={1.5}
          className={`transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="text-xs text-text-muted mt-1 pl-4 border-l border-border-warm overflow-hidden"
          >
            {plan.reasoning}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  )
}
