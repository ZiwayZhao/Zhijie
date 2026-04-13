/**
 * ManualCardCreator — inline form for manually creating flashcards.
 * Supports basic and cloze card types.
 */
import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import type { FlashcardNote, FlashcardDeck } from '@/lib/fsrs'
import { createFlashcard, saveDeck } from '@/lib/fsrs'

interface ManualCardCreatorProps {
  deck: FlashcardDeck
  onCreated: () => void
  onClose: () => void
}

export default function ManualCardCreator({ deck, onCreated, onClose }: ManualCardCreatorProps) {
  const [front, setFront] = useState('')
  const [back, setBack] = useState('')
  const [cardType, setCardType] = useState<'basic' | 'cloze'>('basic')

  const canSubmit = front.trim().length > 0 && (cardType === 'cloze' || back.trim().length > 0)

  const handleSubmit = useCallback(() => {
    if (!canSubmit) return

    const noteId = `note-manual-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const note: FlashcardNote = {
      id: noteId,
      type: cardType,
      fields: { front: front.trim(), back: back.trim() },
      tags: [],
      sourceRef: { materialId: deck.courseId },
      createdAt: Date.now(),
      generatedBy: 'user',
    }

    const card = createFlashcard(noteId)
    const updatedDeck: FlashcardDeck = {
      ...deck,
      notes: [...deck.notes, note],
      cards: [...deck.cards, card],
    }

    saveDeck(updatedDeck)
    setFront('')
    setBack('')
    onCreated()
  }, [front, back, cardType, canSubmit, deck, onCreated])

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: 'auto' }}
        exit={{ opacity: 0, height: 0 }}
        className="border border-border-warm bg-bg-card p-5 mb-4 overflow-hidden"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-heading text-base text-text-main">新建闪卡</h3>
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center text-text-muted hover:text-text-body transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {/* Card type selector */}
        <div className="flex gap-2 mb-4">
          {(['basic', 'cloze'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setCardType(t)}
              className={`px-3 py-1.5 text-xs rounded-sm border transition-colors ${
                cardType === t
                  ? 'border-red-primary text-red-primary bg-red-primary/5'
                  : 'border-border-warm text-text-muted hover:border-red-primary/30'
              }`}
            >
              {t === 'basic' ? '基础问答' : '填空题'}
            </button>
          ))}
        </div>

        {/* Front */}
        <div className="mb-3">
          <label className="text-[11px] text-text-muted uppercase tracking-wider mb-1 block">
            {cardType === 'cloze' ? '内容（用 {{c1::答案}} 标记填空）' : '正面（问题）'}
          </label>
          <textarea
            value={front}
            onChange={(e) => setFront(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 text-sm bg-bg-main border border-border-warm rounded-sm
                       text-text-body placeholder:text-text-muted/60 outline-none
                       focus:border-red-primary transition-colors resize-none"
            placeholder={cardType === 'cloze' ? '薛定谔方程：iℏ∂ψ/∂t = {{c1::Ĥψ}}' : '波函数的物理意义是什么？'}
          />
        </div>

        {/* Back (hidden for cloze) */}
        {cardType === 'basic' && (
          <div className="mb-4">
            <label className="text-[11px] text-text-muted uppercase tracking-wider mb-1 block">
              背面（答案）
            </label>
            <textarea
              value={back}
              onChange={(e) => setBack(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 text-sm bg-bg-main border border-border-warm rounded-sm
                         text-text-body placeholder:text-text-muted/60 outline-none
                         focus:border-red-primary transition-colors resize-none"
              placeholder="概率幅，其模的平方代表粒子在某位置出现的概率密度"
            />
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={`w-full py-2 text-sm font-body rounded-sm transition-colors ${
            canSubmit
              ? 'bg-red-primary text-white hover:bg-red-dark'
              : 'bg-border-warm text-text-muted cursor-not-allowed'
          }`}
        >
          添加卡片
        </button>
      </motion.div>
    </AnimatePresence>
  )
}
