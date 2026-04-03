/**
 * QuestionRenderer — Routes to the correct card component based on question_type.
 * Handles MCQ via the existing QuizPanel's QuestionCard pattern inline.
 */
import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, X, BookOpen } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import type { QuestionItem, MCQuestion } from '@/lib/types/question'
import FillBlankCard from '@/components/quiz/FillBlankCard'
import TrueFalseCard from '@/components/quiz/TrueFalseCard'
import ShortAnswerCard from '@/components/quiz/ShortAnswerCard'
import CalculationCard from '@/components/quiz/CalculationCard'

interface QuestionRendererProps {
  question: QuestionItem
  index: number
  total: number
  onAnswer: (correct: boolean, points: number) => void
}

/* ---------- DifficultyBadge ---------- */

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

/* ---------- MCQ Card (inline, matches existing QuizPanel pattern) ---------- */

function MCQCard({ question, index, total, onAnswer }: {
  question: MCQuestion; index: number; total: number
  onAnswer: (correct: boolean, points: number) => void
}) {
  const [selected, setSelected] = useState<number | null>(null)
  const answered = selected !== null
  const isCorrect = selected === question.correct_index

  const handleSelect = useCallback((optIdx: number) => {
    if (answered) return
    setSelected(optIdx)
    onAnswer(optIdx === question.correct_index, optIdx === question.correct_index ? question.points : 0)
  }, [answered, question, onAnswer])

  const optionState = (i: number) => {
    if (!answered) return 'default'
    if (i === question.correct_index) return 'correct'
    if (i === selected) return 'incorrect'
    return 'default'
  }

  const borderMap: Record<string, string> = {
    correct: 'border-emerald-500 bg-emerald-50/50',
    incorrect: 'border-red-primary bg-red-primary/5',
    default: 'border-border-warm hover:border-red-primary/40',
  }

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }} className="border border-border-warm rounded-sm p-5 bg-bg-card">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted font-mono">{index + 1}/{total}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded border border-sky-200 bg-sky-50 text-sky-700 font-body">选择</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-text-muted font-mono">{question.points}分</span>
          <DifficultyBadge level={question.difficulty} />
        </div>
      </div>
      <div className="text-sm font-body text-text-main leading-relaxed mb-4 quiz-math">
        <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
          {question.question}
        </ReactMarkdown>
      </div>
      <div className="space-y-2">
        {question.options.map((opt, i) => {
          const state = optionState(i)
          const letter = String.fromCharCode(65 + i)
          return (
            <button key={i} type="button" onClick={() => handleSelect(i)} disabled={answered}
              className={`w-full flex items-start gap-3 p-3 rounded-md border text-left transition-colors
                ${borderMap[state]} ${answered ? 'cursor-default' : 'cursor-pointer'}`}>
              <span className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-mono border
                ${state === 'correct' ? 'bg-emerald-500 text-white border-emerald-500'
                  : state === 'incorrect' ? 'bg-red-primary text-white border-red-primary'
                  : 'bg-bg-accent text-text-muted border-border-warm'}`}>
                {state === 'correct' ? <Check size={12} strokeWidth={3} />
                  : state === 'incorrect' ? <X size={12} strokeWidth={3} /> : letter}
              </span>
              <span className={`text-sm font-body leading-relaxed
                ${state === 'correct' ? 'text-emerald-800' : state === 'incorrect' ? 'text-red-primary' : 'text-text-body'}`}>
                {opt}
              </span>
            </button>
          )
        })}
      </div>
      <AnimatePresence>
        {answered && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-4">
            <div className={`border-l-3 p-3 rounded-r-md text-sm font-body leading-relaxed
              ${isCorrect ? 'border-l-emerald-500 bg-emerald-50/50 text-emerald-800' : 'border-l-red-primary bg-red-primary/5 text-text-body'}`}>
              <p className="font-medium mb-1">{isCorrect ? '回答正确' : '回答错误'}</p>
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

/* ---------- Main Router ---------- */

export default function QuestionRenderer({ question, index, total, onAnswer }: QuestionRendererProps) {
  switch (question.question_type) {
    case 'mcq':
      return <MCQCard question={question} index={index} total={total} onAnswer={onAnswer} />
    case 'fill_blank':
      return <FillBlankCard question={question} index={index} total={total} onAnswer={onAnswer} />
    case 'true_false':
      return <TrueFalseCard question={question} index={index} total={total} onAnswer={onAnswer} />
    case 'short_answer':
      return <ShortAnswerCard question={question} index={index} total={total} onAnswer={onAnswer} />
    case 'calculation':
      return <CalculationCard question={question} index={index} total={total} onAnswer={onAnswer} />
    default:
      return (
        <div className="border border-border-warm rounded-sm p-5 bg-bg-card text-sm text-text-muted">
          不支持的题目类型
        </div>
      )
  }
}
