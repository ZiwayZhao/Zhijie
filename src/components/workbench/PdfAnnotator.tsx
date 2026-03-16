import { useState, useRef, useCallback } from 'react'
import {
  PdfLoader,
  PdfHighlighter,
  TextHighlight,
  AreaHighlight,
  useHighlightContainerContext,
  type PdfHighlighterUtils,
  type Highlight,
  type PdfSelection,
} from 'react-pdf-highlighter-extended'
import 'react-pdf-highlighter-extended/dist/esm/style/PdfHighlighter.css'
import 'react-pdf-highlighter-extended/dist/esm/style/TextHighlight.css'
import 'react-pdf-highlighter-extended/dist/esm/style/AreaHighlight.css'
import 'react-pdf-highlighter-extended/dist/esm/style/MouseSelection.css'
import { Highlighter, MessageSquare, Trash2, X, Loader2 } from 'lucide-react'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface CommentedHighlight extends Highlight {
  comment?: string
  color?: string
}

interface PdfAnnotatorProps {
  pdfUrl: string
  materialId: string
}

/* ------------------------------------------------------------------ */
/*  Persistence                                                        */
/* ------------------------------------------------------------------ */

const STORAGE_PREFIX = 'zhijie_highlights_'
const COLORS = ['#FFEB3B', '#A5192E', '#4CAF50', '#2196F3', '#FF9800']

function loadHighlights(id: string): CommentedHighlight[] {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + id)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveHighlights(id: string, list: CommentedHighlight[]) {
  localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(list))
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function PdfAnnotator({ pdfUrl, materialId }: PdfAnnotatorProps) {
  const [highlights, setHighlights] = useState<CommentedHighlight[]>(() =>
    loadHighlights(materialId),
  )
  const [selectedColor, setSelectedColor] = useState(COLORS[0])
  const [showSidebar, setShowSidebar] = useState(true)
  const utilsRef = useRef<PdfHighlighterUtils | null>(null)

  const addHighlight = useCallback(
    (selection: PdfSelection, comment?: string) => {
      const ghost = selection.makeGhostHighlight()
      const h: CommentedHighlight = {
        ...ghost,
        id: `hl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        comment: comment || undefined,
        color: selectedColor,
      }
      setHighlights((prev) => {
        const next = [h, ...prev]
        saveHighlights(materialId, next)
        return next
      })
    },
    [materialId, selectedColor],
  )

  const deleteHighlight = useCallback(
    (id: string) => {
      setHighlights((prev) => {
        const next = prev.filter((h) => h.id !== id)
        saveHighlights(materialId, next)
        return next
      })
    },
    [materialId],
  )

  const scrollTo = useCallback((h: CommentedHighlight) => {
    utilsRef.current?.scrollToHighlight(h)
  }, [])

  return (
    <div className="flex rounded-md overflow-hidden border border-border-warm" style={{ height: '80vh' }}>
      {/* PDF viewer area */}
      <div className="flex-1 relative min-w-0">
        {/* Color toolbar */}
        <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5 bg-bg-card/95 backdrop-blur border border-border-warm rounded-md px-2 py-1.5">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setSelectedColor(c)}
              className="w-5 h-5 rounded-full border-2 transition-all"
              style={{
                backgroundColor: c,
                borderColor: selectedColor === c ? '#1A1A1A' : 'transparent',
                transform: selectedColor === c ? 'scale(1.15)' : 'scale(1)',
              }}
            />
          ))}
          <div className="w-px h-4 bg-border-warm mx-1" />
          <button
            onClick={() => setShowSidebar((v) => !v)}
            className="p-1 rounded hover:bg-bg-accent transition-colors"
            title={showSidebar ? '隐藏批注' : '显示批注'}
          >
            <MessageSquare size={14} className="text-text-muted" />
          </button>
        </div>

        {/* PDF.js viewer */}
        <PdfLoader
          document={pdfUrl}
          workerSrc={pdfjsWorker}
          beforeLoad={() => (
            <div className="flex items-center justify-center h-full gap-2 text-text-muted">
              <Loader2 size={20} className="animate-spin" />
              <span className="text-sm">加载 PDF...</span>
            </div>
          )}
          errorMessage={(err) => (
            <div className="flex items-center justify-center h-full text-sm text-red-primary">
              PDF 加载失败: {err.message}
            </div>
          )}
        >
          {(pdfDocument) => (
            <PdfHighlighter
              pdfDocument={pdfDocument}
              highlights={highlights}
              enableAreaSelection={(e) => e.altKey}
              textSelectionColor="rgba(165, 25, 46, 0.15)"
              onSelection={(selection) => addHighlight(selection)}
              utilsRef={(u) => { utilsRef.current = u }}
              style={{ height: '100%' }}
            >
              <HighlightContainer />
            </PdfHighlighter>
          )}
        </PdfLoader>
      </div>

      {/* Annotation sidebar */}
      {showSidebar && (
        <div className="w-[250px] shrink-0 border-l border-border-warm bg-bg-card overflow-y-auto">
          <div className="p-3 border-b border-border-warm flex items-center justify-between sticky top-0 bg-bg-card z-10">
            <h3 className="text-sm font-medium text-text-main flex items-center gap-1.5">
              <Highlighter size={14} className="text-red-primary" />
              批注 ({highlights.length})
            </h3>
            <button onClick={() => setShowSidebar(false)} className="p-1 hover:bg-bg-accent rounded">
              <X size={14} className="text-text-muted" />
            </button>
          </div>

          {highlights.length === 0 ? (
            <p className="text-xs text-text-muted p-4 text-center leading-relaxed">
              选中文本即可添加高亮
              <br />
              按住 Alt 拖拽可框选区域
            </p>
          ) : (
            <div className="divide-y divide-border-warm">
              {highlights.map((h) => (
                <div
                  key={h.id}
                  className="p-3 hover:bg-bg-accent cursor-pointer transition-colors group"
                  onClick={() => scrollTo(h)}
                >
                  <div className="flex items-start gap-2">
                    <div
                      className="w-1 self-stretch rounded-full shrink-0 mt-0.5"
                      style={{ backgroundColor: h.color ?? COLORS[0] }}
                    />
                    <div className="flex-1 min-w-0">
                      {h.content?.text ? (
                        <p className="text-xs text-text-body line-clamp-3">
                          &ldquo;{h.content.text.slice(0, 100)}&rdquo;
                        </p>
                      ) : (
                        <p className="text-xs text-text-muted">区域标注</p>
                      )}
                      {h.comment && (
                        <p className="text-xs text-accent-gold mt-1 italic">{h.comment}</p>
                      )}
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteHighlight(h.id)
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-primary/10 rounded transition-all"
                    >
                      <Trash2 size={12} className="text-red-primary" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Highlight container — rendered once per highlight                   */
/* ------------------------------------------------------------------ */

function HighlightContainer() {
  const { highlight } = useHighlightContainerContext<CommentedHighlight>()
  const color = highlight.color ?? COLORS[0]

  if (highlight.type === 'area') {
    return (
      <AreaHighlight
        highlight={highlight}
        isScrolledTo={false}
        style={{
          background: color + '33', // 20% opacity
          border: `1px solid ${color}`,
        }}
      />
    )
  }

  return (
    <TextHighlight
      highlight={highlight}
      isScrolledTo={false}
      style={{ background: color + '44' }} // 27% opacity
    />
  )
}
