import { useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { FileText, ClipboardList, PenLine, FileQuestion, Upload, ChevronRight } from 'lucide-react'
import { getUserMaterials } from '@/mocks/materials'
import type { Material } from '@/mocks/materials'

const typeIcons: Record<string, typeof FileText> = {
  课件: FileText,
  习题: ClipboardList,
  笔记: PenLine,
  考题: FileQuestion,
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
  const userMaterials = getUserMaterials()
  const [filter, setFilter] = useState('全部')

  const types = ['全部', '课件', '习题', '笔记', '考题']
  const filtered = filter === '全部'
    ? userMaterials
    : userMaterials.filter((m) => m.type === filter)

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <motion.div initial="hidden" animate="visible" variants={fadeUp} custom={0}>
        <div className="border-l-3 border-l-red-primary pl-4 mb-8">
          <h1 className="font-heading text-3xl text-text-main">我的材料</h1>
          <p className="text-text-muted mt-1">你上传的所有学习材料</p>
        </div>
      </motion.div>

      {userMaterials.length === 0 ? (
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
        <>
          {/* Filter tabs */}
          <div className="flex gap-1 border-b border-border-warm mb-5">
            {types.map((t) => (
              <button
                key={t}
                onClick={() => setFilter(t)}
                className={[
                  'px-4 py-2 text-sm transition-colors cursor-pointer border-b-2 -mb-px',
                  filter === t
                    ? 'border-red-primary text-red-primary font-medium'
                    : 'border-transparent text-text-muted hover:text-text-body',
                ].join(' ')}
              >
                {t}
              </button>
            ))}
          </div>

          {/* Materials list */}
          {filtered.length === 0 ? (
            <p className="text-text-muted text-sm py-8 text-center">暂无该类型的材料</p>
          ) : (
            <div className="space-y-0">
              {filtered.map((m, i) => (
                <MaterialRow key={m.id} material={m} index={i} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function MaterialRow({ material, index }: { material: Material; index: number }) {
  const Icon = typeIcons[material.type] ?? FileText

  return (
    <motion.div variants={fadeUp} initial="hidden" animate="visible" custom={index + 1}>
      <Link
        to={`/course/${material.courseId}/material/${material.id}`}
        className="flex items-center gap-4 py-3.5 px-4 -mx-4 border-b border-border-warm
                   last:border-b-0 no-underline hover:bg-bg-accent rounded-sm transition-colors group"
      >
        <div className="w-9 h-9 shrink-0 rounded-md bg-bg-accent flex items-center justify-center border border-border-warm">
          <Icon size={16} className="text-red-primary" strokeWidth={1.5} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-text-main font-medium truncate">{material.name}</p>
          <p className="text-xs text-text-muted mt-0.5">
            {material.uploadTime} · {material.fileSize}
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
