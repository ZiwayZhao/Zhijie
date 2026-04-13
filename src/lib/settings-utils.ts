/**
 * Shared types and utilities for Settings page and its section components.
 */
import { STORAGE_KEYS } from '@/lib/storage-keys'

export const STUDY_GOALS = [30, 60, 90, 120] as const
export const REMINDER_TIMES = ['08:00', '09:00', '10:00', '18:00', '20:00', '21:00'] as const
export const FONT_SIZES = ['小', '标准', '大'] as const

export type Theme = 'warm' | 'dark'
export type FontSize = typeof FONT_SIZES[number]

export interface UserPreferences {
  dailyGoal: number
  reminderTime: string
  reminderEnabled: boolean
  theme: Theme
  fontSize: FontSize
}

export const DEFAULT_PREFS: UserPreferences = {
  dailyGoal: 60,
  reminderTime: '09:00',
  reminderEnabled: true,
  theme: 'warm',
  fontSize: '标准',
}

export const FONT_SIZE_MAP: Record<FontSize, string> = {
  '小': '14px',
  '标准': '16px',
  '大': '18px',
}

export function loadPreferences(): UserPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.USER_PREFERENCES)
    if (raw) return { ...DEFAULT_PREFS, ...JSON.parse(raw) }
  } catch { /* ignore */ }
  return { ...DEFAULT_PREFS }
}

export function savePreferences(prefs: UserPreferences) {
  localStorage.setItem(STORAGE_KEYS.USER_PREFERENCES, JSON.stringify(prefs))
}

export function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme === 'dark' ? 'dark' : '')
}

export function applyFontSize(size: FontSize) {
  document.documentElement.style.fontSize = FONT_SIZE_MAP[size]
}
