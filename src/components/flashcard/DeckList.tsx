/**
 * DeckList — displays all flashcard decks grouped by course.
 * Styled as a collection of book spines / journal issue covers.
 */
import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { Sparkles, BookOpen } from 'lucide-react'
import type { FlashcardDeck } from '@/lib/fsrs'
import { getDueCards, State } from '@/lib/fsrs'
import { loadEvolutionLogs } from '@/lib/card-evolution'

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface DeckListProps {
  decks: FlashcardDeck[]
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

interface DeckStats {
  total: number
  due: number
  newCount: number
  learningCount: number
  reviewCount: number
}

function computeStats(deck: FlashcardDeck): DeckStats {
  const due = getDueCards(deck.cards).length
  let newCount = 0
  let learningCount = 0
  let reviewCount = 0

  for (const c of deck.cards) {
    const s = c.card.state
    if (s === State.New) newCount++
    else if (s === State.Learning || s === State.Relearning) learningCount++
    else if (s === State.Review) reviewCount++
  }

  return { total: deck.cards.length, due, newCount, learningCount, reviewCount }
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function StatLabel({ label, count, color }: { label: string; count: number; color: string }) {
  if (count === 0) return null
  return (
    <span className="inline-flex items-center gap-1 text-[11px]" style={{ color }}>
      <span
        className="inline-block w-1.5 h-1.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      {label} {count}
    </span>
  )
}

function DeckItem({ deck, index }: { deck: FlashcardDeck; index: number }) {
  const navigate = useNavigate()
  const stats = useMemo(() => computeStats(deck), [deck])

  return (
    <motion.div
      className="border border-border-warm bg-bg-card flex overflow-hidden group"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.35 }}
    >
      {/* Left accent — book spine feel */}
      <div className="w-1.5 shrink-0 bg-red-primary/80 group-hover:bg-red-primary transition-colors duration-300" />

      <div className="flex-1 flex items-center justify-between gap-4 p-5 pl-4">
        <div className="flex-1 min-w-0">
          {/* Course name — serif heading */}
          <h3 className="font-heading text-lg text-text-main truncate leading-tight">
            {deck.courseName}
          </h3>

          {/* Stats row — inline labels */}
          <div className="flex items-center gap-4 mt-2.5 flex-wrap">
            <span className="text-[11px] text-text-body font-mono">
              {stats.total} cards
            </span>
            <StatLabel label="新" count={stats.newCount} color="var(--color-info)" />
            <StatLabel label="学习中" count={stats.learningCount} color="var(--color-accent-gold)" />
            <StatLabel label="复习" count={stats.reviewCount} color="var(--color-success)" />
          </div>

          {/* Due count — editorial urgency */}
          {stats.due > 0 && (
            <p className="text-sm text-red-primary font-medium mt-2 flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full bg-red-primary animate-pulse" />
              {stats.due} 张卡片待复习
            </p>
          )}

          {/* Evolution badge */}
          <EvolutionBadge courseId={deck.courseId} />
        </div>

        {/* Action button — editorial style */}
        <button
          disabled={stats.due === 0}
          onClick={() => navigate(`/my/flashcards/${deck.courseId}/review`)}
          className={
            stats.due > 0
              ? 'px-5 py-2 text-sm font-body bg-red-primary text-white hover:bg-red-dark transition-colors whitespace-nowrap'
              : 'px-5 py-2 text-sm font-body border border-border-warm text-text-muted cursor-not-allowed whitespace-nowrap'
          }
        >
          {stats.due > 0 ? '开始复习' : '暂无待复习'}
        </button>
      </div>
    </motion.div>
  )
}

function EvolutionBadge({ courseId }: { courseId: string }) {
  const logs = useMemo(() => loadEvolutionLogs(courseId), [courseId])
  if (logs.length === 0) return null

  // Show recent evolutions (last 7 days)
  const recentCount = logs.filter(
    (l) => Date.now() - l.timestamp < 7 * 24 * 60 * 60 * 1000,
  ).length

  if (recentCount === 0) return null

  return (
    <p className="flex items-center gap-1.5 text-[11px] text-accent-gold mt-2 italic">
      <Sparkles size={11} strokeWidth={1.5} />
      AI 本周优化了 {recentCount} 张卡片
    </p>
  )
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function DeckList({ decks }: DeckListProps) {
  if (decks.length === 0) {
    return (
      <motion.div
        className="text-center py-20"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4 }}
      >
        <BookOpen size={32} strokeWidth={1} className="mx-auto text-text-muted mb-4" />
        <p className="font-heading text-lg text-text-body">暂无闪卡</p>
        <p className="text-sm text-text-muted mt-2 max-w-xs mx-auto leading-relaxed">
          学习课程材料后，AI 会自动为你生成闪卡，利用间隔重复高效记忆知识点
        </p>
      </motion.div>
    )
  }

  return (
    <div className="space-y-3">
      {decks.map((deck, i) => (
        <DeckItem key={deck.courseId} deck={deck} index={i} />
      ))}
    </div>
  )
}
