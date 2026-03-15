export interface Activity {
  id: string
  type: 'upload' | 'study' | 'note' | 'quiz'
  message: string
  time: string
  courseName: string
}

export const activities: Activity[] = [
  {
    id: 'a1',
    type: 'upload',
    message: 'Prof. Mueller 上传了「图论进阶 - 第5周」',
    time: '2 小时前',
    courseName: '离散数学',
  },
  {
    id: 'a2',
    type: 'study',
    message: '你完成了「梯度下降与优化方法」的精读',
    time: '4 小时前',
    courseName: '机器学习',
  },
  {
    id: 'a3',
    type: 'note',
    message: 'Chen Wei 分享了「红黑树实现笔记」',
    time: '昨天',
    courseName: '算法与数据结构',
  },
  {
    id: 'a4',
    type: 'quiz',
    message: '你在「命题逻辑测验」中获得 92 分',
    time: '昨天',
    courseName: '离散数学',
  },
  {
    id: 'a5',
    type: 'upload',
    message: 'TA Zhang 上传了新的习题集',
    time: '2 天前',
    courseName: '有机化学 I',
  },
  {
    id: 'a6',
    type: 'study',
    message: '你学习了「量子态与测量」45 分钟',
    time: '3 天前',
    courseName: '量子力学导论',
  },
]

export const recentCourses = [
  { id: 'dm-tum', name: '离散数学', school: 'TU Munich', lastVisit: '今天', progress: 68 },
  { id: 'ml-eth', name: '机器学习', school: 'ETH Zurich', lastVisit: '昨天', progress: 45 },
  { id: 'algo-tum', name: '算法与数据结构', school: 'TU Munich', lastVisit: '2天前', progress: 82 },
  { id: 'oc-eth', name: '有机化学 I', school: 'ETH Zurich', lastVisit: '3天前', progress: 31 },
]

export const studyStats = {
  todayMinutes: 127,
  weekMinutes: 840,
  completedMaterials: 12,
  streak: 7,
}
