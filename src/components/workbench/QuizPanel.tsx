/**
 * QuizPanel — MCQ assessment interface.
 * Editorial academic design: warm card borders, red accent for selection,
 * green/red feedback on answer, source tracing, score summary.
 *
 * No AI slop — no purple gradients, no Inter font, no generic card shadows.
 */
import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, X, BookOpen, ChevronRight, RotateCcw } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import type { MCQuestion } from '@/lib/api'

/* ---------- Types ---------- */

export type { MCQuestion }

interface QuizPanelProps {
  questions: MCQuestion[]
  onGenerateFlashcards?: () => void
}

/* ---------- Plain-text → LaTeX pre-processor ---------- */

const GREEK: Record<string, string> = {
  'Δ': '\\Delta ', 'ρ': '\\rho ', 'σ': '\\sigma ', 'τ': '\\tau ',
  'γ': '\\gamma ', 'μ': '\\mu ', 'θ': '\\theta ', 'φ': '\\varphi ',
  'π': '\\pi ', 'ε': '\\varepsilon ', 'λ': '\\lambda ', 'α': '\\alpha ',
  'β': '\\beta ', 'ω': '\\omega ',
}
const GREEK_SET = new Set(Object.keys(GREEK))
const MATH_OPS = new Set(['+', '-', '*', '/', '=', '<', '>', '≥', '≤', '≠', '×', '∝', '√'])
const OP_LATEX: Record<string, string> = { '≥': '\\geq ', '≤': '\\leq ', '≠': '\\neq ', '×': '\\times ', '∝': '\\propto ', '√': '\\sqrt' }

function isFormulaChar(ch: string): boolean {
  return /[A-Za-z0-9_().,]/.test(ch) || GREEK_SET.has(ch) || MATH_OPS.has(ch) || ch === '^' || ch === '²' || ch === '³'
}

/**
 * Convert a raw formula token to LaTeX notation.
 */
function toLaTeX(raw: string): string {
  let s = raw
  for (const [ch, latex] of Object.entries(GREEK)) {
    s = s.split(ch).join(latex)
  }
  for (const [ch, latex] of Object.entries(OP_LATEX)) {
    s = s.split(ch).join(latex)
  }
  s = s.replace(/_([A-Za-z0-9]+)/g, '_{$1}')
  s = s.replace(/²/g, '^{2}').replace(/³/g, '^{3}')
  return s
}

/**
 * Find individual formula tokens in text and wrap each in $..$.
 *
 * A formula token is one of:
 *  - A Greek letter optionally followed by subscript: ρ, ρ_m, Δh_m, σ_ze
 *  - A Latin var with subscript: p_A, z_F, SF_sliding
 *
 * For compound expressions like "(ρ_m - ρ)gΔh_m" we match each token
 * separately but they'll appear close together.
 *
 * Parenthesized expressions containing formula tokens are matched as a whole.
 */
function texify(text: string): string {
  if (text.includes('$')) return text
  if (!/[ρσταγμθφπελαβωΔ]|[A-Za-z]_[A-Za-z0-9]|[²³]/.test(text)) return text

  // Step 1: Match parenthesized expressions containing Greek/subscript
  let result = text.replace(
    /\([^)]*(?:[ρσταγμθφπελαβωΔ]|[A-Za-z]_[A-Za-z0-9])[^)]*\)/g,
    (match) => `$${toLaTeX(match)}$`
  )

  // Step 2: Match remaining standalone formula tokens (not inside $...$)
  // Token: optional leading letter(s) + (Greek or subscript trigger) + optional trailing chars
  result = result.replace(
    /(?<!\$)(?:[A-Za-z]*[ρσταγμθφπελαβωΔ][A-Za-z0-9]*(?:_[A-Za-z0-9]+)?|[A-Za-z]+_[A-Za-z0-9]+)(?:[²³])?(?!\$)/g,
    (match) => {
      // Skip if it's already inside a $ block (rough check)
      return `$${toLaTeX(match)}$`
    }
  )

  // Step 3: Merge adjacent $...$$ ...$ blocks into one: $a$$ b$ → $a\; b$
  // Replace $$ boundary between two math zones with a thin space
  result = result.replace(/\$\s*\$/g, '\\;')

  return result
}

/* ---------- Math-aware text renderer ---------- */

function MathText({ children, className }: { children: string; className?: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={{
        p: ({ children: c }) => <span className={className}>{c}</span>,
      }}
    >
      {texify(children)}
    </ReactMarkdown>
  )
}

/* ---------- Difficulty Badge ---------- */

function DifficultyBadge({ level }: { level: string }) {
  const styles: Record<string, string> = {
    easy: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    medium: 'bg-amber-50 text-amber-700 border-amber-200',
    hard: 'bg-red-50 text-red-primary border-red-primary/20',
  }
  const labels: Record<string, string> = {
    easy: '基础',
    medium: '中等',
    hard: '进阶',
  }
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-body ${styles[level] ?? styles.medium}`}>
      {labels[level] ?? level}
    </span>
  )
}

/* ---------- Option Button ---------- */

function OptionButton({
  text,
  index,
  state,
  onClick,
}: {
  text: string
  index: number
  state: 'default' | 'selected' | 'correct' | 'incorrect' | 'revealed'
  onClick: () => void
}) {
  const letter = String.fromCharCode(65 + index) // A, B, C, D

  const borderColor =
    state === 'correct' ? 'border-emerald-500 bg-emerald-50/50'
      : state === 'incorrect' ? 'border-red-primary bg-red-primary/5'
        : state === 'revealed' ? 'border-emerald-400/50 bg-emerald-50/30'
          : state === 'selected' ? 'border-red-primary'
            : 'border-border-warm hover:border-red-primary/40'

  const letterStyle =
    state === 'correct' ? 'bg-emerald-500 text-white border-emerald-500'
      : state === 'incorrect' ? 'bg-red-primary text-white border-red-primary'
        : 'bg-bg-accent text-text-muted border-border-warm'

  const disabled = state !== 'default'

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`
        w-full flex items-start gap-3 p-3 rounded-md border
        text-left transition-colors duration-200 group
        ${borderColor}
        ${disabled ? 'cursor-default' : 'cursor-pointer'}
      `}
    >
      <span
        className={`
          flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center
          text-xs font-mono border transition-colors duration-200
          ${letterStyle}
          ${!disabled ? 'group-hover:border-red-primary/40 group-hover:text-red-primary' : ''}
        `}
      >
        {state === 'correct' ? <Check size={12} strokeWidth={3} /> :
          state === 'incorrect' ? <X size={12} strokeWidth={3} /> : letter}
      </span>
      <span className={`text-sm font-body leading-relaxed quiz-math ${
        state === 'correct' ? 'text-emerald-800' :
          state === 'incorrect' ? 'text-red-primary' : 'text-text-body'
      }`}>
        <MathText>{text}</MathText>
      </span>
    </button>
  )
}

/* ---------- Question Card ---------- */

function QuestionCard({
  question,
  index,
  total,
  selectedAnswer,
  onSelect,
}: {
  question: MCQuestion
  index: number
  total: number
  selectedAnswer: number | null
  onSelect: (optionIndex: number) => void
}) {
  const answered = selectedAnswer !== null
  const isCorrect = selectedAnswer === question.correct_index

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className="border border-border-warm rounded-lg p-5 bg-bg-card"
    >
      {/* Question header */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-text-muted font-mono">
          {index + 1}/{total}
        </span>
        <DifficultyBadge level={question.difficulty} />
      </div>

      {/* Question text */}
      <div className="text-sm font-body text-text-main leading-relaxed mb-4 quiz-math">
        <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
          {texify(question.question)}
        </ReactMarkdown>
      </div>

      {/* Options */}
      <div className="space-y-2">
        {question.options.map((opt, i) => {
          let state: 'default' | 'selected' | 'correct' | 'incorrect' | 'revealed' = 'default'
          if (answered) {
            if (i === question.correct_index) state = 'correct'
            else if (i === selectedAnswer) state = 'incorrect'
            else state = 'default'
          }
          return (
            <OptionButton
              key={i}
              text={opt}
              index={i}
              state={state}
              onClick={() => onSelect(i)}
            />
          )
        })}
      </div>

      {/* Explanation (shown after answering) */}
      <AnimatePresence>
        {answered && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3 }}
            className="mt-4"
          >
            <div className={`
              border-l-3 p-3 rounded-r-md text-sm font-body leading-relaxed
              ${isCorrect
                ? 'border-l-emerald-500 bg-emerald-50/50 text-emerald-800'
                : 'border-l-red-primary bg-red-primary/5 text-text-body'
              }
            `}>
              <p className="font-medium mb-1">
                {isCorrect ? '回答正确' : '回答错误'}
              </p>
              <div className="text-text-body quiz-math">
                <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                  {texify(question.explanation)}
                </ReactMarkdown>
              </div>
            </div>

            {/* Source trace */}
            <div className="flex items-center gap-1.5 mt-2 text-[11px] text-text-muted">
              <BookOpen size={11} />
              <span>
                来自：{question.source_module_name}
                {question.source_page && ` · 第${question.source_page}页`}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

/* ---------- Score Summary ---------- */

function ScoreSummary({
  correct,
  total,
  onRetry,
  onGenerateFlashcards,
}: {
  correct: number
  total: number
  onRetry: () => void
  onGenerateFlashcards?: () => void
}) {
  const pct = Math.round((correct / total) * 100)
  const grade = pct >= 80 ? '优秀' : pct >= 60 ? '良好' : '需加强'
  const gradeColor = pct >= 80 ? 'text-emerald-600' : pct >= 60 ? 'text-amber-600' : 'text-red-primary'

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="border border-border-warm rounded-lg p-5 bg-bg-card text-center"
    >
      <p className="text-xs text-text-muted font-body mb-2">测验结果</p>
      <p className="font-heading text-3xl text-text-main">
        {correct}<span className="text-lg text-text-muted">/{total}</span>
      </p>
      <p className={`text-sm font-body mt-1 ${gradeColor}`}>{grade} · {pct}%</p>

      <div className="flex items-center justify-center gap-3 mt-4">
        <button
          type="button"
          onClick={onRetry}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-body text-text-muted
                     border border-border-warm rounded-md hover:border-red-primary/40 transition-colors"
        >
          <RotateCcw size={12} />
          重做
        </button>
        {onGenerateFlashcards && (
          <button
            type="button"
            onClick={onGenerateFlashcards}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-body text-white
                       bg-red-primary rounded-md hover:bg-red-dark transition-colors"
          >
            生成闪卡
            <ChevronRight size={12} />
          </button>
        )}
      </div>
    </motion.div>
  )
}

/* ---------- Main Component ---------- */

export default function QuizPanel({ questions, onGenerateFlashcards }: QuizPanelProps) {
  const [answers, setAnswers] = useState<Record<number, number>>({})

  const handleSelect = useCallback((questionIdx: number, optionIdx: number) => {
    setAnswers(prev => {
      if (prev[questionIdx] !== undefined) return prev // Already answered
      return { ...prev, [questionIdx]: optionIdx }
    })
  }, [])

  const handleRetry = useCallback(() => {
    setAnswers({})
  }, [])

  const answeredCount = Object.keys(answers).length
  const allAnswered = answeredCount === questions.length
  const correctCount = Object.entries(answers).filter(
    ([qIdx, aIdx]) => questions[Number(qIdx)]?.correct_index === aIdx,
  ).length

  if (questions.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-text-muted font-body">
        暂无测验题
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h4 className="font-heading text-base text-text-main">自测验</h4>
        <span className="text-xs font-mono text-text-muted">
          {answeredCount}/{questions.length} 已作答
        </span>
      </div>

      {/* Questions */}
      {questions.map((q, i) => (
        <QuestionCard
          key={i}
          question={q}
          index={i}
          total={questions.length}
          selectedAnswer={answers[i] ?? null}
          onSelect={(optIdx) => handleSelect(i, optIdx)}
        />
      ))}

      {/* Score */}
      {allAnswered && (
        <ScoreSummary
          correct={correctCount}
          total={questions.length}
          onRetry={handleRetry}
          onGenerateFlashcards={onGenerateFlashcards}
        />
      )}
    </div>
  )
}
