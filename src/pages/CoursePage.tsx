import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { motion, type Variants } from 'framer-motion'
import { BookMarked, Users, Star, Globe, ExternalLink, Upload, Clock, Code2, GraduationCap } from 'lucide-react'
import { fetchCourse, fetchCourses, type CourseItem } from '@/lib/api'

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.06, duration: 0.4, ease: 'easeOut' },
  }),
}

export default function CoursePage() {
  const { id } = useParams<{ id: string }>()
  const [course, setCourse] = useState<CourseItem | null>(null)
  const [related, setRelated] = useState<CourseItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setLoading(true)
    setError('')
    fetchCourse(id)
      .then((c) => {
        if (cancelled) return
        if (!c) { setError('课程未找到'); return }
        setCourse(c)
        // Fetch related courses from the same category
        return fetchCourses({ pageSize: 6, category: c.category || undefined }).then((r) => {
          if (!cancelled) {
            setRelated(r.items.filter((rc) => rc.slug !== c.slug).slice(0, 4))
          }
        })
      })
      .catch(() => { if (!cancelled) setError('加载失败') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [id])

  if (loading) return <CourseSkeleton />

  if (error || !course) {
    return (
      <div className="p-8">
        <h1 className="font-heading text-2xl text-text-main">{error || '课程未找到'}</h1>
        <p className="text-text-muted mt-2">请检查链接是否正确。</p>
        <Link to="/explore" className="text-red-primary text-sm mt-4 inline-block">
          返回知识网络
        </Link>
      </div>
    )
  }

  return (
    <div className="p-8 lg:p-10 max-w-6xl">
      <CourseHeader course={course} />
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-10 mt-10">
        <CourseContent course={course} />
        <CourseSidebar course={course} related={related} />
      </div>
    </div>
  )
}

function CourseHeader({ course }: { course: CourseItem }) {
  const stars = Array.from({ length: course.difficulty }, (_, i) => i)

  return (
    <motion.header initial="hidden" animate="visible" variants={fadeUp} custom={0}>
      <div className="border-b border-border-warm pb-8">
        <nav className="flex items-center gap-1.5 text-xs text-text-muted mb-5">
          <Link to="/explore" className="hover:text-text-body transition-colors no-underline text-text-muted">
            知识网络
          </Link>
          <span>/</span>
          <span className="text-text-body">{course.category}</span>
        </nav>

        <span className="text-xs tracking-widest uppercase text-text-muted font-body">
          {course.category}
        </span>

        <h1 className="font-heading text-4xl text-text-main mt-1 mb-1 leading-tight">
          {course.name}
        </h1>
        {course.school && (
          <p className="text-base text-text-muted italic font-body mb-4">{course.school}</p>
        )}

        <div className="w-12 h-px bg-red-primary mb-4" />

        {course.description && (
          <p className="text-text-body text-sm leading-relaxed max-w-2xl mb-5 whitespace-pre-line">
            {course.description}
          </p>
        )}

        <div className="flex items-center gap-6 text-sm text-text-muted flex-wrap">
          <span className="flex items-center gap-1.5">
            {stars.map((s) => (
              <Star key={s} size={13} className="text-accent-gold fill-accent-gold" />
            ))}
          </span>
          {course.estimatedHours && (
            <span className="flex items-center gap-1.5">
              <Clock size={14} strokeWidth={1.5} className="text-red-primary" />
              ~{course.estimatedHours} 小时
            </span>
          )}
          {course.programmingLang && (
            <span className="flex items-center gap-1.5">
              <Code2 size={14} strokeWidth={1.5} className="text-red-primary" />
              {course.programmingLang}
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <Globe size={14} strokeWidth={1.5} className="text-red-primary" />
            {course.language === 'zh' ? '中文授课' : 'English'}
          </span>
        </div>

        <div className="flex gap-1.5 mt-4 flex-wrap">
          {course.tags.map((tag) => (
            <span
              key={tag}
              className="px-2.5 py-0.5 text-[11px] border border-border-warm text-text-muted bg-bg-main"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>
    </motion.header>
  )
}

function CourseContent({ course }: { course: CourseItem }) {
  return (
    <motion.section initial="hidden" animate="visible" variants={fadeUp} custom={1}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <span className="text-[10px] tracking-widest uppercase text-text-muted font-body">
            Materials
          </span>
          <h2 className="font-heading text-xl text-text-main mt-0.5">
            课程材料
          </h2>
        </div>
        <Link
          to="/upload"
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium
                     border border-red-primary text-red-primary rounded-sm
                     hover:bg-red-primary hover:text-white transition-colors no-underline"
        >
          <Upload size={14} strokeWidth={1.5} />
          上传材料
        </Link>
      </div>

      {course.materialCount > 0 ? (
        <p className="text-sm text-text-muted py-8 text-center italic">
          {course.materialCount} 份材料将在材料系统接入后显示
        </p>
      ) : (
        <div className="py-12 text-center border border-border-warm rounded-sm bg-bg-card">
          <GraduationCap size={32} className="mx-auto text-text-muted mb-3" strokeWidth={1} />
          <p className="text-text-muted text-sm">暂无材料</p>
          <p className="text-text-muted text-xs mt-1">上传第一份学习材料，开始AI分析之旅</p>
        </div>
      )}

      {(course.websiteUrl || course.videoUrl) && (
        <div className="mt-8">
          <span className="text-[10px] tracking-widest uppercase text-text-muted font-body">
            Resources
          </span>
          <h2 className="font-heading text-xl text-text-main mt-0.5 mb-4">
            课程资源
          </h2>
          <div className="space-y-3">
            {course.websiteUrl && (
              <a
                href={course.websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-red-primary hover:underline"
              >
                <ExternalLink size={14} />
                课程官网
              </a>
            )}
            {course.videoUrl && (
              <a
                href={course.videoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-red-primary hover:underline"
              >
                <ExternalLink size={14} />
                课程视频
              </a>
            )}
          </div>
        </div>
      )}

      {course.prerequisites && (
        <div className="mt-8">
          <span className="text-[10px] tracking-widest uppercase text-text-muted font-body">
            Prerequisites
          </span>
          <h2 className="font-heading text-xl text-text-main mt-0.5 mb-2">
            先修要求
          </h2>
          <p className="text-sm text-text-body">{course.prerequisites}</p>
        </div>
      )}
    </motion.section>
  )
}

function CourseSidebar({ course, related }: { course: CourseItem; related: CourseItem[] }) {
  return (
    <motion.aside
      initial="hidden"
      animate="visible"
      variants={fadeUp}
      custom={2}
      className="space-y-6"
    >
      <div className="border border-border-warm rounded-sm bg-bg-card p-6">
        <span className="text-[10px] tracking-widest uppercase text-text-muted font-body">
          Statistics
        </span>
        <h3 className="font-heading text-base text-text-main mt-0.5 mb-4">课程信息</h3>
        <div className="w-full h-px bg-border-warm mb-4" />
        <div className="space-y-3 text-sm">
          <div className="flex justify-between items-center">
            <span className="text-text-muted">难度</span>
            <span className="flex gap-0.5">
              {Array.from({ length: course.difficulty }, (_, i) => (
                <Star key={i} size={12} className="text-accent-gold fill-accent-gold" />
              ))}
            </span>
          </div>
          {course.estimatedHours && (
            <>
              <div className="h-px bg-border-warm" />
              <div className="flex justify-between items-center">
                <span className="text-text-muted">预计学时</span>
                <span className="font-heading text-text-main">{course.estimatedHours}h</span>
              </div>
            </>
          )}
          {course.programmingLang && (
            <>
              <div className="h-px bg-border-warm" />
              <div className="flex justify-between items-center">
                <span className="text-text-muted">编程语言</span>
                <span className="text-text-main text-xs">{course.programmingLang}</span>
              </div>
            </>
          )}
          <div className="h-px bg-border-warm" />
          <div className="flex justify-between items-center">
            <span className="text-text-muted">授课语言</span>
            <span className="text-text-main">{course.language === 'zh' ? '中文' : 'English'}</span>
          </div>
          <div className="h-px bg-border-warm" />
          <div className="flex justify-between items-center">
            <span className="text-text-muted flex items-center gap-1.5">
              <BookMarked size={13} strokeWidth={1.5} className="text-red-primary" /> 材料
            </span>
            <span className="font-heading text-lg text-text-main">{course.materialCount}</span>
          </div>
          <div className="h-px bg-border-warm" />
          <div className="flex justify-between items-center">
            <span className="text-text-muted flex items-center gap-1.5">
              <Users size={13} strokeWidth={1.5} className="text-red-primary" /> 学生
            </span>
            <span className="font-heading text-lg text-text-main">{course.studentCount}</span>
          </div>
        </div>
      </div>

      {related.length > 0 && (
        <div className="border border-border-warm rounded-sm bg-bg-card p-6">
          <span className="text-[10px] tracking-widest uppercase text-text-muted font-body">
            See Also
          </span>
          <h3 className="font-heading text-base text-text-main mt-0.5 mb-4">相关课程</h3>
          <div className="w-full h-px bg-border-warm mb-4" />
          <div className="space-y-0">
            {related.map((c) => (
              <Link
                key={c.slug}
                to={`/course/${c.slug}`}
                className="block py-3 border-b border-border-warm last:border-b-0
                           no-underline group"
              >
                <p className="text-sm text-text-main group-hover:text-red-primary transition-colors">
                  {c.name}
                </p>
                <p className="text-xs text-text-muted mt-0.5 italic">{c.school}</p>
              </Link>
            ))}
          </div>
        </div>
      )}
    </motion.aside>
  )
}

function CourseSkeleton() {
  return (
    <div className="p-8 lg:p-10 max-w-6xl animate-pulse">
      <div className="border-b border-border-warm pb-8">
        <div className="h-3 w-32 bg-border-warm rounded mb-5" />
        <div className="h-3 w-20 bg-border-warm rounded mb-2" />
        <div className="h-10 w-2/3 bg-border-warm rounded mb-2" />
        <div className="h-5 w-40 bg-border-warm rounded mb-4" />
        <div className="h-px w-12 bg-border-warm mb-4" />
        <div className="h-4 w-full bg-border-warm rounded mb-2" />
        <div className="h-4 w-3/4 bg-border-warm rounded" />
      </div>
    </div>
  )
}
