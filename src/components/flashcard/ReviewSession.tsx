/**
 * ReviewSession — core FSRS-driven review flow.
 * Shows cards one by one, collects ratings, tracks time, shows completion stats.
 * Editorial academic design: journal-style progress, elegant rating controls.
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { FlashcardCard as FCard, FlashcardDeck } from '@/lib/fsrs'
import {
  getSchedulingChoices,
  formatInterval,
  reviewCard,
  Rating,
  saveDeck,
} from '@/lib/fsrs'
import FlashcardCard from '@/components/flashcard/FlashcardCard'
import CompletionScreen from '@/components/flashcard/CompletionScreen'
import type { SessionStats, MasteryChange } from '@/components/flashcard/CompletionScreen'
import {
  loadProfile,
  saveProfile,
  processFeedback,
} from '@/lib/student-model'
import type { LearningProfile } from '@/lib/student-model'
import {
  detectTriggers,
  generateSuggestion,
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
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.92 }}
      transition={{ type: 'tween', duration: 0.1 }}
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
    </motion.button>
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
