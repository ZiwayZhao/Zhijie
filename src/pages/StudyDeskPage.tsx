/**
 * StudyDeskPage — Course-level study desk.
 * Left: PerPageViewer (PDF slide + per-page lecture side-by-side)
 * Right: AI Tutor with exam context awareness
 * Top: Material tab bar for switching between lecture chapters
 */

import { Suspense, lazy, useState, useCallback, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { BookOpen, Upload, Loader2, AlertCircle, FileUp } from 'lucide-react'
import MaterialTabBar from '@/components/studydesk/MaterialTabBar'
import { useStudyDeskData } from '@/hooks/useStudyDeskData'

const PerPageViewer = lazy(() => import('@/components/workbench/PerPageViewer'))
const TutorSidebar = lazy(() => import('@/components/tutor/TutorSidebar'))

/* ---------- Loading Shimmer ---------- */

function LoadingShimmer({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-text-muted">
      <Loader2 size={20} strokeWidth={1.5} className="animate-spin text-red-primary/60" />
      <span className="text-xs font-body">{label}</span>
    </div>
  )
}

/* ---------- Empty State ---------- */

function EmptyState(_props: { courseId: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-5 px-8 text-center">
      <div className="w-16 h-16 flex items-center justify-center border-2 border-dashed border-border-warm rounded-sm">
        <BookOpen size={28} strokeWidth={1} className="text-text-muted" />
      </div>
      <div className="space-y-2">
        <h3 className="font-heading text-lg text-text-main">暂无课件材料</h3>
        <p className="text-sm text-text-muted leading-relaxed max-w-[320px]">
          上传课件 PDF 并生成逐页精讲后，即可在此对照 Slide 深入学习
        </p>
      </div>
      <Link
        to="/upload"
        className="inline-flex items-center gap-2 px-5 py-2 text-sm border border-red-primary text-red-primary
                   rounded-sm hover:bg-red-primary hover:text-white transition-colors"
      >
        <Upload size={14} strokeWidth={1.5} />
        上传课件
      </Link>
    </div>
  )
}

/* ---------- No Markdown State ---------- */

function NoMarkdownState({
  onUploadMd,
}: {
  onUploadMd: (md: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') onUploadMd(reader.result)
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 px-6 text-center">
      <AlertCircle size={24} strokeWidth={1} className="text-accent-gold" />
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-text-main">逐页精讲尚未生成</p>
        <p className="text-xs text-text-muted leading-relaxed max-w-[280px]">
          可手动上传精讲 Markdown 文件，或在工作台中触发 AI 生成
        </p>
      </div>
      <button
        onClick={() => inputRef.current?.click()}
        className="inline-flex items-center gap-2 px-4 py-1.5 text-xs border border-border-warm text-text-body
                   rounded-sm hover:border-red-primary hover:text-red-primary transition-colors"
      >
        <FileUp size={12} strokeWidth={1.5} />
        上传 .md 文件
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".md,.txt"
        onChange={handleFile}
        className="hidden"
      />
    </div>
  )
}

/* ---------- Main Page ---------- */

export default function StudyDeskPage() {
  const { id: courseId } = useParams<{ id: string }>()
  const [tutorCollapsed] = useState(false)

  const {
    lectures,
    examMaterialIds,
    selectedLecture,
    perPageMarkdown,
    loading,
    markdownLoading,
    error,
    selectLecture,
    setManualMarkdown,
  } = useStudyDeskData(courseId || '')

  const handleUploadMd = useCallback((md: string) => {
    setManualMarkdown(md)
  }, [setManualMarkdown])

  if (!courseId) {
    return <div className="p-8 text-text-muted">课程未找到</div>
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 size={20} className="animate-spin text-red-primary" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] gap-3 text-red-primary">
        <AlertCircle size={16} />
        <span className="text-sm">{error}</span>
      </div>
    )
  }

  if (lectures.length === 0) {
    return <EmptyState courseId={courseId} />
  }

  const pdfUrl = selectedLecture?.downloadUrl || ''
  const hasMarkdown = perPageMarkdown.length > 0

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col h-[calc(100vh-64px)]"
    >
      {/* Tab bar */}
      <MaterialTabBar
        materials={lectures}
        activeId={selectedLecture?.id || ''}
        onSelect={selectLecture}
      />

      {/* Main content split */}
      <div className="flex-1 flex min-h-0">
        {/* Left: PerPageViewer or empty/loading state */}
        <div className={tutorCollapsed ? 'flex-1 min-w-0' : 'flex-[7] min-w-0'}>
          {markdownLoading ? (
            <LoadingShimmer label="加载精讲内容..." />
          ) : !hasMarkdown ? (
            <NoMarkdownState onUploadMd={handleUploadMd} />
          ) : (
            <Suspense fallback={<LoadingShimmer label="加载阅读器..." />}>
              <PerPageViewer
                pdfSource={pdfUrl}
                lectureMarkdown={perPageMarkdown}
                title={selectedLecture?.title || selectedLecture?.filename}
              />
            </Suspense>
          )}
        </div>

        {/* Right: AI Tutor sidebar */}
        {!tutorCollapsed && (
          <aside className="flex-[3] min-w-[280px] max-w-[400px] border-l border-border-warm bg-bg-card flex flex-col">
            <Suspense fallback={<LoadingShimmer label="加载助教..." />}>
              <TutorSidebar
                materialId={selectedLecture?.id || ''}
                examMaterialIds={examMaterialIds}
              />
            </Suspense>
          </aside>
        )}
      </div>
    </motion.div>
  )
}
