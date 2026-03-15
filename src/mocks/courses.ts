export interface Course {
  id: string
  name: string
  school: string
  description: string
  tags: string[]
  materialCount: number
  studentCount: number
  category: string
}

export const courses: Course[] = [
  {
    id: 'dm-tum',
    name: '离散数学',
    school: 'TU Munich',
    description: '集合论、图论、组合数学与数理逻辑的基础课程，涵盖证明方法与算法分析基础。',
    tags: ['数学', '计算机基础'],
    materialCount: 42,
    studentCount: 186,
    category: '数学',
  },
  {
    id: 'oc-eth',
    name: '有机化学 I',
    school: 'ETH Zurich',
    description: '有机化合物的结构、命名、反应机理与合成策略入门。',
    tags: ['化学', '实验课'],
    materialCount: 35,
    studentCount: 124,
    category: '化学',
  },
  {
    id: 'algo-tum',
    name: '算法与数据结构',
    school: 'TU Munich',
    description: '排序、搜索、图算法、动态规划与数据结构的设计与分析。',
    tags: ['计算机', '核心课'],
    materialCount: 58,
    studentCount: 312,
    category: '计算机',
  },
  {
    id: 'qm-lmu',
    name: '量子力学导论',
    school: 'LMU Munich',
    description: '波函数、薛定谔方程、量子态与测量理论的基本框架。',
    tags: ['物理', '理论课'],
    materialCount: 28,
    studentCount: 95,
    category: '物理',
  },
  {
    id: 'ml-eth',
    name: '机器学习',
    school: 'ETH Zurich',
    description: '监督学习、无监督学习、神经网络与模型评估的理论与实践。',
    tags: ['计算机', 'AI'],
    materialCount: 67,
    studentCount: 445,
    category: '计算机',
  },
  {
    id: 'thermo-kit',
    name: '工程热力学',
    school: 'KIT',
    description: '热力学定律、熵、焓与工程循环过程分析。',
    tags: ['工程', '物理'],
    materialCount: 31,
    studentCount: 148,
    category: '工程',
  },
  {
    id: 'la-tum',
    name: '线性代数',
    school: 'TU Munich',
    description: '向量空间、线性变换、特征值与矩阵分解的系统学习。',
    tags: ['数学', '计算机基础'],
    materialCount: 39,
    studentCount: 267,
    category: '数学',
  },
  {
    id: 'os-rwth',
    name: '操作系统',
    school: 'RWTH Aachen',
    description: '进程管理、内存分配、文件系统与并发控制的原理与实现。',
    tags: ['计算机', '系统'],
    materialCount: 44,
    studentCount: 201,
    category: '计算机',
  },
  {
    id: 'tic-lmu',
    name: '理论计算机科学',
    school: 'LMU Munich',
    description: '自动机理论、形式语言、可计算性与复杂性理论。',
    tags: ['计算机', '理论'],
    materialCount: 22,
    studentCount: 87,
    category: '计算机',
  },
  {
    id: 'bc-eth',
    name: '生物化学',
    school: 'ETH Zurich',
    description: '蛋白质、核酸、代谢途径与酶催化机理。',
    tags: ['化学', '生物'],
    materialCount: 33,
    studentCount: 112,
    category: '化学',
  },
]

export const categories = ['全部', '数学', '计算机', '化学', '物理', '工程']

export function getCourseById(id: string): Course | undefined {
  return courses.find((c) => c.id === id)
}

export function getCoursesByCategory(category: string): Course[] {
  if (category === '全部') return courses
  return courses.filter((c) => c.category === category)
}
