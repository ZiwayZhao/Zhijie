/**
 * HomePage — /
 * Dynamic daily learning plan + compact stats + recent courses + activity.
 */
import { useEffect, useState, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { motion, type Variants } from 'framer-motion'
import { Clock, Flame, BookOpen, FileCheck, Upload, PenLine, Award } from 'lucide-react'
import { recentCourses, activities, studyStats } from '@/mocks/activities'
import type { Activity } from '@/mocks/activities'
import type { DailyAgenda, TodoItem, ExamConfig } from '@/lib/agenda-engine'
import { generateDailyAgenda, loadExamConfigs, loadTodos, saveTodos } from '@/lib/agenda-engine'
import { loadAllDecks } from '@/lib/fsrs'
import { initMockAgenda, getMockStudyItems } from '@/mocks/agenda'
import { initMockFlashcards } from '@/mocks/flashcards'
import DailyPlan from '@/components/agenda/DailyPlan'
import ExamCountdown from '@/components/agenda/ExamCountdown'
import { differenceInDays } from 'date-fns'

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.4, ease: 'easeOut' },
  }),
}

export default function HomePage() {
  const [agenda, setAgenda] = useState<DailyAgenda>({ date: '', items: [], totalMinutes: 0 })
  const [examConfigs, setExamConfigs] = useState<ExamConfig[]>([])
  const todosRef = useRef<TodoItem[]>([])

  const rebuildAgenda = useCallback((currentTodos: TodoItem[]) => {
    const decks = loadAllDecks()
    const configs = loadExamConfigs()
    const studyItems = getMockStudyItems()
    const daily = generateDailyAgenda(decks, configs, studyItems, currentTodos)
    setAgenda(daily)
    setExamConfigs(configs)
  }, [])

  useEffect(() => {
    initMockFlashcards()
    initMockAgenda()
    const loadedTodos = loadTodos()
    todosRef.current = loadedTodos
    rebuildAgenda(loadedTodos)
  }, [rebuildAgenda])

  const handleToggleComplete = useCallback((id: string) => {
    const updated = todosRef.current.map((t) =>
      t.id === id ? { ...t, completed: !t.completed } : t,
    )
    todosRef.current = updated
    saveTodos(updated)
    rebuildAgenda(updated)
  }, [rebuildAgenda])

  const handleAddTodo = useCallback((title: string) => {
    const newTodo: TodoItem = {
      type: 'todo',
      id: `todo-${Date.now()}`,
      title,
      completed: false,
    }
    const updated = [...todosRef.current, newTodo]
    todosRef.current = updated
    saveTodos(updated)
    rebuildAgenda(updated)
  }, [rebuildAgenda])

  const upcomingExams = examConfigs.filter((c) => {
    const days = differenceInDays(new Date(c.examDate), new Date())
    return days >= 0 && days <= 7
  })

  return (
    <div className="px-10 py-8 max-w-6xl space-y-10">
      <WelcomeSection />

      {/* Exam countdowns (if any within 7 days) */}
      {upcomingExams.length > 0 && (
        <motion.div
          initial="hidden"
          animate="visible"
          variants={fadeUp}
          custom={2}
          className="flex gap-5 overflow-x-auto"
        >
          {upcomingExams.map((config) => (
            <ExamCountdown key={config.courseId} examConfig={config} />
          ))}
        </motion.div>
      )}

      {/* Daily learning plan */}
      <DailyPlan
        agenda={agenda}
        onToggleComplete={handleToggleComplete}
        onAddTodo={handleAddTodo}
      />

      {/* Recent courses + Activity timeline — 70:30 editorial ratio */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-10">
        <RecentCoursesSection />
        <ActivityTimeline />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Sub-sections                                                       */
/* ------------------------------------------------------------------ */

function WelcomeSection() {
  const hour = new Date().getHours()
  const greeting = hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好'

  return (
    <motion.div initial="hidden" animate="visible" variants={fadeUp} custom={0}>
      {/* Decorative red rule — editorial accent */}
      <div className="w-12 h-[3px] bg-red-primary mb-4 rounded-full" />
      <h1 className="font-heading text-3xl text-text-main tracking-tight mb-2">{greeting}，同学</h1>
      {/* Stats as figure-caption row */}
      <div className="flex items-center gap-5 text-xs text-text-muted mt-3 font-body tracking-wide uppercase">
        <span className="flex items-center gap-1.5">
          <Clock size={13} strokeWidth={1.5} className="text-red-primary" />
          今日 {studyStats.todayMinutes} 分钟
        </span>
        <span className="w-px h-3 bg-border-warm" />
        <span className="flex items-center gap-1.5">
          <Flame size={13} strokeWidth={1.5} className="text-accent-gold" />
          连续 {studyStats.streak} 天
        </span>
        <span className="w-px h-3 bg-border-warm" />
        <span className="flex items-center gap-1.5">
          <FileCheck size={13} strokeWidth={1.5} className="text-text-muted" />
          {studyStats.completedMaterials} 份材料
        </span>
        <span className="w-px h-3 bg-border-warm" />
        <span className="flex items-center gap-1.5">
          <BookOpen size={13} strokeWidth={1.5} className="text-text-muted" />
          本周 {Math.round(studyStats.weekMinutes / 60)} 小时
        </span>
      </div>
    </motion.div>
  )
}

function RecentCoursesSection() {
  return (
    <motion.section initial="hidden" animate="visible" variants={fadeUp} custom={4}>
      <div className="flex items-center gap-3 mb-5">
        <div className="w-8 h-[2px] bg-red-primary rounded-full" />
        <h2 className="font-heading text-xl text-text-main">最近学习</h2>
      </div>
      <div className="flex gap-5 overflow-x-auto pb-2">
        {recentCourses.map((c, i) => (
          <motion.div key={c.id} variants={fadeUp} custom={i + 5} className="shrink-0">
            <Link
              to={`/course/${c.id}`}
              className="group block w-56 border border-border-warm rounded-md bg-bg-card p-5
                         hover:border-red-primary/60 transition-all duration-200 no-underline"
            >
              <h3 className="font-heading text-base text-text-main mb-1 group-hover:text-red-primary transition-colors duration-200">
                {c.name}
              </h3>
              <p className="text-xs text-text-muted mb-4 font-body">{c.school}</p>
              <div className="w-full h-1 rounded-full bg-bg-accent overflow-hidden">
                <div
                  className="h-full rounded-full bg-red-primary transition-all"
                  style={{ width: `${c.progress}%` }}
                />
              </div>
              <div className="flex justify-between mt-2.5 text-xs text-text-muted font-body">
                <span>进度 {c.progress}%</span>
                <span>{c.lastVisit}</span>
              </div>
            </Link>
          </motion.div>
        ))}
      </div>
    </motion.section>
  )
}

const activityIcons: Record<Activity['type'], typeof Upload> = {
  upload: Upload,
  study: BookOpen,
  note: PenLine,
  quiz: Award,
}

function ActivityTimeline() {
  return (
    <motion.section initial="hidden" animate="visible" variants={fadeUp} custom={6}>
      <div className="flex items-center gap-3 mb-5">
        <div className="w-8 h-[2px] bg-border-warm rounded-full" />
        <h2 className="font-heading text-lg text-text-main">学习动态</h2>
      </div>
      {/* Margin-note style: left border, no card wrapper */}
      <div className="border-l-2 border-border-warm pl-5 space-y-0">
        {activities.map((a, i) => {
          const Icon = activityIcons[a.type]
          return (
            <motion.div
              key={a.id}
              variants={fadeUp}
              custom={i + 7}
              className="flex gap-3 py-3 border-b border-border-warm/60 last:border-b-0"
            >
              <div className="w-6 h-6 shrink-0 rounded-full bg-bg-accent flex items-center justify-center mt-0.5">
                <Icon size={12} className="text-red-primary" strokeWidth={1.5} />
              </div>
              <div className="min-w-0">
                <p className="text-sm text-text-body leading-snug">{a.message}</p>
                <p className="text-[11px] text-text-muted mt-1 font-body">
                  {a.courseName} · {a.time}
                </p>
              </div>
            </motion.div>
          )
        })}
      </div>
    </motion.section>
  )
}
