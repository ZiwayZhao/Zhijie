/**
 * MyCoursesPage — /my/courses
 * Displays enrolled courses in an editorial grid layout.
 * Uses localStorage for enrollment state + real API for course data.
 */
import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { motion, type Variants } from 'framer-motion'
import { BookOpen, Users, FileText, Compass, Loader2 } from 'lucide-react'
import { fetchCourse, type CourseItem } from '@/lib/api'
import { STORAGE_KEYS } from '@/lib/storage-keys'

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.05, duration: 0.35, ease: 'easeOut' },
  }),
}

/* ---------- Enrollment helpers ---------- */

export function getEnrolledSlugs(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.ENROLLED_COURSES)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function enrollCourse(slug: string) {
  const slugs = getEnrolledSlugs()
  if (!slugs.includes(slug)) {
    localStorage.setItem(STORAGE_KEYS.ENROLLED_COURSES, JSON.stringify([...slugs, slug]))
  }
}

export function unenrollCourse(slug: string) {
  const slugs = getEnrolledSlugs().filter((s) => s !== slug)
  localStorage.setItem(STORAGE_KEYS.ENROLLED_COURSES, JSON.stringify(slugs))
}

export function isEnrolled(slug: string): boolean {
  return getEnrolledSlugs().includes(slug)
}

/* ---------- Category colors ---------- */

function getCategoryColor(category: string): string {
  const lower = category.toLowerCase()
  if (lower.includes('math') || lower.includes('数学')) return 'bg-red-primary/8 text-red-primary'
  if (lower.includes('computer') || lower.includes('计算') || lower.includes('编程')) return 'bg-info/8 text-info'
  if (lower.includes('chem') || lower.includes('化学')) return 'bg-accent-gold/10 text-accent-gold'
  if (lower.includes('phys') || lower.includes('物理')) return 'bg-red-dark/8 text-red-dark'
  if (lower.includes('eng') || lower.includes('工程')) return 'bg-success/8 text-success'
  return 'bg-bg-accent text-text-muted'
}

/* ---------- Course Card ---------- */

function CourseCard({ course, index }: { course: CourseItem; index: number }) {
  return (
    <motion.div variants={fadeUp} custom={index + 2} initial="hidden" animate="visible">
      <Link
        to={`/course/${course.slug}`}
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

        {course.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {course.tags.slice(0, 5).map((tag) => (
              <span
                key={tag}
                className="text-[11px] px-1.5 py-0.5 border border-border-warm text-text-muted bg-bg-main"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </Link>
    </motion.div>
  )
}

/* ---------- Empty State ---------- */

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

/* ---------- Page ---------- */

export default function MyCoursesPage() {
  const [courses, setCourses] = useState<CourseItem[]>([])
  const [loading, setLoading] = useState(true)

  const loadEnrolled = useCallback(async () => {
    const slugs = getEnrolledSlugs()
    if (slugs.length === 0) {
      setCourses([])
      setLoading(false)
      return
    }
    try {
      const results = await Promise.all(slugs.map((s) => fetchCourse(s)))
      setCourses(results.filter((c): c is CourseItem => c !== null))
    } catch {
      // silently fail — show whatever we have
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadEnrolled()
  }, [loadEnrolled])

  return (
    <div className="p-8 max-w-4xl mx-auto">
      {/* Editorial header */}
      <motion.div variants={fadeUp} custom={0} initial="hidden" animate="visible">
        <div className="border-l-3 border-l-red-primary pl-4 mb-8">
          <h1 className="font-heading text-3xl text-text-main">我的课程</h1>
          <p className="text-text-muted mt-1">
            {loading
              ? '加载中...'
              : courses.length > 0
                ? `已加入 ${courses.length} 门课程`
                : '已加入的课程列表'}
          </p>
        </div>
      </motion.div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-text-muted gap-2">
          <Loader2 size={20} className="animate-spin" />
          <span className="text-sm">加载课程...</span>
        </div>
      ) : courses.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {courses.map((course, i) => (
            <CourseCard key={course.slug} course={course} index={i} />
          ))}
        </div>
      ) : (
        <EmptyState />
      )}
    </div>
  )
}
