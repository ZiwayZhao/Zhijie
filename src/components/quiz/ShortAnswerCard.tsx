/**
 * ShortAnswerCard — Short answer with self-grading rubric checklist.
 * After submit: shows reference answer + rubric items as checkboxes.
 * User self-assesses which points they covered.
 * Editorial academic design: warm paper, red accents, serif headings.
 */
import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { BookOpen, Send, CheckSquare, Square } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import type { ShortAnswerQuestion } from '@/lib/types/question'

interface ShortAnswerCardProps {
  question: ShortAnswerQuestion
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

const MAX_CHARS = 500

export default function ShortAnswerCard({ question, index, total, onAnswer }: ShortAnswerCardProps) {
  const [text, setText] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [checkedRubric, setCheckedRubric] = useState<boolean[]>(() =>
    question.scoring_rubric.map(() => false)
  )
  const [graded, setGraded] = useState(false)

  const handleSubmit = useCallback(() => {
    if (submitted || !text.trim()) return
    setSubmitted(true)
  }, [submitted, text])

  const toggleRubric = useCallback((idx: number) => {
    setCheckedRubric(prev => {
      const next = [...prev]
      next[idx] = !next[idx]
      return next
    })
  }, [])

  const handleConfirmGrade = useCallback(() => {
    if (graded) return
    setGraded(true)
    const coveredCount = checkedRubric.filter(Boolean).length
    const totalRubric = question.scoring_rubric.length
    const earned = Math.round(question.points * (coveredCount / totalRubric))
    const allCovered = coveredCount === totalRubric
    onAnswer(allCovered, earned)
  }, [graded, checkedRubric, question, onAnswer])

  const coveredCount = checkedRubric.filter(Boolean).length
  const selfScore = Math.round(question.points * (coveredCount / question.scoring_rubric.length))

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
          <span className="text-[10px] px-1.5 py-0.5 rounded border border-orange-200 bg-orange-50 text-orange-700 font-body">简答</span>
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

      {/* Answer textarea */}
      <div className="relative mb-3">
        <textarea
          value={text}
          onChange={e => setText(e.target.value.slice(0, MAX_CHARS))}
          disabled={submitted}
          placeholder="在此输入你的答案..."
          rows={4}
          className={`w-full px-3 py-2 text-sm font-body border rounded-md resize-none
            outline-none transition-colors bg-bg-main
            ${submitted ? 'border-border-warm text-text-muted' : 'border-border-warm focus:border-red-primary text-text-body'}`}
        />
        <span className="absolute bottom-2 right-3 text-[10px] text-text-muted font-mono">
          {text.length}/{MAX_CHARS}
        </span>
      </div>

      {!submitted && (
        <button
          onClick={handleSubmit}
          disabled={!text.trim()}
          className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-body text-white bg-red-primary
                     rounded-md hover:bg-red-dark transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Send size={11} />
          提交答案
        </button>
      )}

      {/* Grading section */}
      <AnimatePresence>
        {submitted && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-4">
            {/* Reference answer */}
            <div className="border-l-3 border-l-red-primary p-3 rounded-r-md bg-bg-accent mb-3">
              <p className="text-xs font-medium text-text-muted mb-1">参考答案</p>
              <div className="text-sm font-body text-text-body leading-relaxed quiz-math">
                <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                  {question.reference_answer}
                </ReactMarkdown>
              </div>
            </div>

            {/* Self-grading rubric */}
            <div className="border border-border-warm rounded-md p-3 mb-3">
              <p className="text-xs font-medium text-text-main mb-2">自评得分点（勾选你覆盖的要点）</p>
              <div className="space-y-1.5">
                {question.scoring_rubric.map((item, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => !graded && toggleRubric(i)}
                    disabled={graded}
                    className="flex items-start gap-2 w-full text-left text-sm font-body text-text-body
                               hover:text-text-main transition-colors disabled:cursor-default"
                  >
                    {checkedRubric[i]
                      ? <CheckSquare size={14} className="mt-0.5 text-emerald-600 flex-shrink-0" />
                      : <Square size={14} className="mt-0.5 text-text-muted flex-shrink-0" />
                    }
                    <span>{item}</span>
                  </button>
                ))}
              </div>
              <div className="flex items-center justify-between mt-3 pt-2 border-t border-border-warm">
                <span className="text-xs text-text-muted font-mono">
                  自评：{selfScore}/{question.points}分
                </span>
                {!graded && (
                  <button
                    onClick={handleConfirmGrade}
                    className="px-3 py-1 text-xs font-body text-white bg-red-primary
                               rounded-md hover:bg-red-dark transition-colors"
                  >
                    确认评分
                  </button>
                )}
              </div>
            </div>

            {/* Explanation */}
            <div className="border-l-3 border-l-emerald-500 p-3 rounded-r-md bg-emerald-50/50 text-sm font-body leading-relaxed text-text-body">
              <p className="font-medium mb-1 text-emerald-800">解析</p>
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
