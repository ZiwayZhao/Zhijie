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
        'relative cursor-pointer rounded-md border-2 border-dashed p-12 text-center transition-all',
        isDragging
          ? 'border-red-primary bg-bg-accent'
          : 'border-border-warm bg-bg-card hover:border-red-primary/50',
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

      <div className="flex flex-col items-center gap-3">
        {isDragging ? (
          <FileUp size={40} strokeWidth={1} className="text-red-primary" />
        ) : (
          <Upload size={40} strokeWidth={1} className="text-text-muted" />
        )}
        <div>
          <p className="text-sm font-medium text-text-main">
            {isDragging ? '松开以上传文件' : '拖拽文件到此处，或点击选择'}
          </p>
          <p className="text-xs text-text-muted mt-1.5">
            支持 PDF、DOCX、PPT、图片等格式
          </p>
        </div>
      </div>
    </motion.div>
  )
}
