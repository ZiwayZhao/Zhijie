import { useParams, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft } from 'lucide-react'
import { getMaterialById, getMaterialsByCourse } from '@/mocks/materials'
import { getCourseById } from '@/mocks/courses'
import MaterialReader from '@/components/workbench/MaterialReader'
import RelatedMaterials from '@/components/workbench/RelatedMaterials'
import AIToolPanel from '@/components/workbench/AIToolPanel'

export default function WorkbenchPage() {
  const { id: courseId, mid } = useParams()
  const material = mid ? getMaterialById(mid) : undefined
  const course = courseId ? getCourseById(courseId) : undefined
  const courseMaterials = courseId ? getMaterialsByCourse(courseId) : []

  if (!material || !course) {
    return (
      <div className="p-8">
        <h1 className="font-heading text-2xl text-text-main">材料未找到</h1>
        <p className="text-text-muted mt-2">
          无法找到对应的学习材料。
        </p>
        <Link
          to={courseId ? `/course/${courseId}` : '/'}
          className="inline-flex items-center gap-1.5 mt-4 text-sm text-red-primary hover:underline"
        >
          <ArrowLeft size={14} strokeWidth={1.5} />
          返回课程
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col lg:flex-row min-h-0">
      {/* 70% Left — Material reader */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.35 }}
        className="flex-[7] min-w-0 p-6 lg:p-8 overflow-y-auto"
      >
        {/* Breadcrumb */}
        <nav className="flex items-center gap-1.5 text-sm text-text-muted mb-6">
          <Link to="/" className="hover:text-text-body transition-colors no-underline text-text-muted">
            首页
          </Link>
          <span>/</span>
          <Link
            to={`/course/${courseId}`}
            className="hover:text-text-body transition-colors no-underline text-text-muted"
          >
            {course.name}
          </Link>
          <span>/</span>
          <span className="text-text-main">{material.name}</span>
        </nav>

        <MaterialReader material={material} />

        <RelatedMaterials
          materials={courseMaterials}
          currentId={material.id}
          courseId={course.id}
        />
      </motion.div>

      {/* 30% Right — AI tool panel (sticky) */}
      <motion.aside
        initial={{ opacity: 0, x: 16 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.15, duration: 0.35 }}
        className="flex-[3] border-l border-border-warm bg-bg-card p-5 lg:p-6
                   lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto
                   max-lg:border-t max-lg:border-l-0"
      >
        <AIToolPanel />
      </motion.aside>
    </div>
  )
}
