/**
 * MyCoursesPage — /my/courses
 * Displays enrolled courses in an editorial grid layout.
 */
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { motion, type Variants } from 'framer-motion'
import { BookOpen, Users, FileText, Compass } from 'lucide-react'
import { courses, type Course } from '@/mocks/courses'

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.05, duration: 0.35, ease: 'easeOut' },
  }),
}

/** Mock: first 5 courses are "enrolled" */
const ENROLLED_IDS = ['dm-tum', 'oc-eth', 'algo-tum', 'qm-lmu', 'ml-eth']

function getCategoryColor(category: string): string {
  const map: Record<string, string> = {
    '数学': 'bg-red-primary/8 text-red-primary',
    '计算机': 'bg-info/8 text-info',
    '化学': 'bg-accent-gold/10 text-accent-gold',
    '物理': 'bg-red-dark/8 text-red-dark',
    '工程': 'bg-success/8 text-success',
  }
  return map[category] || 'bg-bg-accent text-text-muted'
}

function CourseCard({ course, index }: { course: Course; index: number }) {
  return (
    <motion.div variants={fadeUp} custom={index + 2} initial="hidden" animate="visible">
      <Link
        to={`/course/${course.id}`}
        className="block border border-border-warm rounded-md bg-bg-card p-5
                   hover:border-red-primary transition-colors no-underline group"
      >
        <div className="flex items-start justify-between mb-3">
          <h3 className="font-heading text-lg text-text-main group-hover:text-red-primary transition-colors">
            {course.name}
          </h3>
          <span className={`text-[11px] px-2 py-0.5 rounded-sm shrink-0 ml-2 ${getCategoryColor(course.category)}`}>
            {course.category}
          </span>
        </div>

        <p className="text-xs text-text-muted mb-4">{course.school}</p>

        <p className="text-sm text-text-body leading-relaxed line-clamp-2 mb-4">
          {course.description}
        </p>

        <div className="flex items-center gap-4 text-xs text-text-muted">
          <span className="flex items-center gap-1">
            <FileText size={12} strokeWidth={1.5} />
            {course.materialCount} 份材料
          </span>
          <span className="flex items-center gap-1">
            <Users size={12} strokeWidth={1.5} />
            {course.studentCount} 人
          </span>
        </div>

        {/* Tags */}
        <div className="flex flex-wrap gap-1.5 mt-3">
          {course.tags.map((tag) => (
            <span
              key={tag}
              className="text-[11px] px-1.5 py-0.5 rounded-sm bg-bg-accent text-text-muted"
            >
              {tag}
            </span>
          ))}
        </div>
      </Link>
    </motion.div>
  )
}

function EmptyState() {
  return (
    <motion.div
      variants={fadeUp}
      custom={2}
      initial="hidden"
      animate="visible"
      className="border border-border-warm rounded-md bg-bg-card p-12 text-center"
    >
      <div className="w-16 h-16 rounded-full bg-bg-accent flex items-center justify-center mx-auto mb-4">
        <BookOpen size={28} strokeWidth={1.2} className="text-text-muted" />
      </div>
      <h3 className="font-heading text-lg text-text-main mb-2">
        还没有加入任何课程
      </h3>
      <p className="text-sm text-text-muted mb-6 max-w-xs mx-auto">
        浏览知识网络，找到你正在学习的课程并加入
      </p>
      <Link
        to="/explore"
        className="inline-flex items-center gap-2 px-5 py-2.5 text-sm
                   bg-red-primary text-white rounded-md hover:bg-red-dark
                   transition-colors no-underline"
      >
        <Compass size={15} strokeWidth={1.5} />
        浏览知识网络
      </Link>
    </motion.div>
  )
}

export default function MyCoursesPage() {
  const enrolled = useMemo(
    () => courses.filter((c) => ENROLLED_IDS.includes(c.id)),
    [],
  )

  return (
    <div className="p-8 max-w-4xl mx-auto">
      {/* Editorial header */}
      <motion.div variants={fadeUp} custom={0} initial="hidden" animate="visible">
        <div className="border-l-3 border-l-red-primary pl-4 mb-8">
          <h1 className="font-heading text-3xl text-text-main">我的课程</h1>
          <p className="text-text-muted mt-1">
            {enrolled.length > 0
              ? `已加入 ${enrolled.length} 门课程`
              : '已加入的课程列表'}
          </p>
        </div>
      </motion.div>

      {enrolled.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {enrolled.map((course, i) => (
            <CourseCard key={course.id} course={course} index={i} />
          ))}
        </div>
      ) : (
        <EmptyState />
      )}
    </div>
  )
}
