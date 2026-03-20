/**
 * ToolResultCard — compact card showing tool execution result.
 * Provides action buttons to view specialist markdown or quiz in MaterialReader.
 */

import { BookOpen, FileQuestion, AlertCircle } from 'lucide-react'
import type { ToolResultItem } from '@/hooks/useTutorSession'

interface ToolResultCardProps {
  result: ToolResultItem
  onViewSpecialist?: (data: Record<string, unknown>) => void
  onViewQuiz?: (data: Record<string, unknown>) => void
}

export default function ToolResultCard({
  result,
  onViewSpecialist,
  onViewQuiz,
}: ToolResultCardProps) {
  if (!result.ok) {
    return (
      <div className="flex items-start gap-2 px-3 py-2 border border-red-primary/30 rounded-sm bg-red-primary/5 text-xs mb-2">
        <AlertCircle size={13} strokeWidth={1.5} className="text-red-primary mt-0.5 shrink-0" />
        <div>
          <span className="font-medium text-red-primary">{result.toolName}</span>
          <span className="text-text-muted ml-1">失败</span>
          {result.error && (
            <p className="text-text-muted mt-0.5">{result.error}</p>
          )}
        </div>
      </div>
    )
  }

  const data = result.data ?? {}

  if (result.toolName === 'get_specialist') {
    const moduleName = (data.module_name as string) ?? '精讲笔记'
    return (
      <div className="flex items-center gap-2 px-3 py-2 border border-border-warm rounded-sm bg-bg-main text-xs mb-2">
        <BookOpen size={13} strokeWidth={1.5} className="text-red-primary shrink-0" />
        <span className="text-text-body flex-1 truncate">
          {moduleName}
        </span>
        {onViewSpecialist && (
          <button
            onClick={() => onViewSpecialist(data)}
            className="text-red-primary hover:underline whitespace-nowrap"
          >
            查看精讲
          </button>
        )}
      </div>
    )
  }

  if (result.toolName === 'get_quiz') {
    const count = (data.questions_count as number) ?? 0
    const matched = data.module_matched as boolean
    return (
      <div className="flex items-center gap-2 px-3 py-2 border border-border-warm rounded-sm bg-bg-main text-xs mb-2">
        <FileQuestion size={13} strokeWidth={1.5} className="text-red-primary shrink-0" />
        <span className="text-text-body flex-1">
          {count} 道测验题{matched ? '' : '（全部模块）'}
        </span>
        {onViewQuiz && (
          <button
            onClick={() => onViewQuiz(data)}
            className="text-red-primary hover:underline whitespace-nowrap"
          >
            查看测验
          </button>
        )}
      </div>
    )
  }

  // Fallback for unknown tools
  return (
    <div className="px-3 py-2 border border-border-warm rounded-sm bg-bg-main text-xs mb-2 text-text-muted">
      {result.toolName}: 完成
    </div>
  )
}
