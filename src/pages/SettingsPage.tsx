/**
 * SettingsPage — /settings
 * User preferences and data management with editorial design.
 */
import { useState, useCallback, useEffect } from 'react'
import { motion, type Variants } from 'framer-motion'
import { Info, Github } from 'lucide-react'
import {
  type Theme,
  type FontSize,
  type UserPreferences,
  loadPreferences,
  savePreferences,
  applyTheme,
  applyFontSize,
} from '@/lib/settings-utils'
import { SettingRow, SectionDivider } from '@/components/settings/SettingsShared'
import LearningPrefsSection from '@/components/settings/LearningPrefsSection'
import DisplaySection from '@/components/settings/DisplaySection'
import LLMSettingsSection from '@/components/settings/LLMSettingsSection'
import DataManagementSection from '@/components/settings/DataManagementSection'

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.05, duration: 0.35, ease: 'easeOut' },
  }),
}

export default function SettingsPage() {
  const [prefs, setPrefs] = useState<UserPreferences>(loadPreferences)
  const { dailyGoal, reminderTime, reminderEnabled, theme, fontSize } = prefs

  // Apply theme and fontSize on mount and change
  useEffect(() => {
    applyTheme(prefs.theme)
    applyFontSize(prefs.fontSize)
  }, [prefs.theme, prefs.fontSize])

  const updatePref = useCallback(<K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => {
    setPrefs(prev => {
      const next = { ...prev, [key]: value }
      savePreferences(next)
      return next
    })
  }, [])

  const setDailyGoal = (v: number) => updatePref('dailyGoal', v)
  const setReminderTime = (v: string) => updatePref('reminderTime', v)
  const setReminderEnabled = (v: boolean) => updatePref('reminderEnabled', v)
  const setTheme = (v: Theme) => updatePref('theme', v)
  const setFontSize = (v: FontSize) => updatePref('fontSize', v)

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
      <LearningPrefsSection
        dailyGoal={dailyGoal}
        reminderTime={reminderTime}
        reminderEnabled={reminderEnabled}
        onDailyGoalChange={setDailyGoal}
        onReminderTimeChange={setReminderTime}
        onReminderEnabledChange={setReminderEnabled}
      />

      {/* Display */}
      <DisplaySection
        theme={theme}
        fontSize={fontSize}
        onThemeChange={setTheme}
        onFontSizeChange={setFontSize}
      />

      {/* AI Model Config */}
      <LLMSettingsSection />

      {/* Data Management */}
      <DataManagementSection />

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
