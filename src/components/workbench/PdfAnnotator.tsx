import { useState, useRef, useCallback, useEffect } from 'react'
import {
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
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist'
import { Loader2 } from 'lucide-react'
import {
  dispatchHighlightCreated,
  dispatchHighlightDeleted,
  onHighlightDeleted,
  onHighlightScrollTo,
} from '@/lib/highlight-events'
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

import { STORAGE_KEYS } from '@/lib/storage-keys'

const COLORS = ['#FFEB3B', '#A5192E', '#4CAF50', '#2196F3', '#FF9800']

function loadHighlights(id: string): CommentedHighlight[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.HIGHLIGHTS(id))
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveHighlights(id: string, list: CommentedHighlight[]) {
  localStorage.setItem(STORAGE_KEYS.HIGHLIGHTS(id), JSON.stringify(list))
  // Debounced fire-and-forget backend sync (2s coalesce)
  import('@/lib/sync-service').then(({ debouncedSyncAnnotationsUp }) => {
    debouncedSyncAnnotationsUp(id, list as unknown as Array<{ id: string; [key: string]: unknown }>)
  })
}

/* ------------------------------------------------------------------ */
/*  StrictMode-safe PDF loader hook                                    */
/*  Fixes race condition in react-pdf-highlighter-extended's PdfLoader */
/*  where zombie .finally() from destroyed task clears loading state   */
/* ------------------------------------------------------------------ */

function usePdfDocument(url: string) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setDoc(null)

    GlobalWorkerOptions.workerSrc = pdfjsWorker
    const task = getDocument(url)

    task.promise
      .then((pdfDoc) => {
        if (!cancelled) {
          setDoc(pdfDoc)
          setLoading(false)
        } else {
          pdfDoc.destroy()
        }
      })
      .catch((err) => {
        if (!cancelled && err?.message !== 'Worker was destroyed') {
          setError(err?.message ?? 'PDF 加载失败')
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
      task.destroy()
    }
  }, [url])

  return { doc, error, loading }
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function PdfAnnotator({ pdfUrl, materialId }: PdfAnnotatorProps) {
  const { doc: pdfDocument, error: pdfError, loading: pdfLoading } = usePdfDocument(pdfUrl)
  const [highlights, setHighlights] = useState<CommentedHighlight[]>(() =>
    loadHighlights(materialId),
  )
  const [selectedColor, setSelectedColor] = useState(COLORS[0])
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
      dispatchHighlightCreated(materialId, h)
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
      dispatchHighlightDeleted(materialId, id)
    },
    [materialId],
  )

  // Listen for external delete requests (from NotesPanel)
  useEffect(() => {
    return onHighlightDeleted(({ materialId: mid, highlightId }) => {
      if (mid !== materialId) return
      setHighlights((prev) => {
        const next = prev.filter((h) => h.id !== highlightId)
        saveHighlights(materialId, next)
        return next
      })
    })
  }, [materialId])

  // Listen for scroll-to requests (from NotesPanel)
  useEffect(() => {
    return onHighlightScrollTo(({ materialId: mid, highlightId }) => {
      if (mid !== materialId) return
      const target = highlights.find((h) => h.id === highlightId)
      if (target) utilsRef.current?.scrollToHighlight(target)
    })
  }, [materialId, highlights])

  return (
    <div className="flex rounded-sm overflow-hidden border border-border-warm" style={{ height: '80vh' }}>
      {/* PDF viewer area */}
      <div className="flex-1 relative min-w-0">
        {/* Color toolbar */}
        <div className="absolute top-2 right-2 z-10 flex items-center gap-1 bg-bg-card/90 backdrop-blur border border-border-warm rounded-sm px-1.5 py-1 opacity-60 hover:opacity-100 transition-opacity">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setSelectedColor(c)}
              className="w-4 h-4 rounded-full border-2 transition-all"
              style={{
                backgroundColor: c,
                borderColor: selectedColor === c ? '#1A1A1A' : 'transparent',
                transform: selectedColor === c ? 'scale(1.1)' : 'scale(1)',
              }}
            />
          ))}
          {highlights.length > 0 && (
            <>
              <div className="w-px h-3 bg-border-warm mx-0.5" />
              <span className="text-[10px] text-text-muted tabular-nums">{highlights.length}</span>
            </>
          )}
        </div>

        {/* PDF.js viewer — custom loader to fix StrictMode race condition */}
        {pdfLoading && (
          <div className="flex items-center justify-center h-full gap-2 text-text-muted">
            <Loader2 size={20} className="animate-spin" />
            <span className="text-sm">加载 PDF...</span>
          </div>
        )}
        {pdfError && (
          <div className="flex items-center justify-center h-full text-sm text-red-primary">
            PDF 加载失败: {pdfError}
          </div>
        )}
        {pdfDocument && (
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
      </div>

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
