/**
 * Disassembly (AI analysis pipeline) API — types, mock data, and functions.
 * Extracted from api.ts to meet the 400-line file limit.
 */

import { authFetch, getAccessToken } from '@/lib/auth-api'
import type { ExamProfile } from '@/lib/exam-profile'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8003/api'
const AUTH_API = `${API_BASE}/v1`
const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false'

/* ---------- Types ---------- */

export interface DisassemblyModule {
  id: string
  name: string
  description: string | null
  page_range_start: number
  page_range_end: number
  pages: string
  examWeight: 'high' | 'medium' | 'low'
  sort_order: number
  has_specialist: boolean
}

export interface DisassemblyTask {
  task_id: string
  material_id: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  phase: string
  progress: number
  attempt: number
  error_message: string | null
  error_phase: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
}

export interface SpecialistResult {
  moduleId: string
  moduleName: string
  markdown: string
  summary: string | null
  key_concepts: string[]
  exam_traps: string[]
}

export interface MCQuestion {
  question: string
  options: string[]
  correct_index: number
  explanation: string
  source_module_name: string
  source_page: number | null
  difficulty: string
}

export interface QuizResult {
  id: string
  questions: MCQuestion[]
  total_questions: number
}

export interface ProgressEvent {
  progress: number
  status: DisassemblyTask['status']
  phase: string
  currentStep?: string
  modules?: DisassemblyModule[]
  detail?: { completed?: number; total?: number }
}

export interface AnalysisResult {
  task: DisassemblyTask
  modules: DisassemblyModule[]
  quiz: QuizResult | null
}

/* ---------- Mock Data ---------- */

const MOCK_MODULES: DisassemblyModule[] = [
  { id: 'mod-1', name: '图的基本概念与分类', description: null, page_range_start: 1, page_range_end: 8, pages: '1-8', examWeight: 'high', sort_order: 0, has_specialist: true },
  { id: 'mod-2', name: '图的遍历算法 (BFS/DFS)', description: null, page_range_start: 9, page_range_end: 18, pages: '9-18', examWeight: 'high', sort_order: 1, has_specialist: true },
  { id: 'mod-3', name: '连通性与割点', description: null, page_range_start: 19, page_range_end: 26, pages: '19-26', examWeight: 'medium', sort_order: 2, has_specialist: true },
  { id: 'mod-4', name: '最短路径算法', description: null, page_range_start: 27, page_range_end: 35, pages: '27-35', examWeight: 'high', sort_order: 3, has_specialist: true },
  { id: 'mod-5', name: '证明方法与数学归纳法', description: null, page_range_start: 36, page_range_end: 42, pages: '36-42', examWeight: 'low', sort_order: 4, has_specialist: true },
]

const MOCK_QUIZ: QuizResult = {
  id: 'mock-quiz-1',
  total_questions: 5,
  questions: [
    { question: '在无向图中，所有顶点度数之和与边数的关系是？', options: ['等于边数', '等于边数的2倍', '等于顶点数', '没有确定关系'], correct_index: 1, explanation: '握手定理：无向图中所有顶点度数之和等于边数的 2 倍，因为每条边贡献了 2 个度。', source_module_name: '图的基本概念与分类', source_page: 3, difficulty: 'easy' },
    { question: 'BFS 遍历图时使用的数据结构是？', options: ['栈 (Stack)', '队列 (Queue)', '优先队列 (Priority Queue)', '链表 (Linked List)'], correct_index: 1, explanation: 'BFS 使用队列来维护待访问节点的顺序，确保按层次（距离递增）遍历。DFS 使用栈。', source_module_name: '图的遍历算法 (BFS/DFS)', source_page: 11, difficulty: 'easy' },
    { question: '以下哪种情况说明无向图 G 中的顶点 v 是割点？', options: ['v 的度数为图中最大', '删除 v 后图的连通分量数增加', 'v 是某条最短路径的端点', 'v 在所有生成树中都是叶子节点'], correct_index: 1, explanation: '割点的定义：删除该顶点（及其关联的边）后，图的连通分量数量增加。这是判断割点的核心条件。', source_module_name: '连通性与割点', source_page: 21, difficulty: 'medium' },
    { question: 'Dijkstra 算法不适用于以下哪种图？', options: ['稀疏图', '含负权边的图', '含环的图', '有向图'], correct_index: 1, explanation: 'Dijkstra 算法要求所有边权非负。若存在负权边，贪心策略失效。此时应使用 Bellman-Ford 算法。', source_module_name: '最短路径算法', source_page: 29, difficulty: 'medium' },
    { question: '使用数学归纳法证明命题 P(n) 对所有 n≥1 成立时，归纳步骤需要证明的是？', options: ['P(1) 为真', 'P(k) → P(k+1) 对任意 k≥1 成立', 'P(n) 对某个特定 n 成立', 'P(k) ∧ P(k+1) 同时为真'], correct_index: 1, explanation: '归纳步骤：假设 P(k) 成立（归纳假设），证明 P(k+1) 也成立。配合基础步骤 P(1) 为真，即可完成证明。', source_module_name: '证明方法与数学归纳法', source_page: 38, difficulty: 'hard' },
  ],
}

const MOCK_STEPS = [
  '正在解析文档结构...',
  '正在识别知识模块...',
  '正在分析考点权重...',
  '正在建立模块关联...',
  '分析完成，生成报告中...',
]

/* ---------- API Functions ---------- */

let mockTaskCounter = 0

export async function startDisassembly(
  materialId: string,
  intent: 'learn' | 'exam',
  options?: {
    examProfile?: ExamProfile
    referenceMaterialIds?: string[]
  },
): Promise<{ taskId: string }> {
  if (USE_MOCK) {
    mockTaskCounter++
    return { taskId: `mock-task-${materialId}-${mockTaskCounter}` }
  }

  const res = await authFetch(`${AUTH_API}/disassembly/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      material_id: materialId,
      intent,
      exam_profile: options?.examProfile ?? null,
      reference_material_ids: options?.referenceMaterialIds ?? [],
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Start failed' }))
    throw new Error(err.detail?.detail || err.detail || `Start failed: ${res.status}`)
  }

  const data = await res.json()
  return { taskId: data.task_id }
}

export function subscribeProgress(
  taskId: string,
  onProgress: (event: ProgressEvent) => void,
): () => void {
  if (USE_MOCK) return subscribeMockProgress(taskId, onProgress)

  // Prefer SSE ticket auth; fall back to raw JWT if ticket fetch fails
  let cancelled = false
  let evtSource: EventSource | null = null

  const connect = async () => {
    const sseUrl = new URL(`${AUTH_API}/disassembly/tasks/${taskId}/status`, window.location.origin)

    // Try getting a ticket first (preferred, more secure)
    try {
      const { getStreamTicket } = await import('@/lib/sync-service')
      const ticket = await getStreamTicket(taskId)
      if (ticket) {
        sseUrl.searchParams.set('ticket', ticket)
      } else {
        // Fallback to raw JWT
        const token = getAccessToken()
        if (token) sseUrl.searchParams.set('token', token)
      }
    } catch {
      // Fallback to raw JWT
      const token = getAccessToken()
      if (token) sseUrl.searchParams.set('token', token)
    }

    if (cancelled) return
    return new EventSource(sseUrl.toString())
  }

  // Connect async, then wire up handlers
  connect().then((es) => {
    if (!es || cancelled) { es?.close(); return }
    evtSource = es
    wireEventSource(es, taskId, onProgress)
  })

  return () => { cancelled = true; evtSource?.close() }
}

function wireEventSource(
  evtSource: EventSource,
  _taskId: string,
  onProgress: (event: ProgressEvent) => void,
): void {

  evtSource.addEventListener('status', (e) => {
    try {
      const data = JSON.parse(e.data)
      onProgress({
        progress: data.progress, status: data.status, phase: data.phase,
        currentStep: `${data.phase}: ${data.status}`,
      })
      if (data.status === 'completed' || data.status === 'failed' || data.status === 'cancelled') {
        evtSource.close()
      }
    } catch { /* ignore malformed SSE data */ }
  })

  evtSource.addEventListener('progress', (e) => {
    try {
      const data = JSON.parse(e.data)
      onProgress({
        progress: data.progress,
        status: data.phase === 'done' ? 'completed' : 'running',
        phase: data.phase, currentStep: data.message, detail: data.detail,
      })
      if (data.phase === 'done') evtSource.close()
    } catch { /* ignore */ }
  })

  evtSource.onerror = () => {
    onProgress({ progress: 0, status: 'failed', phase: 'unknown', currentStep: '连接中断' })
    evtSource.close()
  }
}

function subscribeMockProgress(
  _taskId: string,
  onProgress: (event: ProgressEvent) => void,
): () => void {
  let step = 0
  const phases: ProgressEvent['phase'][] = ['parsing', 'cartographer', 'specialist', 'examiner', 'done']
  const progressValues = [0.15, 0.35, 0.65, 0.90, 1.0]

  const id = setInterval(() => {
    const progress = progressValues[step] ?? 1.0
    const phase = phases[step] ?? 'done'
    const isLast = step >= progressValues.length - 1
    onProgress({
      progress, status: isLast ? 'completed' : 'running', phase,
      currentStep: MOCK_STEPS[step] ?? '处理中...',
      modules: isLast ? MOCK_MODULES : undefined,
      detail: phase === 'specialist' ? { completed: 3, total: 5 } : undefined,
    })
    step++
    if (step >= progressValues.length) clearInterval(id)
  }, 1600)

  return () => clearInterval(id)
}

export async function getAnalysisResult(taskId: string): Promise<AnalysisResult> {
  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 300))
    return {
      task: {
        task_id: taskId, material_id: 'mock', status: 'completed', phase: 'done',
        progress: 1.0, attempt: 1, error_message: null, error_phase: null,
        started_at: null, completed_at: null, created_at: new Date().toISOString(),
      },
      modules: MOCK_MODULES,
      quiz: MOCK_QUIZ,
    }
  }

  const res = await authFetch(`${AUTH_API}/disassembly/tasks/${taskId}/result`)
  if (!res.ok) throw new Error(`Result fetch failed: ${res.status}`)
  const data = await res.json()
  return {
    task: data.task,
    modules: data.modules.map((m: any) => ({
      ...m, pages: `${m.page_range_start}-${m.page_range_end}`, examWeight: m.exam_weight,
    })),
    quiz: data.quiz,
  }
}

export async function getSpecialistResult(
  taskId: string,
  moduleId: string,
): Promise<SpecialistResult> {
  if (USE_MOCK) {
    const mod = MOCK_MODULES.find((m) => m.id === moduleId)
    if (!mod) throw new Error(`Module not found: ${moduleId}`)
    await new Promise((r) => setTimeout(r, 600))
    return {
      moduleId: mod.id, moduleName: mod.name,
      markdown: `## ${mod.name}\n\n模块精讲内容（mock）\n\n> 考试权重：${mod.examWeight}`,
      summary: null, key_concepts: [], exam_traps: [],
    }
  }

  const res = await authFetch(`${AUTH_API}/disassembly/tasks/${taskId}/module/${moduleId}`)
  if (!res.ok) throw new Error(`Module detail failed: ${res.status}`)
  const data = await res.json()
  return {
    moduleId: data.id, moduleName: data.name,
    markdown: data.specialist?.markdown_content ?? '',
    summary: data.specialist?.summary ?? null,
    key_concepts: data.specialist?.key_concepts ?? [],
    exam_traps: data.specialist?.exam_traps ?? [],
  }
}

export async function getLatestAnalysis(materialId: string): Promise<DisassemblyTask | null> {
  if (USE_MOCK) return null
  const res = await authFetch(`${AUTH_API}/disassembly/materials/${materialId}/latest`)
  if (!res.ok) return null
  const data = await res.json()
  return data || null
}

export async function cancelAnalysis(taskId: string): Promise<void> {
  if (USE_MOCK) return
  const res = await authFetch(`${AUTH_API}/disassembly/tasks/${taskId}/cancel`, { method: 'POST' })
  if (!res.ok) throw new Error('Cancel failed')
}
