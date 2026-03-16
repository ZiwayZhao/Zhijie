/**
 * AgendaPage — /agenda
 * Full agenda timeline view with exam countdowns and grouped items.
 */
import { useEffect, useState, useCallback, useRef } from 'react'
import { motion } from 'framer-motion'
import type { DailyAgenda, ExamConfig, TodoItem } from '@/lib/agenda-engine'
import { generateDailyAgenda, loadExamConfigs, loadTodos, saveTodos } from '@/lib/agenda-engine'
import { loadAllDecks } from '@/lib/fsrs'
import { initMockAgenda, getMockStudyItems } from '@/mocks/agenda'
import { initMockFlashcards } from '@/mocks/flashcards'
import AgendaTimeline from '@/components/agenda/AgendaTimeline'

export default function AgendaPage() {
  const [agenda, setAgenda] = useState<DailyAgenda>({ date: '', items: [], totalMinutes: 0 })
  const [examConfigs, setExamConfigs] = useState<ExamConfig[]>([])
  const todosRef = useRef<TodoItem[]>([])

  const rebuildAgenda = useCallback((currentTodos: TodoItem[]) => {
    const decks = loadAllDecks()
    const configs = loadExamConfigs()
    const studyItems = getMockStudyItems()
    const daily = generateDailyAgenda(decks, configs, studyItems, currentTodos)
    setAgenda(daily)
    setExamConfigs(configs)
  }, [])

  useEffect(() => {
    initMockFlashcards()
    initMockAgenda()
    const loadedTodos = loadTodos()
    todosRef.current = loadedTodos
    rebuildAgenda(loadedTodos)
  }, [rebuildAgenda])

  const handleToggleComplete = useCallback((id: string) => {
    const updated = todosRef.current.map((t) =>
      t.id === id ? { ...t, completed: !t.completed } : t,
    )
    todosRef.current = updated
    saveTodos(updated)
    rebuildAgenda(updated)
  }, [rebuildAgenda])

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
      >
        <div className="border-l-3 border-l-red-primary pl-4 mb-8">
          <h1 className="font-heading text-3xl text-text-main">学习日程</h1>
          <p className="text-text-muted mt-1">
            统一管理你的学习计划、闪卡复习和考试备考
          </p>
        </div>
      </motion.div>

      <AgendaTimeline
        agenda={agenda}
        examConfigs={examConfigs}
        onToggleComplete={handleToggleComplete}
      />
    </div>
  )
}
