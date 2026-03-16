import { useState, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { motion, type Variants } from 'framer-motion'
import { FileText, FileQuestion, PenLine, ClipboardList, BookMarked, Users, Calendar, ChevronRight } from 'lucide-react'
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
    <div className="p-8 max-w-6xl">
      <CourseHeader course={course} />
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-8 mt-8">
        <MaterialsPanel courseId={course.id} />
        <CourseSidebar course={course} />
      </div>
    </div>
  )
}

function CourseHeader({ course }: { course: ReturnType<typeof getCourseById> & object }) {
  return (
    <motion.div initial="hidden" animate="visible" variants={fadeUp} custom={0}>
      <div className="border border-border-warm border-l-3 border-l-red-primary rounded-md bg-bg-card p-6">
        <h1 className="font-heading text-3xl text-text-main mb-1">{course.name}</h1>
        <p className="text-sm text-text-muted mb-3">{course.school}</p>
        <p className="text-text-body text-sm leading-relaxed mb-4">{course.description}</p>
        <div className="flex items-center gap-5 text-sm text-text-muted">
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
              className="px-2.5 py-0.5 text-xs rounded-sm border border-border-warm text-text-muted bg-bg-accent"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>
    </motion.div>
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
      {/* Tabs */}
      <div className="flex gap-1 border-b border-border-warm mb-5">
        {materialTypes.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={[
              'px-4 py-2 text-sm transition-colors cursor-pointer border-b-2 -mb-px',
              activeTab === tab
                ? 'border-red-primary text-red-primary font-medium'
                : 'border-transparent text-text-muted hover:text-text-body',
            ].join(' ')}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <p className="text-text-muted text-sm py-8 text-center">暂无该类型的材料</p>
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
        className="flex items-center gap-4 py-3.5 px-4 -mx-4 border-b border-border-warm
                   last:border-b-0 no-underline hover:bg-bg-accent rounded-sm transition-colors group"
        style={{ contentVisibility: 'auto' }}
      >
        <div className="w-9 h-9 shrink-0 rounded-md bg-bg-accent flex items-center justify-center border border-border-warm">
          <Icon size={16} className="text-red-primary" strokeWidth={1.5} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-text-main font-medium truncate">{material.name}</p>
          <p className="text-xs text-text-muted mt-0.5">
            {material.uploader} · {material.uploadTime} · {material.fileSize}
          </p>
        </div>
        <span className="px-2 py-0.5 text-xs rounded-sm border border-border-warm text-text-muted bg-bg-card">
          {material.type}
        </span>
        <ChevronRight
          size={16}
          className="text-text-muted group-hover:text-red-primary transition-colors shrink-0"
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
      className="space-y-5"
    >
      {/* Stats */}
      <div className="border border-border-warm rounded-md bg-bg-card p-5">
        <h3 className="font-heading text-base text-text-main mb-4">课程统计</h3>
        <div className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-text-muted flex items-center gap-1.5">
              <BookMarked size={14} strokeWidth={1.5} /> 材料总数
            </span>
            <span className="text-text-main font-medium">{course.materialCount}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-muted flex items-center gap-1.5">
              <Users size={14} strokeWidth={1.5} /> 参与学生
            </span>
            <span className="text-text-main font-medium">{course.studentCount}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-muted flex items-center gap-1.5">
              <Calendar size={14} strokeWidth={1.5} /> 最近更新
            </span>
            <span className="text-text-main font-medium">2 天前</span>
          </div>
        </div>
      </div>

      {/* Contributors */}
      <div className="border border-border-warm rounded-md bg-bg-card p-5">
        <h3 className="font-heading text-base text-text-main mb-4">贡献者</h3>
        <div className="space-y-2.5">
          {contributors.map((c) => (
            <div key={c.name} className="flex items-center justify-between text-sm">
              <span className="text-text-body">{c.name}</span>
              <span className="text-xs text-text-muted">{c.count} 份</span>
            </div>
          ))}
        </div>
      </div>

      {/* Related */}
      {related.length > 0 && (
        <div className="border border-border-warm rounded-md bg-bg-card p-5">
          <h3 className="font-heading text-base text-text-main mb-4">相关课程</h3>
          <div className="space-y-0">
            {related.map((c) => (
              <Link
                key={c.id}
                to={`/course/${c.id}`}
                className="block py-2.5 border-b border-border-warm last:border-b-0
                           no-underline hover:text-red-primary transition-colors"
              >
                <p className="text-sm text-text-main">{c.name}</p>
                <p className="text-xs text-text-muted mt-0.5">{c.school}</p>
              </Link>
            ))}
          </div>
        </div>
      )}
    </motion.aside>
  )
}
