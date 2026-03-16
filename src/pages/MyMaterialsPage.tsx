import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { FileText, Upload, ChevronRight, Trash2 } from 'lucide-react'
import { fetchMaterials, deleteMaterial, type MaterialItem } from '@/lib/api'

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('zh-CN')
}

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.05, duration: 0.35 },
  }),
}

export default function MyMaterialsPage() {
  const [materials, setMaterials] = useState<MaterialItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchMaterials({ limit: 100 })
      .then((r) => setMaterials(r.items))
      .catch((e) => console.error('Failed to load materials:', e))
      .finally(() => setLoading(false))
  }, [])

  async function handleDelete(id: string) {
    try {
      await deleteMaterial(id)
      setMaterials((prev) => prev.filter((m) => m.id !== id))
    } catch (e) {
      console.error('Delete failed:', e)
    }
  }

  if (loading) {
    return (
      <div className="p-8 max-w-4xl mx-auto animate-pulse">
        <div className="h-8 w-40 bg-border-warm rounded mb-8" />
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-16 bg-border-warm/30 rounded mb-2" />
        ))}
      </div>
    )
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <motion.div initial="hidden" animate="visible" variants={fadeUp} custom={0}>
        <div className="border-l-3 border-l-red-primary pl-4 mb-8">
          <h1 className="font-heading text-3xl text-text-main">我的材料</h1>
          <p className="text-text-muted mt-1">你上传的所有学习材料 ({materials.length})</p>
        </div>
      </motion.div>

      {materials.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="mt-12 text-center"
        >
          <Upload size={40} strokeWidth={1} className="mx-auto text-text-muted mb-4" />
          <p className="text-text-muted text-sm mb-4">还没有上传过材料</p>
          <Link
            to="/upload"
            className="inline-block px-5 py-2.5 rounded-md bg-red-primary text-white text-sm font-medium hover:bg-red-dark transition-colors no-underline"
          >
            上传第一份材料
          </Link>
        </motion.div>
      ) : (
        <div className="space-y-0">
          {materials.map((m, i) => (
            <MaterialRow key={m.id} material={m} index={i} onDelete={handleDelete} />
          ))}
        </div>
      )}
    </div>
  )
}

function MaterialRow({
  material,
  index,
  onDelete,
}: {
  material: MaterialItem
  index: number
  onDelete: (id: string) => void
}) {
  return (
    <motion.div variants={fadeUp} initial="hidden" animate="visible" custom={index + 1}>
      <div className="flex items-center gap-4 py-3.5 px-4 -mx-4 border-b border-border-warm last:border-b-0">
        <Link
          to={`/course/${material.courseId || '_'}/material/${material.id}`}
          className="flex items-center gap-4 flex-1 min-w-0 no-underline hover:bg-bg-accent rounded-sm transition-colors group"
        >
          <div className="w-9 h-9 shrink-0 rounded-md bg-bg-accent flex items-center justify-center border border-border-warm">
            <FileText size={16} className="text-red-primary" strokeWidth={1.5} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-text-main font-medium truncate">{material.title}</p>
            <p className="text-xs text-text-muted mt-0.5">
              {formatDate(material.createdAt)} · {formatFileSize(material.fileSize)} · {material.materialType}
            </p>
          </div>
          <span className={`px-2 py-0.5 text-xs rounded-sm border border-border-warm text-text-muted bg-bg-card`}>
            {material.analysisStatus === 'confirmed' ? '已确认' :
             material.analysisStatus === 'processing' ? '分析中' :
             material.analysisStatus === 'completed' ? '已分析' : '待处理'}
          </span>
          <ChevronRight
            size={16}
            className="text-text-muted group-hover:text-red-primary transition-colors shrink-0"
            strokeWidth={1.5}
          />
        </Link>
        <button
          onClick={() => onDelete(material.id)}
          className="p-1.5 text-text-muted hover:text-red-primary transition-colors shrink-0"
          title="删除"
        >
          <Trash2 size={14} strokeWidth={1.5} />
        </button>
      </div>
    </motion.div>
  )
}
