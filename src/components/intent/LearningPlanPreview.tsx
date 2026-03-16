/**
 * LearningPlanPreview — shows a generated learning plan for student confirmation.
 * Student can approve, modify (skip steps), or cancel.
 */
import { useState } from 'react'
import { motion } from 'framer-motion'
import { BookOpen, Brain, FileCheck, HelpCircle, Zap, CheckCircle, SkipForward, Clock } from 'lucide-react'
import { getMasteryLevel, getMasteryLabel, getMasteryColor } from '@/lib/student-model'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface LearningPlanStep {
  id: string
  moduleId: string
  moduleName: string
  action: 'read' | 'quiz' | 'flashcard' | 'review' | 'deep-dive'
  estimatedMin: number
  mastery: number
  priority: 'high' | 'medium' | 'low'
  skippable: boolean
}

interface LearningPlanPreviewProps {
  plan: LearningPlanStep[]
  intent: 'learn' | 'exam' | 'review'
  estimatedMinutes?: number
  onConfirm: () => void
  onCancel: () => void
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const actionIcons: Record<string, typeof BookOpen> = {
  read: BookOpen,
  quiz: FileCheck,
  flashcard: Brain,
  review: HelpCircle,
  'deep-dive': Zap,
}

const actionLabels: Record<string, string> = {
  read: '精读',
  quiz: '测验',
  flashcard: '闪卡',
  review: '复习',
  'deep-dive': '深度理解',
}

const priorityColors: Record<string, string> = {
  high: 'var(--color-red-primary)',
  medium: 'var(--color-accent-gold)',
  low: 'var(--color-text-muted)',
}

const priorityLabels: Record<string, string> = {
  high: '重点',
  medium: '建议',
  low: '可选',
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function LearningPlanPreview({
  plan,
  intent,
  onConfirm,
  onCancel,
}: LearningPlanPreviewProps) {
  const [skippedIds, setSkippedIds] = useState<Set<string>>(new Set())

  const intentLabel = intent === 'learn' ? '系统学习' : intent === 'exam' ? '备考冲刺' : '间隔复习'
  const activeSteps = plan.filter((s) => !skippedIds.has(s.id))
  const activeMinutes = activeSteps.reduce((sum, s) => sum + s.estimatedMin, 0)

  function toggleSkip(stepId: string) {
    setSkippedIds((prev) => {
      const next = new Set(prev)
      if (next.has(stepId)) next.delete(stepId)
      else next.add(stepId)
      return next
    })
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-heading text-lg text-text-main">
            为你制定的学习计划
          </h3>
          <p className="text-xs text-text-muted mt-0.5">
            {intentLabel} · {activeSteps.length} 个步骤 · 约 {activeMinutes} 分钟
          </p>
        </div>
        <div className="flex items-center gap-1 text-xs text-text-muted">
          <Clock size={12} strokeWidth={1.5} />
          <span>约 {activeMinutes} min</span>
        </div>
      </div>

      {/* Steps */}
      <div className="space-y-2 mb-6">
        {plan.map((step, index) => {
          const isSkipped = skippedIds.has(step.id)
          const Icon = actionIcons[step.action] ?? BookOpen
          const level = getMasteryLevel(step.mastery)
          const masteryColor = getMasteryColor(level)
          const prioColor = priorityColors[step.priority]

          return (
            <motion.div
              key={step.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.04, duration: 0.25 }}
              className={`flex items-center gap-3 border rounded-lg px-4 py-3 transition-colors ${
                isSkipped
                  ? 'border-border-warm bg-bg-main opacity-50'
                  : 'border-border-warm bg-bg-card'
              }`}
            >
              {/* Step number */}
              <div className="w-6 h-6 rounded-full bg-bg-accent flex items-center justify-center shrink-0">
                {isSkipped ? (
                  <SkipForward size={12} className="text-text-muted" />
                ) : (
                  <span className="text-xs font-medium text-text-main">{index + 1}</span>
                )}
              </div>

              {/* Action icon */}
              <Icon size={16} strokeWidth={1.5} className="text-text-muted shrink-0" />

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-sm ${isSkipped ? 'line-through text-text-muted' : 'text-text-body'}`}>
                    {step.moduleName}
                  </span>
                  <span className="text-xs px-1 py-0.5 rounded border" style={{ borderColor: `${prioColor}40`, color: prioColor }}>
                    {priorityLabels[step.priority]}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="text-xs text-text-muted">{actionLabels[step.action]}</span>
                  <span className="text-xs text-text-muted">~{step.estimatedMin}min</span>
                  <span className="text-xs" style={{ color: masteryColor }}>
                    掌握度 {Math.round(step.mastery * 100)}% · {getMasteryLabel(level)}
                  </span>
                </div>
              </div>

              {/* Skip toggle */}
              {step.skippable && (
                <button
                  onClick={() => toggleSkip(step.id)}
                  className="text-xs text-text-muted hover:text-red-primary transition-colors shrink-0"
                >
                  {isSkipped ? '恢复' : '跳过'}
                </button>
              )}
            </motion.div>
          )
        })}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          onClick={onConfirm}
          className="flex items-center gap-2 px-5 py-2.5 rounded bg-red-primary text-white font-body text-sm hover:bg-red-dark transition-colors"
        >
          <CheckCircle size={16} strokeWidth={1.5} />
          开始学习
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2.5 rounded border border-border-warm text-text-muted font-body text-sm hover:border-red-primary hover:text-red-primary transition-colors"
        >
          取消
        </button>
      </div>
    </motion.div>
  )
}
