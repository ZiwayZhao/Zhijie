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
      className="space-y-3"
    >
      <div className="flex items-center gap-2">
        <span className="text-[10px] tracking-widest uppercase text-text-muted font-body">
          Selected Files
        </span>
        <span className="text-xs text-text-muted">({files.length})</span>
      </div>
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
              className="flex items-center gap-3 p-3.5 border border-border-warm rounded-sm bg-bg-card
                         hover:border-red-primary/30 transition-colors"
            >
              <div className="w-8 h-8 flex items-center justify-center border border-border-warm shrink-0">
                <Icon size={15} strokeWidth={1.5} className="text-text-muted" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-text-main truncate">{f.file.name}</p>
                <p className="text-xs text-text-muted italic mt-0.5">{formatSize(f.file.size)}</p>
              </div>
              <button
                onClick={() => onRemove(f.id)}
                className="p-1.5 rounded-sm hover:bg-bg-accent transition-colors"
                aria-label="删除文件"
              >
                <X size={13} strokeWidth={1.5} className="text-text-muted hover:text-red-primary transition-colors" />
              </button>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </motion.div>
  )
}
