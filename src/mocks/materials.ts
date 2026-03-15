export interface Material {
  id: string
  courseId: string
  name: string
  type: '课件' | '习题' | '笔记' | '考题'
  uploader: string
  uploadTime: string
  fileSize: string
  /** File MIME type, e.g. 'application/pdf', 'text/markdown' */
  fileType?: string
  /** Base64-encoded file data (for PDF) or text content (for md/txt) */
  fileData?: string
}

export const materials: Material[] = [
  // 离散数学 dm-tum
  { id: 'dm-01', courseId: 'dm-tum', name: '集合论与关系 - 第1周讲义', type: '课件', uploader: 'Prof. Mueller', uploadTime: '2025-10-08', fileSize: '2.4 MB' },
  { id: 'dm-02', courseId: 'dm-tum', name: '图论基础 - 第3周讲义', type: '课件', uploader: 'Prof. Mueller', uploadTime: '2025-10-22', fileSize: '3.1 MB' },
  { id: 'dm-03', courseId: 'dm-tum', name: '习题集 1: 命题逻辑', type: '习题', uploader: 'TA Wang', uploadTime: '2025-10-10', fileSize: '580 KB' },
  { id: 'dm-04', courseId: 'dm-tum', name: '期中考试 2024 真题', type: '考题', uploader: 'Anon', uploadTime: '2025-11-01', fileSize: '1.2 MB' },
  { id: 'dm-05', courseId: 'dm-tum', name: '组合数学笔记整理', type: '笔记', uploader: '学习小组A', uploadTime: '2025-11-05', fileSize: '890 KB' },
  // 算法与数据结构 algo-tum
  { id: 'algo-01', courseId: 'algo-tum', name: '排序算法比较分析', type: '课件', uploader: 'Prof. Schmidt', uploadTime: '2025-10-05', fileSize: '4.2 MB' },
  { id: 'algo-02', courseId: 'algo-tum', name: '动态规划专题习题', type: '习题', uploader: 'TA Li', uploadTime: '2025-10-20', fileSize: '720 KB' },
  { id: 'algo-03', courseId: 'algo-tum', name: '红黑树实现笔记', type: '笔记', uploader: 'Chen Wei', uploadTime: '2025-10-28', fileSize: '1.5 MB' },
  { id: 'algo-04', courseId: 'algo-tum', name: '2024 期末考试真题', type: '考题', uploader: 'Anon', uploadTime: '2025-12-01', fileSize: '980 KB' },
  // 有机化学 oc-eth
  { id: 'oc-01', courseId: 'oc-eth', name: '亲核取代反应 SN1/SN2', type: '课件', uploader: 'Prof. Fischer', uploadTime: '2025-09-28', fileSize: '5.6 MB' },
  { id: 'oc-02', courseId: 'oc-eth', name: '醇醚醛酮习题集', type: '习题', uploader: 'TA Zhang', uploadTime: '2025-10-15', fileSize: '440 KB' },
  // 机器学习 ml-eth
  { id: 'ml-01', courseId: 'ml-eth', name: '梯度下降与优化方法', type: '课件', uploader: 'Prof. Krause', uploadTime: '2025-10-12', fileSize: '8.3 MB' },
  { id: 'ml-02', courseId: 'ml-eth', name: '神经网络反向传播推导', type: '笔记', uploader: 'Liu Hao', uploadTime: '2025-10-25', fileSize: '2.1 MB' },
  { id: 'ml-03', courseId: 'ml-eth', name: 'SVM 与核方法习题', type: '习题', uploader: 'TA Kim', uploadTime: '2025-11-02', fileSize: '650 KB' },
]

/* ---------- Dynamic user-uploaded materials (localStorage) ---------- */

const STORAGE_KEY = 'zhijie_user_materials'

function loadUserMaterials(): Material[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveUserMaterials(items: Material[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
}

let _userMaterials: Material[] = loadUserMaterials()

export function addMaterial(m: Material) {
  _userMaterials = [m, ..._userMaterials]
  saveUserMaterials(_userMaterials)
}

export function getUserMaterials(): Material[] {
  return _userMaterials
}

/* ---------- Queries (merge static + user materials) ---------- */

function allMaterials(): Material[] {
  return [..._userMaterials, ...materials]
}

export function getMaterialById(id: string): Material | undefined {
  return allMaterials().find((m) => m.id === id)
}

export function getMaterialsByCourse(courseId: string): Material[] {
  return allMaterials().filter((m) => m.courseId === courseId)
}

export function getMaterialsByType(courseId: string, type: string): Material[] {
  if (type === '全部') return getMaterialsByCourse(courseId)
  return allMaterials().filter((m) => m.courseId === courseId && m.type === type)
}

export const materialTypes = ['全部', '课件', '习题', '笔记', '考题'] as const

/** Mock long-form material content for the workbench reader */
export const materialContent = `## 1. 图的基本概念

**定义 1.1** 一个图 G = (V, E) 由顶点集 V 和边集 E 组成，其中 E ⊆ V × V。

图论是离散数学中最具应用价值的分支之一，它为网络分析、路径规划、资源分配等问题提供了数学框架。在计算机科学中，图被广泛用于建模社交网络、网页链接结构、编译器中的控制流等。

### 1.1 图的分类

根据边的性质，图可以分为以下几类：

- **无向图（Undirected Graph）**：边没有方向，即 (u, v) 与 (v, u) 表示同一条边
- **有向图（Directed Graph / Digraph）**：边有方向，(u, v) 表示从 u 到 v 的有向边
- **加权图（Weighted Graph）**：每条边关联一个权重值 w(e)
- **多重图（Multigraph）**：允许两个顶点之间存在多条边

### 1.2 图的表示方法

在计算机中，图通常采用以下两种方式表示：

**邻接矩阵（Adjacency Matrix）**

对于有 n 个顶点的图 G，使用 n × n 的矩阵 A，其中：
- A[i][j] = 1  若 (i, j) ∈ E
- A[i][j] = 0  否则

空间复杂度：O(n²)。适用于稠密图。

**邻接表（Adjacency List）**

对每个顶点维护一个邻居列表。空间复杂度：O(n + m)，其中 m = |E|。适用于稀疏图。

## 2. 图的遍历

### 2.1 广度优先搜索 (BFS)

BFS 从源点出发，按照距离递增的顺序访问所有可达顶点。它使用队列数据结构。

**算法框架：**
1. 将源点入队，标记为已访问
2. 当队列非空时：
   a. 出队一个顶点 u
   b. 对 u 的每个未访问邻居 v：标记为已访问，入队
3. 重复直到队列为空

**时间复杂度**：O(V + E)

**应用**：最短路径（无权图）、连通分量检测、二分图判定。

### 2.2 深度优先搜索 (DFS)

DFS 沿着一条路径尽可能深地探索，直到无法继续时回溯。它使用栈（或递归调用栈）。

**定理 2.1**（DFS 时间戳性质）对于 DFS 森林中的任意两个顶点 u 和 v：
- 若 u 是 v 的祖先，则 d[u] < d[v] < f[v] < f[u]
- 若 u 和 v 不存在祖先-后代关系，则它们的区间 [d[u], f[u]] 和 [d[v], f[v]] 不相交

## 3. 连通性

**定义 3.1** 无向图 G 是连通的，当且仅当 G 中任意两个顶点之间存在路径。

**定义 3.2** 有向图 G 是强连通的，当且仅当 G 中任意两个顶点 u, v 之间既存在从 u 到 v 的路径，也存在从 v 到 u 的路径。

### 3.1 割点与桥

- **割点（Cut Vertex）**：删除后使图不再连通的顶点
- **桥（Bridge）**：删除后使图不再连通的边

**Tarjan 算法** 可以在 O(V + E) 时间内找出所有割点和桥。

## 4. 证明方法

### 4.1 数学归纳法

**原理**：要证明性质 P(n) 对所有自然数 n ≥ n₀ 成立：
1. **基础步骤**：证明 P(n₀) 成立
2. **归纳步骤**：假设 P(k) 成立（归纳假设），证明 P(k+1) 也成立

### 4.2 反证法

假设结论不成立，推导出矛盾。

**经典例题**：证明 √2 是无理数。

假设 √2 = p/q（p, q 互素）。则 2q² = p²，所以 p 是偶数。设 p = 2k，则 2q² = 4k²，即 q² = 2k²，所以 q 也是偶数。与 p, q 互素矛盾。 ■`
