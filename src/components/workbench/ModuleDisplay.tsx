/**
 * ModuleDisplay — shows analysis results (modules list), error state,
 * and manual tool selection. Handles the 'complete' and 'error' phases.
 */
import { motion, AnimatePresence } from 'framer-motion'
import {
  BookOpen,
  Target,

  Network,
  MessageCircleQuestion,
  ListChecks,
  ClipboardCheck,
  AlertTriangle,
  Brain,
  Loader2,
  Wrench,
  ChevronDown,
  CheckCircle2,
  AlertOctagon,
  RotateCcw,
  FileText,
} from 'lucide-react'
import type { DisassemblyModule } from '@/lib/api'

/* ---------- Types ---------- */

interface Tool {
  id: string
  label: string
  description: string
  icon: React.ElementType
}

interface CompletePhaseProps {
  modules: DisassemblyModule[]
  loadingModule: string | null
  onModuleClick: (mod: DisassemblyModule) => void
  onReset: () => void
}

interface ErrorPhaseProps {
  message: string
  onRetry: () => void
}

interface ManualToolSectionProps {
  expanded: boolean
  onToggle: () => void
  activeTool: string | null
  onToolClick: (toolId: string) => void
}

/* ---------- Constants ---------- */

const allTools: Tool[] = [
  { id: 'deep-read', label: '精读笔记', description: '逐段精读，生成结构化笔记', icon: BookOpen },
  { id: 'concept-map', label: '概念图谱', description: '提取核心概念及其关联', icon: Network },
  { id: 'qa', label: '知识问答', description: '基于材料内容的智能问答', icon: MessageCircleQuestion },
  { id: 'key-points', label: '考点提取', description: '识别高频考点与重点', icon: Target },
  { id: 'mock-quiz', label: '模拟测验', description: '生成模拟试题检验掌握度', icon: ClipboardCheck },
  { id: 'pitfalls', label: '易错总结', description: '归纳常见错误与易混概念', icon: AlertTriangle },
  { id: 'summary', label: '一键总结', description: '快速生成材料摘要', icon: ListChecks },
  { id: 'flashcards', label: '闪卡生成', description: '提取关键知识点生成闪卡', icon: Brain },
]

/* ---------- CompletePhase ---------- */

export function CompletePhase({
  modules,
  loadingModule,
  onModuleClick,
  onReset,
}: CompletePhaseProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="space-y-3"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-text-main font-medium">
          <CheckCircle2 size={16} className="text-green-600" />
          分析完成
        </div>
        <button
          onClick={onReset}
          className="text-xs text-text-muted hover:text-text-body transition-colors flex items-center gap-1"
        >
          <RotateCcw size={12} strokeWidth={1.5} />
          重新分析
        </button>
      </div>

      <p className="text-xs text-text-muted">
        发现 {modules.length} 个知识模块，点击查看 AI 精讲：
      </p>

      <div className="space-y-2">
        {modules.map((mod, i) => (
          <motion.button
            key={mod.id}
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.06 }}
            onClick={() => onModuleClick(mod)}
            disabled={loadingModule === mod.id}
            className="w-full flex items-start gap-3 p-3 rounded-md border-l-3 border border-border-warm bg-bg-card text-left transition-all border-l-red-primary hover:bg-bg-accent"
          >
            {loadingModule === mod.id ? (
              <Loader2 size={16} className="animate-spin text-accent-gold mt-0.5 shrink-0" />
            ) : (
              <FileText size={16} strokeWidth={1.5} className="text-red-primary mt-0.5 shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-text-main">{mod.name}</div>
              <div className="flex items-center gap-2 text-xs text-text-muted mt-0.5">
                <span>第 {mod.pages} 页</span>
                <span className="text-[10px]">&middot;</span>
                <WeightBadge weight={mod.examWeight} />
              </div>
            </div>
          </motion.button>
        ))}
      </div>
    </motion.div>
  )
}

/* ---------- WeightBadge ---------- */

function WeightBadge({ weight }: { weight: DisassemblyModule['examWeight'] }) {
  const map = {
    high: { label: '高频考点', cls: 'text-red-primary border-red-primary' },
    medium: { label: '中频考点', cls: 'text-accent-gold border-accent-gold' },
    low: { label: '低频考点', cls: 'text-text-muted border-border-warm' },
  }
  const { label, cls } = map[weight]
  return (
    <span className={`px-1.5 py-px text-[10px] border rounded-sm ${cls}`}>
      {label}
    </span>
  )
}

/* ---------- ErrorPhase ---------- */

export function ErrorPhase({ message, onRetry }: ErrorPhaseProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="space-y-3"
    >
      <div className="flex items-center gap-2 text-sm text-red-primary font-medium">
        <AlertOctagon size={16} />
        分析失败
      </div>
      <p className="text-xs text-text-muted">{message}</p>
      <button
        onClick={onRetry}
        className="flex items-center gap-2 px-3 py-2 text-sm border border-border-warm rounded-md hover:border-red-primary transition-colors text-text-body"
      >
        <RotateCcw size={14} strokeWidth={1.5} />
        重试
      </button>
    </motion.div>
  )
}

/* ---------- ManualToolSection ---------- */

export function ManualToolSection({
  expanded,
  onToggle,
  activeTool,
  onToolClick,
}: ManualToolSectionProps) {
  return (
    <div className="border-t border-border-warm pt-4">
      <button
        onClick={onToggle}
        className="flex items-center justify-between w-full text-sm text-text-muted hover:text-text-body transition-colors"
      >
        <span className="flex items-center gap-2">
          <Wrench size={14} strokeWidth={1.5} />
          手动选择工具
        </span>
        <ChevronDown
          size={14}
          strokeWidth={1.5}
          className={`transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="space-y-2 pt-3">
              {allTools.map((tool, i) => (
                <ManualToolCard
                  key={tool.id}
                  tool={tool}
                  index={i}
                  isActive={activeTool === tool.id}
                  onClick={() => onToolClick(tool.id)}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ---------- ManualToolCard ---------- */

function ManualToolCard({
  tool,
  index,
  isActive,
  onClick,
}: {
  tool: Tool
  index: number
  isActive: boolean
  onClick: () => void
}) {
  const Icon = tool.icon
  return (
    <motion.button
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.06 }}
      onClick={onClick}
      disabled={isActive}
      className={[
        'w-full flex items-start gap-3 p-3 rounded-md border-l-3 border border-border-warm bg-bg-card text-left transition-all',
        isActive
          ? 'border-l-accent-gold opacity-80'
          : 'border-l-red-primary hover:bg-bg-accent',
      ].join(' ')}
    >
      {isActive ? (
        <Loader2 size={16} strokeWidth={1.5} className="text-accent-gold animate-spin mt-0.5 shrink-0" />
      ) : (
        <Icon size={16} strokeWidth={1.5} className="text-red-primary mt-0.5 shrink-0" />
      )}
      <div className="min-w-0">
        <div className="text-sm font-medium text-text-main">
          {isActive ? 'AI 处理中...' : tool.label}
        </div>
        <div className="text-xs text-text-muted mt-0.5">{tool.description}</div>
      </div>
    </motion.button>
  )
}
