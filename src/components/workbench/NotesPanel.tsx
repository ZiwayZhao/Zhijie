/**
 * NotesPanel — Unified notes view for the workbench sidebar.
 * Aggregates: PDF highlights, manual notes.
 * Supports: creating manual notes, inline annotation notes, exporting as Markdown,
 *           clicking highlights to jump to PDF, deleting highlights, color filtering,
 *           AI explain (via tutor sidebar), inline flashcard creation.
 * Communicates with PdfAnnotator via CustomEvents (no polling).
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, Download, Trash2, Highlighter, PenLine,
  ChevronDown, ChevronRight, ExternalLink,
  Sparkles, CreditCard, MessageSquare, Check, X,
} from 'lucide-react'
import { STORAGE_KEYS } from '@/lib/storage-keys'
import {
  onHighlightCreated,
  onHighlightDeleted,
  dispatchHighlightDeleted,
  dispatchHighlightScrollTo,
} from '@/lib/highlight-events'
import {
  loadDeck, saveDeck,
  createFlashcard,
  type FlashcardNote, type FlashcardDeck,
} from '@/lib/fsrs'

/* ── Types ─────────────────────────────────────── */

interface HighlightNote {
  type: 'highlight'
  id: string
  text: string
  color: string
  comment: string
  page?: number
  createdAt: number
}

interface ManualNote {
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

/* ── Inline note editor ── */

function InlineNoteEditor({
  initialValue,
  onSave,
  onCancel,
}: {
  initialValue: string
  onSave: (value: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initialValue)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <div className="mt-1.5 space-y-1">
      <textarea
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="写下你的想法..."
        rows={2}
        className="w-full px-2 py-1.5 text-[11px] bg-bg-main border border-border-warm rounded-sm
                   focus:border-red-primary focus:outline-none text-text-body placeholder:text-text-muted/50
                   resize-none leading-relaxed"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            onSave(value.trim())
          }
          if (e.key === 'Escape') onCancel()
        }}
      />
      <div className="flex justify-end gap-1">
        <button
          onClick={onCancel}
          className="p-1 text-text-muted hover:text-text-body transition-colors"
          title="取消"
        >
          <X size={11} />
        </button>
        <button
          onClick={() => onSave(value.trim())}
          className="p-1 text-red-primary hover:text-red-dark transition-colors"
          title="保存 (⌘+Enter)"
        >
          <Check size={11} />
        </button>
      </div>
    </div>
  )
}

/* ── Tiny toast for action feedback ── */

function ActionToast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2000)
    return () => clearTimeout(t)
  }, [onDone])

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="absolute bottom-full left-0 right-0 mb-1 z-10"
    >
      <div className="bg-text-main text-white text-[10px] px-2.5 py-1.5 rounded-sm shadow-sm text-center">
        {message}
      </div>
    </motion.div>
  )
}

/* ── Action button with label ── */

function ActionBtn({
  icon,
  label,
  onClick,
  variant = 'default',
}: {
  icon: React.ReactNode
  label: string
  onClick?: () => void
  variant?: 'default' | 'primary' | 'danger'
}) {
  const colorClass =
    variant === 'primary'
      ? 'text-red-primary hover:bg-red-primary/10'
      : variant === 'danger'
        ? 'text-text-muted hover:text-red-500 hover:bg-red-500/5'
        : 'text-text-muted hover:text-text-body hover:bg-bg-accent/60'

  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-0.5 px-1.5 py-1 text-[10px] rounded-sm transition-colors ${colorClass}`}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

/* ── Inline flashcard creator ── */

function InlineFlashcardCreator({
  highlight,
  materialId,
  courseId,
  courseName,
  onSaved,
  onCancel,
}: {
  highlight: HighlightNote
  materialId: string
  courseId?: string
  courseName?: string
  onSaved: (msg: string) => void
  onCancel: () => void
}) {
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
      // Put full text with cloze placeholder on front
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

/* ── Enhanced highlight card ── */

function HighlightCard({
  highlight,
  materialId,
  courseId,
  courseName,
  onScrollTo,
  onDelete,
  onUpdateComment,
  onAIExplain,
}: {
  highlight: HighlightNote
  materialId: string
  courseId?: string
  courseName?: string
  onScrollTo: () => void
  onDelete: () => void
  onUpdateComment: (comment: string) => void
  onAIExplain?: (text: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [showFlashcard, setShowFlashcard] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const handleAI = useCallback(() => {
    if (highlight.text.length < 5) {
      setToast('选中文本太短，请选择更完整的内容')
      return
    }
    if (onAIExplain) {
      onAIExplain(highlight.text)
    } else {
      setToast('AI 助教不可用')
    }
  }, [highlight.text, onAIExplain])

  return (
    <div
      className="relative border-l-[3px] pl-2.5 py-2 text-xs group cursor-pointer
                 hover:bg-bg-accent/40 rounded-r-sm transition-colors"
      style={{ borderColor: highlight.color || '#FBDA83' }}
      onClick={() => onScrollTo()}
    >
      {/* Toast feedback */}
      <AnimatePresence>
        {toast && <ActionToast message={toast} onDone={() => setToast(null)} />}
      </AnimatePresence>

      {/* Page number + color dot header */}
      <div className="flex items-center gap-1.5 mb-1">
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: highlight.color || '#FBDA83' }}
        />
        {highlight.page && (
          <span className="text-[10px] font-medium text-text-muted">
            第 {highlight.page} 页
          </span>
        )}
        <span className="text-[10px] text-text-muted/40 ml-auto">
          {new Date(highlight.createdAt).toLocaleDateString()}
        </span>
      </div>

      {/* Full highlight text — use line-clamp for display, expandable */}
      <p className="text-text-body leading-relaxed line-clamp-4 group-hover:line-clamp-none transition-all">
        {highlight.text}
      </p>

      {/* Inline note / comment */}
      {editing ? (
        <div onClick={(e) => e.stopPropagation()}>
          <InlineNoteEditor
            initialValue={highlight.comment}
            onSave={(val) => {
              onUpdateComment(val)
              setEditing(false)
            }}
            onCancel={() => setEditing(false)}
          />
        </div>
      ) : highlight.comment ? (
        <p
          className="text-text-muted mt-1 italic text-[11px] leading-relaxed
                     border-l border-border-warm pl-2 hover:border-red-primary/40 transition-colors"
          onClick={(e) => {
            e.stopPropagation()
            setEditing(true)
          }}
          title="点击编辑笔记"
        >
          {highlight.comment}
        </p>
      ) : (
        <button
          onClick={(e) => {
            e.stopPropagation()
            setEditing(true)
          }}
          className="mt-1 text-[10px] text-text-muted/40 hover:text-text-muted transition-colors
                     flex items-center gap-1"
        >
          <MessageSquare size={9} />
          添加笔记...
        </button>
      )}

      {/* Delete button — top-right on hover */}
      <button
        onClick={(e) => { e.stopPropagation(); onDelete() }}
        className="absolute top-2 right-1 opacity-0 group-hover:opacity-100 p-1
                   text-text-muted/40 hover:text-red-500 transition-all"
        title="删除批注"
      >
        <Trash2 size={11} />
      </button>

      {/* Action buttons — visible on hover, with text labels */}
      <div
        className="flex items-center gap-0.5 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={(e) => e.stopPropagation()}
      >
        <ActionBtn
          icon={<ExternalLink size={10} />}
          label="定位"
          variant="primary"
          onClick={() => onScrollTo()}
        />
        <ActionBtn
          icon={<MessageSquare size={10} />}
          label="笔记"
          onClick={() => setEditing(true)}
        />
        <ActionBtn
          icon={<Sparkles size={10} />}
          label="AI"
          onClick={handleAI}
        />
        <ActionBtn
          icon={<CreditCard size={10} />}
          label="闪卡"
          onClick={() => setShowFlashcard((v) => !v)}
        />
      </div>

      {/* Inline flashcard creator */}
      <AnimatePresence>
        {showFlashcard && (
          <InlineFlashcardCreator
            highlight={highlight}
            materialId={materialId}
            courseId={courseId}
            courseName={courseName}
            onSaved={(msg) => {
              setShowFlashcard(false)
              setToast(msg)
            }}
            onCancel={() => setShowFlashcard(false)}
          />
        )}
      </AnimatePresence>
    </div>
  )
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
                  <div
                    key={note.id}
                    className="border border-border-warm rounded-sm p-2.5 bg-bg-main group hover:border-red-primary/30 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="text-[11px] font-medium text-text-main">{note.title}</h4>
                      <button
                        onClick={() => handleDeleteNote(note.id)}
                        className="opacity-0 group-hover:opacity-100 p-0.5 text-text-muted hover:text-red-500 transition-all shrink-0"
                        title="删除"
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                    <p className="text-[11px] text-text-body mt-1 leading-relaxed whitespace-pre-wrap line-clamp-3">
                      {note.content}
                    </p>
                    <p className="text-[10px] text-text-muted/40 mt-1">
                      {new Date(note.createdAt).toLocaleString()}
                    </p>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}
