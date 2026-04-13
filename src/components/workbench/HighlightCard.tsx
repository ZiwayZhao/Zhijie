/**
 * HighlightCard — Display card for a single PDF highlight with actions.
 * Extracted from NotesPanel.tsx.
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Trash2, ExternalLink, Sparkles, CreditCard,
  MessageSquare, Check, X,
} from 'lucide-react'
import InlineFlashcardCreator from './InlineFlashcardCreator'
import type { HighlightNote } from './NotesPanel'

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
          title="保存 (Cmd+Enter)"
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

/* ── HighlightCard props ── */

export interface HighlightCardProps {
  highlight: HighlightNote
  materialId: string
  courseId?: string
  courseName?: string
  onScrollTo: () => void
  onDelete: () => void
  onUpdateComment: (comment: string) => void
  onAIExplain?: (text: string) => void
}

/* ── HighlightCard component ── */

export default function HighlightCard({
  highlight,
  materialId,
  courseId,
  courseName,
  onScrollTo,
  onDelete,
  onUpdateComment,
  onAIExplain,
}: HighlightCardProps) {
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

      {/* Full highlight text */}
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
