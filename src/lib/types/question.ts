/**
 * Multi-type question definitions for the quiz system.
 * Extends beyond MCQ to support fill-blank, true/false, short answer, calculation.
 */

export interface BaseQuestion {
  question_type: 'mcq' | 'fill_blank' | 'true_false' | 'short_answer' | 'calculation'
  question: string
  points: number
  difficulty: 'easy' | 'medium' | 'hard'
  source_module_name: string
  source_page: number | null
  explanation: string
}

/** Multiple choice — compatible with existing MCQuestion */
export interface MCQuestion extends BaseQuestion {
  question_type: 'mcq'
  options: string[]
  correct_index: number
}

/** Fill in the blank — blanks marked with {{blank}} in question text */
export interface FillBlankQuestion extends BaseQuestion {
  question_type: 'fill_blank'
  blanks: string[] // acceptable answers per blank, | separated alternatives
}

/** True or false */
export interface TrueFalseQuestion extends BaseQuestion {
  question_type: 'true_false'
  correct_answer: boolean
}

/** Short answer with self-grading rubric */
export interface ShortAnswerQuestion extends BaseQuestion {
  question_type: 'short_answer'
  reference_answer: string
  scoring_rubric: string[]
}

/** Multi-step calculation */
export interface CalculationQuestion extends BaseQuestion {
  question_type: 'calculation'
  steps: { step: string; answer: string; points: number }[]
  final_answer: string
}

export type QuestionItem =
  | MCQuestion
  | FillBlankQuestion
  | TrueFalseQuestion
  | ShortAnswerQuestion
  | CalculationQuestion
