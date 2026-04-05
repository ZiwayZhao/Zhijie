/**
 * FormulaSheetTab — single-page formula quick-reference sheet.
 * Renders markdown with LaTeX support, print-friendly layout.
 */

import { Printer } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import remarkGfm from 'remark-gfm'
import rehypeKatex from 'rehype-katex'
import { baseMdComponents } from '@/components/ui/MarkdownComponents'

/* ---------- Props ---------- */

interface FormulaSheetTabProps {
  formulaSheet: string
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
    <div className="space-y-6">
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
          components={baseMdComponents}
        >
          {formulaSheet}
        </ReactMarkdown>
      </div>
    </div>
  )
}
