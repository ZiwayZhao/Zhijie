import { useState, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { motion, type Variants } from 'framer-motion'
import { FileText, FileQuestion, PenLine, ClipboardList, BookMarked, Users, Calendar, ChevronRight, Upload } from 'lucide-react'
import { getCourseById, courses } from '@/mocks/courses'
import { getMaterialsByType, materialTypes } from '@/mocks/materials'
import type { Material } from '@/mocks/materials'

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
  const course = getCourseById(id ?? '')

  if (!course) {
    return (
      <div className="p-8">
        <h1 className="font-heading text-2xl text-text-main">课程未找到</h1>
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
        <MaterialsPanel courseId={course.id} />
        <CourseSidebar course={course} />
      </div>
    </div>
  )
}

function CourseHeader({ course }: { course: ReturnType<typeof getCourseById> & object }) {
  return (
    <motion.header initial="hidden" animate="visible" variants={fadeUp} custom={0}>
      <div className="border-b border-border-warm pb-8">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-1.5 text-xs text-text-muted mb-5">
          <Link to="/explore" className="hover:text-text-body transition-colors no-underline text-text-muted">
            知识网络
          </Link>
          <span>/</span>
          <span className="text-text-body">{course.category}</span>
        </nav>

        {/* Category as italic subtitle */}
        <span className="text-xs tracking-widest uppercase text-text-muted font-body">
          {course.category}
        </span>

        <h1 className="font-heading text-4xl text-text-main mt-1 mb-1 leading-tight">
          {course.name}
        </h1>
        <p className="text-base text-text-muted italic font-body mb-4">{course.school}</p>

        {/* Thin red accent line */}
        <div className="w-12 h-px bg-red-primary mb-4" />

        <p className="text-text-body text-sm leading-relaxed max-w-2xl mb-5">{course.description}</p>

        <div className="flex items-center gap-6 text-sm text-text-muted">
          <span className="flex items-center gap-1.5">
            <BookMarked size={15} strokeWidth={1.5} className="text-red-primary" />
            {course.materialCount} 份材料
          </span>
          <span className="flex items-center gap-1.5">
            <Users size={15} strokeWidth={1.5} className="text-red-primary" />
            {course.studentCount} 名学生
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

function MaterialsPanel({ courseId }: { courseId: string }) {
  const [activeTab, setActiveTab] = useState<string>('全部')

  const filtered = useMemo(
    () => getMaterialsByType(courseId, activeTab),
    [courseId, activeTab],
  )

  return (
    <motion.section initial="hidden" animate="visible" variants={fadeUp} custom={1}>
      {/* Section label */}
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

      {/* Tabs — journal article section style */}
      <nav className="flex gap-0 border-b border-border-warm mb-6">
        {materialTypes.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={[
              'px-5 py-2.5 text-sm transition-colors cursor-pointer relative -mb-px font-body',
              activeTab === tab
                ? 'text-red-primary border-b-2 border-b-red-primary font-medium'
                : 'text-text-muted hover:text-text-body border-b-2 border-transparent',
            ].join(' ')}
          >
            {tab}
          </button>
        ))}
      </nav>

      {/* List — bibliography style */}
      {filtered.length === 0 ? (
        <p className="text-text-muted text-sm py-12 text-center italic">暂无该类型的材料</p>
      ) : (
        <div className="space-y-0">
          {filtered.map((m, i) => (
            <MaterialRow key={m.id} material={m} courseId={courseId} index={i} />
          ))}
        </div>
      )}
    </motion.section>
  )
}

const typeIcons: Record<Material['type'], typeof FileText> = {
  课件: FileText,
  习题: ClipboardList,
  笔记: PenLine,
  考题: FileQuestion,
}

function MaterialRow({
  material,
  courseId,
  index,
}: {
  material: Material
  courseId: string
  index: number
}) {
  const Icon = typeIcons[material.type]

  return (
    <motion.div variants={fadeUp} custom={index + 2}>
      <Link
        to={`/course/${courseId}/material/${material.id}`}
        className="flex items-center gap-4 py-4 px-4 -mx-4 border-b border-border-warm
                   last:border-b-0 no-underline hover:bg-bg-accent rounded-sm transition-colors group"
        style={{ contentVisibility: 'auto' }}
      >
        {/* Type icon with accent line */}
        <div className="w-10 h-10 shrink-0 flex items-center justify-center border border-border-warm bg-bg-main
                        group-hover:border-red-primary transition-colors">
          <Icon size={16} className="text-text-muted group-hover:text-red-primary transition-colors" strokeWidth={1.5} />
        </div>

        {/* Bibliography entry */}
        <div className="flex-1 min-w-0">
          <p className="text-sm text-text-main font-medium truncate group-hover:text-red-primary transition-colors">
            {material.name}
          </p>
          <p className="text-xs text-text-muted mt-0.5 italic">
            {material.uploader} · {material.uploadTime} · {material.fileSize}
          </p>
        </div>

        {/* Type badge */}
        <span className="px-2 py-0.5 text-[11px] border border-border-warm text-text-muted bg-bg-main shrink-0">
          {material.type}
        </span>

        <ChevronRight
          size={14}
          className="text-border-warm group-hover:text-red-primary transition-colors shrink-0"
          strokeWidth={1.5}
        />
      </Link>
    </motion.div>
  )
}

function CourseSidebar({ course }: { course: ReturnType<typeof getCourseById> & object }) {
  const related = courses.filter((c) => c.category === course.category && c.id !== course.id).slice(0, 3)

  const contributors = [
    { name: 'Prof. Mueller', count: 12 },
    { name: 'TA Wang', count: 8 },
    { name: 'Chen Wei', count: 5 },
    { name: '学习小组A', count: 3 },
  ]

  return (
    <motion.aside
      initial="hidden"
      animate="visible"
      variants={fadeUp}
      custom={2}
      className="space-y-6"
    >
      {/* Stats — figure-caption style */}
      <div className="border border-border-warm rounded-sm bg-bg-card p-6">
        <span className="text-[10px] tracking-widest uppercase text-text-muted font-body">
          Statistics
        </span>
        <h3 className="font-heading text-base text-text-main mt-0.5 mb-4">课程统计</h3>
        <div className="w-full h-px bg-border-warm mb-4" />
        <div className="space-y-3 text-sm">
          <div className="flex justify-between items-center">
            <span className="text-text-muted flex items-center gap-1.5">
              <BookMarked size={13} strokeWidth={1.5} className="text-red-primary" /> 材料总数
            </span>
            <span className="font-heading text-lg text-text-main">{course.materialCount}</span>
          </div>
          <div className="h-px bg-border-warm" />
          <div className="flex justify-between items-center">
            <span className="text-text-muted flex items-center gap-1.5">
              <Users size={13} strokeWidth={1.5} className="text-red-primary" /> 参与学生
            </span>
            <span className="font-heading text-lg text-text-main">{course.studentCount}</span>
          </div>
          <div className="h-px bg-border-warm" />
          <div className="flex justify-between items-center">
            <span className="text-text-muted flex items-center gap-1.5">
              <Calendar size={13} strokeWidth={1.5} className="text-red-primary" /> 最近更新
            </span>
            <span className="text-sm text-text-main font-medium">2 天前</span>
          </div>
        </div>
      </div>

      {/* Contributors */}
      <div className="border border-border-warm rounded-sm bg-bg-card p-6">
        <span className="text-[10px] tracking-widest uppercase text-text-muted font-body">
          Contributors
        </span>
        <h3 className="font-heading text-base text-text-main mt-0.5 mb-4">贡献者</h3>
        <div className="w-full h-px bg-border-warm mb-4" />
        <div className="space-y-3">
          {contributors.map((c, i) => (
            <div key={c.name} className="flex items-center justify-between text-sm">
              <span className="text-text-body flex items-center gap-2">
                <span className="font-heading text-xs text-text-muted w-4">{i + 1}.</span>
                {c.name}
              </span>
              <span className="text-xs text-text-muted italic">{c.count} 份</span>
            </div>
          ))}
        </div>
      </div>

      {/* Related courses — "See Also" style */}
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
                key={c.id}
                to={`/course/${c.id}`}
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
