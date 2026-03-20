/**
 * ExamInfoCard — collect exam information when user selects "备考" intent.
 * Editorial academic design: warm backgrounds, red accent, progressive disclosure.
 */
import { useState, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Calendar, Clock, BookOpen, FileQuestion, Plus, Check, X, ChevronRight } from 'lucide-react'
import type { ExamProfile, QuestionTypeDistribution } from '@/lib/exam-profile'
import { defaultExamProfile, guessCourseType, saveExamProfile } from '@/lib/exam-profile'

interface ExamInfoCardProps {
  courseId: string
  courseName?: string
  onConfirm: (profile: ExamProfile) => void
  onSkip: () => void
}

const DURATION_OPTIONS = [60, 90, 120, 150, 180]
const TYPE_LABELS: Record<string, string> = {
  mcq: '选择题', fill_blank: '填空题', true_false: '判断题',
  short_answer: '简答题', calculation: '计算题',
}
const ALL_TYPES: QuestionTypeDistribution['question_type'][] = [
  'mcq', 'fill_blank', 'true_false', 'short_answer', 'calculation',
]
const TOTAL_STEPS = 4
const toggleCls = (on: boolean) =>
  on ? 'border-red-primary text-red-primary bg-red-primary/5'
     : 'border-border-warm text-text-muted hover:border-red-primary/40'
const inputCls = 'w-14 px-2 py-1 text-xs text-center border border-border-warm rounded-sm bg-bg-main text-text-body focus:border-red-primary focus:outline-none font-body'

export default function ExamInfoCard({ courseId, courseName, onConfirm, onSkip }: ExamInfoCardProps) {
  const [step, setStep] = useState(0)
  const [examDate, setExamDate] = useState('')
  const [duration, setDuration] = useState<number | undefined>(undefined)
  const [isOpenBook, setIsOpenBook] = useState<boolean | undefined>(undefined)
  const [distribution, setDistribution] = useState<QuestionTypeDistribution[]>([])
  const courseType = useMemo(() => guessCourseType(courseName ?? ''), [courseName])

  const buildProfile = useCallback((): ExamProfile => {
    const dist = distribution.length > 0 ? distribution : defaultExamProfile(courseType).question_distribution
    const tp = dist.reduce((s, d) => s + d.count * d.points_each, 0)
    return {
      exam_date: examDate || undefined, duration_minutes: duration, is_open_book: isOpenBook,
      total_points: tp || 100, source: 'user_input',
      question_distribution: dist.map((d) => ({
        ...d, total_points: d.count * d.points_each, percentage: tp > 0 ? (d.count * d.points_each) / tp : 0,
      })),
    }
  }, [examDate, duration, isOpenBook, distribution, courseType])

  const handleConfirm = useCallback(() => {
    const p = buildProfile(); saveExamProfile(courseId, p); onConfirm(p)
  }, [buildProfile, courseId, onConfirm])

  const handleSkip = useCallback(() => {
    const p = defaultExamProfile(courseType); saveExamProfile(courseId, p); onSkip()
  }, [courseId, courseType, onSkip])

  const handleNext = useCallback(() => {
    step < TOTAL_STEPS - 1 ? setStep((s) => s + 1) : handleConfirm()
  }, [step, handleConfirm])

  const updateRow = useCallback((idx: number, field: 'count' | 'points_each', v: number) => {
    setDistribution((prev) => prev.map((d, i) => i === idx ? { ...d, [field]: v } : d))
  }, [])

  const addRow = useCallback(() => {
    const used = new Set(distribution.map((d) => d.question_type))
    const next = ALL_TYPES.find((t) => !used.has(t))
    if (next) setDistribution((p) => [...p, { question_type: next, count: 5, points_each: 2, total_points: 10, percentage: 0 }])
  }, [distribution])

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
      className="border border-border-warm rounded-sm bg-bg-card overflow-hidden">
      {/* Header */}
      <div className="border-l-3 border-l-red-primary px-4 py-3 bg-bg-accent/50">
        <div className="flex items-center gap-2">
          <FileQuestion size={15} className="text-red-primary" strokeWidth={1.5} />
          <h4 className="font-heading text-sm text-text-main">考试信息</h4>
        </div>
        <p className="text-xs text-text-muted mt-1">补充考试信息，帮助 AI 生成更贴近真实考试的练习题</p>
      </div>
      {/* Step dots */}
      <div className="flex items-center justify-center gap-1.5 py-2.5 border-b border-border-warm">
        {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
          <div key={i} className={`w-1.5 h-1.5 rounded-full transition-colors duration-300 ${
            i < step ? 'bg-red-primary' : i === step ? 'bg-red-primary/60' : 'bg-border-warm'}`} />
        ))}
      </div>
      {/* Step content */}
      <div className="px-4 py-4 min-h-[140px]">
        <AnimatePresence mode="wait">
          {step === 0 && (
            <Slide key="date">
              <Label icon={<Calendar size={13} strokeWidth={1.5} />} text="考试日期" />
              <input type="date" value={examDate} onChange={(e) => setExamDate(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border-warm rounded-sm bg-bg-main text-text-body focus:border-red-primary focus:outline-none transition-colors font-body" />
              <p className="text-[11px] text-text-muted mt-1.5">可留空，稍后再设置</p>
            </Slide>
          )}
          {step === 1 && (
            <Slide key="duration">
              <Label icon={<Clock size={13} strokeWidth={1.5} />} text="考试时长" />
              <div className="flex flex-wrap gap-2">
                {DURATION_OPTIONS.map((d) => (
                  <button key={d} onClick={() => setDuration(duration === d ? undefined : d)}
                    className={`px-3 py-1.5 text-xs border rounded-sm transition-colors font-body ${toggleCls(duration === d)}`}>
                    {d} 分钟
                  </button>
                ))}
              </div>
            </Slide>
          )}
          {step === 2 && (
            <Slide key="format">
              <Label icon={<BookOpen size={13} strokeWidth={1.5} />} text="考试形式" />
              <div className="flex gap-2">
                {([false, true] as const).map((open) => (
                  <button key={String(open)} onClick={() => setIsOpenBook(isOpenBook === open ? undefined : open)}
                    className={`flex-1 px-3 py-2 text-xs border rounded-sm transition-colors font-body ${toggleCls(isOpenBook === open)}`}>
                    {open ? '开卷' : '闭卷'}
                  </button>
                ))}
              </div>
            </Slide>
          )}
          {step === 3 && (
            <Slide key="dist">
              <Label icon={<FileQuestion size={13} strokeWidth={1.5} />} text="题型分布" />
              {distribution.length === 0 && (
                <button onClick={() => setDistribution(defaultExamProfile(courseType).question_distribution)}
                  className="w-full text-xs text-red-primary hover:underline font-body py-2 text-left">
                  使用默认分布（{courseType === 'math' ? '理工类' : courseType === 'cs' ? '计算机类' : '人文类'}）
                </button>
              )}
              {distribution.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-[10px] text-text-muted font-body px-1">
                    <span className="flex-1">题型</span>
                    <span className="w-14 text-center">数量</span>
                    <span className="w-14 text-center">每题分</span>
                    <span className="w-5" />
                  </div>
                  {distribution.map((d, idx) => (
                    <div key={d.question_type} className="flex items-center gap-2">
                      <span className="flex-1 text-xs text-text-body font-body truncate">
                        {TYPE_LABELS[d.question_type] ?? d.question_type}
                      </span>
                      <input type="number" min={1} max={50} value={d.count}
                        onChange={(e) => updateRow(idx, 'count', Math.max(1, Number(e.target.value) || 1))}
                        className={inputCls} />
                      <input type="number" min={1} max={50} value={d.points_each}
                        onChange={(e) => updateRow(idx, 'points_each', Math.max(1, Number(e.target.value) || 1))}
                        className={inputCls} />
                      <button onClick={() => setDistribution((p) => p.filter((_, i) => i !== idx))}
                        className="w-5 h-5 flex items-center justify-center text-text-muted hover:text-red-primary transition-colors">
                        <X size={11} strokeWidth={1.5} />
                      </button>
                    </div>
                  ))}
                  <div className="flex items-center gap-2 pt-1 border-t border-border-warm/60">
                    <span className="flex-1 text-[11px] text-text-muted font-body">合计</span>
                    <span className="w-14 text-center text-[11px] text-text-muted font-body">
                      {distribution.reduce((s, d) => s + d.count, 0)} 题
                    </span>
                    <span className="w-14 text-center text-[11px] text-text-muted font-body">
                      {distribution.reduce((s, d) => s + d.count * d.points_each, 0)} 分
                    </span>
                    <span className="w-5" />
                  </div>
                  {distribution.length < ALL_TYPES.length && (
                    <button onClick={addRow}
                      className="flex items-center gap-1 text-xs text-red-primary hover:underline font-body pt-1">
                      <Plus size={11} strokeWidth={1.5} />添加题型
                    </button>
                  )}
                </div>
              )}
            </Slide>
          )}
        </AnimatePresence>
      </div>
      {/* Footer */}
      <div className="px-4 pb-4 flex items-center justify-between">
        <button onClick={handleSkip}
          className="text-xs text-text-muted hover:text-text-body transition-colors font-body">
          跳过，使用默认设置
        </button>
        <div className="flex items-center gap-2">
          {step > 0 && (
            <button onClick={() => setStep((s) => s - 1)}
              className="px-3 py-1.5 text-xs border border-border-warm rounded-sm text-text-muted hover:border-red-primary/40 transition-colors font-body">
              上一步
            </button>
          )}
          <button onClick={handleNext}
            className="flex items-center gap-1 px-3 py-1.5 text-xs text-white bg-red-primary rounded-sm hover:bg-red-dark transition-colors font-body">
            {step < TOTAL_STEPS - 1 ? (<>下一步<ChevronRight size={12} strokeWidth={1.5} /></>) : (<><Check size={12} strokeWidth={1.5} />确认</>)}
          </button>
        </div>
      </div>
    </motion.div>
  )
}

/* ---------- Helpers ---------- */

function Slide({ children }: { children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.2 }} className="space-y-3">
      {children}
    </motion.div>
  )
}

function Label({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-text-muted font-body">{icon}<span>{text}</span></div>
  )
}
