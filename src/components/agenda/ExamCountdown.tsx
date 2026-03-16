/**
 * ExamCountdown — displays a countdown badge/card for upcoming exams.
 */
import { AlertTriangle, Clock } from 'lucide-react'
import type { ExamConfig } from '@/lib/agenda-engine'
import { differenceInDays } from 'date-fns'

interface ExamCountdownProps {
  examConfig: ExamConfig
  compact?: boolean
}

function getDaysLeft(examDate: string): number {
  return differenceInDays(new Date(examDate), new Date())
}

function getUrgencyClass(daysLeft: number): { text: string; border: string; bg: string } {
  if (daysLeft <= 3) return { text: 'text-red-primary', border: 'border-red-primary/30', bg: 'bg-red-primary/5' }
  if (daysLeft <= 7) return { text: 'text-accent-gold', border: 'border-accent-gold/30', bg: 'bg-accent-gold/5' }
  return { text: 'text-text-muted', border: 'border-border-warm', bg: 'bg-bg-accent' }
}

export default function ExamCountdown({ examConfig, compact }: ExamCountdownProps) {
  const daysLeft = getDaysLeft(examConfig.examDate)
  const urgency = getUrgencyClass(daysLeft)

  if (compact) {
    return (
      <span className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded ${urgency.text} ${urgency.border} border`}>
        <Clock size={11} strokeWidth={1.5} />
        {daysLeft === 0 ? '今天' : `${daysLeft}天`}
      </span>
    )
  }

  return (
    <div className={`border ${urgency.border} ${urgency.bg} rounded-lg p-4 min-w-[180px]`}>
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle size={14} strokeWidth={1.5} className={urgency.text} />
        <span className={`text-xs font-body ${urgency.text}`}>
          {daysLeft <= 3 ? '紧急' : '即将到来'}
        </span>
      </div>
      <p className="font-heading text-base text-text-main">{examConfig.courseName}</p>
      <p className={`text-2xl font-heading mt-1 ${urgency.text}`}>
        {daysLeft === 0 ? '今天考试' : `${daysLeft} 天`}
      </p>
      <p className="text-xs text-text-muted mt-1">{examConfig.examDate}</p>
    </div>
  )
}
