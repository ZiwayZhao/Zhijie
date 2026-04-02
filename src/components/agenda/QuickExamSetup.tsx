/**
 * QuickExamSetup — inline card for quickly setting an exam date.
 * Appears on the homepage when no exam configs exist.
 * Editorial Academic style: warm paper bg, serif heading, red accent.
 */
import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { GraduationCap, CalendarDays, ChevronDown, Plus, X } from 'lucide-react'
import { fetchCourses, type CourseItem } from '@/lib/api'
import { saveExamConfigs, loadExamConfigs, type ExamConfig } from '@/lib/agenda-engine'

interface QuickExamSetupProps {
  onExamSet: () => void
}

export default function QuickExamSetup({ onExamSet }: QuickExamSetupProps) {
  const [expanded, setExpanded] = useState(false)
  const [courses, setCourses] = useState<CourseItem[]>([])
  const [selectedCourse, setSelectedCourse] = useState('')
  const [selectedCourseName, setSelectedCourseName] = useState('')
  const [examDate, setExamDate] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (expanded && courses.length === 0) {
      fetchCourses({ pageSize: 50 })
        .then(({ items }) => setCourses(items))
        .catch(() => {})
    }
  }, [expanded, courses.length])

  function handleCourseChange(slug: string) {
    setSelectedCourse(slug)
    const course = courses.find((c) => c.slug === slug)
    if (course) setSelectedCourseName(course.name)
  }

  function handleSave() {
    if (!selectedCourse || !examDate) return
    setSaving(true)

    const existing = loadExamConfigs()
    const updated = [
      ...existing.filter((c) => c.courseId !== selectedCourse),
      { courseId: selectedCourse, courseName: selectedCourseName, examDate },
    ]
    saveExamConfigs(updated)

    setTimeout(() => {
      setSaving(false)
      setExpanded(false)
      setSelectedCourse('')
      setExamDate('')
      onExamSet()
    }, 300)
  }

  // Minimum date = today
  const today = new Date().toISOString().slice(0, 10)

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.15 }}
    >
      <AnimatePresence mode="wait">
        {!expanded ? (
          <motion.button
            key="collapsed"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setExpanded(true)}
            className="w-full border border-dashed border-border-warm rounded-md bg-bg-card p-5
                       hover:border-red-primary/40 hover:bg-bg-accent/30 transition-all duration-200
                       flex items-center gap-3 text-left group"
          >
            <div className="w-9 h-9 rounded-full bg-red-primary/10 flex items-center justify-center shrink-0
                            group-hover:bg-red-primary/20 transition-colors">
              <GraduationCap size={18} strokeWidth={1.5} className="text-red-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-text-body font-body">设定考试日期，AI 自动规划每日学习任务</p>
              <p className="text-[11px] text-text-muted font-body mt-0.5">
                基于你的 mastery 水平和考试权重智能排列优先级
              </p>
            </div>
            <Plus size={16} className="text-text-muted group-hover:text-red-primary transition-colors shrink-0" />
          </motion.button>
        ) : (
          <motion.div
            key="expanded"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="border border-border-warm border-l-[3px] border-l-accent-gold rounded-md bg-bg-card overflow-hidden"
          >
            <div className="p-5">
              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <CalendarDays size={15} strokeWidth={1.5} className="text-accent-gold" />
                  <h3 className="font-heading text-base text-text-main">设定考试日期</h3>
                </div>
                <button
                  onClick={() => setExpanded(false)}
                  className="text-text-muted hover:text-text-body transition-colors p-1"
                >
                  <X size={14} />
                </button>
              </div>

              {/* Form */}
              <div className="space-y-3">
                {/* Course select */}
                <div className="relative">
                  <select
                    value={selectedCourse}
                    onChange={(e) => handleCourseChange(e.target.value)}
                    className="w-full text-sm bg-bg-main border border-border-warm rounded-sm px-3 py-2.5
                               text-text-body font-body appearance-none focus:outline-none focus:border-red-primary/40
                               transition-colors"
                  >
                    <option value="">选择课程...</option>
                    {courses.map((c) => (
                      <option key={c.slug} value={c.slug}>
                        {c.name}{c.school ? ` — ${c.school}` : ''}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    size={14}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
                  />
                </div>

                {/* Date input */}
                <input
                  type="date"
                  value={examDate}
                  min={today}
                  onChange={(e) => setExamDate(e.target.value)}
                  className="w-full text-sm bg-bg-main border border-border-warm rounded-sm px-3 py-2.5
                             text-text-body font-body focus:outline-none focus:border-red-primary/40
                             transition-colors"
                />

                {/* Save button */}
                <button
                  onClick={handleSave}
                  disabled={!selectedCourse || !examDate || saving}
                  className="w-full text-sm font-body py-2.5 rounded-sm transition-all duration-200
                             disabled:opacity-40 disabled:cursor-not-allowed
                             bg-red-primary text-white hover:bg-red-dark"
                >
                  {saving ? '保存中...' : '设定考试'}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
