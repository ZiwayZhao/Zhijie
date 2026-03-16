/**
 * API service layer for science1204 backend.
 * Uses mock fallbacks when the backend is unavailable.
 */

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000/api'

const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false'

/* ---------- Types ---------- */

export interface DisassemblyModule {
  id: string
  name: string
  pages: string
  examWeight: 'high' | 'medium' | 'low'
}

export interface DisassemblyTask {
  taskId: string
  status: 'pending' | 'processing' | 'completed' | 'error'
  progress: number
  modules?: DisassemblyModule[]
  currentStep?: string
}

export interface SpecialistResult {
  moduleId: string
  moduleName: string
  markdown: string
}

export interface ProgressEvent {
  progress: number
  status: DisassemblyTask['status']
  currentStep?: string
  modules?: DisassemblyModule[]
}

/* ---------- Mock Data ---------- */

const MOCK_MODULES: DisassemblyModule[] = [
  { id: 'mod-1', name: '图的基本概念与分类', pages: '1-8', examWeight: 'high' },
  { id: 'mod-2', name: '图的遍历算法 (BFS/DFS)', pages: '9-18', examWeight: 'high' },
  { id: 'mod-3', name: '连通性与割点', pages: '19-26', examWeight: 'medium' },
  { id: 'mod-4', name: '最短路径算法', pages: '27-35', examWeight: 'high' },
  { id: 'mod-5', name: '证明方法与数学归纳法', pages: '36-42', examWeight: 'low' },
]

const MOCK_STEPS = [
  '正在解析文档结构...',
  '正在识别知识模块...',
  '正在分析考点权重...',
  '正在建立模块关联...',
  '分析完成，生成报告中...',
]

function makeMockSpecialist(mod: DisassemblyModule): string {
  const templates: Record<string, string> = {
    'mod-1': `## 图的基本概念与分类

### 核心定义

**定义** 一个图 $G = (V, E)$ 由顶点集 $V$ 和边集 $E$ 组成，其中 $E \\subseteq V \\times V$。

图论是离散数学中最具应用价值的分支之一。它为网络分析、路径规划、资源分配等问题提供了严格的数学框架。

### 图的分类体系

| 类型 | 特征 | 典型应用 |
|------|------|---------|
| 无向图 | 边无方向，$(u,v) = (v,u)$ | 社交网络、分子结构 |
| 有向图 | 边有方向，$(u,v) \\neq (v,u)$ | 网页链接、任务调度 |
| 加权图 | 边带权重 $w(e)$ | 最短路径、最小生成树 |
| 多重图 | 允许平行边 | 交通网络建模 |

### 图的表示方法

**邻接矩阵**：空间 $O(n^2)$，适合稠密图，查询 $O(1)$。

**邻接表**：空间 $O(n+m)$，适合稀疏图，遍历邻居高效。

> **考试陷阱**：邻接矩阵对无向图是对称的，但对有向图不一定对称。注意区分入度和出度的计算方式。

### 自测题

1. 一个有 $n$ 个顶点的完全图有多少条边？
2. 为什么邻接表比邻接矩阵更适合稀疏图？
3. 如何从邻接矩阵中判断一个图是否为无向图？`,

    'mod-2': `## 图的遍历算法

### BFS（广度优先搜索）

BFS 从源点出发，按距离递增顺序访问所有可达顶点。使用**队列**数据结构。

**算法步骤：**
1. 将源点入队，标记已访问
2. 出队顶点 $u$，访问 $u$ 的所有未访问邻居并入队
3. 重复直到队列为空

**时间复杂度**：$O(V + E)$

**关键性质**：BFS 生成的树是**最短路径树**（对无权图）。

### DFS（深度优先搜索）

DFS 沿一条路径尽可能深地探索，无法继续时回溯。使用**栈**或递归。

**DFS 时间戳定理**：对 DFS 森林中任意两顶点 $u, v$：
- 若 $u$ 是 $v$ 的祖先，则 $d[u] < d[v] < f[v] < f[u]$
- 若无祖先关系，则时间区间不相交

### BFS vs DFS 对比

| 维度 | BFS | DFS |
|------|-----|-----|
| 数据结构 | 队列 | 栈/递归 |
| 空间复杂度 | $O(V)$ | $O(V)$ |
| 最短路径 | 是（无权图） | 否 |
| 拓扑排序 | 否 | 是 |
| 连通分量 | 可以 | 可以 |

> **考试陷阱**：DFS 的时间戳区间性质是证明题常考点，务必理解包含关系和不相交关系的含义。`,
  }

  return templates[mod.id] ?? `## ${mod.name}

### 模块概述

本模块覆盖课件第 ${mod.pages} 页的内容。考试权重：**${mod.examWeight === 'high' ? '高' : mod.examWeight === 'medium' ? '中' : '低'}**。

### 核心知识点

- 本模块包含多个需要深入理解的概念
- 建议结合例题进行练习

### 重要定理

本节内容涉及的核心定理需要熟练掌握证明过程。

> **学习建议**：先理解定义，再看定理证明，最后做习题验证。

### 自测题

1. 请描述本模块的核心概念。
2. 列举至少两个实际应用场景。`
}

/* ---------- API Functions ---------- */

let mockTaskCounter = 0

export async function startDisassembly(
  materialId: string,
  intent: 'learn' | 'exam',
): Promise<{ taskId: string }> {
  if (USE_MOCK) {
    mockTaskCounter++
    const taskId = `mock-task-${materialId}-${intent}-${mockTaskCounter}`
    return { taskId }
  }

  const res = await fetch(`${API_BASE}/disassembly/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ materialId, intent }),
  })

  if (!res.ok) throw new Error(`Disassembly start failed: ${res.status}`)
  return res.json() as Promise<{ taskId: string }>
}

export function subscribeProgress(
  taskId: string,
  onProgress: (event: ProgressEvent) => void,
): () => void {
  if (USE_MOCK) {
    return subscribeMockProgress(taskId, onProgress)
  }

  const evtSource = new EventSource(
    `${API_BASE}/disassembly/status/${taskId}/stream`,
  )

  evtSource.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data) as ProgressEvent
      onProgress(data)
      if (data.status === 'completed' || data.status === 'error') {
        evtSource.close()
      }
    } catch { /* ignore parse errors */ }
  }

  evtSource.onerror = () => {
    onProgress({ progress: 0, status: 'error', currentStep: '连接中断' })
    evtSource.close()
  }

  return () => evtSource.close()
}

function subscribeMockProgress(
  _taskId: string,
  onProgress: (event: ProgressEvent) => void,
): () => void {
  let step = 0
  const progressValues = [20, 40, 60, 80, 100]

  const id = setInterval(() => {
    const progress = progressValues[step] ?? 100
    const isLast = step >= progressValues.length - 1

    onProgress({
      progress,
      status: isLast ? 'completed' : 'processing',
      currentStep: MOCK_STEPS[step] ?? '处理中...',
      modules: isLast ? MOCK_MODULES : undefined,
    })

    step++
    if (step >= progressValues.length) {
      clearInterval(id)
    }
  }, 1600)

  return () => clearInterval(id)
}

export async function getSpecialistResult(
  _taskId: string,
  moduleId: string,
): Promise<SpecialistResult> {
  if (USE_MOCK) {
    const mod = MOCK_MODULES.find((m) => m.id === moduleId)
    if (!mod) throw new Error(`Module not found: ${moduleId}`)

    // Simulate network delay
    await new Promise((r) => setTimeout(r, 600))
    return {
      moduleId: mod.id,
      moduleName: mod.name,
      markdown: makeMockSpecialist(mod),
    }
  }

  const res = await fetch(
    `${API_BASE}/disassembly/result/${_taskId}/module/${moduleId}`,
  )
  if (!res.ok) throw new Error(`Specialist result failed: ${res.status}`)
  return res.json() as Promise<SpecialistResult>
}
