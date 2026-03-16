/**
 * ProcessingView — editorial 4-phase pipeline timeline.
 * Shows analysis progress with vertical timeline nodes,
 * pulsing active state, and specialist sub-progress.
 *
 * Design: editorial academic — warm borders, red accents, serif headings,
 * vertical timeline with connecting lines, no shadows.
 */
import { motion } from 'framer-motion'
import { FileText, Layers, BookOpen, ClipboardCheck, Check, X, Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'

/* ---------- Types ---------- */

export type PipelinePhase = 'init' | 'parsing' | 'cartographer' | 'specialist' | 'examiner' | 'done'

interface ProcessingViewProps {
  phase: PipelinePhase
  progress: number
  message: string
  detail?: { completed?: number; total?: number }
  error?: string
}

/* ---------- Phase Config ---------- */

interface PhaseConfig {
  key: PipelinePhase
  label: string
  icon: ReactNode
}

const PHASES: PhaseConfig[] = [
  { key: 'parsing', label: '解析文档', icon: <FileText size={16} /> },
  { key: 'cartographer', label: '分析结构', icon: <Layers size={16} /> },
  { key: 'specialist', label: '生成精讲', icon: <BookOpen size={16} /> },
  { key: 'examiner', label: '生成测验', icon: <ClipboardCheck size={16} /> },
]

const PHASE_ORDER: PipelinePhase[] = ['parsing', 'cartographer', 'specialist', 'examiner', 'done']

function getPhaseIndex(phase: PipelinePhase): number {
  const idx = PHASE_ORDER.indexOf(phase)
  return idx === -1 ? 0 : idx
}

/* ---------- Node States ---------- */

type NodeState = 'pending' | 'active' | 'completed' | 'error'

function getNodeState(
  nodePhase: PipelinePhase,
  currentPhase: PipelinePhase,
  hasError: boolean,
): NodeState {
  const nodeIdx = getPhaseIndex(nodePhase)
  const currentIdx = getPhaseIndex(currentPhase)

  if (hasError && nodePhase === currentPhase) return 'error'
  if (nodeIdx < currentIdx) return 'completed'
  if (nodeIdx === currentIdx) return 'active'
  return 'pending'
}

/* ---------- Timeline Node ---------- */

function TimelineNode({
  config,
  state,
  isLast,
  subProgress,
}: {
  config: PhaseConfig
  state: NodeState
  isLast: boolean
  subProgress?: string
}) {
  return (
    <div className="flex gap-3">
      {/* Node circle + connector line */}
      <div className="flex flex-col items-center">
        <div
          className={`
            relative w-8 h-8 rounded-full flex items-center justify-center
            border-2 transition-colors duration-300
            ${state === 'completed'
              ? 'border-red-primary bg-red-primary text-white'
              : state === 'active'
                ? 'border-red-primary bg-bg-card text-red-primary'
                : state === 'error'
                  ? 'border-red-primary bg-red-primary/10 text-red-primary'
                  : 'border-border-warm bg-bg-card text-text-muted'
            }
          `}
        >
          {state === 'completed' ? (
            <Check size={14} strokeWidth={3} />
          ) : state === 'error' ? (
            <X size={14} strokeWidth={3} />
          ) : state === 'active' ? (
            <>
              <motion.div
                className="absolute inset-0 rounded-full border-2 border-red-primary"
                animate={{ scale: [1, 1.4, 1], opacity: [0.5, 0, 0.5] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
              />
              {config.icon}
            </>
          ) : (
            config.icon
          )}
        </div>

        {/* Connector line */}
        {!isLast && (
          <div
            className={`
              w-[2px] h-8 transition-colors duration-500
              ${state === 'completed' ? 'bg-red-primary' : 'bg-border-warm border-dashed'}
            `}
          />
        )}
      </div>

      {/* Label + sub info */}
      <div className="pt-1 pb-4">
        <span
          className={`
            text-sm font-body transition-colors duration-300
            ${state === 'completed'
              ? 'text-text-main font-medium'
              : state === 'active'
                ? 'text-text-main font-medium'
                : state === 'error'
                  ? 'text-red-primary font-medium'
                  : 'text-text-muted'
            }
          `}
        >
          {config.label}
        </span>

        {state === 'active' && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="flex items-center gap-1.5 mt-1"
          >
            <Loader2 size={12} className="animate-spin text-red-primary" />
            {subProgress && (
              <span className="text-xs text-text-muted font-mono">{subProgress}</span>
            )}
          </motion.div>
        )}
      </div>
    </div>
  )
}

/* ---------- Main Component ---------- */

export default function ProcessingView({
  phase,
  progress,
  message,
  detail,
  error,
}: ProcessingViewProps) {
  const hasError = !!error

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="border border-border-warm rounded-lg p-5 bg-bg-card"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h4 className="font-heading text-base text-text-main">
          {hasError ? '分析失败' : phase === 'done' ? '分析完成' : '正在分析'}
        </h4>
        <span className="text-xs font-mono text-text-muted">
          {Math.round(progress * 100)}%
        </span>
      </div>

      {/* Progress bar (thin, editorial) */}
      <div className="w-full h-1 bg-bg-accent rounded-full overflow-hidden mb-5">
        <motion.div
          className={`h-full rounded-full ${hasError ? 'bg-red-primary/60' : 'bg-red-primary'}`}
          animate={{ width: `${Math.round(progress * 100)}%` }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        />
      </div>

      {/* Timeline */}
      <div className="pl-1">
        {PHASES.map((cfg, i) => {
          const state = getNodeState(cfg.key, phase, hasError)
          const isSpecialist = cfg.key === 'specialist' && state === 'active' && detail
          const subText = isSpecialist
            ? `${detail?.completed ?? 0}/${detail?.total ?? '?'} 模块`
            : undefined

          return (
            <TimelineNode
              key={cfg.key}
              config={cfg}
              state={state}
              isLast={i === PHASES.length - 1}
              subProgress={subText}
            />
          )
        })}
      </div>

      {/* Current message */}
      <div className="mt-3 pt-3 border-t border-border-warm">
        <p className="text-xs text-text-muted font-body leading-relaxed">
          {error || message}
        </p>
      </div>
    </motion.div>
  )
}
