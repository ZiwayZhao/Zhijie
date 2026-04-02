import { useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Upload, FolderOpen } from 'lucide-react'
import DropZone from '@/components/upload/DropZone'
import FolderDropZone from '@/components/upload/FolderDropZone'
import FileList from '@/components/upload/FileList'
import type { UploadFile } from '@/components/upload/FileList'
import ClassifyForm from '@/components/upload/ClassifyForm'
import type { ClassifyData } from '@/components/upload/ClassifyForm'
import ClassificationTable from '@/components/upload/ClassificationTable'
import UploadProgress from '@/components/upload/UploadProgress'
import { requestUpload, uploadFileToS3, confirmUpload } from '@/lib/api'
import { classifyFiles, filterSupportedFiles, type FileWithPath, type ClassifiedFile } from '@/lib/folder-classifier'

type UploadStatus = 'idle' | 'uploading' | 'done' | 'error'
type UploadMode = 'single' | 'batch'

export default function UploadPage() {
  const [mode, setMode] = useState<UploadMode>('single')
  const [files, setFiles] = useState<UploadFile[]>([])
  const [batchFiles, setBatchFiles] = useState<ClassifiedFile[]>([])
  const [status, setStatus] = useState<UploadStatus>('idle')
  const [progress, setProgress] = useState(0)
  const [progressLabel, setProgressLabel] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const counterRef = useRef(0)
  const batchCourseRef = useRef('')
  const classifyRef = useRef<ClassifyData | null>(null)
  const navigate = useNavigate()

  /* ---------- Single file mode ---------- */

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

  async function handleSingleSubmit(data: ClassifyData) {
    classifyRef.current = data
    batchCourseRef.current = data.courseId
    setStatus('uploading')
    setProgress(0)
    setErrorMsg('')

    try {
      const total = files.length
      for (let i = 0; i < total; i++) {
        const f = files[i]
        setProgressLabel(`${i + 1} / ${total}`)
        const pctBase = Math.round((i / total) * 100)
        setProgress(pctBase)

        const contentType = f.file.type || 'application/pdf'
        const { materialId, uploadUrl } = await requestUpload({
          filename: f.file.name,
          contentType,
          fileSize: f.file.size,
          title: f.file.name.replace(/\.[^.]+$/, ''),
          materialType: data.materialType || 'pdf',
          semester: data.semester,
          courseId: data.courseId || undefined,
        })

        setProgress(pctBase + Math.round((1 / total) * 40))
        await uploadFileToS3(uploadUrl, f.file, contentType)
        setProgress(pctBase + Math.round((1 / total) * 80))
        await confirmUpload(materialId)
        setProgress(Math.round(((i + 1) / total) * 100))
      }
      setStatus('done')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '上传失败，请重试')
      setStatus('error')
    }
  }

  /* ---------- Batch folder mode ---------- */

  const handleFolderFiles = useCallback((rawFiles: FileWithPath[]) => {
    const supported = filterSupportedFiles(rawFiles)
    if (supported.length === 0) {
      setErrorMsg('未找到支持的文件格式（PDF、DOCX、PPT、图片等）')
      return
    }
    const classified = classifyFiles(supported)
    setBatchFiles(classified)
    setMode('batch')
  }, [])

  async function handleBatchConfirm(
    confirmedFiles: ClassifiedFile[],
    courseId: string,
    semester: string,
  ) {
    batchCourseRef.current = courseId
    setStatus('uploading')
    setProgress(0)
    setErrorMsg('')

    try {
      const total = confirmedFiles.length
      for (let i = 0; i < total; i++) {
        const f = confirmedFiles[i]
        setProgressLabel(`${i + 1} / ${total}: ${f.file.name}`)
        const pctBase = Math.round((i / total) * 100)
        setProgress(pctBase)

        const contentType = f.file.type || 'application/pdf'
        const { materialId, uploadUrl } = await requestUpload({
          filename: f.file.name,
          contentType,
          fileSize: f.file.size,
          title: f.file.name.replace(/\.[^.]+$/, ''),
          materialType: f.suggestedType,
          semester,
          courseId: courseId || undefined,
        })

        setProgress(pctBase + Math.round((1 / total) * 40))
        await uploadFileToS3(uploadUrl, f.file, contentType)
        setProgress(pctBase + Math.round((1 / total) * 80))
        await confirmUpload(materialId)
        setProgress(Math.round(((i + 1) / total) * 100))
      }
      setStatus('done')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '上传失败，请重试')
      setStatus('error')
    }
  }

  function handleBatchCancel() {
    setBatchFiles([])
    setMode('single')
  }

  /* ---------- Navigation ---------- */

  function handleGoToCourse() {
    const courseId = batchCourseRef.current || classifyRef.current?.courseId
    if (courseId) {
      navigate(`/course/${courseId}`)
    } else {
      navigate('/my/materials')
    }
  }

  function handleReset() {
    setFiles([])
    setBatchFiles([])
    setMode('single')
    setStatus('idle')
    setProgress(0)
    setProgressLabel('')
    setErrorMsg('')
  }

  /* ---------- Render ---------- */

  const isIdle = status === 'idle' || status === 'error'

  return (
    <div className="max-w-[780px] mx-auto px-6 py-8 lg:py-10">
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
          支持单文件上传或整个课程文件夹批量上传，自动按文件名分类
        </p>
      </motion.header>

      <div className="space-y-6">
        {/* Mode toggle — only show when idle and no files selected */}
        {isIdle && files.length === 0 && batchFiles.length === 0 && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setMode('single')}
              className={[
                'px-3 py-1.5 text-xs rounded-sm border transition-colors',
                mode === 'single'
                  ? 'border-red-primary bg-red-primary text-white'
                  : 'border-border-warm text-text-muted hover:border-red-primary/40',
              ].join(' ')}
            >
              <Upload size={11} strokeWidth={1.5} className="inline mr-1" />
              单文件上传
            </button>
            <button
              onClick={() => setMode('batch')}
              className={[
                'px-3 py-1.5 text-xs rounded-sm border transition-colors',
                mode === 'batch'
                  ? 'border-red-primary bg-red-primary text-white'
                  : 'border-border-warm text-text-muted hover:border-red-primary/40',
              ].join(' ')}
            >
              <FolderOpen size={11} strokeWidth={1.5} className="inline mr-1" />
              文件夹批量上传
            </button>
          </div>
        )}

        {/* Drop zones — show when idle */}
        {isIdle && mode === 'single' && batchFiles.length === 0 && (
          <DropZone onFiles={handleFiles} />
        )}
        {isIdle && mode === 'batch' && batchFiles.length === 0 && (
          <FolderDropZone onFiles={handleFolderFiles} />
        )}

        {/* Single mode: file list + classify form */}
        {isIdle && mode === 'single' && (
          <>
            <FileList files={files} onRemove={handleRemove} />
            {files.length > 0 && (
              <ClassifyForm fileCount={files.length} onSubmit={handleSingleSubmit} />
            )}
          </>
        )}

        {/* Batch mode: classification table */}
        {isIdle && mode === 'batch' && batchFiles.length > 0 && (
          <ClassificationTable
            files={batchFiles}
            onConfirm={handleBatchConfirm}
            onCancel={handleBatchCancel}
          />
        )}

        {/* Error message */}
        {status === 'error' && errorMsg && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-3 border border-red-primary/20 bg-red-primary/5 rounded-md text-sm text-red-primary"
          >
            {errorMsg}
          </motion.div>
        )}

        {/* Progress */}
        {status === 'uploading' && (
          <div className="space-y-2">
            <UploadProgress status="uploading" progress={progress} />
            {progressLabel && (
              <p className="text-xs text-text-muted text-center italic">{progressLabel}</p>
            )}
          </div>
        )}

        {/* Done */}
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
                onClick={handleReset}
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
