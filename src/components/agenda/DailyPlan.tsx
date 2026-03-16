/**
 * DailyPlan — today's learning plan card for the homepage.
 * Shows sorted agenda items with add-todo input.
 */
import { useState } from 'react'
import { motion } from 'framer-motion'
import { CalendarDays, Plus } from 'lucide-react'
import type { DailyAgenda } from '@/lib/agenda-engine'
import AgendaItem from '@/components/agenda/AgendaItem'

interface DailyPlanProps {
  agenda: DailyAgenda
  onToggleComplete: (id: string) => void
  onAddTodo: (title: string) => void
}

export default function DailyPlan({ agenda, onToggleComplete, onAddTodo }: DailyPlanProps) {
  const [newTodo, setNewTodo] = useState('')

  const activeItems = agenda.items.filter(
    (item) => !('completed' in item && item.completed),
  )
  const completedItems = agenda.items.filter(
    (item) => 'completed' in item && item.completed,
  )

  function handleAddTodo() {
    const title = newTodo.trim()
    if (!title) return
    onAddTodo(title)
    setNewTodo('')
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAddTodo()
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.1 }}
      className="border border-border-warm border-l-[3px] border-l-red-primary rounded-md bg-bg-card"
    >
      {/* Header — reading-list style */}
      <div className="flex items-center justify-between px-6 pt-6 pb-3">
        <div className="flex items-center gap-2.5">
          <CalendarDays size={16} strokeWidth={1.5} className="text-red-primary" />
          <h3 className="font-heading text-lg text-text-main tracking-tight">今日学习计划</h3>
        </div>
        <span className="text-[11px] text-text-muted font-body tracking-wide">
          {activeItems.length > 0
            ? `${activeItems.length} 项 · 约 ${agenda.totalMinutes} 分钟`
            : '暂无任务'}
        </span>
      </div>

      {/* Active items */}
      <div className="px-6">
        {activeItems.length > 0 ? (
          activeItems.map((item, i) => (
            <AgendaItem
              key={item.id}
              item={item}
              index={i}
              onToggleComplete={onToggleComplete}
            />
          ))
        ) : (
          <p className="text-sm text-text-muted py-8 text-center font-body">
            今天没有待完成的学习任务
          </p>
        )}
      </div>

      {/* Completed items */}
      {completedItems.length > 0 && (
        <div className="px-6 pt-3 pb-1 border-t border-border-warm mt-1">
          <p className="text-[11px] text-text-muted mb-1 font-body tracking-wide">
            已完成 ({completedItems.length})
          </p>
          {completedItems.map((item, i) => (
            <AgendaItem
              key={item.id}
              item={item}
              index={i}
              onToggleComplete={onToggleComplete}
            />
          ))}
        </div>
      )}

      {/* Add todo input */}
      <div className="flex items-center gap-2.5 px-6 py-3.5 border-t border-border-warm">
        <Plus size={14} strokeWidth={1.5} className="text-text-muted shrink-0" />
        <input
          type="text"
          value={newTodo}
          onChange={(e) => setNewTodo(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="添加学习任务..."
          className="flex-1 text-sm bg-transparent border-none outline-none text-text-body placeholder:text-text-muted/60 font-body"
        />
        {newTodo.trim() && (
          <button
            onClick={handleAddTodo}
            className="text-xs text-red-primary hover:text-red-dark transition-colors duration-150 font-body"
          >
            添加
          </button>
        )}
      </div>
    </motion.div>
  )
}
