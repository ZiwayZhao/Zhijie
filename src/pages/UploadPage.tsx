import { useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Upload } from 'lucide-react'
import DropZone from '@/components/upload/DropZone'
import FileList from '@/components/upload/FileList'
import type { UploadFile } from '@/components/upload/FileList'
import ClassifyForm from '@/components/upload/ClassifyForm'
import type { ClassifyData } from '@/components/upload/ClassifyForm'
import UploadProgress from '@/components/upload/UploadProgress'
import { addMaterial } from '@/mocks/materials'

type UploadStatus = 'idle' | 'uploading' | 'done'

/** Read file as base64 (PDF/images) or text (md/txt/docx) */
function readFileContent(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    if (file.type === 'application/pdf' || file.type.startsWith('image/')) {
      reader.onload = (e) => {
        const result = e.target?.result as string
        // Strip data URL prefix, keep base64
        resolve(result.split(',')[1] ?? result)
      }
      reader.readAsDataURL(file)
    } else {
      reader.onload = (e) => resolve(e.target?.result as string)
      reader.readAsText(file)
    }
  })
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function UploadPage() {
  const [files, setFiles] = useState<UploadFile[]>([])
  const [status, setStatus] = useState<UploadStatus>('idle')
  const [progress, setProgress] = useState(0)
  const counterRef = useRef(0)
  const classifyRef = useRef<ClassifyData | null>(null)
  const navigate = useNavigate()

  const handleFiles = useCallback((newFiles: File[]) => {
    const uploads: UploadFile[] = newFiles.map((file) => ({
      id: `file-${++counterRef.current}`,
      file,
    }))
    setFiles((prev) => [...prev, ...uploads])
  }, [])

  const handleRemove = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id))
  }, [])

  function handleSubmit(data: ClassifyData) {
    classifyRef.current = data
    setStatus('uploading')
    setProgress(0)

    // Mock upload — animate to 100% then complete
    const start = performance.now()
    const duration = 1800 // 1.8 seconds
    const animate = () => {
      const elapsed = performance.now() - start
      const pct = Math.min(Math.round((elapsed / duration) * 100), 100)
      setProgress(pct)
      if (pct < 100) {
        requestAnimationFrame(animate)
      } else {
        saveMaterials(data)
        setStatus('done')
      }
    }
    requestAnimationFrame(animate)
  }

  async function saveMaterials(data: ClassifyData) {
    const now = new Date().toISOString().slice(0, 10)
    for (const f of files) {
      const fileData = await readFileContent(f.file)
      addMaterial({
        id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        courseId: data.courseId,
        name: f.file.name.replace(/\.[^.]+$/, ''),
        type: data.materialType as '课件' | '习题' | '笔记' | '考题',
        uploader: '我',
        uploadTime: now,
        fileSize: formatFileSize(f.file.size),
        fileType: f.file.type,
        fileData,
      })
    }
  }

  function handleGoToCourse() {
    const courseId = classifyRef.current?.courseId
    if (courseId) {
      navigate(`/course/${courseId}`)
    } else {
      navigate('/my/materials')
    }
  }

  return (
    <div className="max-w-[720px] mx-auto px-6 py-8 lg:py-10">
      {/* Editorial page header */}
      <motion.header
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="mb-8 border-b border-border-warm pb-6"
      >
        <div className="flex items-center gap-2 mb-2">
          <Upload size={16} strokeWidth={1.5} className="text-red-primary" />
          <span className="text-[10px] tracking-widest uppercase text-text-muted font-body">
            Upload
          </span>
        </div>
        <h1 className="font-heading text-3xl text-text-main">上传学习材料</h1>
        <p className="text-sm text-text-muted mt-2 leading-relaxed">
          上传课件、习题、笔记或考题，AI 将自动为你归类
        </p>
      </motion.header>

      <div className="space-y-6">
        {/* Drop zone */}
        {status === 'idle' && <DropZone onFiles={handleFiles} />}

        {/* File list */}
        {status === 'idle' && <FileList files={files} onRemove={handleRemove} />}

        {/* Classify form — show when files added and not yet submitting */}
        {files.length > 0 && status === 'idle' && (
          <ClassifyForm fileCount={files.length} onSubmit={handleSubmit} />
        )}

        {/* Upload progress */}
        {status !== 'idle' && (
          <UploadProgress
            status={status === 'done' ? 'done' : 'uploading'}
            progress={progress}
          />
        )}

        {/* After upload done */}
        {status === 'done' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="flex items-center justify-center gap-4 pt-2"
          >
            <button
              onClick={handleGoToCourse}
              className="px-5 py-2.5 rounded-sm bg-red-primary text-white text-sm font-medium hover:bg-red-dark transition-colors"
            >
              查看课程材料
            </button>
            <button
              onClick={() => {
                setFiles([])
                setStatus('idle')
                setProgress(0)
              }}
              className="text-sm text-text-muted hover:text-red-primary transition-colors"
            >
              继续上传
            </button>
          </motion.div>
        )}
      </div>
    </div>
  )
}
