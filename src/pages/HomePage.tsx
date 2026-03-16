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
    <div className="p-8 max-w-6xl space-y-8">
      <WelcomeSection />

      {/* Exam countdowns (if any within 7 days) */}
      {upcomingExams.length > 0 && (
        <motion.div
          initial="hidden"
          animate="visible"
          variants={fadeUp}
          custom={2}
          className="flex gap-4 overflow-x-auto"
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

      {/* Recent courses + Activity timeline */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-8">
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
      <h1 className="font-heading text-3xl text-text-main mb-1">{greeting}，同学</h1>
      <div className="flex items-center gap-6 text-sm text-text-muted mt-2">
        <span className="flex items-center gap-1.5">
          <Clock size={14} strokeWidth={1.5} className="text-red-primary" />
          今日 {studyStats.todayMinutes} 分钟
        </span>
        <span className="flex items-center gap-1.5">
          <Flame size={14} strokeWidth={1.5} className="text-accent-gold" />
          连续 {studyStats.streak} 天
        </span>
        <span className="flex items-center gap-1.5">
          <FileCheck size={14} strokeWidth={1.5} className="text-text-muted" />
          {studyStats.completedMaterials} 份材料
        </span>
        <span className="flex items-center gap-1.5">
          <BookOpen size={14} strokeWidth={1.5} className="text-text-muted" />
          本周 {Math.round(studyStats.weekMinutes / 60)} 小时
        </span>
      </div>
    </motion.div>
  )
}

function RecentCoursesSection() {
  return (
    <motion.section initial="hidden" animate="visible" variants={fadeUp} custom={4}>
      <h2 className="font-heading text-xl text-text-main mb-4">最近学习</h2>
      <div className="flex gap-4 overflow-x-auto pb-2">
        {recentCourses.map((c, i) => (
          <motion.div key={c.id} variants={fadeUp} custom={i + 5} className="shrink-0">
            <Link
              to={`/course/${c.id}`}
              className="block w-52 border border-border-warm rounded-md bg-bg-card p-4
                         hover:border-red-primary transition-colors no-underline"
            >
              <h3 className="font-heading text-base text-text-main mb-1">{c.name}</h3>
              <p className="text-xs text-text-muted mb-3">{c.school}</p>
              <div className="w-full h-1.5 rounded-full bg-bg-accent overflow-hidden">
                <div
                  className="h-full rounded-full bg-red-primary transition-all"
                  style={{ width: `${c.progress}%` }}
                />
              </div>
              <div className="flex justify-between mt-2 text-xs text-text-muted">
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
      <h2 className="font-heading text-xl text-text-main mb-4">学习动态</h2>
      <div className="border border-border-warm rounded-md bg-bg-card p-5">
        <div className="space-y-0">
          {activities.map((a, i) => {
            const Icon = activityIcons[a.type]
            return (
              <motion.div
                key={a.id}
                variants={fadeUp}
                custom={i + 7}
                className="flex gap-3 py-3 border-b border-border-warm last:border-b-0"
              >
                <div className="w-7 h-7 shrink-0 rounded-full bg-bg-accent flex items-center justify-center mt-0.5">
                  <Icon size={14} className="text-red-primary" strokeWidth={1.5} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-text-body leading-snug">{a.message}</p>
                  <p className="text-xs text-text-muted mt-1">
                    {a.courseName} · {a.time}
                  </p>
                </div>
              </motion.div>
            )
          })}
        </div>
      </div>
    </motion.section>
  )
}
