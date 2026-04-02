/**
 * ClassificationTable — Shows auto-classified files for review before batch upload.
 * Users can adjust material type per file and exclude files.
 */

import { useState, useEffect } from 'react'
import { Check, ChevronDown, Loader2, Plus } from 'lucide-react'
import { fetchCourses, createCourse, type CourseItem } from '@/lib/api'
import type { ClassifiedFile } from '@/lib/folder-classifier'

const MATERIAL_TYPES = ['课件', '习题', '考题', '解答', '笔记', '其他'] as const
const SEMESTERS = ['2025/26 WS', '2025 SS', '2024/25 WS', '2024 SS', '其他']

interface ClassificationTableProps {
  files: ClassifiedFile[]
  onConfirm: (files: ClassifiedFile[], courseId: string, semester: string) => void
  onCancel: () => void
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

export default function ClassificationTable({
  files: initialFiles,
  onConfirm,
  onCancel,
}: ClassificationTableProps) {
  const [files, setFiles] = useState(initialFiles)
  const [courseId, setCourseId] = useState('')
  const [semester, setSemester] = useState(SEMESTERS[0])
  const [courseList, setCourseList] = useState<CourseItem[]>([])
  const [courseLoading, setCourseLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [newCourseName, setNewCourseName] = useState('')
  const [newCourseSchool, setNewCourseSchool] = useState('')
  const [createLoading, setCreateLoading] = useState(false)

  useEffect(() => {
    fetchCourses({ pageSize: 100 })
      .then(({ items }) => setCourseList(items))
      .catch(() => {})
      .finally(() => setCourseLoading(false))
  }, [])

  const filteredCourses = searchTerm
    ? courseList.filter(
        (c) =>
          c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          c.school.toLowerCase().includes(searchTerm.toLowerCase()),
      )
    : courseList

  async function handleCreateCourse() {
    if (!newCourseName.trim()) return
    setCreateLoading(true)
    try {
      const course = await createCourse({
        name: newCourseName.trim(),
        university: newCourseSchool.trim() || undefined,
      })
      setCourseList((prev) => [course, ...prev])
      setCourseId(course.courseUuid)
      setIsCreating(false)
      setNewCourseName('')
      setNewCourseSchool('')
    } catch {
      // Stay in creation mode
    } finally {
      setCreateLoading(false)
    }
  }

  function updateFileType(index: number, newType: string) {
    setFiles((prev) =>
      prev.map((f, i) => (i === index ? { ...f, suggestedType: newType } : f)),
    )
  }

  function toggleInclude(index: number) {
    setFiles((prev) =>
      prev.map((f, i) => (i === index ? { ...f, included: !f.included } : f)),
    )
  }

  const includedCount = files.filter((f) => f.included).length

  return (
    <div
      className="space-y-5 border border-border-warm rounded-sm bg-bg-card"
    >
      {/* Header — course & semester selection */}
      <div className="p-5 pb-0 space-y-4">
        <div>
          <span className="text-[10px] tracking-widest uppercase text-text-muted font-body">
            Batch Upload
          </span>
          <h3 className="font-heading text-xl text-text-main mt-0.5">
            文件分类确认
          </h3>
          <div className="w-8 h-px bg-red-primary mt-2" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Course select */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-text-main">所属课程</label>
            {isCreating ? (
              <div className="space-y-1.5">
                <input
                  type="text"
                  value={newCourseName}
                  onChange={(e) => setNewCourseName(e.target.value)}
                  placeholder="课程名称（如：离散数学）"
                  className="input-field text-xs"
                  autoFocus
                />
                <input
                  type="text"
                  value={newCourseSchool}
                  onChange={(e) => setNewCourseSchool(e.target.value)}
                  placeholder="学校（可选）"
                  className="input-field text-xs"
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCreateCourse}
                    disabled={!newCourseName.trim() || createLoading}
                    className="px-2.5 py-1 text-[11px] rounded-sm bg-red-primary text-white
                               hover:bg-red-dark transition-colors disabled:opacity-40"
                  >
                    {createLoading ? '创建中...' : '创建'}
                  </button>
                  <button
                    onClick={() => setIsCreating(false)}
                    className="px-2.5 py-1 text-[11px] text-text-muted hover:text-text-body transition-colors"
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <>
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="搜索课程..."
                  className="input-field text-xs"
                />
                <div className="relative">
                  {courseLoading ? (
                    <div className="flex items-center gap-2 py-1.5 text-text-muted text-xs">
                      <Loader2 size={12} className="animate-spin" /> 加载中...
                    </div>
                  ) : (
                    <>
                      <select
                        value={courseId}
                        onChange={(e) => setCourseId(e.target.value)}
                        className="input-field text-xs appearance-none pr-7"
                      >
                        <option value="">选择课程...</option>
                        {filteredCourses.map((c) => (
                          <option key={c.courseUuid} value={c.courseUuid}>
                            {c.name}{c.school ? ` — ${c.school}` : ''}
                          </option>
                        ))}
                      </select>
                      <ChevronDown
                        size={12}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
                      />
                    </>
                  )}
                </div>
                <button
                  onClick={() => setIsCreating(true)}
                  className="flex items-center gap-1 text-[11px] text-text-muted hover:text-red-primary transition-colors"
                >
                  <Plus size={10} strokeWidth={1.5} />
                  新建课程
                </button>
              </>
            )}
          </div>

          {/* Semester select */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-text-main">学期</label>
            <div className="relative">
              <select
                value={semester}
                onChange={(e) => setSemester(e.target.value)}
                className="input-field text-xs appearance-none pr-7"
              >
                {SEMESTERS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <ChevronDown
                size={12}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
              />
            </div>
          </div>
        </div>
      </div>

      {/* File table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-y border-border-warm bg-bg-main/50 text-xs text-text-muted">
              <th className="text-left px-5 py-2 font-medium">文件名</th>
              <th className="text-left px-3 py-2 font-medium w-28">分类</th>
              <th className="text-right px-3 py-2 font-medium w-20">大小</th>
              <th className="text-center px-3 py-2 font-medium w-14">包含</th>
            </tr>
          </thead>
          <tbody>
            {files.map((f, i) => (
              <tr
                key={`${f.relativePath}-${i}`}
                className={[
                  'border-b border-border-warm/50 transition-colors',
                  f.included ? 'hover:bg-bg-accent/30' : 'opacity-40',
                ].join(' ')}
              >
                <td className="px-5 py-2.5">
                  <div className="text-text-main truncate max-w-[300px]">{f.file.name}</div>
                  {f.relativePath !== f.file.name && (
                    <div className="text-[10px] text-text-muted truncate">{f.relativePath}</div>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <select
                    value={f.suggestedType}
                    onChange={(e) => updateFileType(i, e.target.value)}
                    className="text-xs border border-border-warm rounded-sm px-1.5 py-0.5 bg-bg-card
                               focus:border-red-primary focus:outline-none"
                  >
                    {MATERIAL_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2.5 text-right text-text-muted text-xs">
                  {formatSize(f.file.size)}
                </td>
                <td className="px-3 py-2.5 text-center">
                  <button
                    onClick={() => toggleInclude(i)}
                    className={[
                      'w-5 h-5 rounded-sm border flex items-center justify-center transition-colors',
                      f.included
                        ? 'bg-red-primary border-red-primary text-white'
                        : 'border-border-warm bg-bg-card hover:border-red-primary/40',
                    ].join(' ')}
                  >
                    {f.included && <Check size={11} strokeWidth={2} />}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer — summary + actions */}
      <div className="flex items-center justify-between px-5 pb-5">
        <p className="text-xs text-text-muted">
          {includedCount} / {files.length} 个文件将被上传
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-text-muted hover:text-text-main transition-colors"
          >
            取消
          </button>
          <button
            onClick={() => onConfirm(files.filter((f) => f.included), courseId, semester)}
            disabled={includedCount === 0 || !courseId}
            className="px-5 py-2 rounded-sm bg-red-primary text-white text-sm font-medium
                       hover:bg-red-dark transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            确认上传 ({includedCount} 个文件)
          </button>
        </div>
      </div>
    </div>
  )
}
