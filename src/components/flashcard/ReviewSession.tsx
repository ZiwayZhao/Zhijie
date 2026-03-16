/**
 * ReviewSession — core FSRS-driven review flow.
 * Shows cards one by one, collects ratings, tracks time, shows completion stats.
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { FlashcardCard as FCard, FlashcardDeck } from '@/lib/fsrs'
import {
  getSchedulingChoices,
  formatInterval,
  reviewCard,
  ratingLabel,
  ratingColor,
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

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function ProgressBar({ current, total }: { current: number; total: number }) {
  const pct = total > 0 ? (current / total) * 100 : 0
  return (
    <div className="w-full mb-6">
      <div className="flex justify-between text-xs text-text-muted mb-1.5">
        <span>{current} / {total}</span>
        <span>{Math.round(pct)}%</span>
      </div>
      <div className="h-1.5 bg-bg-main rounded-full overflow-hidden border border-border-warm">
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: 'var(--color-red-primary)' }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.3 }}
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
  const color = ratingColor(rating)
  return (
    <button
      onClick={onClick}
      className="flex-1 py-3 px-2 rounded border text-sm font-body transition-colors hover:text-white"
      style={{
        borderColor: `${color}60`,
        color,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = color
        e.currentTarget.style.color = '#fff'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = ''
        e.currentTarget.style.color = color
      }}
    >
      <span className="block font-medium">{ratingLabel(rating)}</span>
      <span className="block text-xs mt-0.5 opacity-80">{interval}</span>
    </button>
  )
}

function CompletionScreen({ stats, deck, onClose }: { stats: SessionStats; deck: FlashcardDeck; onClose: () => void }) {
  const [appliedEvolutions, setAppliedEvolutions] = useState<Set<string>>(new Set())

  function handleApplyEvolution(suggestion: EvolutionSuggestion) {
    const updated = applyEvolution(deck, suggestion.action)
    // Update deck in-place for persistence
    deck.notes = updated.notes
    deck.cards = updated.cards
    saveDeck(deck)

    // Log evolution
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
      className="text-center py-12 max-w-md mx-auto"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <h2 className="font-heading text-2xl text-text-main mb-2">复习完成</h2>
      <p className="text-text-muted mb-8">本次共复习 {stats.total} 张卡片</p>

      <div className="grid grid-cols-2 gap-4 mb-8">
        <StatCard label="正确率" value={`${correctPct}%`} />
        <StatCard label="平均用时" value={`${avgTimeS}s`} />
        <StatCard
          label="记得 / 简单"
          value={`${correctCount}`}
          valueColor="#4CAF50"
        />
        <StatCard
          label="忘记 / 困难"
          value={`${stats.ratings[Rating.Again as 1] + stats.ratings[Rating.Hard as 2]}`}
          valueColor="#A5192E"
        />
      </div>

      {/* Evolution suggestions */}
      {stats.evolutionSuggestions.length > 0 && (
        <div className="mb-8 text-left">
          <h3 className="font-heading text-base text-text-main mb-3">
            AI 闪卡优化建议
          </h3>
          <div className="space-y-2">
            {stats.evolutionSuggestions.map((suggestion) => {
              const isApplied = appliedEvolutions.has(suggestion.trigger.cardId)
              return (
                <div
                  key={`${suggestion.trigger.cardId}-${suggestion.trigger.type}`}
                  className={`flex items-center justify-between border rounded px-3 py-2 ${isApplied ? 'border-green-500/30 bg-green-50' : 'border-border-warm'}`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-text-body">{suggestion.description}</p>
                    <p className="text-xs text-text-muted mt-0.5">
                      {suggestion.action.type === 'split' ? '拆分为子卡片' :
                       suggestion.action.type === 'retire' ? '退役此卡片' :
                       suggestion.action.type === 'rewrite' ? '改写问法' : '添加记忆提示'}
                    </p>
                  </div>
                  {isApplied ? (
                    <span className="text-xs text-green-600 shrink-0 ml-3">已应用</span>
                  ) : (
                    <button
                      onClick={() => handleApplyEvolution(suggestion)}
                      className="text-xs px-2 py-1 rounded border border-red-primary/30 text-red-primary hover:bg-red-primary hover:text-white transition-colors shrink-0 ml-3"
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

      {/* Mastery changes */}
      {stats.masteryChanges.length > 0 && (
        <div className="mb-8 text-left">
          <h3 className="font-heading text-base text-text-main mb-3">知识掌握度变化</h3>
          <div className="space-y-2">
            {stats.masteryChanges.map((change) => {
              const level = getMasteryLevel(change.after)
              const color = getMasteryColor(level)
              const diff = change.after - change.before
              const arrow = diff > 0 ? '↑' : '↓'
              return (
                <div key={change.moduleId} className="flex items-center justify-between border border-border-warm rounded px-3 py-2">
                  <span className="text-sm text-text-body">{change.moduleName}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-text-muted">
                      {Math.round(change.before * 100)}%
                    </span>
                    <span style={{ color }} className="text-sm font-medium">
                      {arrow} {Math.round(change.after * 100)}%
                    </span>
                    <span className="text-xs px-1.5 py-0.5 rounded border" style={{ borderColor: `${color}40`, color }}>
                      {getMasteryLabel(level)}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <button
        onClick={onClose}
        className="px-6 py-2.5 rounded border border-red-primary text-red-primary font-body hover:bg-red-primary hover:text-white transition-colors"
      >
        返回闪卡列表
      </button>
    </motion.div>
  )
}

function StatCard({
  label,
  value,
  valueColor,
}: {
  label: string
  value: string
  valueColor?: string
}) {
  return (
    <div className="border border-border-warm bg-bg-card rounded-lg p-4">
      <p className="text-xs text-text-muted mb-1">{label}</p>
      <p
        className="font-heading text-2xl"
        style={{ color: valueColor ?? 'var(--color-text-main)' }}
      >
        {value}
      </p>
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
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -40 }}
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
            className="flex gap-3 mt-8"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
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
        <p className="text-center text-text-muted text-sm mt-8">
          点击卡片查看答案，然后选择掌握程度
        </p>
      )}
    </div>
  )
}
