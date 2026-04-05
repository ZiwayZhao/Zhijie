/**
 * ExamProfile — exam information management with localStorage persistence.
 * Stores per-course exam configuration (date, duration, question distribution)
 * to drive exam-aligned quiz generation.
 */

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface QuestionTypeDistribution {
  question_type: 'mcq' | 'fill_blank' | 'true_false' | 'short_answer' | 'calculation'
  count: number
  points_each: number
  total_points: number
  percentage: number
}

export interface ExamProfile {
  exam_date?: string
  duration_minutes?: number
  is_open_book?: boolean
  calculator_allowed?: boolean
  total_points: number
  question_distribution: QuestionTypeDistribution[]
  source: 'default' | 'user_input' | 'exam_analysis'
  analyzed_exam_s3_key?: string
}

/* ------------------------------------------------------------------ */
/*  Course type guessing                                               */
/* ------------------------------------------------------------------ */

const MATH_KEYWORDS = [
  '数学', '高数', '线代', '线性代数', '概率', '统计', '微积分',
  'math', 'calculus', 'algebra', 'probability', 'statistics',
  '物理', 'physics', '力学', 'mechanics', '电磁', '量子',
  '工程', 'engineering',
]

const CS_KEYWORDS = [
  '数据库', '算法', '编程', '计算机', '数据结构', '操作系统',
  '网络', '编译', '软件', 'CS', 'computer', 'programming',
  'algorithm', 'database', '离散', 'discrete',
]

export function guessCourseType(courseName: string): string {
  const lower = courseName.toLowerCase()
  if (MATH_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()))) return 'math'
  if (CS_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()))) return 'cs'
  return 'humanities'
}

/* ------------------------------------------------------------------ */
/*  Default profiles by course type                                    */
/* ------------------------------------------------------------------ */

function recalcPercentages(dist: QuestionTypeDistribution[], totalPoints: number): QuestionTypeDistribution[] {
  return dist.map((d) => ({
    ...d,
    total_points: d.count * d.points_each,
    percentage: totalPoints > 0 ? (d.count * d.points_each) / totalPoints : 0,
  }))
}

export function defaultExamProfile(courseType: string): ExamProfile {
  let distribution: QuestionTypeDistribution[]

  if (courseType === 'math') {
    distribution = [
      { question_type: 'mcq', count: 10, points_each: 2, total_points: 20, percentage: 0.2 },
      { question_type: 'fill_blank', count: 5, points_each: 2, total_points: 10, percentage: 0.1 },
      { question_type: 'calculation', count: 4, points_each: 10, total_points: 40, percentage: 0.4 },
      { question_type: 'short_answer', count: 3, points_each: 10, total_points: 30, percentage: 0.3 },
    ]
  } else if (courseType === 'cs') {
    distribution = [
      { question_type: 'mcq', count: 15, points_each: 2, total_points: 30, percentage: 0.3 },
      { question_type: 'true_false', count: 10, points_each: 1, total_points: 10, percentage: 0.1 },
      { question_type: 'fill_blank', count: 5, points_each: 2, total_points: 10, percentage: 0.1 },
      { question_type: 'short_answer', count: 5, points_each: 10, total_points: 50, percentage: 0.5 },
    ]
  } else {
    // humanities default
    distribution = [
      { question_type: 'mcq', count: 20, points_each: 1, total_points: 20, percentage: 0.2 },
      { question_type: 'true_false', count: 10, points_each: 1, total_points: 10, percentage: 0.1 },
      { question_type: 'short_answer', count: 4, points_each: 10, total_points: 40, percentage: 0.4 },
      { question_type: 'fill_blank', count: 6, points_each: 5, total_points: 30, percentage: 0.3 },
    ]
  }

  return {
    total_points: 100,
    question_distribution: distribution,
    source: 'default',
  }
}

/* ------------------------------------------------------------------ */
/*  Persistence                                                        */
/* ------------------------------------------------------------------ */

function storageKey(courseId: string): string {
  return `zhijie_exam_profile_${courseId}`
}

export function loadExamProfile(courseId: string): ExamProfile | null {
  try {
    const raw = localStorage.getItem(storageKey(courseId))
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.question_distribution)) {
        return parsed as ExamProfile
      }
    }
  } catch {
    // fall through
  }
  return null
}

export function saveExamProfile(courseId: string, profile: ExamProfile): void {
  // Recalculate totals before saving
  const totalPoints = profile.question_distribution.reduce(
    (sum, d) => sum + d.count * d.points_each, 0,
  )
  const normalized: ExamProfile = {
    ...profile,
    total_points: totalPoints,
    question_distribution: recalcPercentages(profile.question_distribution, totalPoints),
  }
  localStorage.setItem(storageKey(courseId), JSON.stringify(normalized))

  // Fire-and-forget backend sync
  import('@/lib/sync-service').then(({ debouncedSyncExamProfileUp }) => {
    debouncedSyncExamProfileUp(courseId, normalized)
  })
}
