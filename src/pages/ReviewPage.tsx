/**
 * ReviewPage — /my/flashcards/:deckId/review
 * Loads a deck by courseId, gets due cards, renders ReviewSession.
 */
import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import type { FlashcardDeck, FlashcardCard } from '@/lib/fsrs'
import { loadDeck, getDueCards } from '@/lib/fsrs'
import { initMockFlashcards } from '@/mocks/flashcards'
import ReviewSession from '@/components/flashcard/ReviewSession'

export default function ReviewPage() {
  const { deckId } = useParams<{ deckId: string }>()
  const navigate = useNavigate()

  const [deck, setDeck] = useState<FlashcardDeck | null>(null)
  const [dueCards, setDueCards] = useState<FlashcardCard[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    initMockFlashcards()
    if (!deckId) {
      setLoading(false)
      return
    }
    const loaded = loadDeck(deckId)
    if (loaded) {
      setDeck(loaded)
      setDueCards(getDueCards(loaded.cards))
    }
    setLoading(false)
  }, [deckId])

  function handleComplete() {
    navigate('/my/flashcards')
  }

  if (loading) {
    return (
      <div className="p-8 max-w-3xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-bg-accent rounded w-48" />
          <div className="h-64 bg-bg-accent rounded" />
        </div>
      </div>
    )
  }

  if (!deck) {
    return (
      <div className="p-8 max-w-3xl mx-auto text-center py-16">
        <p className="text-text-muted text-lg">未找到该课程的闪卡</p>
        <button
          onClick={() => navigate('/my/flashcards')}
          className="mt-4 px-4 py-2 border border-border-warm text-text-body rounded hover:border-red-primary transition-colors"
        >
          返回闪卡列表
        </button>
      </div>
    )
  }

  if (dueCards.length === 0) {
    return (
      <div className="p-8 max-w-3xl mx-auto text-center py-16">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <h2 className="font-heading text-2xl text-text-main mb-2">
            {deck.courseName}
          </h2>
          <p className="text-text-muted">当前没有待复习的卡片</p>
          <button
            onClick={() => navigate('/my/flashcards')}
            className="mt-6 px-4 py-2 border border-border-warm text-text-body rounded hover:border-red-primary transition-colors"
          >
            返回闪卡列表
          </button>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <motion.div
        className="mb-8"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <div className="flex items-center justify-between">
          <div className="border-l-3 border-l-red-primary pl-4">
            <h1 className="font-heading text-2xl text-text-main">
              {deck.courseName}
            </h1>
            <p className="text-text-muted text-sm mt-0.5">
              {dueCards.length} 张卡片待复习
            </p>
          </div>
          <button
            onClick={() => navigate('/my/flashcards')}
            className="text-sm text-text-muted hover:text-red-primary transition-colors"
          >
            退出复习
          </button>
        </div>
      </motion.div>

      <ReviewSession
        deck={deck}
        dueCards={dueCards}
        onComplete={handleComplete}
      />
    </div>
  )
}
