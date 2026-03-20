/**
 * useQuizSession — wraps QuizPanelV2 with BKT feedback.
 * Loads learning profile, processes quiz results, and persists updates.
 */
import { useState, useCallback } from 'react'
import {
  loadProfile,
  saveProfile,
  processQuizResults,
  type LearningProfile,
  type QuizV2Result,
} from '@/lib/student-model'

export interface QuizSessionResult {
  sourceModuleName: string
  questionType: string
  correct: boolean
  earnedPoints: number
  maxPoints: number
}

export function useQuizSession(courseId: string) {
  const [profile, setProfile] = useState<LearningProfile>(() => loadProfile())

  /** Call when user finishes a QuizPanelV2 session */
  const handleQuizComplete = useCallback(
    (results: QuizSessionResult[]) => {
      const mapped: QuizV2Result[] = results.map((r) => ({
        moduleId: r.sourceModuleName,
        questionType: r.questionType,
        correct: r.correct,
        points: r.earnedPoints,
        maxPoints: r.maxPoints,
      }))

      setProfile((prev) => {
        const updated = processQuizResults(prev, mapped)
        saveProfile(updated)
        return updated
      })
    },
    [],
  )

  /** Get mastery for a specific module */
  const getModuleMastery = useCallback(
    (moduleId: string): number => {
      return profile.modules[moduleId]?.mastery ?? 0.3
    },
    [profile],
  )

  return { profile, handleQuizComplete, getModuleMastery }
}
