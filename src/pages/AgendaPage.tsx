/**
 * AgendaPage — /agenda
 * Full agenda timeline view with date display, week navigation,
 * exam countdowns, grouped items, and a floating add-task input.
 */
import { useEffect, useState, useCallback, useRef } from 'react'
import { motion, type Variants } from 'framer-motion'
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Plus,
  Clock,
} from 'lucide-react'
import { format, addDays, subDays, startOfWeek, endOfWeek, isSameDay, isToday } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import type { DailyAgenda, ExamConfig, TodoItem } from '@/lib/agenda-engine'
import { generateDailyAgenda, loadExamConfigs, loadTodos, saveTodos } from '@/lib/agenda-engine'
import { loadAllDecks } from '@/lib/fsrs'
import { initMockAgenda, getMockStudyItems } from '@/mocks/agenda'
import { initMockFlashcards } from '@/mocks/flashcards'
import AgendaTimeline from '@/components/agenda/AgendaTimeline'
import ExamCountdown from '@/components/agenda/ExamCountdown'

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.05, duration: 0.35, ease: 'easeOut' },
  }),
}

function WeekStrip({
  selectedDate,
  onSelectDate,
}: {
  selectedDate: Date
  onSelectDate: (d: Date) => void
}) {
  const weekStart = startOfWeek(selectedDate, { weekStartsOn: 1 })
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  return (
    <div className="flex gap-1">
      {days.map((day) => {
        const selected = isSameDay(day, selectedDate)
        const today = isToday(day)
        return (
          <button
            key={day.toISOString()}
            onClick={() => onSelectDate(day)}
            className={`flex flex-col items-center py-2 px-3 rounded-md transition-colors min-w-[44px] ${
              selected
                ? 'bg-red-primary text-white'
                : today
                  ? 'bg-bg-accent text-red-primary border border-red-primary/20'
                  : 'text-text-body hover:bg-bg-accent'
            }`}
          >
            <span className={`text-[10px] uppercase ${selected ? 'text-white/70' : 'text-text-muted'}`}>
              {format(day, 'EEE', { locale: zhCN })}
            </span>
            <span className={`text-sm font-heading mt-0.5 ${selected ? 'text-white' : ''}`}>
              {format(day, 'd')}
            </span>
          </button>
        )
      })}
    </div>
  )
}

export default function AgendaPage() {
  const [selectedDate, setSelectedDate] = useState(new Date())
  const [agenda, setAgenda] = useState<DailyAgenda>({ date: '', items: [], totalMinutes: 0 })
  const [examConfigs, setExamConfigs] = useState<ExamConfig[]>([])
  const [newTodo, setNewTodo] = useState('')
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

  const handleAddTodo = useCallback(() => {
    const title = newTodo.trim()
    if (!title) return
    const todo: TodoItem = {
      type: 'todo',
      id: `todo-${Date.now()}`,
      title,
      completed: false,
    }
    const updated = [...todosRef.current, todo]
    todosRef.current = updated
    saveTodos(updated)
    rebuildAgenda(updated)
    setNewTodo('')
  }, [newTodo, rebuildAgenda])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleAddTodo()
      }
    },
    [handleAddTodo],
  )

  const navigateWeek = useCallback(
    (dir: -1 | 1) => {
      setSelectedDate((d) => (dir === 1 ? addDays(d, 7) : subDays(d, 7)))
    },
    [],
  )

  const goToToday = useCallback(() => setSelectedDate(new Date()), [])

  const upcomingExams = examConfigs.filter((c) => {
    const daysLeft = Math.ceil(
      (new Date(c.examDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
    )
    return daysLeft >= 0 && daysLeft <= 14
  })

  const dateLabel = format(selectedDate, 'yyyy年M月d日 EEEE', { locale: zhCN })
  const isTodaySelected = isToday(selectedDate)

  return (
    <div className="p-8 max-w-3xl mx-auto">
      {/* Editorial header with date */}
      <motion.div variants={fadeUp} custom={0} initial="hidden" animate="visible">
        <div className="border-l-3 border-l-red-primary pl-4 mb-6">
          <div className="flex items-center gap-2">
            <CalendarDays size={20} strokeWidth={1.5} className="text-red-primary" />
            <h1 className="font-heading text-3xl text-text-main">学习日程</h1>
          </div>
          <p className="text-text-muted mt-1">
            统一管理你的学习计划、闪卡复习和考试备考
          </p>
        </div>
      </motion.div>

      {/* Date display + week navigation */}
      <motion.div
        variants={fadeUp}
        custom={1}
        initial="hidden"
        animate="visible"
        className="border border-border-warm rounded-md bg-bg-card p-4 mb-6"
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <h2 className="font-heading text-lg text-text-main">{dateLabel}</h2>
            {!isTodaySelected && (
              <button
                onClick={goToToday}
                className="text-xs px-2 py-1 rounded border border-red-primary/30
                           text-red-primary hover:bg-red-primary/5 transition-colors"
              >
                回到今天
              </button>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => navigateWeek(-1)}
              className="w-7 h-7 flex items-center justify-center rounded
                         hover:bg-bg-accent transition-colors text-text-muted"
              aria-label="上一周"
            >
              <ChevronLeft size={16} strokeWidth={1.5} />
            </button>
            <button
              onClick={() => navigateWeek(1)}
              className="w-7 h-7 flex items-center justify-center rounded
                         hover:bg-bg-accent transition-colors text-text-muted"
              aria-label="下一周"
            >
              <ChevronRight size={16} strokeWidth={1.5} />
            </button>
          </div>
        </div>

        <WeekStrip selectedDate={selectedDate} onSelectDate={setSelectedDate} />
      </motion.div>

      {/* Exam countdowns — prominently at top */}
      {upcomingExams.length > 0 && (
        <motion.div
          variants={fadeUp}
          custom={2}
          initial="hidden"
          animate="visible"
          className="mb-6"
        >
          <h3 className="font-heading text-base text-text-main mb-3 flex items-center gap-2">
            <Clock size={14} strokeWidth={1.5} className="text-red-primary" />
            考试倒计时
          </h3>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {upcomingExams.map((config) => (
              <ExamCountdown key={config.courseId} examConfig={config} />
            ))}
          </div>
        </motion.div>
      )}

      {/* Main agenda timeline */}
      <motion.div variants={fadeUp} custom={3} initial="hidden" animate="visible">
        <AgendaTimeline
          agenda={agenda}
          examConfigs={examConfigs}
          onToggleComplete={handleToggleComplete}
        />
      </motion.div>

      {/* Floating add-task input */}
      <motion.div
        variants={fadeUp}
        custom={4}
        initial="hidden"
        animate="visible"
        className="sticky bottom-6 mt-6"
      >
        <div className="border border-border-warm rounded-lg bg-bg-card px-4 py-3
                        flex items-center gap-3">
          <div className="w-7 h-7 rounded-full bg-bg-accent flex items-center justify-center shrink-0">
            <Plus size={14} strokeWidth={1.5} className="text-red-primary" />
          </div>
          <input
            type="text"
            value={newTodo}
            onChange={(e) => setNewTodo(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="添加学习任务..."
            className="flex-1 text-sm bg-transparent border-none outline-none
                       text-text-body placeholder:text-text-muted/60"
          />
          {newTodo.trim() && (
            <button
              onClick={handleAddTodo}
              className="px-3 py-1.5 text-xs rounded-md bg-red-primary text-white
                         hover:bg-red-dark transition-colors"
            >
              添加
            </button>
          )}
        </div>
      </motion.div>
    </div>
  )
}
