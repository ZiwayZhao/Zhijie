import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { FileText, Calendar, User, BookOpen } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import remarkGfm from 'remark-gfm'
import rehypeKatex from 'rehype-katex'
import type { Material } from '@/mocks/materials'
import { materialContent } from '@/mocks/materials'
import { getCourseById } from '@/mocks/courses'

interface MaterialReaderProps {
  material: Material
}

/** Fix common markdown issues (ported from science1204) */
function fixMarkdown(md: string): string {
  let fixed = md
  // Fix LaTeX pipes
  fixed = fixed.replace(/(\$\$[\s\S]*?\$\$)|(\$[^$\n]*?\$)/g, (match) => {
    if (match.indexOf('|') === -1) return match
    return match.replace(/\|/g, '\\vert')
  })
  // Unwrap bolded headers
  fixed = fixed.replace(/^\s*\*\*\s*(#{1,6})\s*(.*?)\*\*\s*$/gm, '$1 $2')
  // Remove duplicate hashes
  fixed = fixed.replace(/(^|\n)(#{1,6})\s+(?:#+\s+)+/g, '$1$2 ')
  // Ensure space after # (only when no space exists, e.g. #Title → # Title)
  fixed = fixed.replace(/^(#{1,6})(?=[^# \n])/gm, '$1 ')
  return fixed
}

export default function MaterialReader({ material }: MaterialReaderProps) {
  const course = getCourseById(material.courseId)
  const isPdf = material.fileType === 'application/pdf'

  // Build PDF blob URL from base64 data
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

  // Determine content to render
  const content = material.fileData && !isPdf
    ? material.fileData
    : materialContent // fallback to mock for static materials

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="space-y-6"
    >
      {/* Material header */}
      <header className="border-b border-border-warm pb-6">
        <h1 className="font-heading text-3xl text-text-main leading-snug">
          {material.name}
        </h1>
        <div className="flex flex-wrap items-center gap-4 mt-4 text-sm text-text-muted">
          <span className="flex items-center gap-1.5">
            <User size={14} strokeWidth={1.5} />
            {material.uploader}
          </span>
          <span className="flex items-center gap-1.5">
            <Calendar size={14} strokeWidth={1.5} />
            {material.uploadTime}
          </span>
          <span className="flex items-center gap-1.5">
            <FileText size={14} strokeWidth={1.5} />
            {material.fileSize}
          </span>
          {course && (
            <span className="flex items-center gap-1.5">
              <BookOpen size={14} strokeWidth={1.5} />
              {course.name} — {course.school}
            </span>
          )}
        </div>
        <div className="flex gap-2 mt-3">
          <span className="px-2.5 py-0.5 text-xs border border-red-primary text-red-primary rounded-sm">
            {material.type}
          </span>
        </div>
      </header>

      {/* Content area */}
      {isPdf && pdfUrl ? (
        <div className="w-full rounded-md overflow-hidden border border-border-warm" style={{ height: '80vh' }}>
          <iframe
            src={pdfUrl}
            className="w-full h-full border-0"
            title={`PDF: ${material.name}`}
          />
        </div>
      ) : (
        <div className="prose-academic">
          <ReactMarkdown
            remarkPlugins={[remarkMath, remarkGfm]}
            rehypePlugins={[rehypeKatex]}
            components={mdComponents}
          >
            {fixMarkdown(content)}
          </ReactMarkdown>
        </div>
      )}
    </motion.article>
  )
}

/** Custom markdown component styles matching editorial academic design */
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
