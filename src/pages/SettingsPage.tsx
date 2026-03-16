/**
 * SettingsPage — /settings
 * User preferences and data management with editorial design.
 */
import { useState, useCallback } from 'react'
import { motion, type Variants } from 'framer-motion'
import {
  Clock,
  Bell,
  Palette,
  Type,
  Trash2,
  Download,
  Info,
  Github,
  Sun,
  Moon,
  Check,
} from 'lucide-react'

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.05, duration: 0.35, ease: 'easeOut' },
  }),
}

const STUDY_GOALS = [30, 60, 90, 120] as const
const REMINDER_TIMES = ['08:00', '09:00', '10:00', '18:00', '20:00', '21:00'] as const
const FONT_SIZES = ['小', '标准', '大'] as const

type Theme = 'warm' | 'dark'
type FontSize = typeof FONT_SIZES[number]

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative w-10 h-[22px] rounded-full border transition-colors ${
        checked
          ? 'bg-red-primary border-red-primary'
          : 'bg-bg-accent border-border-warm'
      }`}
    >
      <span
        className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}

function SectionDivider() {
  return <div className="border-b border-border-warm" />
}

function SettingRow({
  icon: Icon,
  label,
  description,
  children,
}: {
  icon: typeof Clock
  label: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between py-4">
      <div className="flex items-start gap-3 min-w-0">
        <div className="w-8 h-8 rounded-full bg-bg-accent flex items-center justify-center shrink-0 mt-0.5">
          <Icon size={14} strokeWidth={1.5} className="text-red-primary" />
        </div>
        <div className="min-w-0">
          <p className="text-sm text-text-main">{label}</p>
          {description && (
            <p className="text-xs text-text-muted mt-0.5">{description}</p>
          )}
        </div>
      </div>
      <div className="shrink-0 ml-4">{children}</div>
    </div>
  )
}

function PillSelector<T extends string | number>({
  options,
  value,
  onChange,
  format,
}: {
  options: readonly T[]
  value: T
  onChange: (v: T) => void
  format?: (v: T) => string
}) {
  return (
    <div className="flex gap-1.5">
      {options.map((opt) => (
        <button
          key={String(opt)}
          onClick={() => onChange(opt)}
          className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
            value === opt
              ? 'bg-red-primary text-white border-red-primary'
              : 'bg-bg-card text-text-body border-border-warm hover:border-red-primary/40'
          }`}
        >
          {format ? format(opt) : String(opt)}
        </button>
      ))}
    </div>
  )
}

export default function SettingsPage() {
  const [dailyGoal, setDailyGoal] = useState<number>(60)
  const [reminderTime, setReminderTime] = useState<string>('09:00')
  const [reminderEnabled, setReminderEnabled] = useState(true)
  const [theme, setTheme] = useState<Theme>('warm')
  const [fontSize, setFontSize] = useState<FontSize>('标准')
  const [showClearConfirm, setShowClearConfirm] = useState(false)

  const handleClearData = useCallback(() => {
    if (!showClearConfirm) {
      setShowClearConfirm(true)
      return
    }
    // Clear all zhijie_ keys
    const keysToRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith('zhijie_')) {
        keysToRemove.push(key)
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k))
    setShowClearConfirm(false)
    window.location.reload()
  }, [showClearConfirm])

  const handleExport = useCallback(() => {
    const data: Record<string, unknown> = {}
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith('zhijie_')) {
        try {
          data[key] = JSON.parse(localStorage.getItem(key) || '')
        } catch {
          data[key] = localStorage.getItem(key)
        }
      }
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `zhijie-data-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [])

  return (
    <div className="p-8 max-w-2xl mx-auto">
      {/* Editorial header */}
      <motion.div variants={fadeUp} custom={0} initial="hidden" animate="visible">
        <div className="border-l-3 border-l-red-primary pl-4 mb-8">
          <h1 className="font-heading text-3xl text-text-main">设置</h1>
          <p className="text-text-muted mt-1">账户与偏好设置</p>
        </div>
      </motion.div>

      {/* Learning Preferences */}
      <motion.section variants={fadeUp} custom={1} initial="hidden" animate="visible">
        <h2 className="font-heading text-lg text-text-main mb-1">学习偏好</h2>
        <p className="text-xs text-text-muted mb-4">设定你的学习目标和提醒</p>

        <div className="border border-border-warm rounded-md bg-bg-card px-5">
          <SettingRow
            icon={Clock}
            label="每日学习目标"
            description="设定每日计划学习时间"
          >
            <PillSelector
              options={STUDY_GOALS}
              value={dailyGoal}
              onChange={setDailyGoal}
              format={(v) => `${v}min`}
            />
          </SettingRow>

          <SectionDivider />

          <SettingRow
            icon={Bell}
            label="复习提醒"
            description="闪卡到期时发送通知"
          >
            <div className="flex items-center gap-3">
              {reminderEnabled && (
                <select
                  value={reminderTime}
                  onChange={(e) => setReminderTime(e.target.value)}
                  className="text-xs border border-border-warm rounded-md px-2 py-1.5 bg-bg-card
                             text-text-body outline-none focus:border-red-primary transition-colors"
                >
                  {REMINDER_TIMES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              )}
              <Toggle checked={reminderEnabled} onChange={setReminderEnabled} />
            </div>
          </SettingRow>
        </div>
      </motion.section>

      {/* Display */}
      <motion.section variants={fadeUp} custom={3} initial="hidden" animate="visible" className="mt-8">
        <h2 className="font-heading text-lg text-text-main mb-1">显示</h2>
        <p className="text-xs text-text-muted mb-4">外观与排版设置</p>

        <div className="border border-border-warm rounded-md bg-bg-card px-5">
          <SettingRow
            icon={Palette}
            label="主题"
            description="选择界面风格"
          >
            <div className="flex gap-2">
              <button
                onClick={() => setTheme('warm')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border transition-colors ${
                  theme === 'warm'
                    ? 'bg-red-primary text-white border-red-primary'
                    : 'bg-bg-card text-text-body border-border-warm hover:border-red-primary/40'
                }`}
              >
                <Sun size={12} strokeWidth={1.5} />
                暖纸张
              </button>
              <button
                onClick={() => setTheme('dark')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border transition-colors ${
                  theme === 'dark'
                    ? 'bg-red-primary text-white border-red-primary'
                    : 'bg-bg-card text-text-body border-border-warm hover:border-red-primary/40'
                }`}
              >
                <Moon size={12} strokeWidth={1.5} />
                暗色
              </button>
            </div>
          </SettingRow>

          <SectionDivider />

          <SettingRow
            icon={Type}
            label="字体大小"
            description="调整正文字体大小"
          >
            <PillSelector
              options={FONT_SIZES}
              value={fontSize}
              onChange={setFontSize}
            />
          </SettingRow>
        </div>
      </motion.section>

      {/* Data Management */}
      <motion.section variants={fadeUp} custom={5} initial="hidden" animate="visible" className="mt-8">
        <h2 className="font-heading text-lg text-text-main mb-1">数据</h2>
        <p className="text-xs text-text-muted mb-4">管理本地存储的学习数据</p>

        <div className="border border-border-warm rounded-md bg-bg-card px-5">
          <SettingRow
            icon={Download}
            label="导出学习记录"
            description="将闪卡、笔记、日程数据导出为 JSON"
          >
            <button
              onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border
                         border-border-warm bg-bg-card text-text-body
                         hover:border-red-primary/40 transition-colors"
            >
              <Download size={12} strokeWidth={1.5} />
              导出
            </button>
          </SettingRow>

          <SectionDivider />

          <SettingRow
            icon={Trash2}
            label="清除本地数据"
            description="删除所有本地保存的学习记录、闪卡和设置"
          >
            {showClearConfirm ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleClearData}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md
                             bg-red-primary text-white hover:bg-red-dark transition-colors"
                >
                  <Check size={12} strokeWidth={1.5} />
                  确认清除
                </button>
                <button
                  onClick={() => setShowClearConfirm(false)}
                  className="px-3 py-1.5 text-xs rounded-md border border-border-warm
                             text-text-muted hover:text-text-body transition-colors"
                >
                  取消
                </button>
              </div>
            ) : (
              <button
                onClick={handleClearData}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border
                           border-red-primary/30 text-red-primary
                           hover:bg-red-primary/5 transition-colors"
              >
                <Trash2 size={12} strokeWidth={1.5} />
                清除
              </button>
            )}
          </SettingRow>
        </div>
      </motion.section>

      {/* About */}
      <motion.section variants={fadeUp} custom={7} initial="hidden" animate="visible" className="mt-8 mb-8">
        <h2 className="font-heading text-lg text-text-main mb-1">关于</h2>
        <p className="text-xs text-text-muted mb-4">版本信息与链接</p>

        <div className="border border-border-warm rounded-md bg-bg-card px-5">
          <SettingRow
            icon={Info}
            label="智阶"
            description="课程知识社区 + AI 学习工作台"
          >
            <span className="text-xs text-text-muted">v0.1.0</span>
          </SettingRow>

          <SectionDivider />

          <SettingRow
            icon={Github}
            label="源代码"
            description="在 GitHub 上查看项目"
          >
            <a
              href="https://github.com"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border
                         border-border-warm text-text-body
                         hover:border-red-primary/40 transition-colors no-underline"
            >
              <Github size={12} strokeWidth={1.5} />
              GitHub
            </a>
          </SettingRow>
        </div>
      </motion.section>
    </div>
  )
}
