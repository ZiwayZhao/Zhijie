import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  BookOpen,
  Target,
  Brain,
  Network,
  MessageCircleQuestion,
  ListChecks,
  ClipboardCheck,
  AlertTriangle,
  ChevronDown,
  Loader2,
  Wrench,
} from 'lucide-react'

type Intent = null | 'learn' | 'exam'

interface Tool {
  id: string
  label: string
  description: string
  icon: React.ElementType
}

const learnTools: Tool[] = [
  { id: 'deep-read', label: '精读笔记', description: '逐段精读，生成结构化笔记', icon: BookOpen },
  { id: 'concept-map', label: '概念图谱', description: '提取核心概念及其关联', icon: Network },
  { id: 'qa', label: '知识问答', description: '基于材料内容的智能问答', icon: MessageCircleQuestion },
]

const examTools: Tool[] = [
  { id: 'key-points', label: '考点提取', description: '识别高频考点与重点', icon: Target },
  { id: 'mock-quiz', label: '模拟测验', description: '生成模拟试题检验掌握度', icon: ClipboardCheck },
  { id: 'pitfalls', label: '易错总结', description: '归纳常见错误与易混概念', icon: AlertTriangle },
]

const allTools: Tool[] = [
  ...learnTools,
  ...examTools,
  { id: 'summary', label: '一键总结', description: '快速生成材料摘要', icon: ListChecks },
  { id: 'flashcards', label: '闪卡生成', description: '提取关键知识点生成闪卡', icon: Brain },
]

export default function AIToolPanel() {
  const [intent, setIntent] = useState<Intent>(null)
  const [activeTool, setActiveTool] = useState<string | null>(null)
  const [manualExpanded, setManualExpanded] = useState(false)

  const currentTools = intent === 'learn' ? learnTools : intent === 'exam' ? examTools : []

  function handleToolClick(toolId: string) {
    setActiveTool(toolId)
    // Reset after 3 seconds (mock)
    setTimeout(() => setActiveTool(null), 3000)
  }

  return (
    <div className="space-y-5">
      <h3 className="font-heading text-lg text-text-main">AI 工具</h3>

      {/* Intent selector */}
      <div className="space-y-2.5">
        <IntentButton
          active={intent === 'learn'}
          onClick={() => setIntent(intent === 'learn' ? null : 'learn')}
          icon={BookOpen}
          title="学透这份材料"
          subtitle="深度理解模式"
        />
        <IntentButton
          active={intent === 'exam'}
          onClick={() => setIntent(intent === 'exam' ? null : 'exam')}
          icon={Target}
          title="备考冲刺"
          subtitle="考试准备模式"
        />
      </div>

      {/* Tool list for selected intent */}
      <AnimatePresence mode="wait">
        {intent && (
          <motion.div
            key={intent}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
            className="space-y-2"
          >
            {currentTools.map((tool, i) => (
              <ToolCard
                key={tool.id}
                tool={tool}
                index={i}
                isActive={activeTool === tool.id}
                onClick={() => handleToolClick(tool.id)}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Manual tool selection (collapsible) */}
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
                  <ToolCard
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

/* --- Sub-components --- */

function IntentButton({
  active,
  onClick,
  icon: Icon,
  title,
  subtitle,
}: {
  active: boolean
  onClick: () => void
  icon: React.ElementType
  title: string
  subtitle: string
}) {
  return (
    <button
      onClick={onClick}
      className={[
        'w-full flex items-center gap-3 px-4 py-3.5 rounded-md border text-left transition-all',
        active
          ? 'border-red-primary bg-red-primary text-white'
          : 'border-border-warm bg-bg-card text-text-main hover:border-red-primary',
      ].join(' ')}
    >
      <Icon size={20} strokeWidth={1.5} />
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className={`text-xs mt-0.5 ${active ? 'text-white/70' : 'text-text-muted'}`}>
          {subtitle}
        </div>
      </div>
    </button>
  )
}

function ToolCard({
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
