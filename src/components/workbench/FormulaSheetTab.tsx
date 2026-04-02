/**
 * FormulaSheetTab — single-page formula quick-reference sheet.
 * Renders markdown with LaTeX support, print-friendly layout.
 */

import { motion } from 'framer-motion'
import { Printer } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import remarkGfm from 'remark-gfm'
import rehypeKatex from 'rehype-katex'

/* ---------- Props ---------- */

interface FormulaSheetTabProps {
  formulaSheet: string
}

/* ---------- Markdown components (editorial styling) ---------- */

const mdComponents = {
  h1: ({ children, ...props }: React.ComponentPropsWithoutRef<'h1'>) => (
    <h1
      className="font-heading text-2xl text-text-main mt-8 mb-4 pb-2 border-b border-border-warm"
      {...props}
    >
      {children}
    </h1>
  ),
  h2: ({ children, ...props }: React.ComponentPropsWithoutRef<'h2'>) => (
    <h2
      className="font-heading text-xl text-text-main mt-8 mb-3 pl-3 border-l-3 border-l-red-primary"
      {...props}
    >
      {children}
    </h2>
  ),
  h3: ({ children, ...props }: React.ComponentPropsWithoutRef<'h3'>) => (
    <h3 className="font-heading text-lg text-text-main mt-6 mb-2" {...props}>
      {children}
    </h3>
  ),
  p: ({ children, ...props }: React.ComponentPropsWithoutRef<'p'>) => (
    <p className="text-[15px] text-text-body leading-relaxed mb-4" {...props}>
      {children}
    </p>
  ),
  ul: ({ children, ...props }: React.ComponentPropsWithoutRef<'ul'>) => (
    <ul className="list-disc pl-5 space-y-1.5 text-[15px] text-text-body mb-4" {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, ...props }: React.ComponentPropsWithoutRef<'ol'>) => (
    <ol className="list-decimal pl-5 space-y-1.5 text-[15px] text-text-body mb-4" {...props}>
      {children}
    </ol>
  ),
  blockquote: ({ children, ...props }: React.ComponentPropsWithoutRef<'blockquote'>) => (
    <blockquote
      className="border-l-3 border-l-red-primary bg-bg-accent pl-4 py-3 my-4 italic text-text-body"
      {...props}
    >
      {children}
    </blockquote>
  ),
  table: ({ children, ...props }: React.ComponentPropsWithoutRef<'table'>) => (
    <div className="overflow-x-auto my-4">
      <table className="w-full text-sm border border-border-warm" {...props}>
        {children}
      </table>
    </div>
  ),
  th: ({ children, ...props }: React.ComponentPropsWithoutRef<'th'>) => (
    <th
      className="px-3 py-2 text-left font-medium text-text-main bg-bg-accent border border-border-warm"
      {...props}
    >
      {children}
    </th>
  ),
  td: ({ children, ...props }: React.ComponentPropsWithoutRef<'td'>) => (
    <td className="px-3 py-2 text-text-body border border-border-warm" {...props}>
      {children}
    </td>
  ),
  code: ({
    children,
    className,
    ...props
  }: React.ComponentPropsWithoutRef<'code'> & { className?: string }) => {
    const isBlock = className?.startsWith('language-')
    if (isBlock) {
      return (
        <code
          className="block bg-text-main text-bg-main p-4 rounded-sm overflow-x-auto text-sm font-mono my-4"
          {...props}
        >
          {children}
        </code>
      )
    }
    return (
      <code
        className="px-1.5 py-0.5 text-sm bg-bg-accent text-red-primary border border-border-warm rounded-sm font-mono"
        {...props}
      >
        {children}
      </code>
    )
  },
  pre: ({ children, ...props }: React.ComponentPropsWithoutRef<'pre'>) => (
    <pre className="my-4" {...props}>
      {children}
    </pre>
  ),
  strong: ({ children, ...props }: React.ComponentPropsWithoutRef<'strong'>) => (
    <strong className="font-semibold text-text-main" {...props}>
      {children}
    </strong>
  ),
}

/* ---------- Main Component ---------- */

export default function FormulaSheetTab({ formulaSheet }: FormulaSheetTabProps) {
  if (!formulaSheet || !formulaSheet.trim()) {
    return (
      <div className="flex items-center justify-center h-40 text-text-muted text-sm">
        暂无公式速查表
      </div>
    )
  }

  const handlePrint = () => {
    window.print()
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="space-y-6"
    >
      {/* Print button */}
      <div className="flex justify-end print:hidden">
        <button
          onClick={handlePrint}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-muted
                     border border-border-warm rounded-sm
                     hover:border-red-primary hover:text-red-primary transition-colors"
        >
          <Printer size={12} strokeWidth={1.5} />
          打印公式速查表
        </button>
      </div>

      {/* Formula sheet content */}
      <div className="prose-academic print:prose-sm">
        <ReactMarkdown
          remarkPlugins={[remarkMath, remarkGfm]}
          rehypePlugins={[rehypeKatex]}
          components={mdComponents}
        >
          {formulaSheet}
        </ReactMarkdown>
      </div>
    </motion.div>
  )
}
