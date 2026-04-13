/**
 * DataManagementSection — data export, import, and clear.
 */
import { useState, useCallback } from 'react'
import { motion, type Variants } from 'framer-motion'
import { Trash2, Download, Check } from 'lucide-react'
import { STORAGE_KEYS } from '@/lib/storage-keys'
import { SectionDivider, SettingRow } from './SettingsShared'

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.05, duration: 0.35, ease: 'easeOut' },
  }),
}

export default function DataManagementSection() {
  const [showClearConfirm, setShowClearConfirm] = useState(false)

  const handleClearData = useCallback(() => {
    if (!showClearConfirm) {
      setShowClearConfirm(true)
      return
    }
    const keysToRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(STORAGE_KEYS.PREFIX)) {
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
      if (key?.startsWith(STORAGE_KEYS.PREFIX)) {
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
  )
}
