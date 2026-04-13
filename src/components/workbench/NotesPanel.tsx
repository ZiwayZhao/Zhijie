/**
 * NotesPanel — Unified notes view for the workbench sidebar.
 * Aggregates: PDF highlights, manual notes.
 * Supports: creating manual notes, inline annotation notes, exporting as Markdown,
 *           clicking highlights to jump to PDF, deleting highlights, color filtering,
 *           AI explain (via tutor sidebar), inline flashcard creation.
 * Communicates with PdfAnnotator via CustomEvents (no polling).
 */

import { useState, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, Download, Highlighter, PenLine,
  ChevronDown, ChevronRight,
} from 'lucide-react'
import { STORAGE_KEYS } from '@/lib/storage-keys'
import {
  onHighlightCreated,
  onHighlightDeleted,
  dispatchHighlightDeleted,
  dispatchHighlightScrollTo,
} from '@/lib/highlight-events'
import HighlightCard from './HighlightCard'
import ManualNoteCard from './ManualNoteCard'

/* ── Exported types (shared with extracted components) ── */

export interface HighlightNote {
  type: 'highlight'
  id: string
  text: string
  color: string
  comment: string
  page?: number
  createdAt: number
}

export interface ManualNote {
  type: 'manual'
  id: string
  title: string
  content: string
  createdAt: number
}

interface NotesPanelProps {
  materialId: string
  materialTitle: string
  courseId?: string
  courseName?: string
  /** Called when user clicks AI explain — parent should switch to tutor tab and send message */
  onAIExplain?: (text: string) => void
}

/* ── Storage helpers ──────────────────────────── */

function loadManualNotes(materialId: string): ManualNote[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.NOTES(materialId))
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function saveManualNotes(materialId: string, notes: ManualNote[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.NOTES(materialId), JSON.stringify(notes))
  } catch { /* quota */ }
}

/** Convert PdfAnnotator highlight format → display format (NO truncation) */
function convertHighlight(h: Record<string, unknown>): HighlightNote | null {
  const text = (h.content as Record<string, string>)?.text || (h.text as string) || ''
  if (!text.trim()) return null
  return {
    type: 'highlight',
    id: (h.id as string) || crypto.randomUUID(),
    text,
    color: (h.color as string) || '#FBDA83',
    comment: (h.comment as Record<string, string>)?.text || (h.comment as string) || '',
    page: (h.position as Record<string, number>)?.pageNumber || undefined,
    createdAt: (h.createdAt as number) || Date.now(),
  }
}

function loadHighlights(materialId: string): HighlightNote[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.HIGHLIGHTS(materialId))
    if (!raw) return []
    const highlights = JSON.parse(raw)
    return (Array.isArray(highlights) ? highlights : [])
      .map(convertHighlight)
      .filter((h): h is HighlightNote => h !== null)
  } catch { return [] }
}

/** Save an inline note (comment) back to the highlight in localStorage */
function saveHighlightComment(materialId: string, highlightId: string, comment: string) {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.HIGHLIGHTS(materialId))
    if (!raw) return
    const all = JSON.parse(raw) as Array<Record<string, unknown>>
    const target = all.find((h) => h.id === highlightId)
    if (target) {
      if (typeof target.comment === 'object' && target.comment !== null) {
        ;(target.comment as Record<string, string>).text = comment
      } else {
        target.comment = comment
      }
      localStorage.setItem(STORAGE_KEYS.HIGHLIGHTS(materialId), JSON.stringify(all))
    }
  } catch { /* ignore */ }
}

/* ── Component ────────────────────────────────── */

export default function NotesPanel({
  materialId,
  materialTitle,
  courseId,
  courseName,
  onAIExplain,
}: NotesPanelProps) {
  const [manualNotes, setManualNotes] = useState<ManualNote[]>(() => loadManualNotes(materialId))
  const [highlights, setHighlights] = useState<HighlightNote[]>(() => loadHighlights(materialId))
  const [isAdding, setIsAdding] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newContent, setNewContent] = useState('')
  const [colorFilter, setColorFilter] = useState<string | null>(null)
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    highlights: true,
    manual: true,
  })

  // Listen for highlight created events from PdfAnnotator
  useEffect(() => {
    return onHighlightCreated(({ materialId: mid, highlight }) => {
      if (mid !== materialId) return
      const converted = convertHighlight(highlight as unknown as Record<string, unknown>)
      if (converted) {
        setHighlights((prev) => [converted, ...prev])
      }
    })
  }, [materialId])

  // Listen for highlight deleted events (from PdfAnnotator's own delete)
  useEffect(() => {
    return onHighlightDeleted(({ materialId: mid, highlightId }) => {
      if (mid !== materialId) return
      setHighlights((prev) => prev.filter((h) => h.id !== highlightId))
    })
  }, [materialId])

  // Persist manual notes on change
  useEffect(() => {
    saveManualNotes(materialId, manualNotes)
  }, [materialId, manualNotes])

  const handleAddNote = useCallback(() => {
    if (!newContent.trim()) return
    const note: ManualNote = {
      type: 'manual',
      id: crypto.randomUUID(),
      title: newTitle.trim() || '未命名笔记',
      content: newContent.trim(),
      createdAt: Date.now(),
    }
    setManualNotes((prev) => [note, ...prev])
    setNewTitle('')
    setNewContent('')
    setIsAdding(false)
  }, [newTitle, newContent])

  const handleDeleteNote = useCallback((id: string) => {
    setManualNotes((prev) => prev.filter((n) => n.id !== id))
  }, [])

  const handleDeleteHighlight = useCallback((highlightId: string) => {
    setHighlights((prev) => prev.filter((h) => h.id !== highlightId))
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.HIGHLIGHTS(materialId))
      if (raw) {
        const all = JSON.parse(raw) as Array<{ id: string }>
        const filtered = all.filter((h) => h.id !== highlightId)
        localStorage.setItem(STORAGE_KEYS.HIGHLIGHTS(materialId), JSON.stringify(filtered))
      }
    } catch { /* ignore */ }
    dispatchHighlightDeleted(materialId, highlightId)
  }, [materialId])

  const handleUpdateComment = useCallback((highlightId: string, comment: string) => {
    setHighlights((prev) =>
      prev.map((h) => (h.id === highlightId ? { ...h, comment } : h)),
    )
    saveHighlightComment(materialId, highlightId, comment)
  }, [materialId])

  const handleScrollToHighlight = useCallback((highlightId: string) => {
    dispatchHighlightScrollTo(materialId, highlightId)
  }, [materialId])

  const toggleSection = useCallback((section: string) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }))
  }, [])

  const totalCount = highlights.length + manualNotes.length

  const filteredHighlights = colorFilter
    ? highlights.filter((h) => h.color === colorFilter)
    : highlights

  const usedColors = [...new Set(highlights.map((h) => h.color))]

  // Export as Markdown
  const handleExport = useCallback(() => {
    let md = `# ${materialTitle} — 学习笔记\n\n`
    md += `> 导出时间: ${new Date().toLocaleString()}\n\n`

    if (highlights.length > 0) {
      md += `## PDF 批注 (${highlights.length})\n\n`
      highlights.forEach((h) => {
        md += `- **${h.page ? `第 ${h.page} 页` : ''}** "${h.text}"\n`
        if (h.comment) md += `  - ${h.comment}\n`
      })
      md += '\n'
    }

    if (manualNotes.length > 0) {
      md += `## 笔记 (${manualNotes.length})\n\n`
      manualNotes.forEach((n) => {
        md += `### ${n.title}\n\n${n.content}\n\n`
      })
    }

    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${materialTitle}-notes.md`
    a.click()
    URL.revokeObjectURL(url)
  }, [materialTitle, highlights, manualNotes])

  return (
    <div className="space-y-3">
      {/* Action bar */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-text-muted">
          {totalCount > 0 ? `${totalCount} 条笔记` : '暂无笔记'}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-1 px-2 py-1 text-[11px] text-text-muted hover:text-red-primary transition-colors rounded-sm hover:bg-bg-accent/60"
            title="新建笔记"
          >
            <Plus size={12} strokeWidth={1.5} />
            新建
          </button>
          {totalCount > 0 && (
            <button
              onClick={handleExport}
              className="flex items-center gap-1 px-2 py-1 text-[11px] text-text-muted hover:text-red-primary transition-colors rounded-sm hover:bg-bg-accent/60"
              title="导出为 Markdown"
            >
              <Download size={12} strokeWidth={1.5} />
              导出
            </button>
          )}
        </div>
      </div>

      {/* Add note form */}
      <AnimatePresence>
        {isAdding && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="border border-red-primary/30 rounded-sm p-3 bg-bg-accent/30 space-y-2"
          >
            <input
              type="text"
              placeholder="标题（可选）"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className="w-full px-2.5 py-1.5 text-sm bg-bg-main border border-border-warm rounded-sm
                         focus:border-red-primary focus:outline-none text-text-body placeholder:text-text-muted/50"
            />
            <textarea
              placeholder="写下你的笔记..."
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              rows={3}
              autoFocus
              className="w-full px-2.5 py-1.5 text-sm bg-bg-main border border-border-warm rounded-sm
                         focus:border-red-primary focus:outline-none text-text-body placeholder:text-text-muted/50
                         resize-none"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setIsAdding(false); setNewTitle(''); setNewContent('') }}
                className="px-3 py-1 text-xs text-text-muted hover:text-text-body transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleAddNote}
                disabled={!newContent.trim()}
                className="px-3 py-1 text-xs bg-red-primary text-white rounded-sm
                           hover:bg-red-dark transition-colors disabled:opacity-40"
              >
                保存
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Empty state */}
      {totalCount === 0 && !isAdding && (
        <div className="py-8 text-center">
          <p className="text-xs text-text-muted/70 leading-relaxed">
            在 PDF 中选中文字添加批注<br />或点击「新建」创建笔记
          </p>
        </div>
      )}

      {/* Highlights section */}
      {highlights.length > 0 && (
        <div>
          <button
            onClick={() => toggleSection('highlights')}
            className="flex items-center gap-1.5 w-full text-left py-1.5 text-[11px] font-medium text-text-muted
                       hover:text-text-body transition-colors uppercase tracking-wider"
          >
            {expandedSections.highlights ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            <Highlighter size={10} strokeWidth={1.5} />
            PDF 批注 ({highlights.length})
          </button>

          <AnimatePresence>
            {expandedSections.highlights && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
              >
                {/* Color filter bar */}
                {usedColors.length > 1 && (
                  <div className="flex items-center gap-1 mb-2 px-0.5">
                    <button
                      onClick={() => setColorFilter(null)}
                      className={`text-[10px] px-1.5 py-0.5 rounded-sm transition-colors ${
                        colorFilter === null
                          ? 'bg-bg-accent text-text-body'
                          : 'text-text-muted hover:text-text-body'
                      }`}
                    >
                      全部
                    </button>
                    {usedColors.map((c) => (
                      <button
                        key={c}
                        onClick={() => setColorFilter(colorFilter === c ? null : c)}
                        className={`w-4 h-4 rounded-full border-2 transition-all ${
                          colorFilter === c ? 'scale-110' : 'scale-100 opacity-60 hover:opacity-100'
                        }`}
                        style={{
                          backgroundColor: c,
                          borderColor: colorFilter === c ? '#1A1A1A' : 'transparent',
                        }}
                        title={`筛选此颜色 (${highlights.filter((h) => h.color === c).length})`}
                      />
                    ))}
                    {colorFilter && (
                      <span className="text-[10px] text-text-muted ml-1">
                        {filteredHighlights.length}/{highlights.length}
                      </span>
                    )}
                  </div>
                )}

                {/* Highlight cards */}
                <div className="space-y-1 mt-1">
                  {filteredHighlights.map((h) => (
                    <HighlightCard
                      key={h.id}
                      highlight={h}
                      materialId={materialId}
                      courseId={courseId}
                      courseName={courseName}
                      onScrollTo={() => handleScrollToHighlight(h.id)}
                      onDelete={() => handleDeleteHighlight(h.id)}
                      onUpdateComment={(comment) => handleUpdateComment(h.id, comment)}
                      onAIExplain={onAIExplain}
                    />
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Manual notes section */}
      {manualNotes.length > 0 && (
        <div>
          <button
            onClick={() => toggleSection('manual')}
            className="flex items-center gap-1.5 w-full text-left py-1.5 text-[11px] font-medium text-text-muted
                       hover:text-text-body transition-colors uppercase tracking-wider"
          >
            {expandedSections.manual ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            <PenLine size={10} strokeWidth={1.5} />
            笔记 ({manualNotes.length})
          </button>
          <AnimatePresence>
            {expandedSections.manual && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-1.5 mt-1"
              >
                {manualNotes.map((note) => (
                  <ManualNoteCard
                    key={note.id}
                    note={note}
                    onDelete={() => handleDeleteNote(note.id)}
                  />
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}
