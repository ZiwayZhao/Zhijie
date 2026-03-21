/**
 * FlashcardsPage — /my/flashcards
 * Lists all flashcard decks. Styled as a library card catalog.
 */
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import type { FlashcardDeck } from '@/lib/fsrs'
import { loadAllDecks, getDueCards } from '@/lib/fsrs'
import DeckList from '@/components/flashcard/DeckList'

export default function FlashcardsPage() {
  const [decks, setDecks] = useState<FlashcardDeck[]>([])

  useEffect(() => {
    setDecks(loadAllDecks())
  }, [])

  const totalCards = decks.reduce((sum, d) => sum + d.cards.length, 0)
  const totalDue = decks.reduce((sum, d) => sum + getDueCards(d.cards).length, 0)

  return (
    <div className="p-8 max-w-3xl mx-auto">
      {/* Page header — editorial serif with decorative elements */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="mb-10"
      >
        <div className="border-l-3 border-l-red-primary pl-5">
          <h1 className="font-heading text-3xl text-text-main leading-tight">我的闪卡</h1>
          <p className="text-text-muted mt-1.5 text-sm">
            {decks.length > 0
              ? `${decks.length} 个课程 \u00b7 ${totalCards} 张卡片`
              : '利用间隔重复高效记忆知识点'}
          </p>
        </div>

        {/* Summary strip — when there are due cards */}
        {totalDue > 0 && (
          <motion.div
            className="mt-5 flex items-center gap-4 px-5 py-3 border border-border-warm bg-bg-card"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.15 }}
          >
            <span className="inline-block w-2 h-2 rounded-full bg-red-primary" />
            <span className="text-sm text-text-body">
              今日共有 <span className="font-heading text-red-primary">{totalDue}</span> 张卡片待复习
            </span>
            <span className="text-[10px] font-mono text-text-muted uppercase tracking-widest ml-auto">
              FSRS v6
            </span>
          </motion.div>
        )}
      </motion.div>

      <DeckList decks={decks} />
    </div>
  )
}
