/**
 * AgendaTimeline — detailed agenda view for the dedicated /agenda page.
 * Groups items by urgency and shows exam countdowns.
 */
import type { DailyAgenda, AgendaItem as AgendaItemType } from '@/lib/agenda-engine'
import AgendaItem from '@/components/agenda/AgendaItem'

interface AgendaTimelineProps {
  agenda: DailyAgenda
  onToggleComplete: (id: string) => void
  /** When true, exam-prep items are filtered out (shown separately outside) */
  hideExamPrep?: boolean
}

function groupItems(items: AgendaItemType[]) {
  const urgent: AgendaItemType[] = []
  const dueToday: AgendaItemType[] = []
  const planned: AgendaItemType[] = []
  const completed: AgendaItemType[] = []

  for (const item of items) {
    if ('completed' in item && item.completed) {
      completed.push(item)
    } else if (item.type === 'exam-prep' && item.daysLeft <= 3) {
      urgent.push(item)
    } else if (item.type === 'flashcard-review') {
      dueToday.push(item)
    } else {
      planned.push(item)
    }
  }

  return { urgent, dueToday, planned, completed }
}

function SectionHeader({ title, count }: { title: string; count: number }) {
  if (count === 0) return null
  return (
    <h3 className="font-heading text-base text-text-main mt-6 mb-2 first:mt-0">
      {title}
      <span className="text-xs text-text-muted font-body ml-2">({count})</span>
    </h3>
  )
}

export default function AgendaTimeline({ agenda, onToggleComplete, hideExamPrep }: AgendaTimelineProps) {
  const filteredItems = hideExamPrep
    ? agenda.items.filter((item) => item.type !== 'exam-prep')
    : agenda.items
  const groups = groupItems(filteredItems)

  let globalIndex = 0

  return (
    <div>
      {/* Agenda card */}
      <div className="border border-border-warm rounded-lg bg-bg-card">
        <div className="px-5 pt-5 pb-2">
          <div className="flex items-center justify-between">
            <h2 className="font-heading text-lg text-text-main">
              {agenda.date}
            </h2>
            <span className="text-xs text-text-muted">
              {filteredItems.length} 项 · 约 {agenda.totalMinutes} 分钟
            </span>
          </div>
        </div>

        <div className="px-5 pb-5">
          {/* Urgent */}
          <SectionHeader title="紧急" count={groups.urgent.length} />
          {groups.urgent.map((item) => (
            <AgendaItem
              key={item.id}
              item={item}
              index={globalIndex++}
              onToggleComplete={onToggleComplete}
            />
          ))}

          {/* Due today */}
          <SectionHeader title="今日到期" count={groups.dueToday.length} />
          {groups.dueToday.map((item) => (
            <AgendaItem
              key={item.id}
              item={item}
              index={globalIndex++}
              onToggleComplete={onToggleComplete}
            />
          ))}

          {/* Planned */}
          <SectionHeader title="计划学习" count={groups.planned.length} />
          {groups.planned.map((item) => (
            <AgendaItem
              key={item.id}
              item={item}
              index={globalIndex++}
              onToggleComplete={onToggleComplete}
            />
          ))}

          {/* Completed */}
          {groups.completed.length > 0 && (
            <>
              <SectionHeader title="已完成" count={groups.completed.length} />
              {groups.completed.map((item) => (
                <AgendaItem
                  key={item.id}
                  item={item}
                  index={globalIndex++}
                  onToggleComplete={onToggleComplete}
                />
              ))}
            </>
          )}

          {filteredItems.length === 0 && (
            <p className="text-sm text-text-muted py-8 text-center">
              今天暂无学习安排
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
