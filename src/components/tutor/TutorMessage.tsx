/**
 * TutorMessage — renders a single chat message (user / assistant / system).
 * Assistant messages use react-markdown with LaTeX support.
 * Reuses fixMarkdown() and editorial styling from MaterialReader.
 */

import { useMemo } from 'react'
import { motion } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import remarkGfm from 'remark-gfm'
import rehypeKatex from 'rehype-katex'
import { AlertCircle } from 'lucide-react'
import type { TutorMessage as TutorMessageType, ToolResultItem } from '@/hooks/useTutorSession'
import PlanIndicator from '@/components/tutor/PlanIndicator'
import ToolResultCard from '@/components/tutor/ToolResultCard'

/* ---------- Markdown fixer (shared with MaterialReader) ---------- */

function fixMarkdown(md: string): string {
  let fixed = md
  // Fix pipe chars inside LaTeX
  fixed = fixed.replace(/(\$\$[\s\S]*?\$\$)|(\$[^$\n]*?\$)/g, (match) => {
    if (match.indexOf('|') === -1) return match
    return match.replace(/\|/g, '\\vert')
  })
  // Fix bold-wrapped headings
  fixed = fixed.replace(/^\s*\*\*\s*(#{1,6})\s*(.*?)\*\*\s*$/gm, '$1 $2')
  // Fix duplicate hash marks
  fixed = fixed.replace(/(^|\n)(#{1,6})\s+(?:#+\s+)+/g, '$1$2 ')
  // Fix missing space after hash
  fixed = fixed.replace(/^(#{1,6})(?=[^# \n])/gm, '$1 ')
  return fixed
}

/* ---------- Compact markdown components for chat bubble ---------- */

const chatMdComponents = {
  h1: ({ children, ...props }: React.ComponentPropsWithoutRef<'h1'>) => (
    <h1 className="font-heading text-base text-text-main mt-3 mb-1.5" {...props}>{children}</h1>
  ),
  h2: ({ children, ...props }: React.ComponentPropsWithoutRef<'h2'>) => (
    <h2 className="font-heading text-sm text-text-main mt-3 mb-1 pl-2 border-l-2 border-l-red-primary" {...props}>{children}</h2>
  ),
  h3: ({ children, ...props }: React.ComponentPropsWithoutRef<'h3'>) => (
    <h3 className="font-heading text-sm text-text-main mt-2 mb-1" {...props}>{children}</h3>
  ),
  p: ({ children, ...props }: React.ComponentPropsWithoutRef<'p'>) => (
    <p className="text-[13px] text-text-body leading-relaxed mb-2" {...props}>{children}</p>
  ),
  ul: ({ children, ...props }: React.ComponentPropsWithoutRef<'ul'>) => (
    <ul className="list-disc pl-4 space-y-1 text-[13px] text-text-body mb-2" {...props}>{children}</ul>
  ),
  ol: ({ children, ...props }: React.ComponentPropsWithoutRef<'ol'>) => (
    <ol className="list-decimal pl-4 space-y-1 text-[13px] text-text-body mb-2" {...props}>{children}</ol>
  ),
  blockquote: ({ children, ...props }: React.ComponentPropsWithoutRef<'blockquote'>) => (
    <blockquote className="border-l-2 border-l-red-primary bg-bg-accent pl-3 py-1.5 my-2 italic text-[13px] text-text-body" {...props}>
      {children}
    </blockquote>
  ),
  table: ({ children, ...props }: React.ComponentPropsWithoutRef<'table'>) => (
    <div className="overflow-x-auto my-2">
      <table className="w-full text-xs border border-border-warm" {...props}>{children}</table>
    </div>
  ),
  th: ({ children, ...props }: React.ComponentPropsWithoutRef<'th'>) => (
    <th className="px-2 py-1 text-left font-medium text-text-main bg-bg-accent border border-border-warm text-xs" {...props}>{children}</th>
  ),
  td: ({ children, ...props }: React.ComponentPropsWithoutRef<'td'>) => (
    <td className="px-2 py-1 text-text-body border border-border-warm text-xs" {...props}>{children}</td>
  ),
  code: ({ children, className, ...props }: React.ComponentPropsWithoutRef<'code'> & { className?: string }) => {
    const isBlock = className?.startsWith('language-')
    if (isBlock) {
      return (
        <pre className="bg-bg-main border border-border-warm rounded-sm p-2 my-2 overflow-x-auto">
          <code className="text-xs font-mono text-text-body" {...props}>{children}</code>
        </pre>
      )
    }
    return (
      <code className="bg-bg-main border border-border-warm px-1 py-0.5 rounded-sm text-xs font-mono text-red-primary" {...props}>
        {children}
      </code>
    )
  },
}

/* ---------- Props ---------- */

interface TutorMessageProps {
  message: TutorMessageType
  onViewSpecialist?: (data: Record<string, unknown>) => void
  onViewQuiz?: (data: Record<string, unknown>) => void
}

/* ---------- Component ---------- */

export default function TutorMessage({
  message,
  onViewSpecialist,
  onViewQuiz,
}: TutorMessageProps) {
  const parsed = useMemo(
    () => (message.role === 'assistant' ? fixMarkdown(message.content) : message.content),
    [message.content, message.role],
  )

  if (message.role === 'user') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="flex justify-end mb-3"
      >
        <div className="max-w-[85%] px-3.5 py-2.5 bg-bg-accent border border-border-warm rounded-sm text-[13px] text-text-body">
          {message.content}
        </div>
      </motion.div>
    )
  }

  if (message.role === 'system') {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
        className="flex items-start gap-2 mb-3 px-3 py-2 bg-red-primary/5 border border-red-primary/20 rounded-sm"
      >
        <AlertCircle size={14} strokeWidth={1.5} className="text-red-primary mt-0.5 shrink-0" />
        <p className="text-xs text-text-body">{message.content}</p>
      </motion.div>
    )
  }

  // Assistant message
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="mb-4 pl-3 border-l-3 border-l-red-primary"
    >
      {/* Plan indicator (collapsible) */}
      {message.plan && <PlanIndicator plan={message.plan} />}

      {/* Tool results */}
      {message.toolResults?.map((tr: ToolResultItem, i: number) => (
        <ToolResultCard
          key={`${tr.toolName}-${i}`}
          result={tr}
          onViewSpecialist={onViewSpecialist}
          onViewQuiz={onViewQuiz}
        />
      ))}

      {/* Answer body (markdown) */}
      <div className="tutor-markdown">
        <ReactMarkdown
          remarkPlugins={[remarkMath, remarkGfm]}
          rehypePlugins={[rehypeKatex]}
          components={chatMdComponents}
        >
          {parsed}
        </ReactMarkdown>
      </div>
    </motion.div>
  )
}
