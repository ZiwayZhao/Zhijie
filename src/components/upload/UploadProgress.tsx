import { motion } from 'framer-motion'
import { CheckCircle2, Loader2 } from 'lucide-react'

interface UploadProgressProps {
  status: 'uploading' | 'done'
  progress: number
}

export default function UploadProgress({ status, progress }: UploadProgressProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="border border-border-warm rounded-md bg-bg-card p-5 space-y-3"
    >
      <div className="flex items-center gap-2">
        {status === 'uploading' ? (
          <Loader2 size={18} strokeWidth={1.5} className="text-red-primary animate-spin" />
        ) : (
          <CheckCircle2 size={18} strokeWidth={1.5} className="text-green-600" />
        )}
        <span className="text-sm font-medium text-text-main">
          {status === 'uploading' ? '上传中...' : '上传完成'}
        </span>
        <span className="text-xs text-text-muted ml-auto">{progress}%</span>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 rounded-full bg-bg-accent overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className="h-full rounded-full"
          style={{
            background: 'linear-gradient(90deg, #A5192E, #C49A2A)',
          }}
        />
      </div>
    </motion.div>
  )
}
