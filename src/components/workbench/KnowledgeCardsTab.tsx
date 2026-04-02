/**
 * KnowledgeCardsTab — masonry-style layout of structured knowledge cards.
 * Each card type (formula/comparison/definition/procedure) has a distinct visual style.
 * Renders markdown with LaTeX support via ReactMarkdown + remarkMath + rehypeKatex.
 */

import { motion } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import remarkGfm from 'remark-gfm'
import rehypeKatex from 'rehype-katex'
import type { KnowledgeCard, SymbolDef } from '@/lib/types/knowledge-card'

/* ---------- Props ---------- */

interface KnowledgeCardsTabProps {
  cards: KnowledgeCard[]
  errorTaxonomy: string
}

/* ---------- Difficulty Stars ---------- */

function DifficultyStars({ count }: { count: number }) {
  const stars = Math.min(Math.max(count, 0), 5)
  return (
    <span className="flex items-center gap-0.5" title={`难度 ${stars}/5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          className={`text-xs ${i < stars ? 'text-accent-gold' : 'text-border-warm'}`}
        >
          ★
        </span>
      ))}
    </span>
  )
}

/* ---------- Symbol Table ---------- */

function SymbolTable({ symbols }: { symbols: SymbolDef[] }) {
  return (
    <div className="mt-3 border-t border-border-warm pt-3">
      <p className="text-[11px] uppercase tracking-wider text-text-muted mb-1.5 font-body">
        符号说明
      </p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        {symbols.map((s) => (
          <div key={s.symbol} className="flex items-baseline gap-2 text-sm">
            <code className="font-mono text-red-primary text-xs">{s.symbol}</code>
            <span className="text-text-body">{s.meaning}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ---------- Markdown renderer (shared) ---------- */

const mdComponents = {
  p: ({ children, ...props }: React.ComponentPropsWithoutRef<'p'>) => (
    <p className="text-[15px] text-text-body leading-relaxed mb-3" {...props}>
      {children}
    </p>
  ),
  table: ({ children, ...props }: React.ComponentPropsWithoutRef<'table'>) => (
    <div className="overflow-x-auto my-3">
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
          className="block bg-text-main text-bg-main p-4 rounded-sm overflow-x-auto text-sm font-mono my-3"
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
  strong: ({ children, ...props }: React.ComponentPropsWithoutRef<'strong'>) => (
    <strong className="font-semibold text-text-main" {...props}>
      {children}
    </strong>
  ),
}

/* ---------- Card Type Renderers ---------- */

function FormulaCard({ card, index }: { card: KnowledgeCard; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.35 }}
      className="border border-border-warm border-l-3 border-l-red-primary rounded-sm p-5 bg-bg-card"
    >
      <div className="flex items-start justify-between mb-3">
        <h3 className="font-heading text-lg text-text-main">{card.title}</h3>
        <DifficultyStars count={card.difficulty_stars} />
      </div>
      <div className="text-center my-4">
        <ReactMarkdown
          remarkPlugins={[remarkMath]}
          rehypePlugins={[rehypeKatex]}
          components={mdComponents}
        >
          {card.content_markdown}
        </ReactMarkdown>
      </div>
      {card.symbols && card.symbols.length > 0 && <SymbolTable symbols={card.symbols} />}
      {card.related_modules.length > 0 && (
        <ModuleTags modules={card.related_modules} />
      )}
    </motion.div>
  )
}

function ComparisonCard({ card, index }: { card: KnowledgeCard; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.35 }}
      className="border border-border-warm rounded-sm p-5 bg-bg-card col-span-full"
    >
      <div className="flex items-start justify-between mb-3">
        <h3 className="font-heading text-lg text-text-main">{card.title}</h3>
        <DifficultyStars count={card.difficulty_stars} />
      </div>
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm]}
        rehypePlugins={[rehypeKatex]}
        components={mdComponents}
      >
        {card.content_markdown}
      </ReactMarkdown>
      {card.related_modules.length > 0 && (
        <ModuleTags modules={card.related_modules} />
      )}
    </motion.div>
  )
}

function DefinitionCard({ card, index }: { card: KnowledgeCard; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.35 }}
      className="border border-border-warm rounded-sm p-5 bg-bg-accent"
    >
      <div className="flex items-start justify-between mb-3">
        <h3 className="font-heading text-lg text-text-main italic">{card.title}</h3>
        <DifficultyStars count={card.difficulty_stars} />
      </div>
      <div className="italic text-text-body">
        <ReactMarkdown
          remarkPlugins={[remarkMath]}
          rehypePlugins={[rehypeKatex]}
          components={mdComponents}
        >
          {card.content_markdown}
        </ReactMarkdown>
      </div>
      {card.symbols && card.symbols.length > 0 && <SymbolTable symbols={card.symbols} />}
      {card.related_modules.length > 0 && (
        <ModuleTags modules={card.related_modules} />
      )}
    </motion.div>
  )
}

function ProcedureCard({ card, index }: { card: KnowledgeCard; index: number }) {
  // Parse content into steps — split by numbered lines or render as markdown
  const lines = card.content_markdown.split('\n').filter((l) => l.trim())
  const hasNumberedSteps = lines.some((l) => /^\d+[\.\)]\s/.test(l.trim()))

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.35 }}
      className="border border-border-warm rounded-sm p-5 bg-bg-card"
    >
      <div className="flex items-start justify-between mb-3">
        <h3 className="font-heading text-lg text-text-main">{card.title}</h3>
        <DifficultyStars count={card.difficulty_stars} />
      </div>
      {hasNumberedSteps ? (
        <ProcedureSteps markdown={card.content_markdown} />
      ) : (
        <ReactMarkdown
          remarkPlugins={[remarkMath]}
          rehypePlugins={[rehypeKatex]}
          components={mdComponents}
        >
          {card.content_markdown}
        </ReactMarkdown>
      )}
      {card.related_modules.length > 0 && (
        <ModuleTags modules={card.related_modules} />
      )}
    </motion.div>
  )
}

/** Render numbered steps with red circle indicators and connecting line */
function ProcedureSteps({ markdown }: { markdown: string }) {
  const steps = markdown
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => l.replace(/^\d+[\.\)]\s*/, '').trim())
    .filter(Boolean)

  return (
    <div className="relative pl-8 space-y-4">
      {/* Connecting line */}
      <div className="absolute left-[11px] top-2 bottom-2 w-px bg-border-warm" />
      {steps.map((step, i) => (
        <div key={i} className="relative flex items-start gap-3">
          <span
            className="absolute left-[-32px] flex items-center justify-center w-6 h-6 rounded-full
                        bg-red-primary text-white text-xs font-medium shrink-0"
          >
            {i + 1}
          </span>
          <span className="text-sm text-text-body leading-relaxed inline-math-wrap">
            <ReactMarkdown
              remarkPlugins={[remarkMath]}
              rehypePlugins={[rehypeKatex]}
              components={{ p: ({ children }) => <>{children}</> }}
            >
              {step}
            </ReactMarkdown>
          </span>
        </div>
      ))}
    </div>
  )
}

/* ---------- Module Tags ---------- */

function ModuleTags({ modules }: { modules: string[] }) {
  return (
    <div className="mt-3 pt-3 border-t border-border-warm flex flex-wrap gap-1.5">
      {modules.map((m) => (
        <span
          key={m}
          className="px-2 py-0.5 text-[11px] text-text-muted border border-border-warm rounded-sm"
        >
          {m}
        </span>
      ))}
    </div>
  )
}

/* ---------- Card Router ---------- */

function CardRenderer({ card, index }: { card: KnowledgeCard; index: number }) {
  switch (card.card_type) {
    case 'formula':
      return <FormulaCard card={card} index={index} />
    case 'comparison':
      return <ComparisonCard card={card} index={index} />
    case 'definition':
      return <DefinitionCard card={card} index={index} />
    case 'procedure':
      return <ProcedureCard card={card} index={index} />
    default:
      return <FormulaCard card={card} index={index} />
  }
}

/* ---------- Main Component ---------- */

export default function KnowledgeCardsTab({ cards, errorTaxonomy }: KnowledgeCardsTabProps) {
  if (!cards.length && !errorTaxonomy) {
    return (
      <div className="flex items-center justify-center h-40 text-text-muted text-sm">
        暂无知识卡片
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Cards grid — masonry-style with 2 columns */}
      {cards.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
          {cards.map((card, i) => (
            <CardRenderer key={`${card.card_type}-${card.title}-${i}`} card={card} index={i} />
          ))}
        </div>
      )}

      {/* Error Taxonomy Section */}
      {errorTaxonomy && errorTaxonomy.trim().length > 0 && (
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: cards.length * 0.06 + 0.1, duration: 0.35 }}
          className="border-t border-border-warm pt-6"
        >
          <h2 className="font-heading text-xl text-text-main mb-4 pl-3 border-l-3 border-l-red-primary">
            易错分类
          </h2>
          <div className="prose-academic">
            <ReactMarkdown
              remarkPlugins={[remarkMath, remarkGfm]}
              rehypePlugins={[rehypeKatex]}
              components={mdComponents}
            >
              {errorTaxonomy}
            </ReactMarkdown>
          </div>
        </motion.section>
      )}
    </div>
  )
}
