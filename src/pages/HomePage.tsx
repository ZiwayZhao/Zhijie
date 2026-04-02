/**
 * HomePage — /
 * Public landing page with featured courses.
 * Authenticated users see daily plan + stats; guests see CTA.
 */
import { useEffect, useState, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { motion, type Variants } from 'framer-motion'
import { Clock, Flame, BookOpen, FileCheck, ArrowRight, Layers, HelpCircle } from 'lucide-react'
import { fetchCourses, fetchShowcase, type CourseItem, type ShowcaseItem } from '@/lib/api'
import type { DailyAgenda, TodoItem, ExamConfig } from '@/lib/agenda-engine'
import { generateDailyAgenda, loadExamConfigs, loadTodos, saveTodos, getExamWeakModuleItems } from '@/lib/agenda-engine'
import { loadAllDecks } from '@/lib/fsrs'
import { loadProfile } from '@/lib/student-model'
import { loadExamProfile } from '@/lib/exam-profile'
import DailyPlan from '@/components/agenda/DailyPlan'
import ExamCountdown from '@/components/agenda/ExamCountdown'
import QuickExamSetup from '@/components/agenda/QuickExamSetup'
import { differenceInDays } from 'date-fns'
import { useAuth } from '@/contexts/AuthContext'

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.4, ease: 'easeOut' },
  }),
}

export default function HomePage() {
  const { isAuthenticated, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="px-10 py-8 max-w-6xl">
        <div className="animate-pulse space-y-6">
          <div className="h-8 w-48 bg-border-warm/50 rounded" />
          <div className="h-4 w-72 bg-border-warm/30 rounded" />
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <GuestHomePage />
  }

  return <AuthenticatedHomePage />
}

/* ================================================================== */
/*  Guest Home — public view with featured courses                     */
/* ================================================================== */

function GuestHomePage() {
  return (
    <div className="px-10 py-8 max-w-6xl space-y-12">
      <GuestWelcome />
      <ShowcaseSection />
      <FeaturedCoursesSection />
      <GuestCTA />
    </div>
  )
}

function GuestWelcome() {
  return (
    <motion.div initial="hidden" animate="visible" variants={fadeUp} custom={0}>
      <div className="w-12 h-[3px] bg-red-primary mb-4 rounded-full" />
      <h1 className="font-heading text-3xl text-text-main tracking-tight mb-2">
        智阶 — AI 驱动的课程学习平台
      </h1>
      <p className="text-base text-text-body font-body max-w-lg leading-relaxed mt-3">
        上传任意课件 PDF，AI 自动拆解为模块化精讲、测验和闪卡。
        浏览全球顶尖大学课程，开启你的学习之旅。
      </p>
    </motion.div>
  )
}

function GuestCTA() {
  return (
    <motion.div initial="hidden" animate="visible" variants={fadeUp} custom={8}>
      <div className="border border-border-warm rounded-md bg-bg-accent p-8 text-center">
        <h3 className="font-heading text-xl text-text-main mb-3">立即开始学习</h3>
        <p className="text-sm text-text-muted font-body mb-6 max-w-md mx-auto">
          注册后可以上传自己的课件，AI 将自动生成精讲笔记、测验题和智能闪卡。
        </p>
        <div className="flex justify-center gap-4">
          <Link
            to="/auth/register"
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-red-primary text-white text-sm font-body rounded-md hover:bg-red-dark transition-colors no-underline"
          >
            免费注册 <ArrowRight size={14} />
          </Link>
          <Link
            to="/explore"
            className="inline-flex items-center gap-2 px-6 py-2.5 border border-border-warm text-text-body text-sm font-body rounded-md hover:border-red-primary/60 transition-colors no-underline"
          >
            浏览全部课程
          </Link>
        </div>
      </div>
    </motion.div>
  )
}

/* ================================================================== */
/*  Authenticated Home — daily plan + stats + courses + timeline       */
/* ================================================================== */

function AuthenticatedHomePage() {
  const [agenda, setAgenda] = useState<DailyAgenda>({ date: '', items: [], totalMinutes: 0 })
  const [examConfigs, setExamConfigs] = useState<ExamConfig[]>([])
  const todosRef = useRef<TodoItem[]>([])

  const rebuildAgenda = useCallback((currentTodos: TodoItem[]) => {
    const decks = loadAllDecks()
    const configs = loadExamConfigs()
    const profile = loadProfile()

    // Collect weak-module study items from all exam-configured courses
    const studyItems = configs.flatMap((c) => {
      const examProfile = loadExamProfile(c.courseId)
      return getExamWeakModuleItems(profile, c.courseId, c.courseName, examProfile)
    })

    const daily = generateDailyAgenda(decks, configs, studyItems, currentTodos)
    setAgenda(daily)
    setExamConfigs(configs)
  }, [])

  useEffect(() => {
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
    return days >= 0 && days <= 14
  })

  return (
    <div className="px-10 py-8 max-w-6xl space-y-10">
      <WelcomeSection />

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

      {examConfigs.length === 0 && (
        <motion.div initial="hidden" animate="visible" variants={fadeUp} custom={2}>
          <QuickExamSetup onExamSet={() => rebuildAgenda(todosRef.current)} />
        </motion.div>
      )}

      <DailyPlan
        agenda={agenda}
        onToggleComplete={handleToggleComplete}
        onAddTodo={handleAddTodo}
      />

      <FeaturedCoursesSection />
    </div>
  )
}

/* ================================================================== */
/*  Shared sections                                                    */
/* ================================================================== */

function WelcomeSection() {
  const hour = new Date().getHours()
  const greeting = hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好'
  const profile = loadProfile()
  const moduleCount = Object.keys(profile.modules).length

  return (
    <motion.div initial="hidden" animate="visible" variants={fadeUp} custom={0}>
      <div className="w-12 h-[3px] bg-red-primary mb-4 rounded-full" />
      <h1 className="font-heading text-3xl text-text-main tracking-tight mb-2">{greeting}，同学</h1>
      <div className="flex items-center gap-5 text-xs text-text-muted mt-3 font-body tracking-wide uppercase">
        <span className="flex items-center gap-1.5">
          <Clock size={13} strokeWidth={1.5} className="text-red-primary" />
          累计 {profile.totalStudyMinutes} 分钟
        </span>
        <span className="w-px h-3 bg-border-warm" />
        <span className="flex items-center gap-1.5">
          <Flame size={13} strokeWidth={1.5} className="text-accent-gold" />
          连续 {profile.streakDays} 天
        </span>
        <span className="w-px h-3 bg-border-warm" />
        <span className="flex items-center gap-1.5">
          <BookOpen size={13} strokeWidth={1.5} className="text-text-muted" />
          {moduleCount} 个模块
        </span>
        <span className="w-px h-3 bg-border-warm" />
        <span className="flex items-center gap-1.5">
          <FileCheck size={13} strokeWidth={1.5} className="text-text-muted" />
          {loadAllDecks().length} 套闪卡
        </span>
      </div>
    </motion.div>
  )
}

function ShowcaseSection() {
  const [items, setItems] = useState<ShowcaseItem[]>([])

  useEffect(() => {
    fetchShowcase().then(setItems).catch(() => {})
  }, [])

  if (items.length === 0) return null

  return (
    <motion.section initial="hidden" animate="visible" variants={fadeUp} custom={2} className="min-w-0">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-8 h-[2px] bg-accent-gold rounded-full" />
        <h2 className="font-heading text-xl text-text-main">精品课程 · AI 精讲</h2>
        <span className="text-[10px] px-2 py-0.5 bg-red-primary/10 text-red-primary border border-red-primary/20 rounded-sm font-body">
          已完成分析
        </span>
      </div>
      <p className="text-sm text-text-muted font-body mb-5 -mt-2">
        以下课程已通过完整 AI 管道——包含模块精讲、LaTeX 公式渲染和测验题。点击体验。
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {items.map((item, i) => (
          <motion.div key={item.task_id} variants={fadeUp} custom={i + 3}>
            <div
              className="group block border-l-3 border-l-red-primary border border-border-warm rounded-md bg-bg-card p-6
                         hover:border-red-primary/60 transition-all duration-200 cursor-pointer h-full"
              onClick={() => window.location.href = `/auth/login`}
            >
              <h3 className="font-heading text-base text-text-main mb-2 group-hover:text-red-primary transition-colors duration-200 leading-snug">
                {item.title}
              </h3>
              {item.description && (
                <p className="text-xs text-text-muted font-body mb-4 line-clamp-2">{item.description}</p>
              )}
              <div className="flex items-center gap-4 text-xs text-text-muted font-body">
                <span className="flex items-center gap-1">
                  <Layers size={12} className="text-red-primary" />
                  {item.module_count} 个模块精讲
                </span>
                <span className="flex items-center gap-1">
                  <HelpCircle size={12} className="text-accent-gold" />
                  {item.quiz_count} 道测验题
                </span>
              </div>
              <p className="text-[10px] text-red-primary/70 font-body mt-3">登录后可体验完整 AI 精讲 →</p>
            </div>
          </motion.div>
        ))}
      </div>
    </motion.section>
  )
}

function FeaturedCoursesSection() {
  const [courses, setCourses] = useState<CourseItem[]>([])

  useEffect(() => {
    fetchCourses({ pageSize: 8 })
      .then(({ items }) => setCourses(items))
      .catch(() => {})
  }, [])

  if (courses.length === 0) return null

  return (
    <motion.section initial="hidden" animate="visible" variants={fadeUp} custom={4} className="min-w-0">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-8 h-[2px] bg-red-primary rounded-full" />
          <h2 className="font-heading text-xl text-text-main">热门课程</h2>
        </div>
        <Link
          to="/explore"
          className="text-xs text-text-muted hover:text-red-primary transition-colors font-body flex items-center gap-1 no-underline"
        >
          查看全部 <ArrowRight size={12} />
        </Link>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {courses.map((c, i) => (
          <motion.div key={c.slug} variants={fadeUp} custom={i + 5}>
            <Link
              to={`/course/${c.slug}`}
              className="group block border border-border-warm rounded-md bg-bg-card p-5
                         hover:border-red-primary/60 transition-all duration-200 no-underline h-full"
            >
              <h3 className="font-heading text-sm text-text-main mb-1 group-hover:text-red-primary transition-colors duration-200 line-clamp-2 leading-snug">
                {c.name}
              </h3>
              <p className="text-xs text-text-muted mb-3 font-body">{c.school || c.category}</p>
              <div className="flex flex-wrap gap-1">
                {c.tags.slice(0, 2).map((tag) => (
                  <span
                    key={tag}
                    className="text-[10px] px-1.5 py-0.5 border border-border-warm text-text-muted bg-bg-main"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </Link>
          </motion.div>
        ))}
      </div>
    </motion.section>
  )
}

