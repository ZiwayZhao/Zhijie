/**
 * LearningPrefsSection — daily goal & reminder settings.
 */
import { motion, type Variants } from 'framer-motion'
import { Clock, Bell } from 'lucide-react'
import { STUDY_GOALS, REMINDER_TIMES } from '@/lib/settings-utils'
import { Toggle, SectionDivider, SettingRow, PillSelector } from './SettingsShared'

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.05, duration: 0.35, ease: 'easeOut' },
  }),
}

interface LearningPrefsSectionProps {
  dailyGoal: number
  reminderTime: string
  reminderEnabled: boolean
  onDailyGoalChange: (v: number) => void
  onReminderTimeChange: (v: string) => void
  onReminderEnabledChange: (v: boolean) => void
}

export default function LearningPrefsSection({
  dailyGoal,
  reminderTime,
  reminderEnabled,
  onDailyGoalChange,
  onReminderTimeChange,
  onReminderEnabledChange,
}: LearningPrefsSectionProps) {
  return (
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
            onChange={onDailyGoalChange}
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
                onChange={(e) => onReminderTimeChange(e.target.value)}
                className="text-xs border border-border-warm rounded-md px-2 py-1.5 bg-bg-card
                           text-text-body outline-none focus:border-red-primary transition-colors"
              >
                {REMINDER_TIMES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            )}
            <Toggle checked={reminderEnabled} onChange={onReminderEnabledChange} />
          </div>
        </SettingRow>
      </div>
    </motion.section>
  )
}
