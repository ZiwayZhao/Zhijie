/**
 * SocraticChat — Socratic dialogue engine styled as a philosophy text.
 * AI messages as journal quotes (border-l-3), user messages on warm accent.
 * Scaffold level driven by mastery (ZPD).
 */
import { useState, useRef, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Send, Lightbulb, Eye, X } from 'lucide-react'
import { getScaffoldLevel } from '@/lib/student-model'
import type { ScaffoldLevel } from '@/lib/student-model'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface SocraticChatProps {
  moduleId: string
  moduleName: string
  mastery: number
  onClose: () => void
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  hint?: string
  hasReveal?: boolean
  revealed?: boolean
}

/* ------------------------------------------------------------------ */
/*  Scaffold metadata                                                  */
/* ------------------------------------------------------------------ */

const scaffoldMeta: Record<ScaffoldLevel, { label: string; sublabel: string; intensity: string }> = {
  full: { label: '引导模式', sublabel: 'Guided', intensity: 'high' },
  moderate: { label: '讨论模式', sublabel: 'Dialogue', intensity: 'mid' },
  minimal: { label: '挑战模式', sublabel: 'Challenge', intensity: 'low' },
}

/* ------------------------------------------------------------------ */
/*  Mock response engine                                               */
/* ------------------------------------------------------------------ */

function generateSocraticResponse(
  userMessage: string,
  moduleName: string,
  scaffold: ScaffoldLevel,
): ChatMessage {
  const id = `msg-${Date.now()}`

  if (scaffold === 'full') {
    return {
      id,
      role: 'assistant',
      content: `好问题！让我们一步步来理解"${moduleName}"中的这个概念。\n\n首先，你觉得这个概念的核心定义是什么？试着用自己的话描述一下。\n\n如果需要提示，可以点击下方的"显示提示"。`,
      hint: `提示：想想这个概念与${moduleName}的关系。回忆一下课件中的关键定义，特别是第一次出现这个术语的地方。`,
      hasReveal: true,
    }
  }

  if (scaffold === 'moderate') {
    const questions = [
      `关于"${userMessage.slice(0, 20)}"，你能想到哪些相关的概念？它们之间有什么联系？`,
      `你已经有不错的基础了。想想看，这个问题的关键在于什么？为什么它在${moduleName}中很重要？`,
      `试着从另一个角度思考：如果这个条件改变了，结果会怎样？这能帮你更深入理解这个概念。`,
    ]
    return {
      id,
      role: 'assistant',
      content: questions[Math.floor(Math.random() * questions.length)],
      hasReveal: true,
    }
  }

  const challenges = [
    `很好，你对这个已经相当熟悉了。那么，你能解释为什么${moduleName}中采用这种方法而不是其他方案吗？`,
    `你能举一个反例来测试你的理解吗？或者说，在什么边界条件下这个结论不再成立？`,
    `试着向一个完全不了解这个领域的人解释这个概念。你会怎么说？`,
  ]
  return {
    id,
    role: 'assistant',
    content: challenges[Math.floor(Math.random() * challenges.length)],
  }
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function SocraticChat({ moduleName, mastery, onClose }: SocraticChatProps) {
  const scaffold = getScaffoldLevel(mastery)
  const meta = scaffoldMeta[scaffold]

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: getWelcomeMessage(moduleName, scaffold),
    },
  ])
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function handleSend() {
    const text = input.trim()
    if (!text) return

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
    }

    setMessages((prev) => [...prev, userMsg])
    setInput('')

    setTimeout(() => {
      const response = generateSocraticResponse(text, moduleName, scaffold)
      setMessages((prev) => [...prev, response])
    }, 600)
  }

  function handleReveal(msgId: string) {
    setMessages((prev) =>
      prev.map((m) => (m.id === msgId ? { ...m, revealed: true } : m)),
    )
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex flex-col h-full border border-border-warm bg-bg-card">
      {/* Header — editorial strip */}
      <div className="px-5 py-3 border-b border-border-warm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-heading text-sm text-text-main">
              苏格拉底对话
            </span>
            <span className="text-[10px] font-mono uppercase tracking-widest text-text-muted">
              {meta.sublabel}
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center text-text-muted hover:text-red-primary transition-colors"
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
        {/* Scaffold level indicator — subtle bar */}
        <div className="flex items-center gap-2 mt-2">
          <span className="text-[10px] text-text-muted">{meta.label}</span>
          <div className="flex gap-0.5">
            {(['high', 'mid', 'low'] as const).map((level) => (
              <div
                key={level}
                className="h-[3px] w-5 transition-colors"
                style={{
                  backgroundColor:
                    (meta.intensity === 'high') ||
                    (meta.intensity === 'mid' && level !== 'low') ||
                    (meta.intensity === 'low' && level === 'low')
                      ? 'var(--color-red-primary)'
                      : 'var(--color-border-warm)',
                  opacity:
                    (meta.intensity === 'high') ||
                    (meta.intensity === 'mid' && level !== 'low') ||
                    (meta.intensity === 'low' && level === 'low')
                      ? 1 : 0.5,
                }}
              />
            ))}
          </div>
          <span className="text-[10px] text-text-muted font-mono">
            mastery {Math.round(mastery * 100)}%
          </span>
        </div>
      </div>

      {/* Messages — philosophy text feel */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 min-h-[200px] max-h-[400px]">
        {messages.map((msg, i) => (
          <motion.div
            key={msg.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i === messages.length - 1 ? 0.1 : 0, duration: 0.25 }}
          >
            {msg.role === 'assistant' ? (
              /* AI message — journal blockquote style */
              <div className="border-l-3 border-l-red-primary pl-4 py-1">
                <p className="text-sm text-text-body leading-relaxed whitespace-pre-wrap">
                  {msg.content}
                </p>

                {/* Hint reveal — elegant expandable */}
                {msg.hint && !msg.revealed && (
                  <button
                    onClick={() => handleReveal(msg.id)}
                    className="inline-flex items-center gap-1.5 mt-3 text-[11px] text-accent-gold hover:text-red-primary transition-colors"
                  >
                    <Lightbulb size={11} strokeWidth={1.5} />
                    <span className="italic">显示提示</span>
                  </button>
                )}
                {msg.hint && msg.revealed && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    transition={{ duration: 0.25 }}
                    className="mt-3 pt-2 border-t border-border-warm"
                  >
                    <p className="text-[11px] text-accent-gold leading-relaxed italic">
                      {msg.hint}
                    </p>
                  </motion.div>
                )}

                {/* Generic reveal */}
                {msg.hasReveal && !msg.hint && !msg.revealed && (
                  <button
                    onClick={() => handleReveal(msg.id)}
                    className="inline-flex items-center gap-1.5 mt-3 text-[11px] text-text-muted hover:text-red-primary transition-colors"
                  >
                    <Eye size={11} strokeWidth={1.5} />
                    <span className="italic">查看参考答案</span>
                  </button>
                )}
              </div>
            ) : (
              /* User message — right-aligned, warm accent */
              <div className="flex justify-end">
                <div className="max-w-[80%] bg-bg-accent border border-border-warm px-4 py-3">
                  <p className="text-sm text-text-body leading-relaxed whitespace-pre-wrap">
                    {msg.content}
                  </p>
                </div>
              </div>
            )}
          </motion.div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area — warm academic feel */}
      <div className="border-t border-border-warm px-4 py-3 bg-bg-main/50">
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入你的问题或想法..."
            className="flex-1 text-sm bg-transparent border-none outline-none text-text-body placeholder:text-text-muted/50 font-body"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className="w-8 h-8 flex items-center justify-center border border-border-warm text-text-muted hover:text-red-primary hover:border-red-primary transition-colors disabled:opacity-25 disabled:hover:text-text-muted disabled:hover:border-border-warm"
          >
            <Send size={14} strokeWidth={1.5} />
          </button>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Welcome message                                                    */
/* ------------------------------------------------------------------ */

function getWelcomeMessage(moduleName: string, scaffold: ScaffoldLevel): string {
  switch (scaffold) {
    case 'full':
      return `你好！我是你的学习助手。我们来一起探索"${moduleName}"的内容。\n\n我不会直接给你答案，而是通过提问帮你自己理解。如果你遇到困难，我会给你提示。\n\n你最想了解这个模块中的什么内容？`
    case 'moderate':
      return `欢迎回来！看起来你对"${moduleName}"已经有一定了解了。\n\n让我们通过讨论来深化你的理解。你有什么想探讨的问题吗？`
    case 'minimal':
      return `你对"${moduleName}"的掌握度很高！\n\n让我们来做一些更有挑战性的思考练习。你准备好了吗？`
  }
}
