/**
 * Centralized localStorage key constants.
 * Every zhijie_* key used in the project MUST be defined here.
 */
export const STORAGE_KEYS = {
  /** LearningProfile (student-model) */
  LEARNING_PROFILE: 'zhijie_learning_profile',

  /** FlashcardDeck per course (fsrs) */
  FLASHCARDS: (courseId: string) => `zhijie_flashcards_${courseId}` as const,
  FLASHCARDS_PREFIX: 'zhijie_flashcards_',

  /** Evolution logs per course (card-evolution) */
  EVOLUTION_LOGS: (courseId: string) => `zhijie_evolution_logs_${courseId}` as const,
  EVOLUTION_LOGS_PREFIX: 'zhijie_evolution_logs_',

  /** Agenda todos list */
  AGENDA_TODOS: 'zhijie_agenda_todos',

  /** Exam configurations */
  EXAM_CONFIGS: 'zhijie_exam_configs',

  /** Enrolled course slugs */
  ENROLLED_COURSES: 'zhijie_enrolled_courses',

  /** User-uploaded materials */
  USER_MATERIALS: 'zhijie_user_materials',

  /** PDF highlights per material */
  HIGHLIGHTS: (materialId: string) => `zhijie_highlights_${materialId}` as const,
  HIGHLIGHTS_PREFIX: 'zhijie_highlights_',

  /** Mock data initialization guards */
  MOCK_FLASHCARDS_INIT: 'zhijie_mock_flashcards_initialized',
  MOCK_AGENDA_INIT: 'zhijie_mock_agenda_initialized',
  /** Common prefix for all zhijie keys (used by clear-all / export) */
  PREFIX: 'zhijie_',
} as const
