/**
 * Per-page lecture API client.
 * Calls the backend to generate page-by-page lecture markdown for a material.
 * Falls back to mock when VITE_USE_MOCK is not explicitly 'false'.
 */

import { authFetch, getAccessToken } from '@/lib/auth-api'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8003/api'
const AUTH_API = `${API_BASE}/v1`
const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false'

/* ---------- Types ---------- */

export interface PerPageLectureTask {
  taskId: string
  materialId: string
  status: 'pending' | 'running' | 'completed' | 'failed'
}

export interface PerPageLectureResult {
  taskId: string
  materialId: string
  markdown: string
  pageCount: number
  kpCount: number
}

export interface PerPageProgressEvent {
  progress: number
  status: string
  currentPage?: number
  totalPages?: number
  detail?: string
}

/* ---------- Mock Data ---------- */

const MOCK_MARKDOWN = `# Per-Page Lecture — Mock

## Page 1 — Title Page

**【原始内容】**
Course introduction slide.

**【KP 提取】**
- \`KP-1.1\` ★ 课程信息

**【精讲】**
This is a mock per-page lecture. In production, the backend generates comprehensive
page-by-page analysis with KP extraction, detailed explanations, and exam annotations.

---

## Page 2 — Outline

**【原始内容】**
Chapter outline and structure overview.

**【KP 提取】**
- \`KP-2.1\` ★★ 章节结构

**【精讲】**
The outline shows the logical progression of topics in this chapter.

**【考试标注】**
- Understanding the chapter structure helps prioritize study time.
`

/* ---------- API Functions ---------- */

/**
 * Start a per-page lecture generation task for a material.
 */
export async function startPerPageLecture(
  materialId: string,
): Promise<{ taskId: string }> {
  if (USE_MOCK) {
    return { taskId: `mock-ppl-${materialId}` }
  }

  const res = await authFetch(`${AUTH_API}/disassembly/per-page-lecture`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ material_id: materialId }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => null)
    const msg = typeof err?.detail === 'string' ? err.detail : 'Failed to start per-page lecture'
    throw new Error(msg)
  }

  const data = await res.json()
  return { taskId: data.task_id }
}

/**
 * Get the completed per-page lecture result.
 */
export async function getPerPageLectureResult(
  taskId: string,
): Promise<PerPageLectureResult> {
  if (USE_MOCK) {
    return {
      taskId,
      materialId: taskId.replace('mock-ppl-', ''),
      markdown: MOCK_MARKDOWN,
      pageCount: 2,
      kpCount: 2,
    }
  }

  const res = await authFetch(`${AUTH_API}/disassembly/per-page-lecture/${taskId}/result`)
  if (!res.ok) throw new Error(`Per-page lecture result fetch failed: ${res.status}`)
  const data = await res.json()

  return {
    taskId: data.task_id,
    materialId: data.material_id,
    markdown: data.markdown,
    pageCount: data.page_count ?? 0,
    kpCount: data.kp_count ?? 0,
  }
}

/**
 * Subscribe to per-page lecture generation progress via SSE.
 */
export function subscribePerPageProgress(
  taskId: string,
  onProgress: (event: PerPageProgressEvent) => void,
): () => void {
  if (USE_MOCK) {
    // Simulate progress in mock mode
    let progress = 0
    const interval = setInterval(() => {
      progress += 20
      onProgress({
        progress: Math.min(progress, 100),
        status: progress >= 100 ? 'completed' : 'running',
        currentPage: Math.ceil(progress / 50),
        totalPages: 2,
        detail: progress >= 100 ? 'Mock generation complete' : `Processing page ${Math.ceil(progress / 50)}...`,
      })
      if (progress >= 100) clearInterval(interval)
    }, 500)
    return () => clearInterval(interval)
  }

  const token = getAccessToken()
  const url = `${AUTH_API}/disassembly/per-page-lecture/${taskId}/status?token=${token}`
  const es = new EventSource(url)

  es.addEventListener('progress', (e) => {
    try {
      const data = JSON.parse(e.data)
      onProgress({
        progress: data.progress ?? 0,
        status: data.status ?? 'running',
        currentPage: data.current_page,
        totalPages: data.total_pages,
        detail: data.detail,
      })
      if (data.status === 'completed' || data.status === 'failed') {
        es.close()
      }
    } catch { /* ignore parse errors */ }
  })

  es.onerror = () => {
    onProgress({ progress: 0, status: 'failed', detail: 'Connection lost' })
    es.close()
  }

  return () => es.close()
}
