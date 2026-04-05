/**
 * KnowledgeCardsTab — masonry-style layout of structured knowledge cards.
 * Card types: formula, comparison, definition, procedure, theorem, example, pitfall, method.
 * Renders markdown with LaTeX support via ReactMarkdown + remarkMath + rehypeKatex.
 */

import { useState } from 'react'
import { motion } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import remarkGfm from 'remark-gfm'
import rehypeKatex from 'rehype-katex'
import { compactMdComponents } from '@/components/ui/MarkdownComponents'
import type { KnowledgeCard, SymbolDef } from '@/lib/types/knowledge-card'

/* ---------- Type Metadata ---------- */

type CardType = KnowledgeCard['card_type']

const TYPE_LABELS: Record<string, string> = {
  all:        '全部',
  formula:    '公式',
  comparison: '对比',
  definition: '定义',
  procedure:  '步骤',
  theorem:    '定理',
  example:    '例题',
  pitfall:    '易错',
  method:     '方法',
}

const TYPE_ICONS: Record<string, string> = {
  all:        '◆',
  formula:    '∑',
  comparison: '⇄',
  definition: '≝',
  procedure:  '①',
  theorem:    '⊢',
  example:    '◎',
  pitfall:    '⚠',
  method:     '⚙',
}

const ALL_TYPES: Array<CardType | 'all'> = [
  'all', 'formula', 'comparison', 'definition', 'procedure',
  'theorem', 'example', 'pitfall', 'method',
]

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
          components={compactMdComponents}
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
        components={compactMdComponents}
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
          components={compactMdComponents}
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
          components={compactMdComponents}
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

function TheoremCard({ card, index }: { card: KnowledgeCard; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.35 }}
      className="border border-blue-100 border-l-3 border-l-blue-700 rounded-sm p-5 bg-blue-50"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-wider text-blue-700 font-body font-medium">
            定理
          </span>
          <h3 className="font-heading text-lg text-text-main">{card.title}</h3>
        </div>
        <DifficultyStars count={card.difficulty_stars} />
      </div>
      <div className="text-text-body">
        <ReactMarkdown
          remarkPlugins={[remarkMath]}
          rehypePlugins={[rehypeKatex]}
          components={compactMdComponents}
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

function ExampleCard({ card, index }: { card: KnowledgeCard; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.35 }}
      className="border border-emerald-100 border-l-3 border-l-emerald-700 rounded-sm p-5 bg-emerald-50"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-wider text-emerald-700 font-body font-medium">
            例题
          </span>
          <h3 className="font-heading text-lg text-text-main">{card.title}</h3>
        </div>
        <DifficultyStars count={card.difficulty_stars} />
      </div>
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm]}
        rehypePlugins={[rehypeKatex]}
        components={compactMdComponents}
      >
        {card.content_markdown}
      </ReactMarkdown>
      {card.related_modules.length > 0 && (
        <ModuleTags modules={card.related_modules} />
      )}
    </motion.div>
  )
}

function PitfallCard({ card, index }: { card: KnowledgeCard; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.35 }}
      className="border border-amber-100 border-l-3 border-l-amber-700 rounded-sm p-5 bg-amber-50"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-wider text-amber-700 font-body font-medium">
            ⚠ 易错
          </span>
          <h3 className="font-heading text-lg text-text-main">{card.title}</h3>
        </div>
        <DifficultyStars count={card.difficulty_stars} />
      </div>
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm]}
        rehypePlugins={[rehypeKatex]}
        components={compactMdComponents}
      >
        {card.content_markdown}
      </ReactMarkdown>
      {card.related_modules.length > 0 && (
        <ModuleTags modules={card.related_modules} />
      )}
    </motion.div>
  )
}

function MethodCard({ card, index }: { card: KnowledgeCard; index: number }) {
  const lines = card.content_markdown.split('\n').filter((l) => l.trim())
  const hasNumberedSteps = lines.some((l) => /^\d+[\.\)]\s/.test(l.trim()))

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.35 }}
      className="border border-violet-100 border-l-3 border-l-violet-700 rounded-sm p-5 bg-bg-card"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-wider text-violet-700 font-body font-medium">
            方法
          </span>
          <h3 className="font-heading text-lg text-text-main">{card.title}</h3>
        </div>
        <DifficultyStars count={card.difficulty_stars} />
      </div>
      {hasNumberedSteps ? (
        <MethodSteps markdown={card.content_markdown} />
      ) : (
        <ReactMarkdown
          remarkPlugins={[remarkMath]}
          rehypePlugins={[rehypeKatex]}
          components={compactMdComponents}
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

/** Numbered steps for method cards — violet step indicators */
function MethodSteps({ markdown }: { markdown: string }) {
  const steps = markdown
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => l.replace(/^\d+[\.\)]\s*/, '').trim())
    .filter(Boolean)

  return (
    <div className="relative pl-8 space-y-4">
      <div className="absolute left-[11px] top-2 bottom-2 w-px bg-violet-200" />
      {steps.map((step, i) => (
        <div key={i} className="relative flex items-start gap-3">
          <span
            className="absolute left-[-32px] flex items-center justify-center w-6 h-6 rounded-full
                        bg-violet-700 text-white text-xs font-medium shrink-0"
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
    case 'theorem':
      return <TheoremCard card={card} index={index} />
    case 'example':
      return <ExampleCard card={card} index={index} />
    case 'pitfall':
      return <PitfallCard card={card} index={index} />
    case 'method':
      return <MethodCard card={card} index={index} />
    default:
      return <FormulaCard card={card} index={index} />
  }
}

/* ---------- Main Component ---------- */

export default function KnowledgeCardsTab({ cards, errorTaxonomy }: KnowledgeCardsTabProps) {
  const [activeType, setActiveType] = useState<CardType | 'all'>('all')

  if (!cards.length && !errorTaxonomy) {
    return (
      <div className="flex items-center justify-center h-40 text-text-muted text-sm">
        暂无知识卡片
      </div>
    )
  }

  // Determine which types actually appear in the data (for badge counts)
  const typeCounts = cards.reduce<Record<string, number>>((acc, c) => {
    acc[c.card_type] = (acc[c.card_type] ?? 0) + 1
    return acc
  }, {})

  const presentTypes = ALL_TYPES.filter(
    (t) => t === 'all' || typeCounts[t] !== undefined,
  )

  const visibleCards =
    activeType === 'all' ? cards : cards.filter((c) => c.card_type === activeType)

  return (
    <div className="space-y-6">
      {/* Type filter tabs — only show types that exist in the data */}
      {cards.length > 0 && presentTypes.length > 2 && (
        <div className="flex flex-wrap gap-1.5 border-b border-border-warm pb-4">
          {presentTypes.map((t) => {
            const isActive = activeType === t
            const count = t === 'all' ? cards.length : (typeCounts[t] ?? 0)
            return (
              <button
                key={t}
                onClick={() => setActiveType(t)}
                className={[
                  'flex items-center gap-1.5 px-3 py-1 text-sm rounded-sm border transition-colors',
                  isActive
                    ? 'border-red-primary text-red-primary bg-bg-accent font-medium'
                    : 'border-border-warm text-text-muted hover:border-red-primary hover:text-text-body bg-bg-card',
                ].join(' ')}
              >
                <span className="font-mono text-xs opacity-70">{TYPE_ICONS[t]}</span>
                {TYPE_LABELS[t]}
                <span
                  className={[
                    'text-[10px] px-1 rounded-sm',
                    isActive ? 'bg-red-primary text-white' : 'bg-border-warm text-text-muted',
                  ].join(' ')}
                >
                  {count}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* Cards grid — masonry-style with 2 columns */}
      {visibleCards.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
          {visibleCards.map((card, i) => (
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
              components={compactMdComponents}
            >
              {errorTaxonomy}
            </ReactMarkdown>
          </div>
        </motion.section>
      )}
    </div>
  )
}
