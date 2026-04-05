/**
 * FillBlankCard — Fill-in-the-blank question with inline input fields.
 * Replaces {{blank}} markers in question text with styled inputs.
 * Editorial academic design: warm paper, red accents, serif headings.
 */
import { useState, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, X, BookOpen } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import type { FillBlankQuestion } from '@/lib/types/question'

interface FillBlankCardProps {
  question: FillBlankQuestion
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

function checkAnswer(userInput: string, acceptable: string): boolean {
  const trimmed = userInput.trim().toLowerCase()
  if (!trimmed) return false
  return acceptable.split('|').some(alt => alt.trim().toLowerCase() === trimmed)
}

export default function FillBlankCard({ question, index, total, onAnswer }: FillBlankCardProps) {
  const [inputs, setInputs] = useState<string[]>(() => question.blanks.map(() => ''))
  const [submitted, setSubmitted] = useState(false)

  const results = useMemo(() => {
    if (!submitted) return null
    return inputs.map((val, i) => checkAnswer(val, question.blanks[i]))
  }, [submitted, inputs, question.blanks])

  const correctCount = results?.filter(Boolean).length ?? 0
  const allCorrect = results !== null && correctCount === question.blanks.length

  const handleSubmit = useCallback(() => {
    if (submitted) return
    setSubmitted(true)
    const correct = inputs.every((val, i) => checkAnswer(val, question.blanks[i]))
    const earned = correct ? question.points : Math.round(question.points * (correctCount / question.blanks.length))
    onAnswer(correct, earned)
  }, [submitted, inputs, question, onAnswer, correctCount])

  const handleInputChange = useCallback((blankIdx: number, value: string) => {
    setInputs(prev => {
      const next = [...prev]
      next[blankIdx] = value
      return next
    })
  }, [])

  // Split question text on {{blank}} markers, interleave with inputs
  const parts = useMemo(() => question.question.split(/\{\{blank\}\}/gi), [question.question])

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
          <span className="text-[10px] px-1.5 py-0.5 rounded border border-blue-200 bg-blue-50 text-blue-700 font-body">填空</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-text-muted font-mono">{question.points}分</span>
          <DifficultyBadge level={question.difficulty} />
        </div>
      </div>

      {/* Question with inline blanks */}
      <div className="text-sm font-body text-text-main leading-relaxed mb-4 flex flex-wrap items-baseline gap-y-2">
        {parts.map((part, i) => (
          <span key={i} className="inline">
            <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}
              components={{ p: ({ children: c }) => <span>{c}</span> }}
            >{part}</ReactMarkdown>
            {i < parts.length - 1 && (
              <input
                type="text"
                value={inputs[i] ?? ''}
                onChange={e => handleInputChange(i, e.target.value)}
                disabled={submitted}
                className={`inline-block w-28 mx-1 px-2 py-0.5 text-sm border-b-2 bg-transparent
                  outline-none font-body transition-colors
                  ${submitted
                    ? results?.[i] ? 'border-emerald-500 text-emerald-700' : 'border-red-primary text-red-primary'
                    : 'border-border-warm focus:border-red-primary text-text-main'
                  }`}
                placeholder={`空${i + 1}`}
              />
            )}
          </span>
        ))}
      </div>

      {/* Submit button */}
      {!submitted && (
        <button
          onClick={handleSubmit}
          disabled={inputs.some(v => !v.trim())}
          className="px-4 py-1.5 text-xs font-body text-white bg-red-primary rounded-sm
                     hover:bg-red-dark transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          提交答案
        </button>
      )}

      {/* Feedback */}
      <AnimatePresence>
        {submitted && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-4">
            {/* Correct answers */}
            <div className="flex flex-wrap gap-2 mb-3">
              {question.blanks.map((ans, i) => (
                <span key={i} className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded border font-body
                  ${results?.[i] ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-primary/20 bg-red-50 text-red-primary'}`}>
                  {results?.[i] ? <Check size={10} /> : <X size={10} />}
                  空{i + 1}: {ans.split('|')[0]}
                </span>
              ))}
            </div>

            <div className={`border-l-3 p-3 rounded-r-md text-sm font-body leading-relaxed
              ${allCorrect ? 'border-l-emerald-500 bg-emerald-50/50 text-emerald-800' : 'border-l-red-primary bg-red-primary/5 text-text-body'}`}>
              <p className="font-medium mb-1">{allCorrect ? '全部正确' : `${correctCount}/${question.blanks.length} 正确`}</p>
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
