/**
 * FlashcardCard — Editorial-styled flip card with Framer Motion.
 * Renders front/back based on card type (basic, cloze, reverse).
 * Page-turning animation with warm paper texture feel.
 */
import { useState } from 'react'
import { motion } from 'framer-motion'
import type { FlashcardNote, CardType } from '@/lib/fsrs'

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface FlashcardCardProps {
  note: FlashcardNote
  /** If true, start showing back side */
  flipped?: boolean
  /** Callback when card is flipped */
  onFlip?: (isFlipped: boolean) => void
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const typeLabel: Record<CardType, { text: string; symbol: string }> = {
  basic: { text: '基础', symbol: 'Q' },
  cloze: { text: '填空', symbol: 'C' },
  reverse: { text: '反向', symbol: 'R' },
  'image-occlusion': { text: '图片', symbol: 'I' },
}

/**
 * Render cloze text: replace {{c1::answer}} with blanks on front,
 * or with the revealed answer on back.
 */
function renderClozeText(text: string, showAnswer: boolean): string {
  return text.replace(/\{\{c\d+::(.+?)\}\}/g, (_match, answer: string) => {
    return showAnswer ? answer : '______'
  })
}

function formatSourceRef(note: FlashcardNote): string | null {
  const { moduleId, slidePage } = note.sourceRef
  const parts: string[] = []
  if (moduleId) parts.push(moduleId)
  if (slidePage) parts.push(`P.${slidePage}`)
  return parts.length > 0 ? parts.join(' \u00b7 ') : null
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function FlashcardCard({ note, flipped: controlledFlipped, onFlip }: FlashcardCardProps) {
  const [internalFlipped, setInternalFlipped] = useState(false)
  const isFlipped = controlledFlipped ?? internalFlipped

  function handleClick() {
    const next = !isFlipped
    if (controlledFlipped === undefined) {
      setInternalFlipped(next)
    }
    onFlip?.(next)
  }

  const sourceTag = formatSourceRef(note)
  const isCloze = note.type === 'cloze'

  const frontText = isCloze
    ? renderClozeText(note.fields.front, false)
    : note.fields.front

  const backText = isCloze
    ? renderClozeText(note.fields.front, true)
    : note.fields.back

  const badge = typeLabel[note.type]

  return (
    <div
      className="w-full max-w-lg mx-auto cursor-pointer select-none"
      style={{ perspective: 1200 }}
      onClick={handleClick}
    >
      <motion.div
        className="relative w-full"
        style={{ transformStyle: 'preserve-3d' }}
        animate={{ rotateY: isFlipped ? 180 : 0 }}
        transition={{ duration: 0.6, ease: [0.22, 0.1, 0.25, 1] }}
      >
        {/* Front face */}
        <div
          className="border border-border-warm bg-bg-card min-h-[280px] flex flex-col justify-between"
          style={{ backfaceVisibility: 'hidden' }}
        >
          {/* Top accent line */}
          <div className="h-[3px] bg-red-primary" />

          <div className="px-8 pt-6 pb-2 flex-1 flex flex-col">
            {/* Header: type label + source */}
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center justify-center w-6 h-6 text-[10px] font-heading text-red-primary border border-red-primary/20 bg-bg-accent">
                  {badge.symbol}
                </span>
                <span className="text-xs font-body tracking-wide uppercase text-text-muted">
                  {badge.text}
                </span>
              </div>
              {sourceTag && (
                <span className="text-[11px] text-text-muted font-mono tracking-tight">
                  {sourceTag}
                </span>
              )}
            </div>

            {/* Question */}
            <div className="flex-1 flex items-center">
              <p className="font-heading text-xl text-text-main leading-relaxed whitespace-pre-wrap">
                {frontText}
              </p>
            </div>
          </div>

          {/* Footer */}
          <div className="px-8 py-4 border-t border-border-warm">
            <p className="text-[11px] text-text-muted text-center tracking-wide">
              点击翻转查看答案
            </p>
          </div>
        </div>

        {/* Back face */}
        <div
          className="border border-border-warm bg-bg-card min-h-[280px] flex flex-col justify-between absolute inset-0"
          style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
        >
          {/* Top accent line — gold for answer side */}
          <div className="h-[3px] bg-accent-gold" />

          <div className="px-8 pt-6 pb-2 flex-1 flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-3">
                <span className="text-xs font-heading tracking-wide text-accent-gold italic">
                  Answer
                </span>
                <span className="text-[10px] text-text-muted">
                  {badge.text}
                </span>
              </div>
            </div>

            {/* Answer content */}
            <div className="flex-1 flex flex-col justify-center">
              <div className="border-l-3 border-l-accent-gold pl-5">
                <p className="text-lg text-text-body leading-relaxed whitespace-pre-wrap">
                  {backText}
                </p>
              </div>
              {note.fields.extra && (
                <p className="text-sm text-text-muted mt-6 pt-4 border-t border-border-warm leading-relaxed">
                  {note.fields.extra}
                </p>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="px-8 py-4 border-t border-border-warm">
            <p className="text-[11px] text-text-muted text-center tracking-wide">
              点击翻回正面
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
