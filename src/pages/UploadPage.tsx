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
import { requestUpload, uploadFileToS3, confirmUpload } from '@/lib/api'

type UploadStatus = 'idle' | 'uploading' | 'done' | 'error'

export default function UploadPage() {
  const [files, setFiles] = useState<UploadFile[]>([])
  const [status, setStatus] = useState<UploadStatus>('idle')
  const [progress, setProgress] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')
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

  async function handleSubmit(data: ClassifyData) {
    classifyRef.current = data
    setStatus('uploading')
    setProgress(0)
    setErrorMsg('')

    try {
      const total = files.length
      for (let i = 0; i < total; i++) {
        const f = files[i]
        const pctBase = Math.round((i / total) * 100)
        setProgress(pctBase)

        // Step 1: Request presigned URL
        const { materialId, uploadUrl } = await requestUpload({
          filename: f.file.name,
          contentType: f.file.type || 'application/pdf',
          fileSize: f.file.size,
          title: f.file.name.replace(/\.[^.]+$/, ''),
          materialType: data.materialType || 'pdf',
          semester: data.semester,
          courseId: data.courseId || undefined,
        })

        setProgress(pctBase + Math.round((1 / total) * 40))

        // Step 2: Upload file to S3
        await uploadFileToS3(uploadUrl, f.file)

        setProgress(pctBase + Math.round((1 / total) * 80))

        // Step 3: Confirm upload
        await confirmUpload(materialId)

        setProgress(Math.round(((i + 1) / total) * 100))
      }

      setStatus('done')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '上传失败，请重试')
      setStatus('error')
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
          上传课件、习题、笔记或考题，通过 S3 存储并自动触发 AI 分析
        </p>
      </motion.header>

      <div className="space-y-6">
        {(status === 'idle' || status === 'error') && <DropZone onFiles={handleFiles} />}

        {(status === 'idle' || status === 'error') && <FileList files={files} onRemove={handleRemove} />}

        {status === 'error' && errorMsg && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-3 border border-red-primary/20 bg-red-primary/5 rounded-md text-sm text-red-primary"
          >
            {errorMsg}
          </motion.div>
        )}

        {files.length > 0 && (status === 'idle' || status === 'error') && (
          <ClassifyForm fileCount={files.length} onSubmit={handleSubmit} />
        )}

        {status === 'uploading' && (
          <UploadProgress status="uploading" progress={progress} />
        )}

        {status === 'done' && (
          <>
            <UploadProgress status="done" progress={100} />
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
          </>
        )}
      </div>
    </div>
  )
}
