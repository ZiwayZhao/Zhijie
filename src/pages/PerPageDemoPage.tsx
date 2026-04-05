import { useState, useCallback, useRef, lazy, Suspense } from 'react'
import { motion } from 'framer-motion'
import { Upload, FileText, BookOpen, X, Loader2, MessageCircle } from 'lucide-react'
import PerPageViewer from '@/components/workbench/PerPageViewer'

const TutorSidebar = lazy(() => import('@/components/tutor/TutorSidebar'))

/* ------------------------------------------------------------------ */
/*  Demo page — load local PDF + Markdown to test PerPageViewer        */
/* ------------------------------------------------------------------ */

export default function PerPageDemoPage() {
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [markdown, setMarkdown] = useState<string | null>(null)
  const [mdFileName, setMdFileName] = useState<string>('')
  const [pdfFileName, setPdfFileName] = useState<string>('')
  const [loading, setLoading] = useState(false)

  const pdfInputRef = useRef<HTMLInputElement>(null)
  const mdInputRef = useRef<HTMLInputElement>(null)

  const handlePdfSelect = useCallback((file: File) => {
    setPdfFile(file)
    setPdfFileName(file.name)
  }, [])

  const handleMdSelect = useCallback(async (file: File) => {
    setLoading(true)
    try {
      const text = await file.text()
      setMarkdown(text)
      setMdFileName(file.name)
    } catch {
      alert('Markdown 文件读取失败')
    } finally {
      setLoading(false)
    }
  }, [])

  // Drag-and-drop handler
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const files = Array.from(e.dataTransfer.files)
    for (const file of files) {
      if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
        handlePdfSelect(file)
      } else if (file.name.endsWith('.md') || file.name.endsWith('.markdown') || file.name.endsWith('.txt')) {
        handleMdSelect(file)
      }
    }
  }, [handlePdfSelect, handleMdSelect])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  // Reset
  const reset = useCallback(() => {
    setPdfFile(null)
    setMarkdown(null)
    setPdfFileName('')
    setMdFileName('')
  }, [])

  // Tutor sidebar toggle
  const [tutorOpen, setTutorOpen] = useState(false)

  // If both files are loaded, show the viewer + optional tutor
  if (pdfFile && markdown) {
    return (
      <div className="flex flex-col h-[calc(100vh-64px)]">
        {/* Tiny top bar with reset + tutor toggle */}
        <div className="shrink-0 flex items-center justify-between px-4 py-1.5 bg-bg-card border-b border-border-warm">
          <span className="text-xs text-text-muted">
            📄 {pdfFileName} + 📝 {mdFileName}
          </span>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setTutorOpen(!tutorOpen)}
              className={[
                'flex items-center gap-1.5 px-3 py-1 text-xs rounded-sm border transition-colors',
                tutorOpen
                  ? 'border-red-primary bg-red-primary text-white'
                  : 'border-border-warm text-text-muted hover:border-red-primary hover:text-red-primary',
              ].join(' ')}
            >
              <MessageCircle size={12} />
              {tutorOpen ? '收起助教' : '提问'}
            </button>
            <button
              onClick={reset}
              className="flex items-center gap-1 text-xs text-text-muted hover:text-red-primary transition-colors"
            >
              <X size={12} /> 重选文件
            </button>
          </div>
        </div>

        <div className="flex-1 flex min-h-0">
          {/* Main viewer */}
          <div className="flex-1 min-w-0">
            <PerPageViewer
              pdfSource={pdfFile}
              lectureMarkdown={markdown}
              title={pdfFileName.replace(/\.pdf$/i, '')}
            />
          </div>

          {/* Tutor sidebar — slides in from right */}
          {tutorOpen && (
            <aside className="w-[340px] shrink-0 border-l border-border-warm bg-bg-card flex flex-col">
              <Suspense
                fallback={
                  <div className="flex items-center justify-center h-full">
                    <Loader2 size={16} className="animate-spin text-red-primary/60" />
                  </div>
                }
              >
                <TutorSidebar materialId="local-demo" />
              </Suspense>
            </aside>
          )}
        </div>
      </div>
    )
  }

  // File picker UI
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="max-w-2xl mx-auto py-16 px-6"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      <h1 className="font-heading text-3xl text-text-main mb-2">
        Slide ↔ 精讲 对照阅读器
      </h1>
      <div className="w-10 h-px bg-red-primary mb-3" />
      <p className="text-sm text-text-muted mb-10">
        上传 PDF 课件和对应的 Per-Page Lecture Markdown，即可左右对照阅读。
        <br />
        支持拖拽上传（同时拖入 PDF + MD 文件即可）。
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        {/* PDF picker */}
        <FilePickerCard
          icon={<FileText size={28} className="text-red-primary" />}
          title="课件 PDF"
          description="上传原始 Slides PDF"
          fileName={pdfFileName}
          accept=".pdf"
          inputRef={pdfInputRef}
          onSelect={(f) => handlePdfSelect(f)}
        />

        {/* Markdown picker */}
        <FilePickerCard
          icon={<BookOpen size={28} className="text-red-primary" />}
          title="精讲 Markdown"
          description="上传 CH*_PER_PAGE_LECTURE.md"
          fileName={mdFileName}
          accept=".md,.markdown,.txt"
          inputRef={mdInputRef}
          onSelect={(f) => handleMdSelect(f)}
        />
      </div>

      {loading && (
        <div className="flex items-center justify-center mt-8 gap-2 text-text-muted">
          <Loader2 size={16} className="animate-spin" />
          <span className="text-sm">读取文件中...</span>
        </div>
      )}

      {/* Quick start hint */}
      <div className="mt-12 p-4 border border-border-warm bg-bg-accent rounded-sm">
        <h3 className="font-heading text-sm text-text-main mb-2">快速开始</h3>
        <ol className="text-xs text-text-body space-y-1.5 list-decimal pl-4">
          <li>
            在 Finder 中找到课件 PDF（如 <code className="text-red-primary bg-bg-card px-1 rounded-sm">Ch01_IntroductionToDBS.pdf</code>）
          </li>
          <li>
            找到对应的精讲文件（如 <code className="text-red-primary bg-bg-card px-1 rounded-sm">CH1_PER_PAGE_LECTURE.md</code>）
          </li>
          <li>
            同时选中两个文件，拖拽到此页面即可
          </li>
          <li>
            使用 ← → 箭头键或页码导航翻页，左右对照阅读
          </li>
        </ol>
      </div>
    </motion.div>
  )
}

/* ------------------------------------------------------------------ */
/*  File picker card                                                   */
/* ------------------------------------------------------------------ */

function FilePickerCard({
  icon,
  title,
  description,
  fileName,
  accept,
  inputRef,
  onSelect,
}: {
  icon: React.ReactNode
  title: string
  description: string
  fileName: string
  accept: string
  inputRef: React.RefObject<HTMLInputElement | null>
  onSelect: (file: File) => void
}) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) onSelect(file)
  }

  return (
    <button
      onClick={() => inputRef.current?.click()}
      className={[
        'group flex flex-col items-center justify-center gap-3 p-8',
        'border border-border-warm rounded-sm bg-bg-card',
        'hover:border-red-primary transition-colors cursor-pointer',
        'text-center',
        fileName ? 'border-red-primary/40' : '',
      ].join(' ')}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleChange}
        className="hidden"
      />

      {fileName ? (
        <>
          {icon}
          <span className="text-sm font-medium text-text-main">{fileName}</span>
          <span className="text-xs text-success">✓ 已选择</span>
        </>
      ) : (
        <>
          <div className="w-12 h-12 flex items-center justify-center border border-border-warm group-hover:border-red-primary transition-colors rounded-full">
            <Upload size={20} className="text-text-muted group-hover:text-red-primary transition-colors" />
          </div>
          <span className="font-heading text-sm text-text-main">{title}</span>
          <span className="text-xs text-text-muted">{description}</span>
        </>
      )}
    </button>
  )
}
