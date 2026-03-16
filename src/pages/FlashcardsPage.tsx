/**
 * FlashcardsPage — /my/flashcards
 * Lists all flashcard decks, initializes mock data on first visit.
 */
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import type { FlashcardDeck } from '@/lib/fsrs'
import { loadAllDecks } from '@/lib/fsrs'
import { initMockFlashcards } from '@/mocks/flashcards'
import DeckList from '@/components/flashcard/DeckList'

export default function FlashcardsPage() {
  const [decks, setDecks] = useState<FlashcardDeck[]>([])

  useEffect(() => {
    initMockFlashcards()
    setDecks(loadAllDecks())
  }, [])

  const totalCards = decks.reduce((sum, d) => sum + d.cards.length, 0)

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
      >
        <div className="border-l-3 border-l-red-primary pl-4 mb-8">
          <h1 className="font-heading text-3xl text-text-main">我的闪卡</h1>
          <p className="text-text-muted mt-1">
            {decks.length > 0
              ? `${decks.length} 个课程 · ${totalCards} 张卡片`
              : '利用间隔重复高效记忆知识点'}
          </p>
        </div>
      </motion.div>

      <DeckList decks={decks} />
    </div>
  )
}
