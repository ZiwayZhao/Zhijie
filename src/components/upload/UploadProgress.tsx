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
      className="border border-border-warm rounded-sm bg-bg-card p-6 space-y-4"
    >
      <div className="flex items-center gap-3">
        {status === 'uploading' ? (
          <div className="w-8 h-8 flex items-center justify-center border border-red-primary rounded-sm">
            <Loader2 size={16} strokeWidth={1.5} className="text-red-primary animate-spin" />
          </div>
        ) : (
          <div className="w-8 h-8 flex items-center justify-center border border-green-600 rounded-sm">
            <CheckCircle2 size={16} strokeWidth={1.5} className="text-green-600" />
          </div>
        )}
        <div className="flex-1">
          <p className="text-sm font-medium text-text-main">
            {status === 'uploading' ? '上传中...' : '上传完成'}
          </p>
          <p className="text-xs text-text-muted mt-0.5 italic">
            {status === 'uploading' ? '正在处理文件' : '文件已成功保存'}
          </p>
        </div>
        <span className="font-heading text-lg text-text-main">{progress}%</span>
      </div>

      {/* Progress bar — warm gradient */}
      <div className="h-1 rounded-full bg-bg-main overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className="h-full rounded-full"
          style={{
            background: 'linear-gradient(90deg, var(--color-red-primary), var(--color-accent-gold))',
          }}
        />
      </div>
    </motion.div>
  )
}
