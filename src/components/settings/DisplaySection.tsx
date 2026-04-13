/**
 * DisplaySection — theme and font size settings.
 */
import { motion, type Variants } from 'framer-motion'
import { Palette, Type, Sun, Moon } from 'lucide-react'
import { FONT_SIZES, type Theme, type FontSize } from '@/lib/settings-utils'
import { SectionDivider, SettingRow, PillSelector } from './SettingsShared'

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.05, duration: 0.35, ease: 'easeOut' },
  }),
}

interface DisplaySectionProps {
  theme: Theme
  fontSize: FontSize
  onThemeChange: (v: Theme) => void
  onFontSizeChange: (v: FontSize) => void
}

export default function DisplaySection({
  theme,
  fontSize,
  onThemeChange,
  onFontSizeChange,
}: DisplaySectionProps) {
  return (
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
              onClick={() => onThemeChange('warm')}
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
              onClick={() => onThemeChange('dark')}
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
            onChange={onFontSizeChange}
          />
        </SettingRow>
      </div>
    </motion.section>
  )
}
