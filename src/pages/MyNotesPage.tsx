/**
 * MyNotesPage — /my/notes
 * Displays saved PDF annotations/highlights grouped by material.
 */
import { useEffect, useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { motion, type Variants } from 'framer-motion'
import { PenLine, FileText, BookOpen } from 'lucide-react'

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.05, duration: 0.35, ease: 'easeOut' },
  }),
}

interface HighlightContent {
  text: string
  emoji?: string
}

interface HighlightPosition {
  boundingRect: { x1: number; y1: number; x2: number; y2: number; width: number; height: number; pageNumber: number }
  rects: Array<{ x1: number; y1: number; x2: number; y2: number; width: number; height: number; pageNumber: number }>
  pageNumber: number
}

interface SavedHighlight {
  id: string
  content: HighlightContent
  position: HighlightPosition
  comment?: { text: string; emoji?: string }
}

interface MaterialNotes {
  materialId: string
  materialName: string
  highlights: SavedHighlight[]
}

/** Load all highlights from localStorage keys matching zhijie_highlights_* */
function loadAllHighlights(): MaterialNotes[] {
  const results: MaterialNotes[] = []

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key || !key.startsWith('zhijie_highlights_')) continue

    try {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const highlights: SavedHighlight[] = JSON.parse(raw)
      if (!Array.isArray(highlights) || highlights.length === 0) continue

      const materialId = key.replace('zhijie_highlights_', '')
      results.push({
        materialId,
        materialName: formatMaterialName(materialId),
        highlights,
      })
    } catch {
      // Skip corrupted data
    }
  }

  return results
}

/** Convert materialId to a readable name */
function formatMaterialName(id: string): string {
  return id
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function HighlightCard({ highlight, index }: { highlight: SavedHighlight; index: number }) {
  const displayText = highlight.content.text || highlight.comment?.text || '(区域标注)'
  const pageNum = highlight.position?.pageNumber

  return (
    <motion.div
      variants={fadeUp}
      custom={index}
      initial="hidden"
      animate="visible"
      className="border-l-3 border-l-red-primary pl-4 py-3"
    >
      <p className="text-sm text-text-body leading-relaxed">
        {displayText}
      </p>
      <div className="flex items-center gap-3 mt-2">
        {pageNum && (
          <span className="text-xs text-text-muted">
            第 {pageNum} 页
          </span>
        )}
        {highlight.comment?.text && highlight.content.text && (
          <span className="text-xs text-accent-gold">
            批注: {highlight.comment.text}
          </span>
        )}
      </div>
    </motion.div>
  )
}

function MaterialGroup({ group, groupIndex }: { group: MaterialNotes; groupIndex: number }) {
  return (
    <motion.div
      variants={fadeUp}
      custom={groupIndex + 2}
      initial="hidden"
      animate="visible"
      className="border border-border-warm rounded-md bg-bg-card overflow-hidden"
    >
      {/* Material header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-border-warm bg-bg-accent/40">
        <div className="w-8 h-8 rounded-full bg-bg-accent flex items-center justify-center shrink-0">
          <FileText size={14} strokeWidth={1.5} className="text-red-primary" />
        </div>
        <div className="min-w-0">
          <h3 className="font-heading text-base text-text-main truncate">
            {group.materialName}
          </h3>
          <p className="text-xs text-text-muted">
            {group.highlights.length} 条标注
          </p>
        </div>
      </div>

      {/* Highlights */}
      <div className="px-5 py-3 space-y-1 divide-y divide-border-warm">
        {group.highlights.map((h, i) => (
          <HighlightCard key={h.id} highlight={h} index={i} />
        ))}
      </div>
    </motion.div>
  )
}

function EmptyState() {
  return (
    <motion.div
      variants={fadeUp}
      custom={2}
      initial="hidden"
      animate="visible"
      className="border border-border-warm rounded-md bg-bg-card p-12 text-center"
    >
      <div className="w-16 h-16 rounded-full bg-bg-accent flex items-center justify-center mx-auto mb-4">
        <PenLine size={28} strokeWidth={1.2} className="text-text-muted" />
      </div>
      <h3 className="font-heading text-lg text-text-main mb-2">
        还没有笔记
      </h3>
      <p className="text-sm text-text-muted mb-6 max-w-xs mx-auto">
        在阅读材料时选中文本或使用 Alt+拖拽 来标注重点内容
      </p>
      <Link
        to="/my/materials"
        className="inline-flex items-center gap-2 px-5 py-2.5 text-sm
                   bg-red-primary text-white rounded-md hover:bg-red-dark
                   transition-colors no-underline"
      >
        <BookOpen size={15} strokeWidth={1.5} />
        浏览我的材料
      </Link>
    </motion.div>
  )
}

export default function MyNotesPage() {
  const [materialNotes, setMaterialNotes] = useState<MaterialNotes[]>([])

  useEffect(() => {
    setMaterialNotes(loadAllHighlights())
  }, [])

  const totalNotes = useMemo(
    () => materialNotes.reduce((sum, m) => sum + m.highlights.length, 0),
    [materialNotes],
  )

  return (
    <div className="p-8 max-w-3xl mx-auto">
      {/* Editorial header */}
      <motion.div variants={fadeUp} custom={0} initial="hidden" animate="visible">
        <div className="border-l-3 border-l-red-primary pl-4 mb-8">
          <h1 className="font-heading text-3xl text-text-main">我的笔记</h1>
          <p className="text-text-muted mt-1">
            {totalNotes > 0
              ? `${materialNotes.length} 份材料 · ${totalNotes} 条标注`
              : '学习笔记汇总'}
          </p>
        </div>
      </motion.div>

      {materialNotes.length > 0 ? (
        <div className="space-y-4">
          {materialNotes.map((group, i) => (
            <MaterialGroup key={group.materialId} group={group} groupIndex={i} />
          ))}
        </div>
      ) : (
        <EmptyState />
      )}
    </div>
  )
}
