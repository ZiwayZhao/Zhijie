/**
 * FlashcardsPage — /my/flashcards
 * Lists all flashcard decks. Styled as a library card catalog.
 */
import { useEffect, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Plus } from 'lucide-react'
import type { FlashcardDeck } from '@/lib/fsrs'
import { loadAllDecks, getDueCards } from '@/lib/fsrs'
import DeckList from '@/components/flashcard/DeckList'
import ManualCardCreator from '@/components/flashcard/ManualCardCreator'

export default function FlashcardsPage() {
  const [decks, setDecks] = useState<FlashcardDeck[]>([])
  const [showCreator, setShowCreator] = useState(false)
  const [creatorDeckIdx, setCreatorDeckIdx] = useState(0)

  const reloadDecks = useCallback(() => setDecks(loadAllDecks()), [])

  useEffect(() => {
    reloadDecks()
  }, [reloadDecks])

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

      {/* Manual card creator */}
      {decks.length > 0 && (
        <div className="mb-6">
          {showCreator ? (
            <>
              {decks.length > 1 && (
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs text-text-muted">添加到：</span>
                  <select
                    value={creatorDeckIdx}
                    onChange={(e) => setCreatorDeckIdx(Number(e.target.value))}
                    className="text-sm bg-bg-main border border-border-warm rounded-sm px-2 py-1
                               text-text-body outline-none focus:border-red-primary"
                  >
                    {decks.map((d, i) => (
                      <option key={d.courseId} value={i}>{d.courseName}</option>
                    ))}
                  </select>
                </div>
              )}
              <ManualCardCreator
                deck={decks[creatorDeckIdx]}
                onCreated={() => { reloadDecks(); setShowCreator(false) }}
                onClose={() => setShowCreator(false)}
              />
            </>
          ) : (
            <button
              onClick={() => setShowCreator(true)}
              className="flex items-center gap-2 px-4 py-2 text-sm border border-border-warm
                         text-text-muted hover:border-red-primary hover:text-red-primary
                         transition-colors rounded-sm"
            >
              <Plus size={14} strokeWidth={1.5} />
              手动新建卡片
            </button>
          )}
        </div>
      )}

      <DeckList decks={decks} />
    </div>
  )
}
