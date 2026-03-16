/**
 * SocraticChat — mock Socratic dialogue engine.
 * Uses structured questions instead of direct answers.
 * Scaffold level driven by mastery (ZPD).
 */
import { useState, useRef, useEffect } from 'react'
import { motion } from 'framer-motion'
import { MessageCircle, Send, Lightbulb, Eye } from 'lucide-react'
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
/*  Mock response engine                                               */
/* ------------------------------------------------------------------ */

function generateSocraticResponse(
  userMessage: string,
  moduleName: string,
  scaffold: ScaffoldLevel,
): ChatMessage {
  const id = `msg-${Date.now()}`

  if (scaffold === 'full') {
    // High scaffold: step-by-step guidance
    return {
      id,
      role: 'assistant',
      content: `好问题！让我们一步步来理解"${moduleName}"中的这个概念。\n\n首先，你觉得这个概念的核心定义是什么？试着用自己的话描述一下。\n\n如果需要提示，可以点击下方的"显示提示"。`,
      hint: `提示：想想这个概念与${moduleName}的关系。回忆一下课件中的关键定义，特别是第一次出现这个术语的地方。`,
      hasReveal: true,
    }
  }

  if (scaffold === 'moderate') {
    // Medium scaffold: balanced hints and questions
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

  // Minimal scaffold: mostly questions
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
  const scaffoldLabels: Record<ScaffoldLevel, string> = {
    full: '引导模式',
    moderate: '讨论模式',
    minimal: '挑战模式',
  }

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

    // Simulate async response
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
    <div className="flex flex-col h-full border border-border-warm rounded-lg bg-bg-card">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-warm">
        <div className="flex items-center gap-2">
          <MessageCircle size={16} strokeWidth={1.5} className="text-red-primary" />
          <span className="font-heading text-sm text-text-main">苏格拉底对话</span>
          <span className="text-xs px-1.5 py-0.5 rounded border border-border-warm text-text-muted">
            {scaffoldLabels[scaffold]}
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-xs text-text-muted hover:text-red-primary transition-colors"
        >
          关闭
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-[200px] max-h-[400px]">
        {messages.map((msg, i) => (
          <motion.div
            key={msg.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i === messages.length - 1 ? 0.1 : 0, duration: 0.25 }}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-lg px-4 py-3 text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-bg-accent text-text-body'
                  : 'border-l-3 border-l-red-primary bg-bg-card border border-border-warm text-text-body'
              }`}
            >
              <p className="whitespace-pre-wrap">{msg.content}</p>

              {/* Hint */}
              {msg.hint && !msg.revealed && (
                <button
                  onClick={() => handleReveal(msg.id)}
                  className="flex items-center gap-1 mt-3 text-xs text-accent-gold hover:text-red-primary transition-colors"
                >
                  <Lightbulb size={12} strokeWidth={1.5} />
                  显示提示
                </button>
              )}
              {msg.hint && msg.revealed && (
                <div className="mt-3 text-xs text-accent-gold border-t border-border-warm pt-2">
                  {msg.hint}
                </div>
              )}

              {/* Reveal answer */}
              {msg.hasReveal && !msg.hint && !msg.revealed && (
                <button
                  onClick={() => handleReveal(msg.id)}
                  className="flex items-center gap-1 mt-3 text-xs text-text-muted hover:text-red-primary transition-colors"
                >
                  <Eye size={12} strokeWidth={1.5} />
                  查看参考答案
                </button>
              )}
            </div>
          </motion.div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="flex items-center gap-2 p-3 border-t border-border-warm">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入你的问题或想法..."
          className="flex-1 text-sm bg-transparent border-none outline-none text-text-body placeholder:text-text-muted/60"
        />
        <button
          onClick={handleSend}
          disabled={!input.trim()}
          className="w-8 h-8 rounded flex items-center justify-center text-text-muted hover:text-red-primary hover:bg-bg-accent transition-colors disabled:opacity-30"
        >
          <Send size={16} strokeWidth={1.5} />
        </button>
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
