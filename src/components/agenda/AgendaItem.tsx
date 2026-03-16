/**
 * AgendaItem — renders a single agenda entry with type-specific styling.
 */
import { motion, AnimatePresence } from 'framer-motion'
import { Link } from 'react-router-dom'
import { AlertTriangle, Brain, BookOpen, CheckCircle, Award, Square, CheckSquare } from 'lucide-react'
import type { AgendaItem as AgendaItemType } from '@/lib/agenda-engine'

interface AgendaItemProps {
  item: AgendaItemType
  index: number
  onToggleComplete?: (id: string) => void
}

const typeConfig = {
  'exam-prep': {
    icon: AlertTriangle,
    dotColor: 'bg-red-primary',
    label: '备考',
  },
  'flashcard-review': {
    icon: Brain,
    dotColor: 'bg-accent-gold',
    label: '闪卡复习',
  },
  study: {
    icon: BookOpen,
    dotColor: 'bg-text-muted',
    label: '学习',
  },
  todo: {
    icon: CheckCircle,
    dotColor: 'bg-border-warm',
    label: '待办',
  },
  milestone: {
    icon: Award,
    dotColor: 'bg-accent-gold',
    label: '成就',
  },
} as const

function getItemTitle(item: AgendaItemType): string {
  switch (item.type) {
    case 'exam-prep':
      return `${item.courseName} 备考${item.moduleName ? ` · ${item.moduleName}` : ''}`
    case 'flashcard-review':
      return `${item.courseName} 闪卡复习（${item.dueCount}张到期）`
    case 'study':
      return `${item.courseName} · ${item.moduleName}`
    case 'todo':
      return item.title
    case 'milestone':
      return item.title
  }
}

function getItemSubtext(item: AgendaItemType): string | null {
  switch (item.type) {
    case 'exam-prep':
      return item.daysLeft === 0
        ? '今天考试'
        : item.daysLeft === 1
          ? '明天考试'
          : `${item.daysLeft}天后考试`
    case 'flashcard-review':
    case 'study':
      return `预计${item.estimatedMin}分钟`
    case 'exam-prep':
      return `预计${item.estimatedMin}分钟`
    default:
      return null
  }
}

function getItemLink(item: AgendaItemType): string | null {
  if (item.type === 'flashcard-review') return '/my/flashcards'
  if (item.type === 'exam-prep' || item.type === 'study') return `/course/${item.courseId}`
  return null
}

export default function AgendaItem({ item, index, onToggleComplete }: AgendaItemProps) {
  const config = typeConfig[item.type]
  const Icon = config.icon
  const title = getItemTitle(item)
  const subtext = getItemSubtext(item)
  const link = getItemLink(item)
  const isCompleted = 'completed' in item && item.completed
  const isTodo = item.type === 'todo'

  const content = (
    <motion.div
      className="flex items-start gap-3 py-3"
      animate={{ opacity: isCompleted ? 0.4 : 1 }}
      transition={{ duration: 0.3 }}
    >
      {/* Left dot / checkbox */}
      {isTodo ? (
        <motion.button
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onToggleComplete?.(item.id)
          }}
          whileTap={{ scale: 0.8 }}
          className="mt-0.5 shrink-0 text-text-muted hover:text-red-primary transition-colors duration-150"
        >
          <AnimatePresence mode="wait" initial={false}>
            {isCompleted ? (
              <motion.span
                key="checked"
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.5, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                className="block text-red-primary"
              >
                <CheckSquare size={16} strokeWidth={1.5} />
              </motion.span>
            ) : (
              <motion.span
                key="unchecked"
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.5, opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="block"
              >
                <Square size={16} strokeWidth={1.5} />
              </motion.span>
            )}
          </AnimatePresence>
        </motion.button>
      ) : (
        <div className={`w-2 h-2 rounded-full ${config.dotColor} mt-1.5 shrink-0`} />
      )}

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Icon size={13} strokeWidth={1.5} className="text-text-muted shrink-0" />
          <p className={`text-sm text-text-body leading-snug font-body ${isCompleted ? 'line-through' : ''}`}>
            {title}
          </p>
        </div>
        {subtext && (
          <p className="text-[11px] text-text-muted mt-0.5 ml-[21px] font-body">{subtext}</p>
        )}
      </div>

      {/* Priority / urgency badge */}
      {item.type === 'exam-prep' && item.daysLeft <= 3 && (
        <span className="text-[11px] px-1.5 py-0.5 rounded border border-red-primary/30 text-red-primary shrink-0 font-body">
          紧急
        </span>
      )}
      {item.type === 'study' && item.priority === 'high' && (
        <span className="text-[11px] px-1.5 py-0.5 rounded border border-accent-gold/30 text-accent-gold shrink-0 font-body">
          重点
        </span>
      )}
    </motion.div>
  )

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.3, ease: 'easeOut' }}
      className="border-b border-border-warm last:border-b-0"
    >
      {link && !isCompleted ? (
        <Link to={link} className="block no-underline hover:bg-bg-accent/40 transition-colors duration-150 -mx-2 px-2 rounded">
          {content}
        </Link>
      ) : (
        content
      )}
    </motion.div>
  )
}
