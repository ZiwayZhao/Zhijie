/**
 * ToolProgress -- shows active tool call and multi-step loop progress.
 *
 * States:
 * 1. Single tool running:    "正在查阅课程精讲笔记..."
 * 2. Multi-step progress:    "步骤 1/2: 讲解视图 -- 正在查阅..."
 * 3. Synthesis (no tool):    "正在整合结果..."
 *
 * Uses framer-motion for subtle fade-in.
 * Follows editorial design: warm bg, border-l accent, no box-shadow.
 */

import { motion, AnimatePresence } from 'framer-motion'
import { Loader2 } from 'lucide-react'

export interface ToolProgressProps {
  /** Human-readable description of the active tool, e.g. "正在查阅课程精讲笔记..." */
  activeToolDescription: string | null
  /** Current step index (1-based) in a multi-step plan */
  currentStep: number | null
  /** Total number of steps in the plan */
  totalSteps: number | null
  /** Description of the current step */
  stepDescription: string | null
  /** Current tutor phase */
  phase: string
}

export function ToolProgress({
  activeToolDescription,
  currentStep,
  totalSteps,
  stepDescription,
  phase,
}: ToolProgressProps) {
  // Only show during tool-running or planning phase
  const isActive = phase === 'tool-running' || phase === 'planning'
  const hasContent = activeToolDescription || stepDescription

  if (!isActive || !hasContent) return null

  const isMultiStep = currentStep !== null && totalSteps !== null && totalSteps > 1
  const displayText = activeToolDescription ?? stepDescription ?? '正在整合结果...'

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={`${currentStep}-${displayText}`}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.2 }}
        className="mb-3 px-3 py-2.5 bg-bg-accent border border-border-warm border-l-3 border-l-red-primary rounded-sm"
      >
        <div className="flex items-center gap-2">
          {/* Spinner */}
          <Loader2
            size={14}
            strokeWidth={1.5}
            className="animate-spin text-red-primary shrink-0"
          />

          {/* Text area */}
          <div className="flex-1 min-w-0">
            {/* Step badge for multi-step plans */}
            {isMultiStep && (
              <span className="inline-block text-[10px] font-medium text-text-muted bg-bg-main border border-border-warm rounded-sm px-1.5 py-0.5 mr-2">
                步骤 {currentStep}/{totalSteps}
              </span>
            )}

            {/* Multi-step: show step description + tool description */}
            {isMultiStep && stepDescription && activeToolDescription ? (
              <span className="text-xs text-text-body">
                <span className="text-text-main font-medium">{stepDescription}</span>
                <span className="text-text-muted mx-1">--</span>
                {activeToolDescription}
              </span>
            ) : (
              <span className="text-xs text-text-body">{displayText}</span>
            )}
          </div>
        </div>

        {/* Multi-step progress bar */}
        {isMultiStep && currentStep !== null && totalSteps !== null && (
          <div className="h-1 w-full bg-border-warm rounded-full overflow-hidden mt-2">
            <motion.div
              className="h-full bg-red-primary rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${Math.round((currentStep / totalSteps) * 100)}%` }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
            />
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  )
}
