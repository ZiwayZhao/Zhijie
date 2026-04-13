/**
 * InlineFlashcardCreator — Inline flashcard creation from a highlight.
 * Extracted from NotesPanel.tsx.
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { CreditCard } from 'lucide-react'
import {
  loadDeck, saveDeck,
  createFlashcard,
  type FlashcardNote, type FlashcardDeck,
} from '@/lib/fsrs'
import type { HighlightNote } from './NotesPanel'

export interface InlineFlashcardCreatorProps {
  highlight: HighlightNote
  materialId: string
  courseId?: string
  courseName?: string
  onSaved: (msg: string) => void
  onCancel: () => void
}

export default function InlineFlashcardCreator({
  highlight,
  materialId,
  courseId,
  courseName,
  onSaved,
  onCancel,
}: InlineFlashcardCreatorProps) {
  const truncatedText = highlight.text.length > 40
    ? highlight.text.slice(0, 40) + '...'
    : highlight.text

  const [cardType, setCardType] = useState<'basic' | 'cloze'>('basic')
  const [front, setFront] = useState(`关于「${truncatedText}」的核心概念是什么？`)
  const [back, setBack] = useState(highlight.text)
  const frontRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    frontRef.current?.focus()
    frontRef.current?.select()
  }, [])

  // When switching to cloze, transform the back into cloze format on front
  const handleTypeSwitch = useCallback((type: 'basic' | 'cloze') => {
    setCardType(type)
    if (type === 'cloze') {
      setFront(`{{c1::${highlight.text}}}`)
      setBack('')
    } else {
      setFront(`关于「${truncatedText}」的核心概念是什么？`)
      setBack(highlight.text)
    }
  }, [highlight.text, truncatedText])

  const handleSave = useCallback(() => {
    if (!front.trim()) return

    const deckCourseId = courseId || 'default'
    const note: FlashcardNote = {
      id: crypto.randomUUID(),
      type: cardType,
      fields: {
        front: front.trim(),
        back: back.trim(),
        extra: highlight.comment || undefined,
      },
      tags: [courseName || deckCourseId].filter(Boolean),
      sourceRef: {
        materialId,
        slidePage: highlight.page,
      },
      createdAt: Date.now(),
      generatedBy: 'user',
    }

    // Load or create deck
    let deck = loadDeck(deckCourseId)
    if (!deck) {
      deck = {
        courseId: deckCourseId,
        courseName: courseName || deckCourseId,
        notes: [],
        cards: [],
        reviewLogs: [],
      } satisfies FlashcardDeck
    }

    // Add note + card
    deck.notes.push(note)
    deck.cards.push(createFlashcard(note.id))
    saveDeck(deck)

    onSaved(`已添加到「${deck.courseName}」闪卡组`)
  }, [front, back, cardType, highlight, materialId, courseId, courseName, onSaved])

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className="mt-2 border border-accent-gold/40 rounded-sm bg-bg-accent/30 p-2.5 space-y-2"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium text-accent-gold flex items-center gap-1">
          <CreditCard size={10} />
          创建闪卡
        </span>
        {/* Type toggle */}
        <div className="flex gap-0 border border-border-warm rounded-sm overflow-hidden">
          <button
            onClick={() => handleTypeSwitch('basic')}
            className={`px-2 py-0.5 text-[10px] transition-colors ${
              cardType === 'basic'
                ? 'bg-accent-gold/20 text-accent-gold font-medium'
                : 'text-text-muted hover:text-text-body'
            }`}
          >
            问答
          </button>
          <button
            onClick={() => handleTypeSwitch('cloze')}
            className={`px-2 py-0.5 text-[10px] transition-colors ${
              cardType === 'cloze'
                ? 'bg-accent-gold/20 text-accent-gold font-medium'
                : 'text-text-muted hover:text-text-body'
            }`}
          >
            填空
          </button>
        </div>
      </div>

      {/* Front */}
      <div>
        <label className="text-[10px] text-text-muted mb-0.5 block">
          {cardType === 'basic' ? '正面（问题）' : '正面（含 {{c1::填空}}）'}
        </label>
        <textarea
          ref={frontRef}
          value={front}
          onChange={(e) => setFront(e.target.value)}
          rows={2}
          className="w-full px-2 py-1.5 text-[11px] bg-bg-main border border-border-warm rounded-sm
                     focus:border-accent-gold focus:outline-none text-text-body
                     placeholder:text-text-muted/50 resize-none leading-relaxed"
          placeholder={cardType === 'basic' ? '输入问题...' : '用 {{c1::}} 包裹要填空的部分'}
        />
      </div>

      {/* Back (only for basic) */}
      {cardType === 'basic' && (
        <div>
          <label className="text-[10px] text-text-muted mb-0.5 block">背面（答案）</label>
          <textarea
            value={back}
            onChange={(e) => setBack(e.target.value)}
            rows={2}
            className="w-full px-2 py-1.5 text-[11px] bg-bg-main border border-border-warm rounded-sm
                       focus:border-accent-gold focus:outline-none text-text-body
                       placeholder:text-text-muted/50 resize-none leading-relaxed"
            placeholder="输入答案..."
          />
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-2.5 py-1 text-[10px] text-text-muted hover:text-text-body transition-colors"
        >
          取消
        </button>
        <button
          onClick={handleSave}
          disabled={!front.trim()}
          className="px-2.5 py-1 text-[10px] bg-accent-gold text-white rounded-sm
                     hover:bg-accent-gold/80 transition-colors disabled:opacity-40"
        >
          保存闪卡
        </button>
      </div>
    </motion.div>
  )
}
