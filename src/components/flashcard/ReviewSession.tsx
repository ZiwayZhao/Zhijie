/**
 * ReviewSession — core FSRS-driven review flow.
 * Shows cards one by one, collects ratings, tracks time, shows completion stats.
 * Editorial academic design: journal-style progress, elegant rating controls.
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { BookOpen, Sparkles, ArrowRight, CheckCircle2 } from 'lucide-react'
import type { FlashcardCard as FCard, FlashcardDeck } from '@/lib/fsrs'
import {
  getSchedulingChoices,
  formatInterval,
  reviewCard,
  ratingLabel,
  Rating,
  saveDeck,
} from '@/lib/fsrs'
import FlashcardCard from '@/components/flashcard/FlashcardCard'
import {
  loadProfile,
  saveProfile,
  processFeedback,
  getMasteryLevel,
  getMasteryLabel,
  getMasteryColor,
} from '@/lib/student-model'
import type { LearningProfile } from '@/lib/student-model'
import {
  detectTriggers,
  generateSuggestion,
  applyEvolution,
  saveEvolutionLog,
} from '@/lib/card-evolution'
import type { EvolutionSuggestion } from '@/lib/card-evolution'

/* ------------------------------------------------------------------ */
/*  Types & Props                                                      */
/* ------------------------------------------------------------------ */

interface ReviewSessionProps {
  deck: FlashcardDeck
  dueCards: FCard[]
  onComplete: () => void
}

interface MasteryChange {
  moduleId: string
  moduleName: string
  before: number
  after: number
}

interface SessionStats {
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
const ratingStyle: Record<1 | 2 | 3 | 4, { color: string; label: string; hoverBg: string }> = {
  1: { color: 'var(--color-red-primary)', label: '忘记', hoverBg: 'var(--color-red-primary)' },
  2: { color: 'var(--color-accent-gold)', label: '困难', hoverBg: 'var(--color-accent-gold)' },
  3: { color: 'var(--color-success)', label: '记得', hoverBg: 'var(--color-success)' },
  4: { color: 'var(--color-info)', label: '简单', hoverBg: 'var(--color-info)' },
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function ProgressBar({ current, total }: { current: number; total: number }) {
  const pct = total > 0 ? (current / total) * 100 : 0
  return (
    <div className="w-full mb-8">
      {/* Reading-progress style: thin line at top */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-mono text-text-muted tracking-tight">
          {current} of {total}
        </span>
        <span className="text-[11px] font-mono text-text-muted tracking-tight">
          {Math.round(pct)}%
        </span>
      </div>
      <div className="h-[2px] bg-border-warm overflow-hidden">
        <motion.div
          className="h-full bg-red-primary"
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        />
      </div>
    </div>
  )
}

function RatingButton({
  rating,
  interval,
  onClick,
}: {
  rating: 1 | 2 | 3 | 4
  interval: string
  onClick: () => void
}) {
  const style = ratingStyle[rating]
  return (
    <button
      onClick={onClick}
      className="group flex-1 py-3 px-2 border border-border-warm bg-bg-card text-center transition-all duration-200 hover:border-current"
      style={{ color: style.color }}
      onMouseEnter={(e) => {
        const el = e.currentTarget
        el.style.backgroundColor = style.hoverBg
        el.style.color = '#FFFEFB'
        el.style.borderColor = style.hoverBg
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget
        el.style.backgroundColor = ''
        el.style.color = style.color
        el.style.borderColor = ''
      }}
    >
      <span className="block text-sm font-heading">{style.label}</span>
      <span className="block text-[10px] mt-1 opacity-70 font-mono">{interval}</span>
    </button>
  )
}

function CompletionScreen({ stats, deck, onClose }: { stats: SessionStats; deck: FlashcardDeck; onClose: () => void }) {
  const [appliedEvolutions, setAppliedEvolutions] = useState<Set<string>>(new Set())

  function handleApplyEvolution(suggestion: EvolutionSuggestion) {
    const updated = applyEvolution(deck, suggestion.action)
    deck.notes = updated.notes
    deck.cards = updated.cards
    saveDeck(deck)

    saveEvolutionLog(deck.courseId, {
      id: `evo-${Date.now()}`,
      trigger: suggestion.trigger,
      action: suggestion.action,
      timestamp: Date.now(),
    })

    setAppliedEvolutions((prev) => new Set([...prev, suggestion.trigger.cardId]))
  }

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
      {/* Completion header — academic journal style */}
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

      {/* Stats table — academic results style */}
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

      {/* Rating breakdown — inline row */}
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

      {/* Mastery changes — editorial table */}
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

      {/* Evolution suggestions — Editor's Recommendations */}
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

/** Academic results cell for the 2x2 stats grid */
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

/** Section heading with icon — editorial journal style */
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

export default function ReviewSession({ deck, dueCards, onComplete }: ReviewSessionProps) {
  const [currentIdx, setCurrentIdx] = useState(0)
  const [isFlipped, setIsFlipped] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [stats, setStats] = useState<SessionStats>({
    total: dueCards.length,
    ratings: { 1: 0, 2: 0, 3: 0, 4: 0 },
    totalTimeMs: 0,
    masteryChanges: [],
    evolutionSuggestions: [],
  })

  // BKT profile tracking
  const profileRef = useRef<LearningProfile>(loadProfile())
  const evolutionQueue = useRef<EvolutionSuggestion[]>([])
  const masterySnapshotRef = useRef<Record<string, number>>({})

  // Capture initial mastery snapshot on mount
  useEffect(() => {
    const profile = profileRef.current
    const snapshot: Record<string, number> = {}
    for (const card of dueCards) {
      const note = deck.notes.find((n) => n.id === card.noteId)
      if (note?.sourceRef.moduleId) {
        const mod = profile.modules[note.sourceRef.moduleId]
        if (mod) snapshot[note.sourceRef.moduleId] = mod.mastery
        else snapshot[note.sourceRef.moduleId] = 0.3 // default BKT pL0
      }
    }
    masterySnapshotRef.current = snapshot
  }, [dueCards, deck.notes])

  // Timer for current card
  const cardStartTime = useRef(Date.now())

  useEffect(() => {
    cardStartTime.current = Date.now()
  }, [currentIdx])

  const currentCard = dueCards[currentIdx] ?? null
  const currentNote = useMemo(() => {
    if (!currentCard) return null
    return deck.notes.find((n) => n.id === currentCard.noteId) ?? null
  }, [currentCard, deck.notes])

  // Scheduling choices for current card
  const choices = useMemo(() => {
    if (!currentCard) return null
    return getSchedulingChoices(currentCard.card)
  }, [currentCard])

  const handleRating = useCallback(
    (rating: 1 | 2 | 3 | 4) => {
      if (!currentCard) return
      const elapsedMs = Date.now() - cardStartTime.current

      // Apply review
      const result = reviewCard(currentCard.card, rating)

      // Update card in deck
      const cardIdx = deck.cards.findIndex((c) => c.id === currentCard.id)
      if (cardIdx >= 0) {
        deck.cards[cardIdx] = {
          ...deck.cards[cardIdx],
          card: result.card,
          consecutiveAgain: rating === (Rating.Again as 1)
            ? deck.cards[cardIdx].consecutiveAgain + 1
            : 0,
          consecutiveEasy: rating === (Rating.Easy as 4)
            ? deck.cards[cardIdx].consecutiveEasy + 1
            : 0,
        }
      }

      // Add review log
      deck.reviewLogs.push({
        cardId: currentCard.id,
        rating,
        reviewedAt: new Date().toISOString(),
        responseMs: elapsedMs,
        log: result.log,
      })

      // Save to localStorage
      saveDeck(deck)

      // BKT feedback: update student model
      const note = deck.notes.find((n) => n.id === currentCard.noteId)
      if (note?.sourceRef.moduleId) {
        profileRef.current = processFeedback(profileRef.current, {
          type: 'flashcard-rating',
          moduleId: note.sourceRef.moduleId,
          courseId: deck.courseId,
          rating,
          moduleName: note.sourceRef.moduleId,
        })
        saveProfile(profileRef.current)
      }

      // Detect evolution triggers
      const updatedCard = deck.cards[cardIdx >= 0 ? cardIdx : 0]
      if (updatedCard) {
        const triggers = detectTriggers(updatedCard, deck)
        for (const trigger of triggers) {
          const triggerNote = deck.notes.find((n) => n.id === trigger.noteId)
          if (triggerNote) {
            const existing = evolutionQueue.current.find(
              (s) => s.trigger.cardId === trigger.cardId && s.trigger.type === trigger.type,
            )
            if (!existing) {
              evolutionQueue.current.push(generateSuggestion(trigger, triggerNote))
            }
          }
        }
      }

      // Update stats
      setStats((prev) => ({
        ...prev,
        ratings: { ...prev.ratings, [rating]: prev.ratings[rating] + 1 },
        totalTimeMs: prev.totalTimeMs + elapsedMs,
      }))

      // Next card or complete
      if (currentIdx + 1 >= dueCards.length) {
        // Calculate mastery changes
        const changes: MasteryChange[] = []
        const profile = profileRef.current
        for (const [modId, beforeVal] of Object.entries(masterySnapshotRef.current)) {
          const afterVal = profile.modules[modId]?.mastery ?? beforeVal
          if (Math.abs(afterVal - beforeVal) > 0.001) {
            changes.push({
              moduleId: modId,
              moduleName: profile.modules[modId]?.moduleName ?? modId,
              before: beforeVal,
              after: afterVal,
            })
          }
        }
        setStats((prev) => ({
          ...prev,
          masteryChanges: changes,
          evolutionSuggestions: [...evolutionQueue.current],
        }))
        setCompleted(true)
      } else {
        setIsFlipped(false)
        setCurrentIdx((prev) => prev + 1)
      }
    },
    [currentCard, currentIdx, deck, dueCards.length],
  )

  if (completed) {
    return <CompletionScreen stats={stats} deck={deck} onClose={onComplete} />
  }

  if (!currentNote || !choices) {
    return (
      <div className="text-center py-12 text-text-muted">
        无法加载卡片数据
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto">
      <ProgressBar current={currentIdx} total={dueCards.length} />

      <AnimatePresence mode="wait">
        <motion.div
          key={currentCard?.id}
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -30 }}
          transition={{ duration: 0.25 }}
        >
          <FlashcardCard
            note={currentNote}
            flipped={isFlipped}
            onFlip={setIsFlipped}
          />
        </motion.div>
      </AnimatePresence>

      {/* Rating buttons — only show when flipped */}
      <AnimatePresence>
        {isFlipped && (
          <motion.div
            className="flex gap-[1px] mt-8 border border-border-warm overflow-hidden"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.2 }}
          >
            {RATINGS.map((r) => (
              <RatingButton
                key={r}
                rating={r}
                interval={formatInterval(choices[r].card)}
                onClick={() => handleRating(r)}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {!isFlipped && (
        <p className="text-center text-text-muted text-xs mt-8 tracking-wide">
          点击卡片查看答案，然后选择掌握程度
        </p>
      )}
    </div>
  )
}
