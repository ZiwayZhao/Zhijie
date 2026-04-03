/**
 * CalculationCard — Multi-step calculation question.
 * Each step has an input field; reveals correct answers with color-coded feedback.
 * Editorial academic design: warm paper, red accents, serif headings.
 */
import { useState, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, X, BookOpen, Eye } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import type { CalculationQuestion } from '@/lib/types/question'

interface CalculationCardProps {
  question: CalculationQuestion
  index: number
  total: number
  onAnswer: (correct: boolean, points: number) => void
}

function DifficultyBadge({ level }: { level: string }) {
  const styles: Record<string, string> = {
    easy: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    medium: 'bg-amber-50 text-amber-700 border-amber-200',
    hard: 'bg-red-50 text-red-primary border-red-primary/20',
  }
  const labels: Record<string, string> = { easy: '基础', medium: '中等', hard: '进阶' }
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-body ${styles[level] ?? styles.medium}`}>
      {labels[level] ?? level}
    </span>
  )
}

function normalizeAnswer(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, '')
}

export default function CalculationCard({ question, index, total, onAnswer }: CalculationCardProps) {
  const [stepInputs, setStepInputs] = useState<string[]>(() => question.steps.map(() => ''))
  const [finalInput, setFinalInput] = useState('')
  const [revealed, setRevealed] = useState(false)

  const stepResults = useMemo(() => {
    if (!revealed) return null
    return question.steps.map((step, i) =>
      normalizeAnswer(stepInputs[i]) === normalizeAnswer(step.answer)
    )
  }, [revealed, stepInputs, question.steps])

  const finalCorrect = useMemo(() => {
    if (!revealed) return false
    return normalizeAnswer(finalInput) === normalizeAnswer(question.final_answer)
  }, [revealed, finalInput, question.final_answer])

  const earnedPoints = useMemo(() => {
    if (!revealed || !stepResults) return 0
    let pts = 0
    stepResults.forEach((ok, i) => { if (ok) pts += question.steps[i].points })
    return pts
  }, [revealed, stepResults, question.steps])

  const handleReveal = useCallback(() => {
    if (revealed) return
    setRevealed(true)
    const allCorrect = question.steps.every((step, i) =>
      normalizeAnswer(stepInputs[i]) === normalizeAnswer(step.answer)
    ) && normalizeAnswer(finalInput) === normalizeAnswer(question.final_answer)
    const pts = question.steps.reduce((sum, step, i) =>
      sum + (normalizeAnswer(stepInputs[i]) === normalizeAnswer(step.answer) ? step.points : 0), 0)
    onAnswer(allCorrect, pts)
  }, [revealed, question, stepInputs, finalInput, onAnswer])

  const handleStepChange = useCallback((idx: number, value: string) => {
    setStepInputs(prev => {
      const next = [...prev]
      next[idx] = value
      return next
    })
  }, [])

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className="border border-border-warm rounded-sm p-5 bg-bg-card"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted font-mono">{index + 1}/{total}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded border border-teal-200 bg-teal-50 text-teal-700 font-body">计算</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-text-muted font-mono">{question.points}分</span>
          <DifficultyBadge level={question.difficulty} />
        </div>
      </div>

      {/* Question */}
      <div className="text-sm font-body text-text-main leading-relaxed mb-4 quiz-math">
        <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
          {question.question}
        </ReactMarkdown>
      </div>

      {/* Steps */}
      <div className="space-y-3 mb-4">
        {question.steps.map((step, i) => (
          <div key={i} className={`border rounded-md p-3 transition-colors
            ${revealed
              ? stepResults?.[i] ? 'border-emerald-300 bg-emerald-50/30' : 'border-red-primary/30 bg-red-primary/5'
              : 'border-border-warm'
            }`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-body text-text-muted">
                步骤 {i + 1}
                <span className="ml-1 text-[10px] font-mono">({step.points}分)</span>
              </span>
              {revealed && (
                stepResults?.[i]
                  ? <Check size={12} className="text-emerald-600" />
                  : <X size={12} className="text-red-primary" />
              )}
            </div>
            <p className="text-sm font-body text-text-body mb-2">{step.step}</p>
            <input
              type="text"
              value={stepInputs[i]}
              onChange={e => handleStepChange(i, e.target.value)}
              disabled={revealed}
              placeholder="输入答案"
              className={`w-full px-2 py-1.5 text-sm font-body border rounded-md outline-none transition-colors bg-bg-main
                ${revealed
                  ? stepResults?.[i] ? 'border-emerald-400 text-emerald-700' : 'border-red-primary text-red-primary'
                  : 'border-border-warm focus:border-red-primary text-text-main'
                }`}
            />
            {revealed && !stepResults?.[i] && (
              <p className="text-xs text-emerald-700 mt-1 font-mono">
                正确答案：{step.answer}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Final answer */}
      <div className={`border rounded-md p-3 mb-4 transition-colors
        ${revealed
          ? finalCorrect ? 'border-emerald-300 bg-emerald-50/30' : 'border-red-primary/30 bg-red-primary/5'
          : 'border-border-warm bg-bg-accent'
        }`}>
        <span className="text-xs font-medium text-text-main">最终答案</span>
        <input
          type="text"
          value={finalInput}
          onChange={e => setFinalInput(e.target.value)}
          disabled={revealed}
          placeholder="输入最终答案"
          className={`w-full mt-2 px-2 py-1.5 text-sm font-body border rounded-md outline-none transition-colors bg-bg-main
            ${revealed
              ? finalCorrect ? 'border-emerald-400 text-emerald-700' : 'border-red-primary text-red-primary'
              : 'border-border-warm focus:border-red-primary text-text-main'
            }`}
        />
        {revealed && !finalCorrect && (
          <p className="text-xs text-emerald-700 mt-1 font-mono">
            正确答案：{question.final_answer}
          </p>
        )}
      </div>

      {/* Submit / Results */}
      {!revealed && (
        <button
          onClick={handleReveal}
          className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-body text-white bg-red-primary
                     rounded-md hover:bg-red-dark transition-colors"
        >
          <Eye size={11} />
          查看答案
        </button>
      )}

      <AnimatePresence>
        {revealed && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-4">
            <div className="border-l-3 border-l-emerald-500 p-3 rounded-r-md bg-emerald-50/50 text-sm font-body leading-relaxed text-text-body">
              <p className="font-medium mb-1 text-emerald-800">
                得分：{earnedPoints}/{question.points}分
              </p>
              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                {question.explanation}
              </ReactMarkdown>
            </div>
            <div className="flex items-center gap-1.5 mt-2 text-[11px] text-text-muted">
              <BookOpen size={11} />
              <span>来自：{question.source_module_name}{question.source_page && ` · 第${question.source_page}页`}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
