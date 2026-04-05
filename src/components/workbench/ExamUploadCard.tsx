/**
 * ExamUploadCard — drag-and-drop upload for past exam PDFs/images,
 * triggers backend analysis, displays detected question distribution.
 */

import { useState, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Upload, FileUp, Check, AlertCircle, Loader2 } from 'lucide-react'
import { authFetch } from '@/lib/auth-api'
import type { ExamProfile } from '@/lib/exam-profile'

export type { ExamProfile }

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8003/api'
const AUTH_API = `${API_BASE}/v1`

const MAX_SIZE_MB = 20
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024
const ACCEPTED = '.pdf,.png,.jpg,.jpeg,.webp'

interface ExamUploadCardProps {
  courseId: string
  materialId: string
  onProfileDetected: (profile: ExamProfile) => void
}

const TYPE_LABELS: Record<string, string> = {
  mcq: '选择题',
  fill_blank: '填空题',
  true_false: '判断题',
  short_answer: '简答题',
  calculation: '计算题',
  essay: '论述题',
}

type Phase = 'idle' | 'uploading' | 'analyzing' | 'done' | 'error'

export default function ExamUploadCard({
  courseId,
  onProfileDetected,
}: ExamUploadCardProps) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [profile, setProfile] = useState<ExamProfile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback(
    async (file: File) => {
      // Validate
      if (file.size > MAX_SIZE_BYTES) {
        setError(`文件过大 (${(file.size / 1024 / 1024).toFixed(1)} MB)，最大 ${MAX_SIZE_MB} MB`)
        setPhase('error')
        return
      }

      setError(null)
      setPhase('uploading')

      try {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('course_id', courseId)

        setPhase('analyzing')

        const res = await authFetch(`${AUTH_API}/exam/upload-past-exam`, {
          method: 'POST',
          body: formData,
        })

        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: '上传失败' }))
          throw new Error(err.detail || `上传失败: ${res.status}`)
        }

        const data = await res.json()
        const detected: ExamProfile = data.profile
        setProfile(detected)
        setPhase('done')
      } catch (e) {
        setError(e instanceof Error ? e.message : '分析失败')
        setPhase('error')
      }
    },
    [courseId],
  )

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      const file = e.dataTransfer.files[0]
      if (file) handleFile(file)
    },
    [handleFile],
  )

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) handleFile(file)
      e.target.value = ''
    },
    [handleFile],
  )

  const confirmProfile = useCallback(() => {
    if (profile) {
      onProfileDetected(profile)
    }
  }, [profile, onProfileDetected])

  const reset = useCallback(() => {
    setPhase('idle')
    setProfile(null)
    setError(null)
  }, [])

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="border border-border-warm rounded-sm bg-bg-card"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-border-warm">
        <h4 className="text-sm font-medium text-text-main">
          历年真题分析
        </h4>
        <p className="text-xs text-text-muted mt-0.5">
          上传真题试卷，AI 自动识别题型分布
        </p>
      </div>

      <div className="p-4">
        <AnimatePresence mode="wait">
          {/* Idle: Drop Zone */}
          {phase === 'idle' && (
            <motion.div
              key="idle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
              onDragLeave={(e) => { e.preventDefault(); setIsDragging(false) }}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
              className={[
                'cursor-pointer rounded-sm border border-dashed py-6 px-4 text-center transition-all',
                isDragging
                  ? 'border-red-primary bg-bg-accent'
                  : 'border-border-warm hover:border-red-primary/40',
              ].join(' ')}
            >
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPTED}
                onChange={onInputChange}
                className="hidden"
              />
              <div className="flex flex-col items-center gap-2">
                {isDragging ? (
                  <FileUp size={20} className="text-red-primary" />
                ) : (
                  <Upload size={20} className="text-text-muted" />
                )}
                <p className="text-xs text-text-body">
                  {isDragging ? '松开上传' : '拖拽真题 PDF/图片，或点击选择'}
                </p>
                <span className="text-[10px] text-text-muted">
                  支持 PDF / PNG / JPG，最大 {MAX_SIZE_MB} MB
                </span>
              </div>
            </motion.div>
          )}

          {/* Uploading / Analyzing */}
          {(phase === 'uploading' || phase === 'analyzing') && (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-3 py-8"
            >
              <Loader2 size={24} className="text-red-primary animate-spin" />
              <p className="text-xs text-text-body">
                {phase === 'uploading' ? '上传中...' : '分析试卷题型中...'}
              </p>
            </motion.div>
          )}

          {/* Error */}
          {phase === 'error' && (
            <motion.div
              key="error"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-3 py-6"
            >
              <AlertCircle size={20} className="text-red-500" />
              <p className="text-xs text-red-600 text-center">{error}</p>
              <button
                onClick={reset}
                className="text-xs text-red-primary hover:underline"
              >
                重新上传
              </button>
            </motion.div>
          )}

          {/* Done: Show Results */}
          {phase === 'done' && profile && (
            <motion.div
              key="done"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-3"
            >
              {/* Meta info */}
              <div className="flex items-center gap-2 text-xs text-text-muted">
                <Check size={14} className="text-green-600" />
                <span>识别完成</span>
                {profile.duration_minutes && (
                  <span className="ml-auto">{profile.duration_minutes} 分钟</span>
                )}
                {profile.is_open_book != null && (
                  <span>{profile.is_open_book ? '开卷' : '闭卷'}</span>
                )}
              </div>

              {/* Distribution table */}
              <div className="border border-border-warm rounded-sm overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-bg-main">
                      <th className="text-left px-3 py-1.5 text-text-muted font-normal">题型</th>
                      <th className="text-center px-2 py-1.5 text-text-muted font-normal">题量</th>
                      <th className="text-center px-2 py-1.5 text-text-muted font-normal">每题</th>
                      <th className="text-right px-3 py-1.5 text-text-muted font-normal">小计</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profile.question_distribution.map((qt, i) => (
                      <tr key={i} className="border-t border-border-warm">
                        <td className="px-3 py-1.5 text-text-body">
                          {TYPE_LABELS[qt.question_type] || qt.question_type}
                        </td>
                        <td className="text-center px-2 py-1.5 text-text-body">{qt.count}</td>
                        <td className="text-center px-2 py-1.5 text-text-body">{qt.points_each}</td>
                        <td className="text-right px-3 py-1.5 text-text-body font-medium">
                          {qt.total_points}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-border-warm bg-bg-main">
                      <td className="px-3 py-1.5 text-text-main font-medium">合计</td>
                      <td colSpan={2} />
                      <td className="text-right px-3 py-1.5 text-text-main font-medium">
                        {profile.total_points}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                <button
                  onClick={confirmProfile}
                  className="flex-1 py-1.5 text-xs font-medium text-white bg-red-primary
                             rounded-sm hover:bg-red-dark transition-colors"
                >
                  确认使用
                </button>
                <button
                  onClick={reset}
                  className="px-3 py-1.5 text-xs text-text-muted border border-border-warm
                             rounded-sm hover:border-red-primary/40 transition-colors"
                >
                  重新上传
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}
