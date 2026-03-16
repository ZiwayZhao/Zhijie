import { useState, useCallback, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  BookOpen,
  Target,
  RefreshCw,
  ChevronDown,
  Loader2,
  Wrench,
  Brain,
  Network,
  MessageCircleQuestion,
  ListChecks,
  ClipboardCheck,
  AlertTriangle,
  ArrowRight,
  RotateCcw,
  CheckCircle2,
  AlertOctagon,
  FileText,
} from 'lucide-react'
import { startDisassembly, subscribeProgress, getSpecialistResult } from '@/lib/api'
import type { DisassemblyModule, ProgressEvent } from '@/lib/api'

/* ---------- Types ---------- */

type Phase = 'idle' | 'gathering' | 'processing' | 'complete' | 'error'
type Intent = 'learn' | 'exam' | 'review'

interface GatheringData {
  examDate?: string
  masteryLevel?: number
  familiarity?: 'zero' | 'basic' | 'advanced'
}

interface AIToolPanelProps {
  materialId: string
  onModuleSelect?: (moduleId: string, markdown: string) => void
}

/* ---------- Manual tools (kept from original) ---------- */

interface Tool {
  id: string
  label: string
  description: string
  icon: React.ElementType
}

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

/* ---------- Main Component ---------- */

export default function AIToolPanel({ materialId, onModuleSelect }: AIToolPanelProps) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [intent, setIntent] = useState<Intent | null>(null)
  const [gathering, setGathering] = useState<GatheringData>({})
  const [progress, setProgress] = useState(0)
  const [currentStep, setCurrentStep] = useState('')
  const [modules, setModules] = useState<DisassemblyModule[]>([])
  const [loadingModule, setLoadingModule] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [manualExpanded, setManualExpanded] = useState(false)
  const [activeTool, setActiveTool] = useState<string | null>(null)

  const taskIdRef = useRef<string | null>(null)
  const unsubRef = useRef<(() => void) | null>(null)

  // Cleanup on unmount
  useEffect(() => {
    return () => { unsubRef.current?.() }
  }, [])

  const handleIntentSelect = useCallback((i: Intent) => {
    setIntent(i)
    if (i === 'review') {
      startProcessing(i, {})
    } else {
      setPhase('gathering')
      setGathering({})
    }
  }, [])

  const startProcessing = useCallback(async (i: Intent, _data: GatheringData) => {
    setPhase('processing')
    setProgress(0)
    setCurrentStep('正在启动分析...')
    setErrorMsg('')

    try {
      const mapped = i === 'review' ? 'learn' : i
      const { taskId } = await startDisassembly(materialId, mapped)
      taskIdRef.current = taskId

      unsubRef.current = subscribeProgress(taskId, (evt: ProgressEvent) => {
        setProgress(evt.progress)
        if (evt.currentStep) setCurrentStep(evt.currentStep)
        if (evt.status === 'completed' && evt.modules) {
          setModules(evt.modules)
          setPhase('complete')
        }
        if (evt.status === 'error') {
          setErrorMsg(evt.currentStep ?? '分析过程中出现错误')
          setPhase('error')
        }
      })
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '启动失败')
      setPhase('error')
    }
  }, [materialId])

  const handleGatheringSubmit = useCallback(() => {
    if (!intent) return
    startProcessing(intent, gathering)
  }, [intent, gathering, startProcessing])

  const handleModuleClick = useCallback(async (mod: DisassemblyModule) => {
    if (!taskIdRef.current || !onModuleSelect) return
    setLoadingModule(mod.id)
    try {
      const result = await getSpecialistResult(taskIdRef.current, mod.id)
      onModuleSelect(mod.id, result.markdown)
    } catch { /* silently fail */ }
    setLoadingModule(null)
  }, [onModuleSelect])

  const handleReset = useCallback(() => {
    unsubRef.current?.()
    unsubRef.current = null
    taskIdRef.current = null
    setPhase('idle')
    setIntent(null)
    setGathering({})
    setProgress(0)
    setModules([])
    setErrorMsg('')
  }, [])

  const handleToolClick = useCallback((toolId: string) => {
    setActiveTool(toolId)
    setTimeout(() => setActiveTool(null), 3000)
  }, [])

  return (
    <div className="space-y-5">
      <h3 className="font-heading text-lg text-text-main">AI 工具</h3>

      <AnimatePresence mode="wait">
        {phase === 'idle' && (
          <IdlePhase key="idle" onSelect={handleIntentSelect} />
        )}
        {phase === 'gathering' && intent && (
          <GatheringPhase
            key="gathering"
            intent={intent}
            data={gathering}
            onChange={setGathering}
            onSubmit={handleGatheringSubmit}
            onBack={handleReset}
          />
        )}
        {phase === 'processing' && (
          <ProcessingPhase key="processing" progress={progress} step={currentStep} />
        )}
        {phase === 'complete' && (
          <CompletePhase
            key="complete"
            modules={modules}
            loadingModule={loadingModule}
            onModuleClick={handleModuleClick}
            onReset={handleReset}
          />
        )}
        {phase === 'error' && (
          <ErrorPhase key="error" message={errorMsg} onRetry={handleReset} />
        )}
      </AnimatePresence>

      {/* Manual tool selection (collapsed) */}
      <div className="border-t border-border-warm pt-4">
        <button
          onClick={() => setManualExpanded(!manualExpanded)}
          className="flex items-center justify-between w-full text-sm text-text-muted hover:text-text-body transition-colors"
        >
          <span className="flex items-center gap-2">
            <Wrench size={14} strokeWidth={1.5} />
            手动选择工具
          </span>
          <ChevronDown
            size={14}
            strokeWidth={1.5}
            className={`transition-transform ${manualExpanded ? 'rotate-180' : ''}`}
          />
        </button>
        <AnimatePresence>
          {manualExpanded && (
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
                    onClick={() => handleToolClick(tool.id)}
                  />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

/* ---------- Phase: Idle ---------- */

const INTENTS: { key: Intent; icon: React.ElementType; title: string; subtitle: string }[] = [
  { key: 'learn', icon: BookOpen, title: '学透这份材料', subtitle: '深度理解，全面掌握' },
  { key: 'exam', icon: Target, title: '备考冲刺', subtitle: '聚焦考点，高效备考' },
  { key: 'review', icon: RefreshCw, title: '快速复习', subtitle: '间隔复习，巩固记忆' },
]

function IdlePhase({ onSelect }: { onSelect: (i: Intent) => void }) {
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

/* ---------- Phase: Gathering ---------- */

function GatheringPhase({
  intent,
  data,
  onChange,
  onSubmit,
  onBack,
}: {
  intent: Intent
  data: GatheringData
  onChange: (d: GatheringData) => void
  onSubmit: () => void
  onBack: () => void
}) {
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

/* ---------- Phase: Processing ---------- */

function ProcessingPhase({ progress, step }: { progress: number; step: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="space-y-4"
    >
      <div className="flex items-center gap-2 text-sm text-text-main font-medium">
        <Loader2 size={16} className="animate-spin text-red-primary" />
        AI 正在分析材料
      </div>

      {/* Progress bar */}
      <div className="w-full h-2 bg-bg-accent rounded-full overflow-hidden border border-border-warm">
        <motion.div
          className="h-full bg-red-primary rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        />
      </div>

      <div className="flex items-center justify-between text-xs text-text-muted">
        <span>{step}</span>
        <span className="font-mono">{progress}%</span>
      </div>
    </motion.div>
  )
}

/* ---------- Phase: Complete ---------- */

function CompletePhase({
  modules,
  loadingModule,
  onModuleClick,
  onReset,
}: {
  modules: DisassemblyModule[]
  loadingModule: string | null
  onModuleClick: (mod: DisassemblyModule) => void
  onReset: () => void
}) {
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

/* ---------- Phase: Error ---------- */

function ErrorPhase({ message, onRetry }: { message: string; onRetry: () => void }) {
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

/* ---------- Manual Tool Card ---------- */

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
