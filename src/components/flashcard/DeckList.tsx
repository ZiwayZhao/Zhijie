/**
 * DeckList — displays all flashcard decks grouped by course.
 */
import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
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

function StatBadge({ label, count, color }: { label: string; count: number; color: string }) {
  if (count === 0) return null
  return (
    <span
      className="text-xs px-2 py-0.5 rounded border"
      style={{ borderColor: `${color}40`, color }}
    >
      {label} {count}
    </span>
  )
}

function DeckItem({ deck, index }: { deck: FlashcardDeck; index: number }) {
  const navigate = useNavigate()
  const stats = useMemo(() => computeStats(deck), [deck])

  return (
    <motion.div
      className="border border-border-warm bg-bg-card rounded-lg p-5 flex items-center justify-between gap-4"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.35 }}
    >
      <div className="flex-1 min-w-0">
        <h3 className="font-heading text-lg text-text-main truncate">
          {deck.courseName}
        </h3>

        <div className="flex items-center gap-3 mt-2 flex-wrap">
          <span className="text-sm text-text-muted">{stats.total} 张卡片</span>
          <StatBadge label="新" count={stats.newCount} color="#2196F3" />
          <StatBadge label="学习中" count={stats.learningCount} color="#C49A2A" />
          <StatBadge label="复习" count={stats.reviewCount} color="#4CAF50" />
        </div>

        {stats.due > 0 && (
          <p className="text-sm text-red-primary mt-1.5">
            {stats.due} 张卡片待复习
          </p>
        )}

        {/* Evolution badge */}
        <EvolutionBadge courseId={deck.courseId} />
      </div>

      <button
        disabled={stats.due === 0}
        onClick={() => navigate(`/my/flashcards/${deck.courseId}/review`)}
        className={
          stats.due > 0
            ? 'px-4 py-2 text-sm font-body rounded border border-red-primary text-red-primary hover:bg-red-primary hover:text-white transition-colors whitespace-nowrap'
            : 'px-4 py-2 text-sm font-body rounded border border-border-warm text-text-muted cursor-not-allowed whitespace-nowrap'
        }
      >
        {stats.due > 0 ? '开始复习' : '暂无待复习'}
      </button>
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
    <p className="flex items-center gap-1 text-xs text-accent-gold mt-1">
      <Sparkles size={12} strokeWidth={1.5} />
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
      <div className="text-center py-16">
        <p className="text-text-muted text-lg">暂无闪卡</p>
        <p className="text-text-muted text-sm mt-2">
          学习课程材料后，AI 会自动为你生成闪卡
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {decks.map((deck, i) => (
        <DeckItem key={deck.courseId} deck={deck} index={i} />
      ))}
    </div>
  )
}
