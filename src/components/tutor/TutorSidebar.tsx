/**
 * TutorSidebar — main chat container for AI tutor.
 * Renders message history, streaming indicator, and input area.
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Send, Loader2, RotateCcw, BookOpen, Compass } from 'lucide-react'
import { useTutorSession } from '@/hooks/useTutorSession'
import type { TutorPhase } from '@/hooks/useTutorSession'
import TutorMessage from '@/components/tutor/TutorMessage'
import { ToolProgress } from '@/components/tutor/ToolProgress'
import { ContextBudgetBar } from '@/components/tutor/ContextBudgetBar'
import type { MCQuestion } from '@/lib/api-disassembly'
import { loadProfile } from '@/lib/student-model'

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
  moduleName?: string | null
  courseId?: string
  /** IDs of exam/exercise materials to include as context for exam-aware answers */
  examMaterialIds?: string[]
  /** If set, auto-send this message once (cleared after sending). Used by NotesPanel AI explain. */
  pendingMessage?: string | null
  onPendingMessageSent?: () => void
  onSpecialistView?: (markdown: string, moduleName: string) => void
  onQuizView?: (questions: MCQuestion[]) => void
}

/* ---------- Component ---------- */

export default function TutorSidebar({
  materialId,
  moduleId,
  moduleName,
  courseId: _courseId,
  examMaterialIds,
  pendingMessage,
  onPendingMessageSent,
  onSpecialistView,
  onQuizView,
}: TutorSidebarProps) {
  const { state, sendMessage, reset } = useTutorSession(materialId, moduleId, examMaterialIds)
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const isBusy = !['idle', 'completed', 'error'].includes(state.phase)
  const statusText = PHASE_STATUS[state.phase]
  const isError = state.phase === 'error'

  // Context-aware prompts based on current module and mastery
  const contextPrompts = useMemo(() => {
    const profile = loadProfile()
    const modMastery = moduleId ? profile.modules[moduleId]?.mastery ?? 0 : 0
    const masteryPct = Math.round(modMastery * 100)

    if (moduleName) {
      if (masteryPct < 30) {
        return [
          `从零开始教我「${moduleName}」的核心概念`,
          `${moduleName}中最重要的知识点是什么？`,
          `用通俗的例子解释${moduleName}`,
        ]
      }
      if (masteryPct < 70) {
        return [
          `帮我深入理解「${moduleName}」中我还不懂的部分`,
          `${moduleName}容易出错的考点有哪些？`,
          `出几道${moduleName}的练习题测试我`,
        ]
      }
      return [
        `用高级题目挑战我对「${moduleName}」的掌握`,
        `${moduleName}有哪些进阶延伸知识？`,
        `帮我做一个${moduleName}的要点总结`,
      ]
    }
    return [
      '讲讲这个课件的核心概念',
      '出几道测验题',
      '帮我制定学习计划',
    ]
  }, [moduleId, moduleName])

  // Handle pending message from NotesPanel AI explain
  useEffect(() => {
    if (pendingMessage && !isBusy) {
      sendMessage(pendingMessage)
      onPendingMessageSent?.()
    }
  }, [pendingMessage]) // eslint-disable-line react-hooks/exhaustive-deps

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
    <div className="flex flex-col h-full px-4 pt-3 pb-2">
      {/* Compact header — only show reset when there are messages */}
      {state.messages.length > 0 && (
        <div className="flex items-center justify-end pb-1.5 mb-1.5">
          <button
            onClick={reset}
            className="flex items-center gap-1 text-[11px] text-text-muted hover:text-red-primary transition-colors"
            title="清除对话"
          >
            <RotateCcw size={11} strokeWidth={1.5} />
            清除对话
          </button>
        </div>
      )}

      {/* Context budget bar (Wave 5) */}
      {state.contextBudget && (
        <ContextBudgetBar
          usedTokens={state.contextBudget.usedTokens}
          maxTokens={state.contextBudget.maxTokens}
          percentage={state.contextBudget.percentage}
        />
      )}

      {/* Degradation notice (Wave 5) */}
      <AnimatePresence>
        {state.degradedMessage && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="px-3 py-2 mb-2 bg-accent-gold/10 border border-accent-gold/30 rounded-sm"
          >
            <p className="text-[11px] text-accent-gold">{state.degradedMessage}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Messages area (scrollable) */}
      <div className="flex-1 overflow-y-auto min-h-0 pr-1">
        {/* Empty state */}
        {state.messages.length === 0 && !isBusy && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-center py-6 px-3"
          >
            {moduleName ? (
              <p className="text-xs text-text-muted mb-3">
                <span className="text-text-body font-medium">{moduleName}</span> — 选择学习方式或直接提问
              </p>
            ) : (
              <p className="text-xs text-text-muted mb-3">
                试试问关于课件内容的问题：
              </p>
            )}
            <div className="space-y-1.5">
              {contextPrompts.map((hint, i) => (
                <button
                  key={i}
                  onClick={() => {
                    sendMessage(hint)
                  }}
                  className="block w-full text-left px-2.5 py-1.5 text-[12px] text-text-body leading-snug
                             border border-border-warm rounded-sm
                             hover:border-red-primary hover:text-red-primary transition-colors"
                >
                  {hint}
                </button>
              ))}
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

        {/* Tool progress indicator (Wave 5) */}
        <ToolProgress
          activeToolDescription={state.activeToolDescription}
          currentStep={state.currentStep}
          totalSteps={state.totalSteps}
          stepDescription={state.stepDescription}
          phase={state.phase}
        />

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

        {/* Suggested follow-ups after tutor response */}
        {state.messages.length > 0 && !isBusy && state.phase !== 'error' && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="flex flex-wrap gap-1.5 mb-3 pl-3"
          >
            {['继续深入讲解', '举个例子', '出道题考考我'].map((prompt) => (
              <button
                key={prompt}
                onClick={() => sendMessage(prompt)}
                className="px-2.5 py-1 text-[11px] text-text-muted border border-border-warm rounded-sm
                           hover:border-red-primary hover:text-red-primary transition-colors"
              >
                {prompt}
              </button>
            ))}
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
        {isError && (
          <button
            onClick={() => {
              const lastUserMsg = state.messages.filter(m => m.role === 'user').at(-1)
              if (lastUserMsg) {
                setInput(lastUserMsg.content)
                inputRef.current?.focus()
              }
            }}
            className="w-full mt-1.5 py-1.5 text-xs text-red-primary border border-red-primary/30
                       rounded-sm hover:bg-red-primary/5 transition-colors"
          >
            重新发送上一条消息
          </button>
        )}
        <p className="text-[10px] text-text-muted/50 mt-1.5 text-center">
          Enter 发送 · Shift+Enter 换行
        </p>
      </div>
    </div>
  )
}
