import { motion, AnimatePresence } from 'framer-motion'
import { FileText, Image, FileSpreadsheet, X } from 'lucide-react'

export interface UploadFile {
  id: string
  file: File
}

interface FileListProps {
  files: UploadFile[]
  onRemove: (id: string) => void
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function getFileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return Image
  if (['ppt', 'pptx'].includes(ext)) return FileSpreadsheet
  return FileText
}

export default function FileList({ files, onRemove }: FileListProps) {
  if (files.length === 0) return null

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.1 }}
      className="space-y-2"
    >
      <h3 className="font-heading text-base text-text-main">
        已选择文件 ({files.length})
      </h3>
      <AnimatePresence>
        {files.map((f, i) => {
          const Icon = getFileIcon(f.file.name)
          return (
            <motion.div
              key={f.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 8 }}
              transition={{ delay: i * 0.05 }}
              className="flex items-center gap-3 p-3 border border-border-warm rounded-md bg-bg-card"
            >
              <Icon size={18} strokeWidth={1.5} className="text-text-muted shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-text-main truncate">{f.file.name}</p>
                <p className="text-xs text-text-muted">{formatSize(f.file.size)}</p>
              </div>
              <button
                onClick={() => onRemove(f.id)}
                className="p-1 rounded hover:bg-bg-accent transition-colors"
                aria-label="删除文件"
              >
                <X size={14} strokeWidth={1.5} className="text-text-muted" />
              </button>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </motion.div>
  )
}
