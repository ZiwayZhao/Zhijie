import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  Maximize2, Minimize2, BookOpen, FileText,
} from 'lucide-react'
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import remarkGfm from 'remark-gfm'
import rehypeKatex from 'rehype-katex'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface PerPageViewerProps {
  /** PDF file — URL string or File object */
  pdfSource: string | File
  /** Raw markdown string of the per-page lecture (with ## Page N headers) */
  lectureMarkdown: string
  /** Optional: title shown in the header */
  title?: string
}

interface PageSection {
  pageNum: number
  heading: string
  content: string
}

/* ------------------------------------------------------------------ */
/*  Markdown parser — extract ## Page N sections                       */
/* ------------------------------------------------------------------ */

function parseLectureSections(md: string): PageSection[] {
  // Match: ## Page 1, ### 📄 Page 33 — Title, ### 📄 Pages 5-6 — Title
  const headerRe = /^#{2,4}\s*(?:📄\s*)?Pages?\s+(\d+)(?:\s*[-–—]\s*(\d+))?(?:\s*[-–—]\s*(.+?))?$/gm
  const sections: PageSection[] = []
  const matches: { index: number; pageNums: number[]; heading: string }[] = []

  let m: RegExpExecArray | null
  while ((m = headerRe.exec(md)) !== null) {
    const startPage = parseInt(m[1], 10)
    // m[2] is the end page if range like "Pages 5-6"; otherwise check if m[2] looks like a page number
    const endPage = m[2] && /^\d+$/.test(m[2]) ? parseInt(m[2], 10) : startPage
    const pageNums: number[] = []
    for (let p = startPage; p <= endPage; p++) pageNums.push(p)
    const heading = m[3]?.trim() || `Page ${m[1]}${endPage > startPage ? `-${m[2]}` : ''}`
    matches.push({ index: m.index, pageNums, heading })
  }

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index
    const end = i + 1 < matches.length ? matches[i + 1].index : md.length
    const content = md.slice(start, end).trim()
    // Map each page in range to the same content block
    for (const pageNum of matches[i].pageNums) {
      sections.push({ pageNum, heading: matches[i].heading, content })
    }
  }

  return sections
}

/* ------------------------------------------------------------------ */
/*  Markdown fixer (reused from MaterialReader)                        */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  PDF single-page renderer hook                                      */
/* ------------------------------------------------------------------ */

function usePdfDoc(source: string | File) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setDoc(null)

    GlobalWorkerOptions.workerSrc = pdfjsWorker

    // Convert File to ArrayBuffer for pdfjs
    const loadSource = source instanceof File
      ? source.arrayBuffer().then(buf => ({ data: new Uint8Array(buf) }))
      : Promise.resolve(source)

    loadSource.then(src => {
      const task = getDocument(src)
      task.promise
        .then(pdf => { if (!cancelled) { setDoc(pdf); setLoading(false) } else pdf.destroy() })
        .catch(err => { if (!cancelled) { setError(err?.message ?? 'PDF 加载失败'); setLoading(false) } })
    }).catch(err => {
      if (!cancelled) { setError(err?.message ?? '文件读取失败'); setLoading(false) }
    })

    return () => { cancelled = true }
  }, [source])

  return { doc, error, loading }
}

/* ------------------------------------------------------------------ */
/*  PDF Page Canvas                                                    */
/* ------------------------------------------------------------------ */

function PdfPageCanvas({
  doc,
  pageNum,
  scale = 1.5,
}: {
  doc: PDFDocumentProxy
  pageNum: number
  scale?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null)

  useEffect(() => {
    if (!doc || pageNum < 1 || pageNum > doc.numPages) return

    let cancelled = false

    doc.getPage(pageNum).then(page => {
      if (cancelled) return
      const canvas = canvasRef.current
      if (!canvas) return

      // Cancel previous render
      renderTaskRef.current?.cancel()

      const viewport = page.getViewport({ scale })
      canvas.width = viewport.width
      canvas.height = viewport.height

      const ctx = canvas.getContext('2d')!
      const task = page.render({ canvasContext: ctx, viewport })
      renderTaskRef.current = task

      task.promise.catch(() => { /* cancelled or error — ignore */ })
    })

    return () => { cancelled = true; renderTaskRef.current?.cancel() }
  }, [doc, pageNum, scale])

  return (
    <canvas
      ref={canvasRef}
      className="max-w-full h-auto mx-auto block"
      style={{ maxHeight: 'calc(100vh - 140px)' }}
    />
  )
}

/* ------------------------------------------------------------------ */
/*  Markdown components (Editorial Academic design system)             */
/* ------------------------------------------------------------------ */

const mdComponents = {
  h1: ({ children, ...p }: React.ComponentPropsWithoutRef<'h1'>) => (
    <h1 className="font-heading text-2xl text-text-main mt-6 mb-3 pb-2 border-b border-border-warm" {...p}>{children}</h1>
  ),
  h2: ({ children, ...p }: React.ComponentPropsWithoutRef<'h2'>) => (
    <h2 className="font-heading text-xl text-text-main mt-6 mb-3 pl-3 border-l-3 border-l-red-primary" {...p}>{children}</h2>
  ),
  h3: ({ children, ...p }: React.ComponentPropsWithoutRef<'h3'>) => (
    <h3 className="font-heading text-lg text-text-main mt-5 mb-2" {...p}>{children}</h3>
  ),
  h4: ({ children, ...p }: React.ComponentPropsWithoutRef<'h4'>) => (
    <h4 className="font-heading text-base font-semibold text-text-main mt-4 mb-1.5" {...p}>{children}</h4>
  ),
  p: ({ children, ...p }: React.ComponentPropsWithoutRef<'p'>) => (
    <p className="text-[14px] text-text-body leading-relaxed mb-3" {...p}>{children}</p>
  ),
  ul: ({ children, ...p }: React.ComponentPropsWithoutRef<'ul'>) => (
    <ul className="list-disc pl-5 space-y-1 text-[14px] text-text-body mb-3" {...p}>{children}</ul>
  ),
  ol: ({ children, ...p }: React.ComponentPropsWithoutRef<'ol'>) => (
    <ol className="list-decimal pl-5 space-y-1 text-[14px] text-text-body mb-3" {...p}>{children}</ol>
  ),
  blockquote: ({ children, ...p }: React.ComponentPropsWithoutRef<'blockquote'>) => (
    <blockquote className="border-l-3 border-l-red-primary bg-bg-accent pl-3 py-2 my-3 italic text-text-body text-[13px]" {...p}>{children}</blockquote>
  ),
  table: ({ children, ...p }: React.ComponentPropsWithoutRef<'table'>) => (
    <div className="overflow-x-auto my-3">
      <table className="w-full text-[13px] border border-border-warm" {...p}>{children}</table>
    </div>
  ),
  th: ({ children, ...p }: React.ComponentPropsWithoutRef<'th'>) => (
    <th className="px-2 py-1.5 text-left font-medium text-text-main bg-bg-accent border border-border-warm text-[13px]" {...p}>{children}</th>
  ),
  td: ({ children, ...p }: React.ComponentPropsWithoutRef<'td'>) => (
    <td className="px-2 py-1.5 text-text-body border border-border-warm text-[13px]" {...p}>{children}</td>
  ),
  code: ({ children, className, ...p }: React.ComponentPropsWithoutRef<'code'> & { className?: string }) => {
    if (className?.startsWith('language-')) {
      return <code className="block bg-[#1a1a1a] text-[#e5e5e5] p-3 rounded-md overflow-x-auto text-[13px] font-mono my-3" {...p}>{children}</code>
    }
    return <code className="px-1 py-0.5 text-[13px] bg-bg-accent text-red-primary border border-border-warm rounded-sm font-mono" {...p}>{children}</code>
  },
  pre: ({ children, ...p }: React.ComponentPropsWithoutRef<'pre'>) => (
    <pre className="my-3" {...p}>{children}</pre>
  ),
  strong: ({ children, ...p }: React.ComponentPropsWithoutRef<'strong'>) => (
    <strong className="font-semibold text-text-main" {...p}>{children}</strong>
  ),
  hr: (p: React.ComponentPropsWithoutRef<'hr'>) => (
    <hr className="border-t border-border-warm my-4" {...p} />
  ),
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function PerPageViewer({ pdfSource, lectureMarkdown, title }: PerPageViewerProps) {
  const sections = useMemo(() => parseLectureSections(lectureMarkdown), [lectureMarkdown])
  const { doc, error: pdfError, loading: pdfLoading } = usePdfDoc(pdfSource)

  const totalPdfPages = doc?.numPages ?? 0
  const [currentPage, setCurrentPage] = useState(1)
  const [splitRatio, setSplitRatio] = useState(50) // 50% left, 50% right
  const [isFullscreen, setIsFullscreen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const lectureRef = useRef<HTMLDivElement>(null)

  // Find the lecture section for the current page
  const currentSection = useMemo(
    () => sections.find(s => s.pageNum === currentPage),
    [sections, currentPage],
  )

  // Build a page→section lookup for the page navigator dots
  const coveredPages = useMemo(
    () => new Set(sections.map(s => s.pageNum)),
    [sections],
  )

  // Navigate
  const goTo = useCallback((p: number) => {
    if (p >= 1 && p <= totalPdfPages) {
      setCurrentPage(p)
      lectureRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }, [totalPdfPages])

  const goPrev = useCallback(() => goTo(currentPage - 1), [currentPage, goTo])
  const goNext = useCallback(() => goTo(currentPage + 1), [currentPage, goTo])

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); goPrev() }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); goNext() }
      if (e.key === 'Home') { e.preventDefault(); goTo(1) }
      if (e.key === 'End') { e.preventDefault(); goTo(totalPdfPages) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [goPrev, goNext, goTo, totalPdfPages])

  // Fullscreen toggle
  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return
    if (document.fullscreenElement) {
      document.exitFullscreen()
      setIsFullscreen(false)
    } else {
      containerRef.current.requestFullscreen()
      setIsFullscreen(true)
    }
  }, [])

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  return (
    <div
      ref={containerRef}
      className="flex flex-col h-[calc(100vh-64px)] bg-bg-main overflow-hidden"
    >
      {/* ── Top toolbar ── */}
      <div className="shrink-0 flex items-center justify-between px-4 py-2 border-b border-border-warm bg-bg-card">
        {/* Left: title + page info */}
        <div className="flex items-center gap-3 min-w-0">
          <BookOpen size={16} className="text-red-primary shrink-0" />
          <span className="font-heading text-sm text-text-main truncate">
            {title || 'Per-Page Lecture Viewer'}
          </span>
          <span className="text-xs text-text-muted shrink-0">
            {currentSection ? currentSection.heading : `Page ${currentPage}`}
          </span>
        </div>

        {/* Center: page navigation */}
        <div className="flex items-center gap-1.5">
          <button onClick={() => goTo(1)} disabled={currentPage <= 1}
            className="p-1 rounded hover:bg-bg-accent disabled:opacity-30 transition-colors">
            <ChevronsLeft size={16} className="text-text-muted" />
          </button>
          <button onClick={goPrev} disabled={currentPage <= 1}
            className="p-1 rounded hover:bg-bg-accent disabled:opacity-30 transition-colors">
            <ChevronLeft size={16} className="text-text-muted" />
          </button>

          <div className="flex items-center gap-1 px-2">
            <input
              type="number"
              min={1}
              max={totalPdfPages}
              value={currentPage}
              onChange={e => goTo(parseInt(e.target.value, 10) || 1)}
              className="w-12 text-center text-sm font-mono bg-bg-main border border-border-warm rounded-sm px-1 py-0.5
                         focus:border-red-primary focus:outline-none"
            />
            <span className="text-xs text-text-muted">/ {totalPdfPages}</span>
          </div>

          <button onClick={goNext} disabled={currentPage >= totalPdfPages}
            className="p-1 rounded hover:bg-bg-accent disabled:opacity-30 transition-colors">
            <ChevronRight size={16} className="text-text-muted" />
          </button>
          <button onClick={() => goTo(totalPdfPages)} disabled={currentPage >= totalPdfPages}
            className="p-1 rounded hover:bg-bg-accent disabled:opacity-30 transition-colors">
            <ChevronsRight size={16} className="text-text-muted" />
          </button>
        </div>

        {/* Right: controls */}
        <div className="flex items-center gap-2">
          {/* Split ratio slider */}
          <label className="flex items-center gap-1.5 text-xs text-text-muted">
            <FileText size={12} />
            <input
              type="range"
              min={20} max={80} value={splitRatio}
              onChange={e => setSplitRatio(Number(e.target.value))}
              className="w-20 h-1 accent-red-primary"
            />
            <BookOpen size={12} />
          </label>

          <div className="w-px h-4 bg-border-warm" />

          <button onClick={toggleFullscreen}
            className="p-1 rounded hover:bg-bg-accent transition-colors"
            title="全屏">
            {isFullscreen
              ? <Minimize2 size={14} className="text-text-muted" />
              : <Maximize2 size={14} className="text-text-muted" />}
          </button>
        </div>
      </div>

      {/* ── Page dot navigator ── */}
      <div className="shrink-0 flex items-center gap-0.5 px-4 py-1.5 border-b border-border-warm bg-bg-card overflow-x-auto">
        {Array.from({ length: totalPdfPages }, (_, i) => i + 1).map(p => (
          <button
            key={p}
            onClick={() => goTo(p)}
            title={`Page ${p}${coveredPages.has(p) ? ' ✓' : ''}`}
            className={[
              'w-2.5 h-2.5 rounded-full shrink-0 transition-all duration-150',
              p === currentPage
                ? 'bg-red-primary scale-125'
                : coveredPages.has(p)
                  ? 'bg-red-primary/30 hover:bg-red-primary/50'
                  : 'bg-border-warm hover:bg-text-muted/30',
            ].join(' ')}
          />
        ))}
        <span className="ml-2 text-[10px] text-text-muted shrink-0">
          {coveredPages.size}/{totalPdfPages} 页有精讲
        </span>
      </div>

      {/* ── Main split view ── */}
      <div className="flex-1 flex min-h-0">
        {/* Left: PDF slide */}
        <div
          className="overflow-auto bg-[#525659] flex items-start justify-center p-4"
          style={{ width: `${splitRatio}%` }}
        >
          {pdfLoading && (
            <div className="flex items-center justify-center h-full text-white/60 text-sm gap-2">
              <span className="animate-spin">⟳</span> 加载 PDF...
            </div>
          )}
          {pdfError && (
            <div className="text-red-400 text-sm p-4">PDF 加载失败: {pdfError}</div>
          )}
          {doc && (
            <AnimatePresence mode="wait">
              <motion.div
                key={currentPage}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="border border-border-warm"
              >
                <PdfPageCanvas doc={doc} pageNum={currentPage} scale={1.8} />
              </motion.div>
            </AnimatePresence>
          )}
        </div>

        {/* Resize handle */}
        <div className="w-px bg-border-warm shrink-0 cursor-col-resize hover:bg-red-primary/50 transition-colors" />

        {/* Right: Lecture markdown */}
        <div
          ref={lectureRef}
          className="overflow-y-auto bg-bg-card"
          style={{ width: `${100 - splitRatio}%` }}
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={currentPage}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="p-5 lg:p-6"
            >
              {currentSection ? (
                <ReactMarkdown
                  remarkPlugins={[remarkMath, remarkGfm]}
                  rehypePlugins={[rehypeKatex]}
                  components={mdComponents}
                >
                  {fixMarkdown(currentSection.content)}
                </ReactMarkdown>
              ) : (
                <div className="flex flex-col items-center justify-center h-64 text-text-muted">
                  <FileText size={32} className="mb-3 opacity-40" />
                  <p className="text-sm">Page {currentPage} 暂无精讲内容</p>
                  <p className="text-xs mt-1">这一页可能是标题页、目录页或参考文献页</p>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* ── Bottom status bar ── */}
      <div className="shrink-0 flex items-center justify-between px-4 py-1 border-t border-border-warm bg-bg-card text-[11px] text-text-muted">
        <span>← → 键翻页 | Home/End 首末页</span>
        <span>
          {currentSection
            ? `📖 ${currentSection.heading}`
            : '此页无精讲'}
          {' | '}
          共 {sections.length} 个精讲章节
        </span>
      </div>
    </div>
  )
}
