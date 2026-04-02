import { useRef, useEffect } from 'react'
import { motion } from 'framer-motion'
import { FileText, ChevronLeft, ChevronRight } from 'lucide-react'
import { extractChapterNumber } from '@/lib/folder-classifier'
import type { MaterialItem } from '@/lib/api'

interface MaterialTabBarProps {
  materials: MaterialItem[]
  activeId: string
  onSelect: (id: string) => void
}

/** Extract a short display label from a material title/filename. */
function getTabLabel(m: MaterialItem): string {
  const name = m.title || m.filename
  // Try to extract "Ch.N" or "L0N" pattern
  const chMatch = name.match(/\b(?:Ch\.?\s*|Chapter\s*|L)(\d+)/i)
  if (chMatch) return `Ch.${parseInt(chMatch[1], 10)}`
  // Fallback: first 12 chars
  return name.replace(/\.[^.]+$/, '').slice(0, 12)
}

export default function MaterialTabBar({ materials, activeId, onSelect }: MaterialTabBarProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLButtonElement>(null)

  // Sort by chapter number
  const sorted = [...materials].sort((a, b) => {
    const numA = extractChapterNumber(a.filename || a.title)
    const numB = extractChapterNumber(b.filename || b.title)
    return numA - numB
  })

  // Scroll active tab into view on change
  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [activeId])

  function scroll(dir: 'left' | 'right') {
    scrollRef.current?.scrollBy({ left: dir === 'left' ? -200 : 200, behavior: 'smooth' })
  }

  if (sorted.length === 0) return null

  return (
    <div className="relative flex items-center border-b border-border-warm bg-bg-card">
      {/* Left scroll arrow */}
      <button
        onClick={() => scroll('left')}
        className="shrink-0 px-1.5 py-2 text-text-muted hover:text-red-primary transition-colors hidden sm:block"
        aria-label="Scroll left"
      >
        <ChevronLeft size={14} strokeWidth={1.5} />
      </button>

      {/* Scrollable tab container */}
      <div
        ref={scrollRef}
        className="flex-1 flex items-end gap-0 overflow-x-auto scrollbar-hide"
      >
        {sorted.map((m) => {
          const isActive = m.id === activeId
          const label = getTabLabel(m)
          return (
            <button
              key={m.id}
              ref={isActive ? activeRef : undefined}
              onClick={() => onSelect(m.id)}
              title={m.title || m.filename}
              className={[
                'relative shrink-0 flex items-center gap-1.5 px-4 py-2.5 text-sm transition-colors whitespace-nowrap',
                isActive
                  ? 'text-red-primary font-medium'
                  : 'text-text-muted hover:text-text-main',
              ].join(' ')}
            >
              <FileText size={13} strokeWidth={1.5} />
              <span className="font-body">{label}</span>

              {/* Active indicator — red underline */}
              {isActive && (
                <motion.div
                  layoutId="study-tab-indicator"
                  className="absolute bottom-0 left-2 right-2 h-[2px] bg-red-primary"
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
            </button>
          )
        })}
      </div>

      {/* Right scroll arrow */}
      <button
        onClick={() => scroll('right')}
        className="shrink-0 px-1.5 py-2 text-text-muted hover:text-red-primary transition-colors hidden sm:block"
        aria-label="Scroll right"
      >
        <ChevronRight size={14} strokeWidth={1.5} />
      </button>
    </div>
  )
}
