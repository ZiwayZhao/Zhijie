import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Sparkles, ChevronDown, Loader2, Plus } from 'lucide-react'
import { fetchCourses, createCourse, type CourseItem } from '@/lib/api'

export interface ClassifyData {
  courseId: string
  materialType: string
  semester: string
  tags: string[]
  description: string
}

interface ClassifyFormProps {
  fileCount: number
  onSubmit: (data: ClassifyData) => void
}

const materialTypes = ['课件', '习题', '笔记', '考题', '其他'] as const
const semesters = ['2025/26 WS', '2025 SS', '2024/25 WS', '2024 SS', '其他']

/** Mock AI-suggested tags */
const aiSuggestedTags = ['期中重点', '课堂笔记', '公式推导']

export default function ClassifyForm({ fileCount, onSubmit }: ClassifyFormProps) {
  const [courseId, setCourseId] = useState('')
  const [materialType, setMaterialType] = useState('')
  const [semester, setSemester] = useState(semesters[0])
  const [tags, setTags] = useState<string[]>(aiSuggestedTags)
  const [description, setDescription] = useState('')
  const [tagInput, setTagInput] = useState('')

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
      // Stay in creation mode so user can retry
    } finally {
      setCreateLoading(false)
    }
  }

  function handleRemoveTag(tag: string) {
    setTags(tags.filter((t) => t !== tag))
  }

  function handleAddTag() {
    const trimmed = tagInput.trim()
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed])
    }
    setTagInput('')
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAddTag()
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15, duration: 0.35 }}
      className="space-y-6 border border-border-warm rounded-sm bg-bg-card p-6"
    >
      {/* Header */}
      <div>
        <span className="text-[10px] tracking-widest uppercase text-text-muted font-body">
          Classification
        </span>
        <div className="flex items-center gap-2 mt-0.5">
          <h3 className="font-heading text-xl text-text-main">
            材料归类
          </h3>
          <span className="text-xs text-text-muted italic">({fileCount} 个文件)</span>
        </div>
        <div className="w-8 h-px bg-red-primary mt-2" />
      </div>

      {/* Course select */}
      <Field label="所属课程">
        {isCreating ? (
          <div className="space-y-2">
            <input
              type="text"
              value={newCourseName}
              onChange={(e) => setNewCourseName(e.target.value)}
              placeholder="课程名称（如：离散数学）"
              className="input-field"
              autoFocus
            />
            <input
              type="text"
              value={newCourseSchool}
              onChange={(e) => setNewCourseSchool(e.target.value)}
              placeholder="学校（可选，如：TUM）"
              className="input-field"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={handleCreateCourse}
                disabled={!newCourseName.trim() || createLoading}
                className="px-3 py-1.5 text-xs rounded-sm bg-red-primary text-white
                           hover:bg-red-dark transition-colors disabled:opacity-40"
              >
                {createLoading ? '创建中...' : '创建课程'}
              </button>
              <button
                onClick={() => setIsCreating(false)}
                className="px-3 py-1.5 text-xs text-text-muted hover:text-text-body transition-colors"
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
              placeholder="搜索课程名称..."
              className="input-field mb-2"
            />
            <div className="relative">
              {courseLoading ? (
                <div className="flex items-center gap-2 py-2 text-text-muted text-sm">
                  <Loader2 size={14} className="animate-spin" />
                  加载课程列表...
                </div>
              ) : (
                <>
                  <select
                    value={courseId}
                    onChange={(e) => setCourseId(e.target.value)}
                    className="input-field appearance-none pr-8"
                  >
                    <option value="">选择课程...</option>
                    {filteredCourses.map((c) => (
                      <option key={c.courseUuid} value={c.courseUuid}>
                        {c.name}{c.school ? ` — ${c.school}` : ''}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    size={14}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
                  />
                </>
              )}
            </div>
            <button
              onClick={() => setIsCreating(true)}
              className="mt-2 flex items-center gap-1 text-xs text-text-muted hover:text-red-primary transition-colors"
            >
              <Plus size={12} strokeWidth={1.5} />
              找不到？新建课程
            </button>
          </>
        )}
      </Field>

      {/* AI suggested tags */}
      <Field label="分类标签">
        <div className="flex flex-wrap gap-2 mb-2">
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs border border-accent-gold/40 bg-accent-gold/10 text-accent-gold"
            >
              <Sparkles size={10} strokeWidth={1.5} />
              {tag}
              <button
                onClick={() => handleRemoveTag(tag)}
                className="ml-0.5 hover:text-red-primary transition-colors"
              >
                &times;
              </button>
            </span>
          ))}
        </div>
        <input
          type="text"
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入标签后按回车添加..."
          className="input-field"
        />
      </Field>

      {/* Material type — editorial tab-like selection */}
      <Field label="材料类型">
        <div className="flex flex-wrap gap-2">
          {materialTypes.map((t) => (
            <button
              key={t}
              onClick={() => setMaterialType(t)}
              className={[
                'px-4 py-1.5 text-sm rounded-sm border transition-colors',
                materialType === t
                  ? 'border-red-primary bg-red-primary text-white'
                  : 'border-border-warm text-text-body hover:border-red-primary hover:text-red-primary',
              ].join(' ')}
            >
              {t}
            </button>
          ))}
        </div>
      </Field>

      {/* Semester */}
      <Field label="学期">
        <div className="relative">
          <select
            value={semester}
            onChange={(e) => setSemester(e.target.value)}
            className="input-field appearance-none pr-8"
          >
            {semesters.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <ChevronDown
            size={14}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
          />
        </div>
      </Field>

      {/* Description */}
      <Field label="描述（可选）">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="简要描述材料内容..."
          className="input-field resize-none"
        />
      </Field>

      {/* Submit — editorial red button */}
      <button
        onClick={() => onSubmit({ courseId, materialType, semester, tags, description })}
        disabled={!courseId || !materialType}
        className="w-full py-3 rounded-sm bg-red-primary text-white text-sm font-medium
                   hover:bg-red-dark transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        上传并发布
      </button>
    </motion.div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-text-main">{label}</label>
      {children}
    </div>
  )
}
