/**
 * IntentGatherer — handles the 'idle' and 'gathering' phases of AIToolPanel.
 * Shows learning intent options (learn/exam/review) and context questions.
 */
import { motion } from 'framer-motion'
import { BookOpen, Target, RefreshCw, ArrowRight } from 'lucide-react'
import type { ExamProfile } from '@/lib/exam-profile'

/* ---------- Types ---------- */

export type Intent = 'learn' | 'exam' | 'review'

export interface GatheringData {
  examDate?: string
  masteryLevel?: number
  familiarity?: 'zero' | 'basic' | 'advanced'
  examProfile?: ExamProfile
  referenceMaterialIds?: string[]
}

interface IdlePhaseProps {
  onSelect: (i: Intent) => void
}

interface GatheringPhaseProps {
  intent: Intent
  data: GatheringData
  onChange: (d: GatheringData) => void
  onSubmit: () => void
  onBack: () => void
}

/* ---------- Constants ---------- */

const INTENTS: { key: Intent; icon: React.ElementType; title: string; subtitle: string }[] = [
  { key: 'learn', icon: BookOpen, title: '学透这份材料', subtitle: '深度理解，全面掌握' },
  { key: 'exam', icon: Target, title: '备考冲刺', subtitle: '聚焦考点，高效备考' },
  { key: 'review', icon: RefreshCw, title: '快速复习', subtitle: '间隔复习，巩固记忆' },
]

/* ---------- IdlePhase ---------- */

export function IdlePhase({ onSelect }: IdlePhaseProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="space-y-2.5"
    >
      <p className="text-sm text-text-muted">选择你的学习目标，AI 将为你定制分析方案：</p>
      {INTENTS.map((item) => {
        const Icon = item.icon
        return (
          <button
            key={item.key}
            onClick={() => onSelect(item.key)}
            className="w-full flex items-center gap-3 px-4 py-3.5 rounded-md border border-border-warm bg-bg-card text-left transition-all hover:border-red-primary"
          >
            <Icon size={20} strokeWidth={1.5} className="text-red-primary shrink-0" />
            <div>
              <div className="text-sm font-medium text-text-main">{item.title}</div>
              <div className="text-xs mt-0.5 text-text-muted">{item.subtitle}</div>
            </div>
          </button>
        )
      })}
    </motion.div>
  )
}

/* ---------- GatheringPhase ---------- */

export function GatheringPhase({
  intent,
  data,
  onChange,
  onSubmit,
  onBack,
}: GatheringPhaseProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="space-y-4"
    >
      <button
        onClick={onBack}
        className="text-xs text-text-muted hover:text-text-body transition-colors"
      >
        &larr; 返回选择
      </button>

      {intent === 'exam' && (
        <ExamGatheringFields data={data} onChange={onChange} />
      )}
      {intent === 'learn' && (
        <LearnGatheringFields data={data} onChange={onChange} />
      )}

      <button
        onClick={onSubmit}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-md bg-red-primary text-white text-sm font-medium transition-colors hover:bg-red-dark"
      >
        开始分析
        <ArrowRight size={16} strokeWidth={1.5} />
      </button>
    </motion.div>
  )
}

/* ---------- Field sub-components ---------- */

function ExamGatheringFields({
  data,
  onChange,
}: {
  data: GatheringData
  onChange: (d: GatheringData) => void
}) {
  return (
    <>
      <div>
        <label className="block text-sm font-medium text-text-main mb-1.5">
          考试什么时候？
        </label>
        <input
          type="date"
          value={data.examDate ?? ''}
          onChange={(e) => onChange({ ...data, examDate: e.target.value })}
          className="input-field"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-text-main mb-1.5">
          目前掌握程度
        </label>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={data.masteryLevel ?? 30}
            onChange={(e) => onChange({ ...data, masteryLevel: Number(e.target.value) })}
            className="flex-1 accent-red-primary"
          />
          <span className="text-sm text-text-body font-mono w-10 text-right">
            {data.masteryLevel ?? 30}%
          </span>
        </div>
      </div>
    </>
  )
}

function LearnGatheringFields({
  data,
  onChange,
}: {
  data: GatheringData
  onChange: (d: GatheringData) => void
}) {
  const options: { value: GatheringData['familiarity']; label: string }[] = [
    { value: 'zero', label: '零基础 — 完全没接触过' },
    { value: 'basic', label: '有基础 — 学过但不扎实' },
    { value: 'advanced', label: '想深入 — 已有基础，追求精通' },
  ]

  return (
    <div>
      <label className="block text-sm font-medium text-text-main mb-2">
        你对这个主题了解多少？
      </label>
      <div className="space-y-2">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange({ ...data, familiarity: opt.value })}
            className={[
              'w-full text-left px-3 py-2.5 rounded-md border text-sm transition-all',
              data.familiarity === opt.value
                ? 'border-red-primary bg-bg-accent text-text-main'
                : 'border-border-warm bg-bg-card text-text-body hover:border-red-primary',
            ].join(' ')}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}
