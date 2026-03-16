/**
 * Mock flashcard data for development.
 * Covers 3 courses: 离散数学, 算法与数据结构, 机器学习
 */
import type { FlashcardNote, FlashcardDeck } from '@/lib/fsrs'
import { createFlashcard, loadAllDecks, saveDeck } from '@/lib/fsrs'

/* ------------------------------------------------------------------ */
/*  Note definitions per course                                        */
/* ------------------------------------------------------------------ */

const discreteMathNotes: FlashcardNote[] = [
  {
    id: 'note-dm-1',
    type: 'basic',
    fields: {
      front: '什么是集合的幂集（Power Set）？',
      back: '集合 S 的幂集 P(S) 是 S 所有子集构成的集合。若 |S| = n，则 |P(S)| = 2^n。',
    },
    tags: ['离散数学', '集合论'],
    sourceRef: { materialId: 'mat-dm-01', moduleId: 'mod-sets', slidePage: 12 },
    createdAt: Date.now() - 86400000 * 5,
    generatedBy: 'ai',
  },
  {
    id: 'note-dm-2',
    type: 'cloze',
    fields: {
      front: '德摩根定律：¬(A ∪ B) = {{c1::¬A ∩ ¬B}}',
      back: '德摩根定律：¬(A ∪ B) = ¬A ∩ ¬B',
    },
    tags: ['离散数学', '集合论'],
    sourceRef: { materialId: 'mat-dm-01', moduleId: 'mod-sets', slidePage: 18 },
    createdAt: Date.now() - 86400000 * 5,
    generatedBy: 'ai',
  },
  {
    id: 'note-dm-3',
    type: 'basic',
    fields: {
      front: '欧拉公式：对连通平面图，顶点数 V、边数 E、面数 F 的关系？',
      back: 'V - E + F = 2（欧拉公式）。适用于任何连通平面图。',
    },
    tags: ['离散数学', '图论'],
    sourceRef: { materialId: 'mat-dm-02', moduleId: 'mod-graph', slidePage: 7 },
    createdAt: Date.now() - 86400000 * 3,
    generatedBy: 'ai',
  },
  {
    id: 'note-dm-4',
    type: 'reverse',
    fields: {
      front: 'Bijection（双射）',
      back: '一个函数既是单射（injective）又是满射（surjective），即一一对应。',
    },
    tags: ['离散数学', '函数'],
    sourceRef: { materialId: 'mat-dm-01', moduleId: 'mod-functions', slidePage: 24 },
    createdAt: Date.now() - 86400000 * 2,
    generatedBy: 'ai',
  },
  {
    id: 'note-dm-5',
    type: 'cloze',
    fields: {
      front: '鸽巢原理：将 n+1 个物品放入 n 个容器，则至少有一个容器包含{{c1::至少两个物品}}。',
      back: '鸽巢原理：将 n+1 个物品放入 n 个容器，则至少有一个容器包含至少两个物品。',
    },
    tags: ['离散数学', '组合'],
    sourceRef: { materialId: 'mat-dm-03', moduleId: 'mod-comb', slidePage: 3 },
    createdAt: Date.now() - 86400000,
    generatedBy: 'ai',
  },
  {
    id: 'note-dm-6',
    type: 'basic',
    fields: {
      front: '什么是图的色数（Chromatic Number）？',
      back: '图 G 的色数 χ(G) 是使得图 G 有一个合法顶点着色所需的最少颜色数。合法着色要求相邻顶点颜色不同。',
    },
    tags: ['离散数学', '图论'],
    sourceRef: { materialId: 'mat-dm-02', moduleId: 'mod-graph', slidePage: 31 },
    createdAt: Date.now() - 86400000,
    generatedBy: 'ai',
  },
]

const algoNotes: FlashcardNote[] = [
  {
    id: 'note-algo-1',
    type: 'basic',
    fields: {
      front: 'QuickSort 的平均时间复杂度和最坏时间复杂度？',
      back: '平均 O(n log n)，最坏 O(n²)（当每次 pivot 选到极值时）。随机化 pivot 选择可使最坏情况极不可能出现。',
    },
    tags: ['算法', '排序'],
    sourceRef: { materialId: 'mat-algo-01', moduleId: 'mod-sort', slidePage: 15 },
    createdAt: Date.now() - 86400000 * 4,
    generatedBy: 'ai',
  },
  {
    id: 'note-algo-2',
    type: 'cloze',
    fields: {
      front: '二叉搜索树中查找操作的时间复杂度为 {{c1::O(h)}}，其中 h 为树的高度。',
      back: '二叉搜索树中查找操作的时间复杂度为 O(h)，其中 h 为树的高度。',
    },
    tags: ['算法', '数据结构', '树'],
    sourceRef: { materialId: 'mat-algo-02', moduleId: 'mod-tree', slidePage: 8 },
    createdAt: Date.now() - 86400000 * 4,
    generatedBy: 'ai',
  },
  {
    id: 'note-algo-3',
    type: 'reverse',
    fields: {
      front: 'Dijkstra 算法',
      back: '求解单源最短路径的贪心算法，要求所有边权非负。时间复杂度 O((V+E) log V)（使用优先队列）。',
    },
    tags: ['算法', '图'],
    sourceRef: { materialId: 'mat-algo-03', moduleId: 'mod-graph-algo', slidePage: 22 },
    createdAt: Date.now() - 86400000 * 3,
    generatedBy: 'ai',
  },
  {
    id: 'note-algo-4',
    type: 'basic',
    fields: {
      front: '动态规划解题的两个关键性质？',
      back: '1. 最优子结构（Optimal Substructure）：全局最优解包含子问题的最优解。\n2. 重叠子问题（Overlapping Subproblems）：子问题被反复求解。',
    },
    tags: ['算法', '动态规划'],
    sourceRef: { materialId: 'mat-algo-04', moduleId: 'mod-dp', slidePage: 5 },
    createdAt: Date.now() - 86400000 * 2,
    generatedBy: 'ai',
  },
  {
    id: 'note-algo-5',
    type: 'cloze',
    fields: {
      front: '哈希表的平均查找时间复杂度为 {{c1::O(1)}}，最坏情况为 {{c1::O(n)}}。',
      back: '哈希表的平均查找时间复杂度为 O(1)，最坏情况为 O(n)。',
    },
    tags: ['算法', '数据结构', '哈希'],
    sourceRef: { materialId: 'mat-algo-02', moduleId: 'mod-hash', slidePage: 14 },
    createdAt: Date.now() - 86400000,
    generatedBy: 'ai',
  },
]

const mlNotes: FlashcardNote[] = [
  {
    id: 'note-ml-1',
    type: 'basic',
    fields: {
      front: '什么是过拟合（Overfitting）？如何检测？',
      back: '模型在训练集上表现很好但在测试集上泛化差。检测方法：训练误差远低于验证误差，或学习曲线出现明显分叉。',
    },
    tags: ['机器学习', '基础概念'],
    sourceRef: { materialId: 'mat-ml-01', moduleId: 'mod-basics', slidePage: 20 },
    createdAt: Date.now() - 86400000 * 6,
    generatedBy: 'ai',
  },
  {
    id: 'note-ml-2',
    type: 'cloze',
    fields: {
      front: '梯度下降更新规则：θ = θ - {{c1::α · ∇J(θ)}}，其中 α 为学习率。',
      back: '梯度下降更新规则：θ = θ - α · ∇J(θ)，其中 α 为学习率。',
    },
    tags: ['机器学习', '优化'],
    sourceRef: { materialId: 'mat-ml-02', moduleId: 'mod-optim', slidePage: 8 },
    createdAt: Date.now() - 86400000 * 6,
    generatedBy: 'ai',
  },
  {
    id: 'note-ml-3',
    type: 'reverse',
    fields: {
      front: 'Bias-Variance Tradeoff（偏差-方差权衡）',
      back: '模型误差 = 偏差² + 方差 + 不可约误差。高偏差→欠拟合，高方差→过拟合。需要在两者间取平衡。',
    },
    tags: ['机器学习', '基础概念'],
    sourceRef: { materialId: 'mat-ml-01', moduleId: 'mod-basics', slidePage: 35 },
    createdAt: Date.now() - 86400000 * 4,
    generatedBy: 'ai',
  },
  {
    id: 'note-ml-4',
    type: 'basic',
    fields: {
      front: 'L1 正则化和 L2 正则化的区别？',
      back: 'L1（Lasso）：惩罚项 λΣ|w|，倾向产生稀疏解（特征选择）。\nL2（Ridge）：惩罚项 λΣw²，倾向使权重均匀缩小，不产生稀疏解。',
    },
    tags: ['机器学习', '正则化'],
    sourceRef: { materialId: 'mat-ml-03', moduleId: 'mod-reg', slidePage: 12 },
    createdAt: Date.now() - 86400000 * 3,
    generatedBy: 'ai',
  },
  {
    id: 'note-ml-5',
    type: 'basic',
    fields: {
      front: '什么是交叉验证（Cross-Validation）？K-Fold 如何工作？',
      back: '将数据集分为 K 份，每次用 K-1 份训练、1 份验证，重复 K 次取平均。常用 K=5 或 K=10。能更可靠地估计模型泛化能力。',
    },
    tags: ['机器学习', '模型评估'],
    sourceRef: { materialId: 'mat-ml-01', moduleId: 'mod-eval', slidePage: 42 },
    createdAt: Date.now() - 86400000 * 2,
    generatedBy: 'ai',
  },
  {
    id: 'note-ml-6',
    type: 'cloze',
    fields: {
      front: 'Softmax 函数将 logits 转换为概率分布：P(y=k) = {{c1::exp(z_k) / Σexp(z_j)}}',
      back: 'Softmax 函数将 logits 转换为概率分布：P(y=k) = exp(z_k) / Σexp(z_j)',
    },
    tags: ['机器学习', '神经网络'],
    sourceRef: { materialId: 'mat-ml-04', moduleId: 'mod-nn', slidePage: 18 },
    createdAt: Date.now() - 86400000,
    generatedBy: 'ai',
  },
  {
    id: 'note-ml-7',
    type: 'basic',
    fields: {
      front: 'SVM 中核函数（Kernel）的作用？',
      back: '核函数将数据从低维映射到高维空间，使得在高维空间中线性可分。常用核：线性核、RBF 核、多项式核。无需显式计算高维坐标（核技巧）。',
    },
    tags: ['机器学习', 'SVM'],
    sourceRef: { materialId: 'mat-ml-03', moduleId: 'mod-svm', slidePage: 27 },
    createdAt: Date.now() - 86400000,
    generatedBy: 'user',
  },
]

/* ------------------------------------------------------------------ */
/*  Course name mapping                                                */
/* ------------------------------------------------------------------ */

const courseNames: Record<string, string> = {
  'dm-tum': '离散数学',
  'algo-tum': '算法与数据结构',
  'ml-eth': '机器学习',
}

/* ------------------------------------------------------------------ */
/*  Build a deck from notes                                            */
/* ------------------------------------------------------------------ */

function buildDeck(courseId: string, notes: FlashcardNote[]): FlashcardDeck {
  const cards = notes.map((n) => createFlashcard(n.id))
  return {
    courseId,
    courseName: courseNames[courseId] ?? courseId,
    notes,
    cards,
    reviewLogs: [],
  }
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

const MOCK_INIT_KEY = 'zhijie_mock_flashcards_initialized'

/**
 * Populate localStorage with mock flashcard decks if not already present.
 */
export function initMockFlashcards(): void {
  if (localStorage.getItem(MOCK_INIT_KEY)) return

  const decks = [
    buildDeck('dm-tum', discreteMathNotes),
    buildDeck('algo-tum', algoNotes),
    buildDeck('ml-eth', mlNotes),
  ]

  for (const deck of decks) {
    saveDeck(deck)
  }

  localStorage.setItem(MOCK_INIT_KEY, '1')
}

/**
 * Return all flashcard decks from localStorage.
 */
export function getMockDecks(): FlashcardDeck[] {
  return loadAllDecks()
}
