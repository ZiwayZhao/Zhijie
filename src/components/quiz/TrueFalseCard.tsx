/**
 * TrueFalseCard — True/False question with two-button selection.
 * Editorial academic design: warm paper, red accents, serif headings.
 */
import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, X, BookOpen } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import type { TrueFalseQuestion } from '@/lib/types/question'

interface TrueFalseCardProps {
  question: TrueFalseQuestion
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

export default function TrueFalseCard({ question, index, total, onAnswer }: TrueFalseCardProps) {
  const [selected, setSelected] = useState<boolean | null>(null)
  const answered = selected !== null
  const isCorrect = selected === question.correct_answer

  const handleSelect = useCallback((value: boolean) => {
    if (answered) return
    setSelected(value)
    onAnswer(value === question.correct_answer, value === question.correct_answer ? question.points : 0)
  }, [answered, question, onAnswer])

  const btnClass = (value: boolean) => {
    if (!answered) {
      return 'border-border-warm hover:border-red-primary/40 text-text-body'
    }
    if (value === question.correct_answer) {
      return 'border-emerald-500 bg-emerald-50/50 text-emerald-700'
    }
    if (value === selected) {
      return 'border-red-primary bg-red-primary/5 text-red-primary'
    }
    return 'border-border-warm text-text-muted opacity-50'
  }

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
          <span className="text-[10px] px-1.5 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-700 font-body">判断</span>
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

      {/* True / False buttons */}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => handleSelect(true)}
          disabled={answered}
          className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-sm border
            text-sm font-body transition-colors ${btnClass(true)}
            ${answered ? 'cursor-default' : 'cursor-pointer'}`}
        >
          {answered && true === question.correct_answer ? <Check size={14} /> : null}
          {answered && true === selected && !isCorrect ? <X size={14} /> : null}
          正确
        </button>
        <button
          type="button"
          onClick={() => handleSelect(false)}
          disabled={answered}
          className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-sm border
            text-sm font-body transition-colors ${btnClass(false)}
            ${answered ? 'cursor-default' : 'cursor-pointer'}`}
        >
          {answered && false === question.correct_answer ? <Check size={14} /> : null}
          {answered && false === selected && !isCorrect ? <X size={14} /> : null}
          错误
        </button>
      </div>

      {/* Explanation */}
      <AnimatePresence>
        {answered && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-4">
            <div className={`border-l-3 p-3 rounded-r-md text-sm font-body leading-relaxed
              ${isCorrect ? 'border-l-emerald-500 bg-emerald-50/50 text-emerald-800' : 'border-l-red-primary bg-red-primary/5 text-text-body'}`}>
              <p className="font-medium mb-1">{isCorrect ? '回答正确' : '回答错误'}</p>
              <p className="text-xs text-text-muted mb-1">
                正确答案：{question.correct_answer ? '正确' : '错误'}
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
