import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { FileText } from 'lucide-react'
import type { Material } from '@/mocks/materials'

interface RelatedMaterialsProps {
  materials: Material[]
  currentId: string
  courseId: string
}

export default function RelatedMaterials({
  materials,
  currentId,
  courseId,
}: RelatedMaterialsProps) {
  const related = materials.filter((m) => m.id !== currentId).slice(0, 4)

  if (related.length === 0) return null

  return (
    <motion.section
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.3, duration: 0.4 }}
      className="border-t border-border-warm pt-6 mt-8"
    >
      <h3 className="font-heading text-lg text-text-main mb-4">
        相关材料
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {related.map((m, i) => (
          <motion.div
            key={m.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 + i * 0.08 }}
          >
            <Link
              to={`/course/${courseId}/material/${m.id}`}
              className="flex items-start gap-3 p-3 border border-border-warm rounded-md bg-bg-card hover:border-red-primary transition-colors no-underline"
            >
              <FileText
                size={16}
                strokeWidth={1.5}
                className="text-text-muted mt-0.5 shrink-0"
              />
              <div className="min-w-0">
                <p className="text-sm text-text-main font-medium truncate">
                  {m.name}
                </p>
                <p className="text-xs text-text-muted mt-0.5">
                  {m.type} · {m.uploader}
                </p>
              </div>
            </Link>
          </motion.div>
        ))}
      </div>
    </motion.section>
  )
}
