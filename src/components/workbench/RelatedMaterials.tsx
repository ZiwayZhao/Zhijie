import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { FileText, ChevronRight } from 'lucide-react'
interface Material {
  id: string
  courseId: string
  name: string
  type: string
  uploader: string
  uploadTime: string
  fileSize: string
}

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
      className="border-t border-border-warm pt-8 mt-10"
    >
      {/* Academic "Related Readings" header */}
      <div className="mb-5">
        <span className="text-[10px] tracking-widest uppercase text-text-muted font-body">
          Related Readings
        </span>
        <h3 className="font-heading text-xl text-text-main mt-0.5">
          相关材料
        </h3>
        <div className="w-8 h-px bg-red-primary mt-2" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {related.map((m, i) => (
          <motion.div
            key={m.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 + i * 0.08, duration: 0.35 }}
          >
            <Link
              to={`/course/${courseId}/material/${m.id}`}
              className="group flex items-start gap-3 p-4 border border-border-warm rounded-sm
                         bg-bg-card hover:border-red-primary transition-colors no-underline"
            >
              <div className="w-8 h-8 shrink-0 flex items-center justify-center border border-border-warm
                              group-hover:border-red-primary transition-colors">
                <FileText
                  size={14}
                  strokeWidth={1.5}
                  className="text-text-muted group-hover:text-red-primary transition-colors"
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-text-main font-medium truncate group-hover:text-red-primary transition-colors">
                  {m.name}
                </p>
                <p className="text-xs text-text-muted mt-1 italic">
                  {m.type} · {m.uploader} · {m.uploadTime}
                </p>
              </div>
              <ChevronRight
                size={14}
                strokeWidth={1.5}
                className="text-border-warm group-hover:text-red-primary transition-colors shrink-0 mt-0.5"
              />
            </Link>
          </motion.div>
        ))}
      </div>
    </motion.section>
  )
}
