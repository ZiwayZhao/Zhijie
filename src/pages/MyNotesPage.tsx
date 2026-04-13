/**
 * MyNotesPage — /my/notes
 * Unified notes center: aggregates PDF highlights + manual notes across all materials.
 * Supports filtering by type, grouping by material/type, search, and Markdown export.
 */
import { useEffect, useState, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { motion, type Variants } from 'framer-motion'
import {
  PenLine, FileText, BookOpen, Download, Search,
  Highlighter, ChevronDown, ChevronRight,
} from 'lucide-react'
import {
  loadAllNoteEntries,
  filterNoteEntries,
  sortNoteEntries,
  groupNoteEntries,
} from '@/lib/note-aggregator'
import { sourceTypeLabel } from '@/lib/types/note-entry'
import type { NoteEntry, NoteFilterType, NoteGroupBy, NoteSortBy } from '@/lib/types/note-entry'

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.05, duration: 0.35, ease: 'easeOut' },
  }),
}

/* ── Filter tabs ── */

const FILTER_TABS: { key: NoteFilterType; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'highlight', label: '批注' },
  { key: 'manual', label: '笔记' },
]

const GROUP_OPTIONS: { key: NoteGroupBy; label: string }[] = [
  { key: 'material', label: '按材料' },
  { key: 'type', label: '按类型' },
  { key: 'none', label: '不分组' },
]

const SORT_OPTIONS: { key: NoteSortBy; label: string }[] = [
  { key: 'newest', label: '最新优先' },
  { key: 'oldest', label: '最早优先' },
  { key: 'material', label: '按材料排序' },
]

/* ── Note card ── */

function NoteCard({ entry, index }: { entry: NoteEntry; index: number }) {
  const isHighlight = entry.source.type === 'highlight'
  const color = isHighlight ? (entry.source as { color?: string }).color || '#FBDA83' : undefined
  const page = isHighlight ? (entry.source as { page?: number }).page : undefined

  return (
    <motion.div
      variants={fadeUp}
      custom={index}
      initial="hidden"
      animate="visible"
      className={
        isHighlight
          ? 'border-l-[3px] pl-3 py-2.5'
          : 'border border-border-warm rounded-sm p-3 bg-bg-main'
      }
      style={isHighlight ? { borderColor: color } : undefined}
    >
      {/* Excerpt (for highlights) */}
      {entry.excerpt && (
        <p className="text-sm text-text-body leading-relaxed line-clamp-3">
          "{entry.excerpt}"
        </p>
      )}

      {/* Content (user note / manual note content) */}
      {entry.content && (
        <p className={`text-sm leading-relaxed ${entry.excerpt ? 'text-text-muted mt-1 italic' : 'text-text-body'} line-clamp-4`}>
          {entry.content}
        </p>
      )}

      {/* Metadata row */}
      <div className="flex items-center gap-3 mt-1.5 text-[10px] text-text-muted/60">
        <span className="flex items-center gap-1">
          {isHighlight ? <Highlighter size={9} /> : <PenLine size={9} />}
          {sourceTypeLabel(entry.source.type)}
        </span>
        {page && <span>P.{page}</span>}
        <span>{new Date(entry.createdAt).toLocaleDateString()}</span>
      </div>
    </motion.div>
  )
}

/* ── Group section ── */

function NoteGroup({
  title,
  entries,
  groupIndex,
  materialId,
  courseId,
}: {
  title: string
  entries: NoteEntry[]
  groupIndex: number
  materialId?: string
  courseId?: string
}) {
  const [expanded, setExpanded] = useState(true)

  return (
    <motion.div
      variants={fadeUp}
      custom={groupIndex + 2}
      initial="hidden"
      animate="visible"
      className="border border-border-warm rounded-sm bg-bg-card overflow-hidden"
    >
      {/* Group header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2.5 w-full px-4 py-3 border-b border-border-warm bg-bg-accent/30 text-left hover:bg-bg-accent/50 transition-colors"
      >
        {expanded ? <ChevronDown size={13} className="text-text-muted" /> : <ChevronRight size={13} className="text-text-muted" />}
        <FileText size={13} strokeWidth={1.5} className="text-red-primary shrink-0" />
        <div className="min-w-0 flex-1">
          <h3 className="font-heading text-sm text-text-main truncate">{title}</h3>
        </div>
        <span className="text-[11px] text-text-muted shrink-0">{entries.length} 条</span>
        {materialId && (
          <Link
            to={`/course/${courseId || 'default'}/material/${materialId}`}
            onClick={(e) => e.stopPropagation()}
            className="text-[10px] text-red-primary hover:underline shrink-0 ml-1"
          >
            打开
          </Link>
        )}
      </button>

      {/* Entries */}
      {expanded && (
        <div className="px-4 py-2.5 space-y-2">
          {entries.map((entry, i) => (
            <NoteCard key={entry.id} entry={entry} index={i} />
          ))}
        </div>
      )}
    </motion.div>
  )
}

/* ── Empty state ── */

function EmptyState() {
  return (
    <motion.div
      variants={fadeUp}
      custom={2}
      initial="hidden"
      animate="visible"
      className="border border-border-warm rounded-sm bg-bg-card p-12 text-center"
    >
      <div className="w-12 h-12 flex items-center justify-center border border-border-warm rounded-sm mx-auto mb-4">
        <PenLine size={22} strokeWidth={1.2} className="text-text-muted" />
      </div>
      <h3 className="font-heading text-lg text-text-main mb-2">还没有笔记</h3>
      <p className="text-sm text-text-muted mb-6 max-w-xs mx-auto">
        在阅读材料时选中文本添加批注，或在工作台侧栏创建笔记
      </p>
      <Link
        to="/my/materials"
        className="inline-flex items-center gap-2 px-4 py-2 text-sm
                   border border-red-primary text-red-primary rounded-sm
                   hover:bg-red-primary hover:text-white transition-colors no-underline"
      >
        <BookOpen size={14} strokeWidth={1.5} />
        浏览我的材料
      </Link>
    </motion.div>
  )
}

/* ── Main page ── */

export default function MyNotesPage() {
  const [allEntries, setAllEntries] = useState<NoteEntry[]>([])
  const [filterType, setFilterType] = useState<NoteFilterType>('all')
  const [groupBy, setGroupBy] = useState<NoteGroupBy>('material')
  const [sortBy, setSortBy] = useState<NoteSortBy>('newest')
  const [search, setSearch] = useState('')

  useEffect(() => {
    setAllEntries(loadAllNoteEntries())
  }, [])

  const filtered = useMemo(
    () => filterNoteEntries(allEntries, filterType, search),
    [allEntries, filterType, search],
  )

  const sorted = useMemo(
    () => sortNoteEntries(filtered, sortBy),
    [filtered, sortBy],
  )

  const grouped = useMemo(
    () => groupNoteEntries(sorted, groupBy),
    [sorted, groupBy],
  )

  // Export all as Markdown
  const handleExport = useCallback(() => {
    if (sorted.length === 0) return
    let md = `# 我的学习笔记\n\n> 导出时间: ${new Date().toLocaleString()}\n> 共 ${sorted.length} 条笔记\n\n`

    const byMaterial = groupNoteEntries(sorted, 'material')
    for (const [materialName, entries] of byMaterial) {
      md += `## ${materialName}\n\n`
      for (const entry of entries) {
        if (entry.excerpt) {
          md += `- "${entry.excerpt}"`
          if (entry.source.type === 'highlight' && (entry.source as { page?: number }).page) {
            md += ` (P.${(entry.source as { page?: number }).page})`
          }
          md += '\n'
          if (entry.content) md += `  - ${entry.content}\n`
        } else {
          md += `- ${entry.content}\n`
        }
      }
      md += '\n'
    }

    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `学习笔记-${new Date().toISOString().slice(0, 10)}.md`
    a.click()
    URL.revokeObjectURL(url)
  }, [sorted])

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto">
      {/* Header */}
      <motion.div variants={fadeUp} custom={0} initial="hidden" animate="visible">
        <div className="flex items-start justify-between mb-6">
          <div className="border-l-3 border-l-red-primary pl-4">
            <h1 className="font-heading text-2xl text-text-main">我的笔记</h1>
            <p className="text-sm text-text-muted mt-1">
              {allEntries.length > 0
                ? `${allEntries.length} 条笔记`
                : '学习笔记汇总'}
            </p>
          </div>
          {allEntries.length > 0 && (
            <button
              onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-muted
                         border border-border-warm rounded-sm
                         hover:border-red-primary hover:text-red-primary transition-colors"
            >
              <Download size={12} strokeWidth={1.5} />
              导出全部
            </button>
          )}
        </div>
      </motion.div>

      {/* Toolbar */}
      {allEntries.length > 0 && (
        <motion.div variants={fadeUp} custom={1} initial="hidden" animate="visible" className="mb-5 space-y-3">
          {/* Search */}
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              placeholder="搜索笔记内容..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-2 text-sm bg-bg-main border border-border-warm rounded-sm
                         focus:border-red-primary focus:outline-none text-text-body placeholder:text-text-muted/50"
            />
          </div>

          {/* Filter + Group + Sort */}
          <div className="flex items-center justify-between gap-3">
            {/* Type filter tabs */}
            <div className="flex gap-0 border border-border-warm rounded-sm overflow-hidden">
              {FILTER_TABS.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setFilterType(key)}
                  className={`px-3 py-1.5 text-[11px] transition-colors ${
                    filterType === key
                      ? 'bg-red-primary text-white'
                      : 'text-text-muted hover:text-text-body hover:bg-bg-accent/60'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Group + Sort selectors */}
            <div className="flex items-center gap-2 text-[11px] text-text-muted">
              <select
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value as NoteGroupBy)}
                className="bg-bg-main border border-border-warm rounded-sm px-2 py-1 text-[11px] text-text-body
                           focus:border-red-primary focus:outline-none cursor-pointer"
              >
                {GROUP_OPTIONS.map(({ key, label }) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as NoteSortBy)}
                className="bg-bg-main border border-border-warm rounded-sm px-2 py-1 text-[11px] text-text-body
                           focus:border-red-primary focus:outline-none cursor-pointer"
              >
                {SORT_OPTIONS.map(({ key, label }) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Result count */}
          {search && (
            <p className="text-[11px] text-text-muted">
              找到 {filtered.length} 条结果
            </p>
          )}
        </motion.div>
      )}

      {/* Content */}
      {allEntries.length > 0 ? (
        filtered.length > 0 ? (
          <div className="space-y-3">
            {Array.from(grouped.entries()).map(([groupTitle, entries], i) => (
              <NoteGroup
                key={groupTitle}
                title={groupTitle}
                entries={entries}
                groupIndex={i}
                materialId={groupBy === 'material' ? entries[0]?.materialId : undefined}
                courseId={groupBy === 'material' ? entries[0]?.courseId : undefined}
              />
            ))}
          </div>
        ) : (
          <div className="py-12 text-center">
            <p className="text-sm text-text-muted">没有匹配的笔记</p>
          </div>
        )
      ) : (
        <EmptyState />
      )}
    </div>
  )
}
