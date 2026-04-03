/**
 * QuizPanelV2 — Multi-type quiz panel with progress tracking and score summary.
 * Supports MCQ, fill-blank, true/false, short answer, and calculation questions.
 * Editorial academic design: warm card borders, red accent, staggered animations.
 */
import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { RotateCcw, ChevronRight, BarChart3 } from 'lucide-react'
import type { QuestionItem } from '@/lib/types/question'
import type { QuizSessionResult } from '@/hooks/useQuizSession'
import QuestionRenderer from '@/components/quiz/QuestionRenderer'

interface QuizPanelV2Props {
  questions: QuestionItem[]
  onGenerateFlashcards?: () => void
  onQuizComplete?: (results: QuizSessionResult[]) => void
}

/* ---------- Type label mapping ---------- */

const TYPE_LABELS: Record<string, string> = {
  mcq: '选择',
  fill_blank: '填空',
  true_false: '判断',
  short_answer: '简答',
  calculation: '计算',
}

const TYPE_COLORS: Record<string, string> = {
  mcq: 'border-sky-200 bg-sky-50 text-sky-700',
  fill_blank: 'border-blue-200 bg-blue-50 text-blue-700',
  true_false: 'border-amber-200 bg-amber-50 text-amber-700',
  short_answer: 'border-orange-200 bg-orange-50 text-orange-700',
  calculation: 'border-teal-200 bg-teal-50 text-teal-700',
}

/* ---------- Score Summary ---------- */

function ScoreSummary({
  totalPoints,
  earnedPoints,
  answeredCount,
  totalCount,
  typeBreakdown,
  onRetry,
  onGenerateFlashcards,
}: {
  totalPoints: number
  earnedPoints: number
  answeredCount: number
  totalCount: number
  typeBreakdown: { type: string; count: number; earned: number; total: number }[]
  onRetry: () => void
  onGenerateFlashcards?: () => void
}) {
  const pct = totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 100) : 0
  const grade = pct >= 90 ? '优秀' : pct >= 80 ? '良好' : pct >= 60 ? '及格' : '需加强'
  const gradeColor = pct >= 80 ? 'text-emerald-600' : pct >= 60 ? 'text-amber-600' : 'text-red-primary'

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="border border-border-warm rounded-sm p-5 bg-bg-card"
    >
      {/* Overall score */}
      <div className="text-center mb-4">
        <p className="text-xs text-text-muted font-body mb-2">测验结果</p>
        <p className="font-heading text-3xl text-text-main">
          {earnedPoints}<span className="text-lg text-text-muted">/{totalPoints}分</span>
        </p>
        <p className={`text-sm font-body mt-1 ${gradeColor}`}>{grade} · {pct}%</p>
        <p className="text-xs text-text-muted font-mono mt-1">
          {answeredCount}/{totalCount} 题已作答
        </p>
      </div>

      {/* Type breakdown */}
      {typeBreakdown.length > 1 && (
        <div className="border-t border-border-warm pt-3 mb-4">
          <div className="flex items-center gap-1.5 mb-2">
            <BarChart3 size={12} className="text-text-muted" />
            <span className="text-xs text-text-muted font-body">各题型得分</span>
          </div>
          <div className="space-y-1.5">
            {typeBreakdown.map(({ type, count, earned, total }) => {
              const typePct = total > 0 ? Math.round((earned / total) * 100) : 0
              return (
                <div key={type} className="flex items-center gap-2">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border font-body ${TYPE_COLORS[type] ?? ''}`}>
                    {TYPE_LABELS[type] ?? type}
                  </span>
                  <span className="text-xs text-text-muted font-mono">{count}题</span>
                  <div className="flex-1 h-1.5 bg-bg-main rounded-full overflow-hidden">
                    <div
                      className="h-full bg-red-primary rounded-full transition-all duration-500"
                      style={{ width: `${typePct}%` }}
                    />
                  </div>
                  <span className="text-xs text-text-body font-mono w-16 text-right">
                    {earned}/{total}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-center gap-3">
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

export default function QuizPanelV2({ questions, onGenerateFlashcards, onQuizComplete }: QuizPanelV2Props) {
  const [results, setResults] = useState<Record<number, { correct: boolean; points: number }>>({})
  const completeFired = useRef(false)

  const handleAnswer = useCallback((qIdx: number, correct: boolean, points: number) => {
    setResults(prev => {
      if (prev[qIdx] !== undefined) return prev
      return { ...prev, [qIdx]: { correct, points } }
    })
  }, [])

  const handleRetry = useCallback(() => {
    setResults({})
    completeFired.current = false
  }, [])

  const answeredCount = Object.keys(results).length
  const allAnswered = answeredCount === questions.length && questions.length > 0

  // Fire onQuizComplete once when all questions are answered
  useEffect(() => {
    if (!allAnswered || completeFired.current || !onQuizComplete) return
    completeFired.current = true

    const sessionResults: QuizSessionResult[] = questions.map((q, i) => ({
      sourceModuleName: q.source_module_name,
      questionType: q.question_type,
      correct: results[i]?.correct ?? false,
      earnedPoints: results[i]?.points ?? 0,
      maxPoints: q.points,
    }))

    onQuizComplete(sessionResults)
  }, [allAnswered, onQuizComplete, questions, results])

  const totalPoints = useMemo(() =>
    questions.reduce((sum, q) => sum + q.points, 0),
    [questions]
  )

  const earnedPoints = useMemo(() =>
    Object.values(results).reduce((sum, r) => sum + r.points, 0),
    [results]
  )

  // Count questions by type
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const q of questions) {
      counts[q.question_type] = (counts[q.question_type] ?? 0) + 1
    }
    return counts
  }, [questions])

  // Type breakdown for summary
  const typeBreakdown = useMemo(() => {
    const breakdown: Record<string, { count: number; earned: number; total: number }> = {}
    questions.forEach((q, i) => {
      const t = q.question_type
      if (!breakdown[t]) breakdown[t] = { count: 0, earned: 0, total: 0 }
      breakdown[t].count++
      breakdown[t].total += q.points
      if (results[i]) breakdown[t].earned += results[i].points
    })
    return Object.entries(breakdown).map(([type, data]) => ({ type, ...data }))
  }, [questions, results])

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

      {/* Type tags + total points */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-text-muted font-body">共 {totalPoints} 分</span>
        <span className="text-border-warm">·</span>
        {Object.entries(typeCounts).map(([type, count]) => (
          <span key={type} className={`text-[10px] px-1.5 py-0.5 rounded border font-body ${TYPE_COLORS[type] ?? ''}`}>
            {TYPE_LABELS[type] ?? type} {count}
          </span>
        ))}
      </div>

      {/* Progress bar */}
      {answeredCount > 0 && !allAnswered && (
        <div className="h-1 bg-bg-main rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-red-primary rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${(answeredCount / questions.length) * 100}%` }}
            transition={{ duration: 0.4 }}
          />
        </div>
      )}

      {/* Questions */}
      {questions.map((q, i) => (
        <QuestionRenderer
          key={i}
          question={q}
          index={i}
          total={questions.length}
          onAnswer={(correct, points) => handleAnswer(i, correct, points)}
        />
      ))}

      {/* Score summary */}
      {allAnswered && (
        <ScoreSummary
          totalPoints={totalPoints}
          earnedPoints={earnedPoints}
          answeredCount={answeredCount}
          totalCount={questions.length}
          typeBreakdown={typeBreakdown}
          onRetry={handleRetry}
          onGenerateFlashcards={onGenerateFlashcards}
        />
      )}
    </div>
  )
}
