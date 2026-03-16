import { useState, useRef, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Upload, FileUp } from 'lucide-react'

interface DropZoneProps {
  onFiles: (files: File[]) => void
}

export default function DropZone({ onFiles }: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      const dropped = Array.from(e.dataTransfer.files)
      if (dropped.length > 0) onFiles(dropped)
    },
    [onFiles],
  )

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selected = e.target.files ? Array.from(e.target.files) : []
      if (selected.length > 0) onFiles(selected)
      // reset so same file can be selected again
      e.target.value = ''
    },
    [onFiles],
  )

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={[
        'relative cursor-pointer rounded-sm border-2 border-dashed py-16 px-12 text-center transition-all',
        isDragging
          ? 'border-red-primary bg-bg-accent'
          : 'border-border-warm bg-bg-card hover:border-red-primary/40 hover:bg-bg-accent/50',
      ].join(' ')}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".pdf,.docx,.pptx,.ppt,.doc,.png,.jpg,.jpeg,.txt,.md"
        onChange={handleInputChange}
        className="hidden"
      />

      <div className="flex flex-col items-center gap-4">
        {isDragging ? (
          <div className="w-14 h-14 flex items-center justify-center border-2 border-red-primary rounded-sm">
            <FileUp size={28} strokeWidth={1} className="text-red-primary" />
          </div>
        ) : (
          <div className="w-14 h-14 flex items-center justify-center border border-border-warm rounded-sm">
            <Upload size={28} strokeWidth={1} className="text-text-muted" />
          </div>
        )}
        <div>
          <p className="text-sm font-medium text-text-main">
            {isDragging ? '松开以上传文件' : '拖拽文件到此处，或点击选择'}
          </p>
          <p className="text-xs text-text-muted mt-2 leading-relaxed">
            支持 PDF、DOCX、PPT、图片等格式
          </p>
        </div>
        {!isDragging && (
          <span className="inline-block mt-1 px-4 py-1.5 text-xs border border-red-primary text-red-primary
                           rounded-sm hover:bg-red-primary hover:text-white transition-colors">
            选择文件
          </span>
        )}
      </div>
    </motion.div>
  )
}
