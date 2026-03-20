/**
 * TutorSidebar — main chat container for AI tutor.
 * Renders message history, streaming indicator, and input area.
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Send, Loader2, RotateCcw, BookOpen } from 'lucide-react'
import { useTutorSession } from '@/hooks/useTutorSession'
import type { TutorPhase } from '@/hooks/useTutorSession'
import TutorMessage from '@/components/tutor/TutorMessage'
import type { MCQuestion } from '@/lib/api-disassembly'

/* ---------- Phase status text ---------- */

const PHASE_STATUS: Partial<Record<TutorPhase, string>> = {
  connecting: '连接中...',
  planning: '思考中...',
  'tool-running': '查阅资料...',
  answering: '回答中...',
}

/* ---------- Props ---------- */

interface TutorSidebarProps {
  materialId: string
  moduleId?: string | null
  onSpecialistView?: (markdown: string, moduleName: string) => void
  onQuizView?: (questions: MCQuestion[]) => void
}

/* ---------- Component ---------- */

export default function TutorSidebar({
  materialId,
  moduleId,
  onSpecialistView,
  onQuizView,
}: TutorSidebarProps) {
  const { state, sendMessage, reset } = useTutorSession(materialId, moduleId)
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const isBusy = !['idle', 'completed', 'error'].includes(state.phase)
  const statusText = PHASE_STATUS[state.phase]

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [state.messages, state.streamingContent])

  // Auto-focus input
  useEffect(() => {
    if (!isBusy) inputRef.current?.focus()
  }, [isBusy])

  const handleSend = useCallback(() => {
    const trimmed = input.trim()
    if (!trimmed || isBusy) return
    sendMessage(trimmed)
    setInput('')
  }, [input, isBusy, sendMessage])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend],
  )

  // Tool result → MaterialReader callbacks
  const handleViewSpecialist = useCallback(
    (data: Record<string, unknown>) => {
      const markdown = data.markdown as string | undefined
      const moduleName = (data.module_name as string) ?? '精讲'
      if (markdown && onSpecialistView) {
        onSpecialistView(markdown, moduleName)
      }
    },
    [onSpecialistView],
  )

  const handleViewQuiz = useCallback(
    (data: Record<string, unknown>) => {
      const questions = data.questions as MCQuestion[] | undefined
      if (questions && onQuizView) {
        onQuizView(questions)
      }
    },
    [onQuizView],
  )

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 mb-3 border-b border-border-warm">
        <div className="flex items-center gap-2">
          <BookOpen size={16} strokeWidth={1.5} className="text-red-primary" />
          <h3 className="font-heading text-sm text-text-main">AI 学习助教</h3>
        </div>
        {state.messages.length > 0 && (
          <button
            onClick={reset}
            className="flex items-center gap-1 text-xs text-text-muted hover:text-red-primary transition-colors"
            title="清除对话"
          >
            <RotateCcw size={12} strokeWidth={1.5} />
            清除
          </button>
        )}
      </div>

      {/* Messages area (scrollable) */}
      <div className="flex-1 overflow-y-auto min-h-0 pr-1">
        {/* Empty state */}
        {state.messages.length === 0 && !isBusy && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-center py-12 px-4"
          >
            <p className="font-heading text-lg text-text-main mb-2">
              有什么想了解的？
            </p>
            <p className="text-xs text-text-muted leading-relaxed">
              试试问关于课件内容的问题，如：
            </p>
            <div className="mt-4 space-y-2">
              {['讲讲这个课件的核心概念', '出几道测验题', 'NULL 是什么意思？'].map(
                (hint, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setInput(hint)
                      inputRef.current?.focus()
                    }}
                    className="block w-full text-left px-3 py-2 text-xs text-text-body
                               border border-border-warm rounded-sm
                               hover:border-red-primary hover:text-red-primary transition-colors"
                  >
                    {hint}
                  </button>
                ),
              )}
            </div>
          </motion.div>
        )}

        {/* Message list */}
        {state.messages.map((msg) => (
          <TutorMessage
            key={msg.id}
            message={msg}
            onViewSpecialist={handleViewSpecialist}
            onViewQuiz={handleViewQuiz}
          />
        ))}

        {/* Streaming content (live) */}
        {state.streamingContent && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mb-4 pl-3 border-l-3 border-l-red-primary"
          >
            <p className="text-[13px] text-text-body leading-relaxed whitespace-pre-wrap">
              {state.streamingContent}
              <span className="inline-block w-1.5 h-4 bg-red-primary/60 ml-0.5 animate-pulse" />
            </p>
          </motion.div>
        )}

        {/* Phase status indicator */}
        {statusText && !state.streamingContent && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center gap-2 mb-3 pl-3"
          >
            <Loader2 size={12} className="animate-spin text-red-primary" />
            <span className="text-xs text-text-muted">{statusText}</span>
          </motion.div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area (fixed bottom) */}
      <div className="pt-3 mt-auto border-t border-border-warm">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入问题..."
            disabled={isBusy}
            rows={1}
            className="flex-1 resize-none px-3 py-2 text-sm text-text-body
                       bg-bg-main border border-border-warm rounded-sm
                       focus:border-red-primary focus:outline-none
                       disabled:opacity-50 transition-colors
                       placeholder:text-text-muted/60"
            style={{ minHeight: '36px', maxHeight: '96px' }}
            onInput={(e) => {
              const el = e.currentTarget
              el.style.height = 'auto'
              el.style.height = Math.min(el.scrollHeight, 96) + 'px'
            }}
          />
          <button
            onClick={handleSend}
            disabled={isBusy || !input.trim()}
            className="self-end px-3 py-2 bg-red-primary text-white rounded-sm
                       hover:bg-red-dark disabled:opacity-40 disabled:cursor-not-allowed
                       transition-colors"
          >
            {isBusy ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Send size={16} strokeWidth={1.5} />
            )}
          </button>
        </div>
        <p className="text-[10px] text-text-muted/50 mt-1.5 text-center">
          Enter 发送 · Shift+Enter 换行
        </p>
      </div>
    </div>
  )
}
