import { useMemo, useState, lazy, Suspense } from 'react'
import { motion } from 'framer-motion'
import { FileText, Calendar, User, BookOpen, Loader2 } from 'lucide-react'

const PdfAnnotator = lazy(() => import('./PdfAnnotator'))
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import remarkGfm from 'remark-gfm'
import rehypeKatex from 'rehype-katex'
import type { Material } from '@/mocks/materials'
import { materialContent } from '@/mocks/materials'
import { getCourseById } from '@/mocks/courses'

/* ---------- Types ---------- */

interface MaterialReaderProps {
  material: Material
  specialistMarkdown?: string | null
  activeTab?: string
  onTabChange?: (tab: string) => void
}

/* ---------- Tabs ---------- */

interface TabDef {
  key: string
  label: string
  available: boolean
}

/* ---------- Markdown fixer ---------- */

function fixMarkdown(md: string): string {
  let fixed = md
  fixed = fixed.replace(/(\$\$[\s\S]*?\$\$)|(\$[^$\n]*?\$)/g, (match) => {
    if (match.indexOf('|') === -1) return match
    return match.replace(/\|/g, '\\vert')
  })
  fixed = fixed.replace(/^\s*\*\*\s*(#{1,6})\s*(.*?)\*\*\s*$/gm, '$1 $2')
  fixed = fixed.replace(/(^|\n)(#{1,6})\s+(?:#+\s+)+/g, '$1$2 ')
  fixed = fixed.replace(/^(#{1,6})(?=[^# \n])/gm, '$1 ')
  return fixed
}

/* ---------- Main Component ---------- */

export default function MaterialReader({
  material,
  specialistMarkdown,
  activeTab: controlledTab,
  onTabChange,
}: MaterialReaderProps) {
  const [internalTab, setInternalTab] = useState('original')
  const activeTab = controlledTab ?? internalTab
  const setActiveTab = onTabChange ?? setInternalTab

  const course = getCourseById(material.courseId)
  const isPdf = material.fileType === 'application/pdf'

  const pdfUrl = useMemo(() => {
    if (!isPdf || !material.fileData) return null
    try {
      const binary = atob(material.fileData)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
      }
      const blob = new Blob([bytes], { type: 'application/pdf' })
      return URL.createObjectURL(blob)
    } catch {
      return null
    }
  }, [isPdf, material.fileData])

  const originalContent = material.fileData && !isPdf
    ? material.fileData
    : materialContent

  const tabs: TabDef[] = [
    { key: 'original', label: '原文', available: true },
    { key: 'specialist', label: 'AI 精讲', available: !!specialistMarkdown },
    { key: 'exam-points', label: '考点', available: false },
  ]

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="space-y-6"
    >
      {/* Material header */}
      <MaterialHeader material={material} course={course} />

      {/* Tab bar */}
      <TabBar tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Tab content */}
      {activeTab === 'original' && (
        <OriginalContent isPdf={isPdf} pdfUrl={pdfUrl} material={material} content={originalContent} />
      )}
      {activeTab === 'specialist' && specialistMarkdown && (
        <div className="prose-academic">
          <ReactMarkdown
            remarkPlugins={[remarkMath, remarkGfm]}
            rehypePlugins={[rehypeKatex]}
            components={mdComponents}
          >
            {fixMarkdown(specialistMarkdown)}
          </ReactMarkdown>
        </div>
      )}
      {activeTab === 'exam-points' && (
        <div className="py-12 text-center text-text-muted text-sm">
          考点提取功能即将上线
        </div>
      )}
    </motion.article>
  )
}

/* ---------- Sub-components ---------- */

function MaterialHeader({
  material,
  course,
}: {
  material: Material
  course: ReturnType<typeof getCourseById>
}) {
  return (
    <header className="border-b border-border-warm pb-8">
      {/* Type badge */}
      <span className="inline-block px-2.5 py-0.5 text-[11px] border border-red-primary text-red-primary mb-3">
        {material.type}
      </span>

      <h1 className="font-heading text-3xl text-text-main leading-snug">
        {material.name}
      </h1>

      {/* Thin red accent */}
      <div className="w-10 h-px bg-red-primary mt-3 mb-4" />

      <div className="flex flex-wrap items-center gap-4 text-sm text-text-muted">
        <span className="flex items-center gap-1.5">
          <User size={13} strokeWidth={1.5} className="text-red-primary" />
          {material.uploader}
        </span>
        <span className="flex items-center gap-1.5">
          <Calendar size={13} strokeWidth={1.5} />
          {material.uploadTime}
        </span>
        <span className="flex items-center gap-1.5">
          <FileText size={13} strokeWidth={1.5} />
          {material.fileSize}
        </span>
        {course && (
          <span className="flex items-center gap-1.5 italic">
            <BookOpen size={13} strokeWidth={1.5} />
            {course.name} — {course.school}
          </span>
        )}
      </div>
    </header>
  )
}

function TabBar({
  tabs,
  activeTab,
  onTabChange,
}: {
  tabs: TabDef[]
  activeTab: string
  onTabChange: (key: string) => void
}) {
  return (
    <nav className="flex gap-0 border-b border-border-warm">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => tab.available && onTabChange(tab.key)}
          disabled={!tab.available}
          className={[
            'px-5 py-2.5 text-sm transition-colors relative -mb-px font-body',
            activeTab === tab.key
              ? 'text-red-primary border-b-2 border-b-red-primary font-medium'
              : tab.available
                ? 'text-text-muted hover:text-text-body border-b-2 border-transparent'
                : 'text-text-muted/40 cursor-not-allowed border-b-2 border-transparent',
          ].join(' ')}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  )
}

function OriginalContent({
  isPdf,
  pdfUrl,
  material,
  content,
}: {
  isPdf: boolean
  pdfUrl: string | null
  material: Material
  content: string
}) {
  if (isPdf && pdfUrl) {
    return (
      <Suspense
        fallback={
          <div className="flex items-center justify-center h-[80vh] gap-2 text-text-muted">
            <Loader2 size={20} className="animate-spin" />
            <span className="text-sm">加载 PDF 阅读器...</span>
          </div>
        }
      >
        <PdfAnnotator pdfUrl={pdfUrl} materialId={material.id} />
      </Suspense>
    )
  }

  return (
    <div className="prose-academic">
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm]}
        rehypePlugins={[rehypeKatex]}
        components={mdComponents}
      >
        {fixMarkdown(content)}
      </ReactMarkdown>
    </div>
  )
}

/* ---------- Markdown components ---------- */

const mdComponents = {
  h1: ({ children, ...props }: React.ComponentPropsWithoutRef<'h1'>) => (
    <h1 className="font-heading text-2xl text-text-main mt-8 mb-4 pb-2 border-b border-border-warm" {...props}>
      {children}
    </h1>
  ),
  h2: ({ children, ...props }: React.ComponentPropsWithoutRef<'h2'>) => (
    <h2 className="font-heading text-xl text-text-main mt-8 mb-3 pl-3 border-l-3 border-l-red-primary" {...props}>
      {children}
    </h2>
  ),
  h3: ({ children, ...props }: React.ComponentPropsWithoutRef<'h3'>) => (
    <h3 className="font-heading text-lg text-text-main mt-6 mb-2" {...props}>
      {children}
    </h3>
  ),
  p: ({ children, ...props }: React.ComponentPropsWithoutRef<'p'>) => (
    <p className="text-[15px] text-text-body leading-relaxed mb-4" {...props}>
      {children}
    </p>
  ),
  ul: ({ children, ...props }: React.ComponentPropsWithoutRef<'ul'>) => (
    <ul className="list-disc pl-5 space-y-1.5 text-[15px] text-text-body mb-4" {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, ...props }: React.ComponentPropsWithoutRef<'ol'>) => (
    <ol className="list-decimal pl-5 space-y-1.5 text-[15px] text-text-body mb-4" {...props}>
      {children}
    </ol>
  ),
  blockquote: ({ children, ...props }: React.ComponentPropsWithoutRef<'blockquote'>) => (
    <blockquote
      className="border-l-3 border-l-red-primary bg-bg-accent pl-4 py-3 my-4 italic text-text-body"
      {...props}
    >
      {children}
    </blockquote>
  ),
  table: ({ children, ...props }: React.ComponentPropsWithoutRef<'table'>) => (
    <div className="overflow-x-auto my-4">
      <table className="w-full text-sm border border-border-warm" {...props}>
        {children}
      </table>
    </div>
  ),
  th: ({ children, ...props }: React.ComponentPropsWithoutRef<'th'>) => (
    <th className="px-3 py-2 text-left font-medium text-text-main bg-bg-accent border border-border-warm" {...props}>
      {children}
    </th>
  ),
  td: ({ children, ...props }: React.ComponentPropsWithoutRef<'td'>) => (
    <td className="px-3 py-2 text-text-body border border-border-warm" {...props}>
      {children}
    </td>
  ),
  code: ({ children, className, ...props }: React.ComponentPropsWithoutRef<'code'> & { className?: string }) => {
    const isBlock = className?.startsWith('language-')
    if (isBlock) {
      return (
        <code
          className="block bg-[#1a1a1a] text-[#e5e5e5] p-4 rounded-md overflow-x-auto text-sm font-mono my-4"
          {...props}
        >
          {children}
        </code>
      )
    }
    return (
      <code className="px-1.5 py-0.5 text-sm bg-bg-accent text-red-primary border border-border-warm rounded-sm font-mono" {...props}>
        {children}
      </code>
    )
  },
  pre: ({ children, ...props }: React.ComponentPropsWithoutRef<'pre'>) => (
    <pre className="my-4" {...props}>{children}</pre>
  ),
  strong: ({ children, ...props }: React.ComponentPropsWithoutRef<'strong'>) => (
    <strong className="font-semibold text-text-main" {...props}>{children}</strong>
  ),
}
