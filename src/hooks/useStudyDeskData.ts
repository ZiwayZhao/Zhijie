import { useState, useEffect, useCallback, useRef } from 'react'
import { fetchCourse, fetchMaterials, type MaterialItem } from '@/lib/api'
import { getPerPageLectureResult } from '@/lib/api-per-page-lecture'
import { sortByChapter } from '@/lib/folder-classifier'

interface StudyDeskData {
  /** All lecture materials (materialType='课件'), sorted by chapter */
  lectures: MaterialItem[]
  /** IDs of exam/exercise materials for tutor context */
  examMaterialIds: string[]
  /** Currently selected lecture material */
  selectedLecture: MaterialItem | null
  /** Per-page lecture markdown for the selected material (if available) */
  perPageMarkdown: string
  /** Whether data is loading */
  loading: boolean
  /** Whether per-page markdown is loading */
  markdownLoading: boolean
  /** Error message */
  error: string | null
  /** Select a different lecture */
  selectLecture: (materialId: string) => void
  /** Manually set per-page markdown (e.g. from file upload) */
  setManualMarkdown: (md: string) => void
}

/**
 * Hook that manages Study Desk data:
 * - Fetches all materials for a course
 * - Categorizes into lectures vs exam materials
 * - Loads per-page lecture markdown when switching lectures
 */
export function useStudyDeskData(courseId: string): StudyDeskData {
  const [allMaterials, setAllMaterials] = useState<MaterialItem[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [perPageMarkdown, setPerPageMarkdown] = useState('')
  const [loading, setLoading] = useState(true)
  const [markdownLoading, setMarkdownLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Cache loaded markdown by materialId to avoid re-fetching
  const mdCache = useRef<Record<string, string>>({})

  // Fetch all materials on mount
  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        setLoading(true)
        setError(null)
        // Resolve course slug → UUID (backend materials API requires UUID)
        const course = await fetchCourse(courseId)
        const realCourseId = course?.courseUuid || courseId
        const { items } = await fetchMaterials({ courseId: realCourseId, limit: 100 })
        if (cancelled) return
        setAllMaterials(items)

        // Auto-select first lecture
        const lectures = sortByChapter(
          items.filter((m) => m.materialType === '课件'),
        )
        if (lectures.length > 0) {
          setSelectedId(lectures[0].id)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load materials')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [courseId])

  // Categorized lists
  const lectures = sortByChapter(
    allMaterials.filter((m) => m.materialType === '课件'),
  )

  const examMaterialIds = allMaterials
    .filter((m) => m.materialType === '考题' || m.materialType === '习题')
    .map((m) => m.id)

  const selectedLecture = allMaterials.find((m) => m.id === selectedId) || null

  // Load per-page markdown when selection changes
  useEffect(() => {
    if (!selectedId) return

    // Check cache first
    if (mdCache.current[selectedId]) {
      setPerPageMarkdown(mdCache.current[selectedId])
      return
    }

    // Try to load from backend
    let cancelled = false
    async function loadMarkdown() {
      try {
        setMarkdownLoading(true)
        // Try fetching per-page lecture result (uses mock in dev)
        const result = await getPerPageLectureResult(`ppl-${selectedId}`)
        if (!cancelled && result.markdown) {
          mdCache.current[selectedId] = result.markdown
          setPerPageMarkdown(result.markdown)
        }
      } catch {
        // No per-page lecture available yet — that's OK
        if (!cancelled) setPerPageMarkdown('')
      } finally {
        if (!cancelled) setMarkdownLoading(false)
      }
    }

    loadMarkdown()
    return () => { cancelled = true }
  }, [selectedId])

  const selectLecture = useCallback((materialId: string) => {
    setSelectedId(materialId)
  }, [])

  const setManualMarkdown = useCallback((md: string) => {
    setPerPageMarkdown(md)
    if (selectedId) {
      mdCache.current[selectedId] = md
    }
  }, [selectedId])

  return {
    lectures,
    examMaterialIds,
    selectedLecture,
    perPageMarkdown,
    loading,
    markdownLoading,
    error,
    selectLecture,
    setManualMarkdown,
  }
}
