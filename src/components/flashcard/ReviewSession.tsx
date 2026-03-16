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

/* ------------------------------------------------------------------ */
/*  Types & Props                                                      */
/* ------------------------------------------------------------------ */

interface ReviewSessionProps {
  deck: FlashcardDeck
  dueCards: FCard[]
  onComplete: () => void
}

interface SessionStats {
  total: number
  ratings: Record<1 | 2 | 3 | 4, number>
  totalTimeMs: number
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

function CompletionScreen({ stats, onClose }: { stats: SessionStats; onClose: () => void }) {
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
  })

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

      // Update stats
      setStats((prev) => ({
        ...prev,
        ratings: { ...prev.ratings, [rating]: prev.ratings[rating] + 1 },
        totalTimeMs: prev.totalTimeMs + elapsedMs,
      }))

      // Next card or complete
      if (currentIdx + 1 >= dueCards.length) {
        setCompleted(true)
      } else {
        setIsFlipped(false)
        setCurrentIdx((prev) => prev + 1)
      }
    },
    [currentCard, currentIdx, deck, dueCards.length],
  )

  if (completed) {
    return <CompletionScreen stats={stats} onClose={onComplete} />
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
