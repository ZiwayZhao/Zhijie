/**
 * FlashcardCard — 3D flip card with Framer Motion.
 * Renders front/back based on card type (basic, cloze, reverse).
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

const typeBadgeLabel: Record<CardType, string> = {
  basic: '基础',
  cloze: '填空',
  reverse: '反向',
  'image-occlusion': '图片遮挡',
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
  return parts.length > 0 ? parts.join(' · ') : null
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

  return (
    <div
      className="w-full max-w-lg mx-auto cursor-pointer select-none"
      style={{ perspective: 1000 }}
      onClick={handleClick}
    >
      <motion.div
        className="relative w-full"
        style={{ transformStyle: 'preserve-3d' }}
        animate={{ rotateY: isFlipped ? 180 : 0 }}
        transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
      >
        {/* Front face */}
        <div
          className="border border-border-warm bg-bg-card rounded-lg p-8 min-h-[260px] flex flex-col justify-between"
          style={{ backfaceVisibility: 'hidden' }}
        >
          <div>
            <div className="flex items-center gap-2 mb-6">
              <span className="text-xs font-body px-2 py-0.5 rounded border border-border-warm text-text-muted">
                {typeBadgeLabel[note.type]}
              </span>
              {sourceTag && (
                <span className="text-xs text-text-muted">{sourceTag}</span>
              )}
            </div>
            <p className="font-heading text-xl text-text-main leading-relaxed whitespace-pre-wrap">
              {frontText}
            </p>
          </div>
          <p className="text-xs text-text-muted mt-6 text-center">
            点击翻转查看答案
          </p>
        </div>

        {/* Back face */}
        <div
          className="border border-border-warm bg-bg-card rounded-lg p-8 min-h-[260px] flex flex-col justify-between absolute inset-0"
          style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
        >
          <div>
            <div className="flex items-center gap-2 mb-6">
              <span className="text-xs font-body px-2 py-0.5 rounded border border-red-primary/30 text-red-primary">
                答案
              </span>
              <span className="text-xs font-body px-2 py-0.5 rounded border border-border-warm text-text-muted">
                {typeBadgeLabel[note.type]}
              </span>
            </div>
            <p className="text-lg text-text-body leading-relaxed whitespace-pre-wrap">
              {backText}
            </p>
            {note.fields.extra && (
              <p className="text-sm text-text-muted mt-4 border-t border-border-warm pt-3">
                {note.fields.extra}
              </p>
            )}
          </div>
          <p className="text-xs text-text-muted mt-6 text-center">
            点击翻回正面
          </p>
        </div>
      </motion.div>
    </div>
  )
}
