/**
 * ToolResultDisplay — renders the result of a manual tool API call.
 * Each tool type gets its own sub-renderer with Editorial Academic styling.
 */
import { motion } from 'framer-motion'
import {
  BookOpen, Target, Network, AlertTriangle,
  ListChecks, X, ArrowRight,
} from 'lucide-react'
import type {
  ToolSummaryResult,
  ToolExamPointsResult,
  ToolMistakeAnalysisResult,
  ToolConceptMapResult,
  ToolReadingNotesResult,
} from '@/lib/api'

/* ---------- Types ---------- */

export type ToolResultData =
  | { toolId: 'summary'; data: ToolSummaryResult }
  | { toolId: 'key-points'; data: ToolExamPointsResult }
  | { toolId: 'pitfalls'; data: ToolMistakeAnalysisResult }
  | { toolId: 'concept-map'; data: ToolConceptMapResult }
  | { toolId: 'deep-read'; data: ToolReadingNotesResult }

interface ToolResultDisplayProps {
  result: ToolResultData
  onDismiss: () => void
}

/* ---------- Main Component ---------- */

export default function ToolResultDisplay({ result, onDismiss }: ToolResultDisplayProps) {
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.25 }}
      className="overflow-hidden"
    >
      <div className="border-l-3 border-l-accent-gold border border-border-warm
                      rounded-sm bg-bg-card p-4 mt-2">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-heading text-text-main flex items-center gap-2">
            <ToolIcon toolId={result.toolId} />
            {toolLabel(result.toolId)}
          </h4>
          <button
            onClick={onDismiss}
            className="text-text-muted hover:text-text-body transition-colors p-1"
            aria-label="关闭结果"
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
        <div className="text-sm text-text-body leading-relaxed">
          {result.toolId === 'summary' && <SummaryDisplay data={result.data} />}
          {result.toolId === 'key-points' && <ExamPointsDisplay data={result.data} />}
          {result.toolId === 'pitfalls' && <MistakeDisplay data={result.data} />}
          {result.toolId === 'concept-map' && <ConceptMapDisplay data={result.data} />}
          {result.toolId === 'deep-read' && <ReadingNotesDisplay data={result.data} />}
        </div>
      </div>
    </motion.div>
  )
}

/* ---------- Tool Icon ---------- */

function ToolIcon({ toolId }: { toolId: string }) {
  const size = 14
  const strokeWidth = 1.5
  const cls = "text-accent-gold"
  switch (toolId) {
    case 'summary': return <ListChecks size={size} strokeWidth={strokeWidth} className={cls} />
    case 'key-points': return <Target size={size} strokeWidth={strokeWidth} className={cls} />
    case 'pitfalls': return <AlertTriangle size={size} strokeWidth={strokeWidth} className={cls} />
    case 'concept-map': return <Network size={size} strokeWidth={strokeWidth} className={cls} />
    case 'deep-read': return <BookOpen size={size} strokeWidth={strokeWidth} className={cls} />
    default: return null
  }
}

function toolLabel(toolId: string): string {
  const map: Record<string, string> = {
    'summary': '一键总结',
    'key-points': '考点提取',
    'pitfalls': '易错总结',
    'concept-map': '概念图谱',
    'deep-read': '精读笔记',
  }
  return map[toolId] ?? '工具结果'
}

/* ---------- Summary ---------- */

function SummaryDisplay({ data }: { data: ToolSummaryResult }) {
  return (
    <div className="space-y-3">
      <p className="text-text-body">{data.summary}</p>
      {data.key_points.length > 0 && (
        <div>
          <p className="text-xs font-medium text-text-muted mb-1.5">关键要点</p>
          <ul className="space-y-1">
            {data.key_points.map((point, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-text-body">
                <ArrowRight size={10} strokeWidth={2} className="text-accent-gold mt-1 shrink-0" />
                {point}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-[10px] text-text-muted">共 {data.word_count} 字</p>
    </div>
  )
}

/* ---------- Exam Points ---------- */

function ExamPointsDisplay({ data }: { data: ToolExamPointsResult }) {
  return (
    <div className="space-y-2">
      {data.points.map((pt, i) => (
        <div key={i} className="border-l-2 border-l-red-primary/40 pl-3 py-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-text-main">{pt.concept}</span>
            <FreqBadge frequency={pt.frequency} />
          </div>
          {pt.exam_types.length > 0 && (
            <div className="flex gap-1 mt-1 flex-wrap">
              {pt.exam_types.map((t, j) => (
                <span key={j} className="text-[10px] px-1.5 py-px border border-border-warm rounded-sm text-text-muted">
                  {t}
                </span>
              ))}
            </div>
          )}
          {pt.tip && <p className="text-xs text-text-muted mt-1">{pt.tip}</p>}
        </div>
      ))}
    </div>
  )
}

function FreqBadge({ frequency }: { frequency: string }) {
  const isHigh = frequency === 'high' || frequency === '高'
  const isMed = frequency === 'medium' || frequency === '中'
  const cls = isHigh
    ? 'text-red-primary border-red-primary'
    : isMed
      ? 'text-accent-gold border-accent-gold'
      : 'text-text-muted border-border-warm'
  const label = isHigh ? '高频' : isMed ? '中频' : '低频'
  return (
    <span className={`text-[10px] px-1 py-px border rounded-sm ${cls}`}>
      {label}
    </span>
  )
}

/* ---------- Mistake Analysis ---------- */

function MistakeDisplay({ data }: { data: ToolMistakeAnalysisResult }) {
  return (
    <div className="space-y-2">
      {data.items.map((m, i) => (
        <div key={i} className="border-l-2 border-l-red-primary/30 pl-3 py-1">
          <p className="text-xs font-medium text-text-main">{m.concept}</p>
          <p className="text-xs text-text-body mt-0.5">{m.common_mistake}</p>
          <p className="text-xs text-accent-gold mt-1">
            <span className="font-medium">正确理解：</span>{m.correct_understanding}
          </p>
          {m.confusion_pairs.length > 0 && (
            <div className="flex gap-1 mt-1 flex-wrap">
              {m.confusion_pairs.map((pair, j) => (
                <span key={j} className="text-[10px] px-1.5 py-px border border-border-warm rounded-sm text-text-muted">
                  {pair}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

/* ---------- Concept Map (text list -- visual graph is Phase 6) ---------- */

function ConceptMapDisplay({ data }: { data: ToolConceptMapResult }) {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-medium text-text-muted mb-1.5">
          概念节点 ({data.nodes.length})
        </p>
        <div className="flex flex-wrap gap-1.5">
          {data.nodes.map((n) => (
            <span
              key={n.id}
              className="text-xs px-2 py-0.5 border border-border-warm rounded-sm bg-bg-accent text-text-body"
              title={n.description}
            >
              {n.name}
            </span>
          ))}
        </div>
      </div>
      {data.edges.length > 0 && (
        <div>
          <p className="text-xs font-medium text-text-muted mb-1.5">
            关联关系 ({data.edges.length})
          </p>
          <div className="space-y-1">
            {data.edges.map((e, i) => {
              const src = data.nodes.find(n => n.id === e.source)?.name ?? e.source
              const tgt = data.nodes.find(n => n.id === e.target)?.name ?? e.target
              return (
                <div key={i} className="flex items-center gap-1.5 text-xs text-text-body">
                  <span className="font-medium">{src}</span>
                  <ArrowRight size={10} strokeWidth={2} className="text-accent-gold" />
                  <span className="font-medium">{tgt}</span>
                  <span className="text-text-muted">({e.relation})</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

/* ---------- Reading Notes ---------- */

function ReadingNotesDisplay({ data }: { data: ToolReadingNotesResult }) {
  return (
    <div className="space-y-3">
      {data.title && (
        <p className="text-xs font-medium text-text-main">{data.title}</p>
      )}
      {data.sections.map((section, i) => (
        <div key={i} className="border-l-2 border-l-accent-gold/40 pl-3 py-1">
          <p className="text-xs font-medium text-text-main">{section.heading}</p>
          <p className="text-xs text-text-body mt-1">{section.content}</p>
        </div>
      ))}
      {data.key_formulas.length > 0 && (
        <div>
          <p className="text-xs font-medium text-text-muted mb-1">关键公式</p>
          <div className="space-y-0.5">
            {data.key_formulas.map((f, i) => (
              <p key={i} className="text-xs text-text-body font-mono">{f}</p>
            ))}
          </div>
        </div>
      )}
      {data.summary && (
        <div className="border-t border-border-warm pt-2">
          <p className="text-xs text-text-muted">{data.summary}</p>
        </div>
      )}
    </div>
  )
}
