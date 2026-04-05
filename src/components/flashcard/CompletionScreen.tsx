/**
 * CompletionScreen — shown after a review session ends.
 * Displays stats, mastery changes, and evolution suggestions.
 */
import { useState, useCallback, useRef } from 'react'
import { motion } from 'framer-motion'
import { BookOpen, Sparkles, ArrowRight, CheckCircle2 } from 'lucide-react'
import type { FlashcardDeck } from '@/lib/fsrs'
import { ratingLabel, Rating, saveDeck } from '@/lib/fsrs'
import { getMasteryLevel, getMasteryLabel, getMasteryColor } from '@/lib/student-model'
import { applyEvolution, saveEvolutionLog } from '@/lib/card-evolution'
import type { EvolutionSuggestion } from '@/lib/card-evolution'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface MasteryChange {
  moduleId: string
  moduleName: string
  before: number
  after: number
}

export interface SessionStats {
  total: number
  ratings: Record<1 | 2 | 3 | 4, number>
  totalTimeMs: number
  masteryChanges: MasteryChange[]
  evolutionSuggestions: EvolutionSuggestion[]
}

const RATINGS: Array<1 | 2 | 3 | 4> = [
  Rating.Again as 1,
  Rating.Hard as 2,
  Rating.Good as 3,
  Rating.Easy as 4,
]

/** Map rating to editorial color tokens */
const ratingStyle: Record<1 | 2 | 3 | 4, { color: string }> = {
  1: { color: 'var(--color-red-primary)' },
  2: { color: 'var(--color-accent-gold)' },
  3: { color: 'var(--color-success)' },
  4: { color: 'var(--color-info)' },
}

/* ------------------------------------------------------------------ */
/*  Helper sub-components                                              */
/* ------------------------------------------------------------------ */

function ResultCell({
  label,
  value,
  valueColor,
  borderLeft,
  borderTop,
}: {
  label: string
  value: string
  valueColor?: string
  borderLeft?: boolean
  borderTop?: boolean
}) {
  const borderClasses = [
    borderLeft ? 'border-l border-l-border-warm' : '',
    borderTop ? 'border-t border-t-border-warm' : '',
  ].join(' ')

  return (
    <div className={`bg-bg-card px-4 py-4 ${borderClasses}`}>
      <p className="text-[11px] font-mono uppercase tracking-wider text-text-muted mb-1">{label}</p>
      <p
        className="font-heading text-2xl"
        style={{ color: valueColor ?? 'var(--color-text-main)' }}
      >
        {value}
      </p>
    </div>
  )
}

function SectionHeading({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="text-red-primary">{icon}</span>
      <h3 className="font-heading text-base text-text-main">{title}</h3>
      {subtitle && (
        <span className="text-[10px] font-mono uppercase tracking-widest text-text-muted ml-1">
          {subtitle}
        </span>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function CompletionScreen({
  stats,
  deck,
  onClose,
}: {
  stats: SessionStats
  deck: FlashcardDeck
  onClose: () => void
}) {
  const [appliedEvolutions, setAppliedEvolutions] = useState<Set<string>>(new Set())
  const getNow = useRef(() => Date.now()).current

  const handleApplyEvolution = useCallback((suggestion: EvolutionSuggestion) => {
    const updated = applyEvolution(deck, suggestion.action)
    const updatedDeck = { ...deck, notes: updated.notes, cards: updated.cards }
    saveDeck(updatedDeck)

    const now = getNow()
    saveEvolutionLog(updatedDeck.courseId, {
      id: `evo-${now}`,
      trigger: suggestion.trigger,
      action: suggestion.action,
      timestamp: now,
    })

    setAppliedEvolutions((prev) => new Set([...prev, suggestion.trigger.cardId]))
  }, [deck, getNow])

  const correctCount = stats.ratings[Rating.Good as 3] + stats.ratings[Rating.Easy as 4]
  const correctPct = stats.total > 0 ? Math.round((correctCount / stats.total) * 100) : 0
  const avgTimeS = stats.total > 0 ? (stats.totalTimeMs / stats.total / 1000).toFixed(1) : '0'

  return (
    <motion.div
      className="max-w-md mx-auto"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      {/* Completion header */}
      <div className="text-center pt-8 pb-6 border-b border-border-warm mb-8">
        <div className="inline-flex items-center gap-2 mb-3">
          <CheckCircle2 size={18} strokeWidth={1.5} className="text-success" />
          <span className="text-xs font-mono uppercase tracking-widest text-text-muted">
            Session Complete
          </span>
        </div>
        <h2 className="font-heading text-2xl text-text-main">复习完成</h2>
        <p className="text-sm text-text-muted mt-1">
          本次共复习 {stats.total} 张卡片
        </p>
      </div>

      {/* Stats table */}
      <div className="border border-border-warm mb-8">
        <div className="grid grid-cols-2">
          <ResultCell label="正确率" value={`${correctPct}%`} />
          <ResultCell label="平均用时" value={`${avgTimeS}s`} borderLeft />
          <ResultCell
            label="记得 / 简单"
            value={`${correctCount}`}
            valueColor="var(--color-success)"
            borderTop
          />
          <ResultCell
            label="忘记 / 困难"
            value={`${stats.ratings[Rating.Again as 1] + stats.ratings[Rating.Hard as 2]}`}
            valueColor="var(--color-red-primary)"
            borderLeft
            borderTop
          />
        </div>
      </div>

      {/* Rating breakdown */}
      <div className="flex items-center justify-center gap-6 mb-8 text-xs text-text-muted">
        {RATINGS.map((r) => (
          <span key={r} className="flex items-center gap-1.5">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ backgroundColor: ratingStyle[r].color }}
            />
            {ratingLabel(r)} {stats.ratings[r]}
          </span>
        ))}
      </div>

      {/* Mastery changes */}
      {stats.masteryChanges.length > 0 && (
        <div className="mb-8">
          <SectionHeading icon={<BookOpen size={14} strokeWidth={1.5} />} title="知识掌握度变化" />
          <div className="border border-border-warm divide-y divide-border-warm">
            {stats.masteryChanges.map((change) => {
              const level = getMasteryLevel(change.after)
              const color = getMasteryColor(level)
              const diff = change.after - change.before
              const sign = diff > 0 ? '+' : ''
              return (
                <div key={change.moduleId} className="flex items-center justify-between px-4 py-3 bg-bg-card">
                  <span className="text-sm text-text-body">{change.moduleName}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono text-text-muted">
                      {Math.round(change.before * 100)}%
                    </span>
                    <ArrowRight size={12} className="text-text-muted" />
                    <span className="text-sm font-mono font-medium" style={{ color }}>
                      {Math.round(change.after * 100)}%
                    </span>
                    <span
                      className="text-[10px] font-mono px-1.5 py-0.5 border"
                      style={{ borderColor: `${color}30`, color }}
                    >
                      {sign}{Math.round(diff * 100)}% {getMasteryLabel(level)}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Evolution suggestions */}
      {stats.evolutionSuggestions.length > 0 && (
        <div className="mb-8">
          <SectionHeading icon={<Sparkles size={14} strokeWidth={1.5} />} title="编辑建议" subtitle="Editor's Recommendations" />
          <div className="border border-border-warm divide-y divide-border-warm">
            {stats.evolutionSuggestions.map((suggestion) => {
              const isApplied = appliedEvolutions.has(suggestion.trigger.cardId)
              const actionLabel =
                suggestion.action.type === 'split' ? '拆分为子卡片' :
                suggestion.action.type === 'retire' ? '退役此卡片' :
                suggestion.action.type === 'rewrite' ? '改写问法' : '添加记忆提示'

              return (
                <div
                  key={`${suggestion.trigger.cardId}-${suggestion.trigger.type}`}
                  className={`flex items-center justify-between px-4 py-3 ${isApplied ? 'bg-bg-accent' : 'bg-bg-card'}`}
                >
                  <div className="flex-1 min-w-0 mr-4">
                    <p className="text-sm text-text-body leading-snug">{suggestion.description}</p>
                    <p className="text-[11px] text-text-muted mt-1 font-mono tracking-tight italic">
                      {actionLabel}
                    </p>
                  </div>
                  {isApplied ? (
                    <span className="text-[11px] text-success font-mono shrink-0 flex items-center gap-1">
                      <CheckCircle2 size={12} strokeWidth={1.5} />
                      已应用
                    </span>
                  ) : (
                    <button
                      onClick={() => handleApplyEvolution(suggestion)}
                      className="text-xs px-3 py-1.5 border border-red-primary/30 text-red-primary hover:bg-red-primary hover:text-white transition-colors shrink-0 font-body"
                    >
                      应用
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Return button */}
      <div className="text-center pb-8">
        <button
          onClick={onClose}
          className="px-8 py-2.5 border border-red-primary text-red-primary font-body text-sm hover:bg-red-primary hover:text-white transition-colors"
        >
          返回闪卡列表
        </button>
      </div>
    </motion.div>
  )
}
