/**
 * ExamCountdown — displays a countdown badge/card for upcoming exams.
 * Editorial style: warm paper bg, serif numbers, left accent border.
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

function getUrgencyAccent(daysLeft: number): { text: string; border: string; bg: string } {
  if (daysLeft <= 3) return { text: 'text-red-primary', border: 'border-red-primary/40', bg: 'bg-bg-accent' }
  if (daysLeft <= 7) return { text: 'text-accent-gold', border: 'border-accent-gold/40', bg: 'bg-bg-accent' }
  return { text: 'text-text-muted', border: 'border-border-warm', bg: 'bg-bg-accent' }
}

export default function ExamCountdown({ examConfig, compact }: ExamCountdownProps) {
  const daysLeft = getDaysLeft(examConfig.examDate)
  const urgency = getUrgencyAccent(daysLeft)

  if (compact) {
    return (
      <span className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border ${urgency.text} ${urgency.border}`}>
        <Clock size={11} strokeWidth={1.5} />
        {daysLeft === 0 ? '今天' : `${daysLeft}天`}
      </span>
    )
  }

  const leftBorderColor = daysLeft <= 3 ? 'border-l-red-primary' : daysLeft <= 7 ? 'border-l-accent-gold' : 'border-l-border-warm'

  return (
    <div className={`border border-border-warm ${leftBorderColor} border-l-[3px] ${urgency.bg} rounded-md p-5 min-w-[200px]`}>
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle size={13} strokeWidth={1.5} className={urgency.text} />
        <span className={`text-[11px] font-body tracking-wide ${urgency.text}`}>
          {daysLeft <= 3 ? '紧急' : '即将到来'}
        </span>
      </div>
      <p className="font-heading text-base text-text-main tracking-tight">{examConfig.courseName}</p>
      <p className={`text-2xl font-heading mt-1.5 ${urgency.text} leading-none`}>
        {daysLeft === 0 ? '今天考试' : `${daysLeft} 天`}
      </p>
      <p className="text-[11px] text-text-muted mt-2 font-body">{examConfig.examDate}</p>
    </div>
  )
}
