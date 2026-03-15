import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Clock, Flame, BookOpen, FileCheck, Upload, PenLine, Award, BookMarked } from 'lucide-react'
import { recentCourses, activities, studyStats } from '@/mocks/activities'
import { courses } from '@/mocks/courses'
import type { Activity } from '@/mocks/activities'
import type { Course } from '@/mocks/courses'

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.4, ease: 'easeOut' },
  }),
}

export default function HomePage() {
  return (
    <div className="p-8 max-w-6xl space-y-10">
      <WelcomeSection />
      <RecentCoursesSection />
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-8">
        <RecommendedSection />
        <ActivityTimeline />
      </div>
    </div>
  )
}

function WelcomeSection() {
  const hour = new Date().getHours()
  const greeting = hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好'

  const stats = [
    { label: '今日学习', value: `${studyStats.todayMinutes} 分钟`, icon: Clock },
    { label: '连续天数', value: `${studyStats.streak} 天`, icon: Flame },
    { label: '已完成材料', value: `${studyStats.completedMaterials} 份`, icon: FileCheck },
    { label: '本周学习', value: `${Math.round(studyStats.weekMinutes / 60)} 小时`, icon: BookOpen },
  ]

  return (
    <motion.div initial="hidden" animate="visible" variants={fadeUp} custom={0}>
      <h1 className="font-heading text-3xl text-text-main mb-1">{greeting}，同学</h1>
      <p className="text-text-muted text-sm mb-5">继续你的学习旅程</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map((s, i) => (
          <motion.div
            key={s.label}
            variants={fadeUp}
            custom={i + 1}
            className="border border-border-warm rounded-md bg-bg-card px-4 py-3.5 flex items-center gap-3"
          >
            <div className="w-9 h-9 rounded-md bg-bg-accent flex items-center justify-center">
              <s.icon size={18} className="text-red-primary" strokeWidth={1.5} />
            </div>
            <div>
              <p className="text-lg font-medium text-text-main leading-tight">{s.value}</p>
              <p className="text-xs text-text-muted">{s.label}</p>
            </div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  )
}

function RecentCoursesSection() {
  return (
    <motion.section initial="hidden" animate="visible" variants={fadeUp} custom={2}>
      <h2 className="font-heading text-xl text-text-main mb-4">最近学习</h2>
      <div className="flex gap-4 overflow-x-auto pb-2">
        {recentCourses.map((c, i) => (
          <motion.div key={c.id} variants={fadeUp} custom={i + 3} className="shrink-0">
            <Link
              to={`/course/${c.id}`}
              className="block w-56 border border-border-warm rounded-md bg-bg-card p-4
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

function RecommendedSection() {
  const recommended = courses.slice(0, 6)

  return (
    <motion.section initial="hidden" animate="visible" variants={fadeUp} custom={4}>
      <h2 className="font-heading text-xl text-text-main mb-4">推荐课程</h2>
      <div className="columns-1 md:columns-2 gap-5 space-y-5">
        {recommended.map((course, i) => (
          <RecommendedCard key={course.id} course={course} index={i} />
        ))}
      </div>
    </motion.section>
  )
}

function RecommendedCard({ course, index }: { course: Course; index: number }) {
  return (
    <motion.div
      variants={fadeUp}
      custom={index + 5}
      className="break-inside-avoid"
    >
      <Link
        to={`/course/${course.id}`}
        className="block border border-border-warm border-l-3 border-l-red-primary rounded-md
                   bg-bg-card p-5 hover:border-red-primary transition-colors no-underline"
      >
        <h3 className="font-heading text-lg text-text-main mb-1">{course.name}</h3>
        <p className="text-xs text-text-muted mb-2">{course.school}</p>
        <p className="text-sm text-text-body line-clamp-2 mb-3">{course.description}</p>
        <div className="flex items-center gap-3 text-xs text-text-muted">
          <span className="flex items-center gap-1">
            <BookMarked size={13} strokeWidth={1.5} />
            {course.materialCount} 份材料
          </span>
          <span>·</span>
          <span>{course.studentCount} 名学生</span>
        </div>
        <div className="flex gap-1.5 mt-3 flex-wrap">
          {course.tags.map((tag) => (
            <span
              key={tag}
              className="px-2 py-0.5 text-xs rounded-sm border border-border-warm text-text-muted bg-bg-accent"
            >
              {tag}
            </span>
          ))}
        </div>
      </Link>
    </motion.div>
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
