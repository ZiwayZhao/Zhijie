import { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, MessageCircle, BookOpen, Loader2, Wrench } from 'lucide-react'
import { fetchCourse, fetchMaterial, type CourseItem, type MaterialItem } from '@/lib/api'
import MaterialReader from '@/components/workbench/MaterialReader'
import AIToolPanel from '@/components/workbench/AIToolPanel'
import SocraticChat from '@/components/workbench/SocraticChat'
import TutorSidebar from '@/components/tutor/TutorSidebar'
import ErrorBoundary from '@/components/ErrorBoundary'
import { loadProfile } from '@/lib/student-model'
import { loadExamProfile } from '@/lib/exam-profile'
import type { ExamProfile } from '@/lib/exam-profile'
import type { MCQuestion } from '@/lib/api'

export default function WorkbenchPage() {
  const { id: courseId, mid } = useParams()

  const [material, setMaterial] = useState<MaterialItem | null>(null)
  const [course, setCourse] = useState<CourseItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [specialistMarkdown, setSpecialistMarkdown] = useState<string | null>(null)
  const [quizQuestions, setQuizQuestions] = useState<MCQuestion[]>([])
  const [activeTab, setActiveTab] = useState('original')
  const [showSocratic, setShowSocratic] = useState(false)
  const [currentModuleId, setCurrentModuleId] = useState<string | null>(null)
  const [currentModuleName, setCurrentModuleName] = useState<string | null>(null)
  const [sidebarTab, setSidebarTab] = useState<'tools' | 'tutor'>('tutor')
  const [examProfile, setExamProfile] = useState<ExamProfile | null>(null)

  useEffect(() => {
    const promises: Promise<void>[] = []
    if (courseId) {
      promises.push(
        fetchCourse(courseId).then((c) => setCourse(c)).catch(() => {})
      )
    }
    if (mid) {
      promises.push(
        fetchMaterial(mid).then((m) => setMaterial(m)).catch(() => {})
      )
    }
    Promise.all(promises).finally(() => setLoading(false))
  }, [courseId, mid])

  // Load saved exam profile
  useEffect(() => {
    if (courseId) {
      const saved = loadExamProfile(courseId)
      if (saved) setExamProfile(saved)
    }
  }, [courseId])

  const handleModuleSelect = useCallback((moduleId: string, moduleName: string, markdown: string) => {
    setSpecialistMarkdown(markdown)
    setActiveTab('specialist')
    setCurrentModuleId(moduleId)
    setCurrentModuleName(moduleName)
  }, [])

  const handleQuizReady = useCallback((questions: MCQuestion[]) => {
    setQuizQuestions(questions)
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 gap-2 text-text-muted">
        <Loader2 size={20} className="animate-spin" />
        <span className="text-sm">加载中...</span>
      </div>
    )
  }

  if (!material) {
    return (
      <div className="p-8 lg:p-10">
        <h1 className="font-heading text-2xl text-text-main">材料未找到</h1>
        <p className="text-text-muted mt-2">
          无法找到对应的学习材料。
        </p>
        <Link
          to={courseId ? `/course/${courseId}` : '/'}
          className="inline-flex items-center gap-1.5 mt-4 text-sm text-red-primary hover:underline"
        >
          <ArrowLeft size={14} strokeWidth={1.5} />
          返回课程
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col lg:flex-row min-h-0">
      {/* 70% Left — Material reader (journal page) */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.35 }}
        className="flex-[7] min-w-0 p-6 lg:py-10 lg:px-12 overflow-y-auto"
      >
        {/* Breadcrumb — editorial navigation */}
        <nav className="flex items-center gap-1.5 text-xs text-text-muted mb-8">
          <Link to="/" className="hover:text-text-body transition-colors no-underline text-text-muted">
            首页
          </Link>
          <span className="text-border-warm">/</span>
          {course && (
            <>
              <Link
                to={`/course/${course.slug}`}
                className="hover:text-text-body transition-colors no-underline text-text-muted"
              >
                {course.name}
              </Link>
              <span className="text-border-warm">/</span>
            </>
          )}
          <span className="text-text-body">{material.title || material.filename}</span>
        </nav>

        <ErrorBoundary>
          <MaterialReader
            material={material}
            courseName={course?.name}
            courseSchool={course?.school}
            specialistMarkdown={specialistMarkdown}
            quizQuestions={quizQuestions}
            activeTab={activeTab}
            onTabChange={setActiveTab}
          />
        </ErrorBoundary>

        {/* Socratic dialogue toggle — elegant editorial style */}
        {specialistMarkdown && currentModuleId && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.3 }}
            className="mt-8"
          >
            {showSocratic ? (
              <SocraticChat
                moduleId={currentModuleId}
                moduleName={currentModuleName || currentModuleId}
                mastery={loadProfile().modules[currentModuleId]?.mastery ?? 0.3}
                onClose={() => setShowSocratic(false)}
              />
            ) : (
              <button
                onClick={() => setShowSocratic(true)}
                className="group flex items-center gap-3 w-full py-4 px-5 border border-border-warm rounded-sm
                           bg-bg-card hover:border-red-primary transition-colors text-left"
              >
                <div className="w-8 h-8 flex items-center justify-center border border-border-warm
                                group-hover:border-red-primary transition-colors">
                  <MessageCircle size={15} strokeWidth={1.5} className="text-text-muted group-hover:text-red-primary transition-colors" />
                </div>
                <div>
                  <p className="text-sm font-medium text-text-main group-hover:text-red-primary transition-colors">
                    开启苏格拉底对话
                  </p>
                  <p className="text-xs text-text-muted mt-0.5">
                    通过提问引导深入理解概念
                  </p>
                </div>
                <BookOpen size={14} strokeWidth={1.5} className="ml-auto text-border-warm group-hover:text-red-primary transition-colors" />
              </button>
            )}
          </motion.div>
        )}

      </motion.div>

      {/* 30% Right — Sidebar with tab switch: Tools | Tutor */}
      <motion.aside
        initial={{ opacity: 0, x: 16 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.15, duration: 0.35 }}
        className="flex-[3] lg:min-w-[400px] border-l border-border-warm bg-bg-card
                   lg:sticky lg:top-0 lg:h-screen
                   max-lg:border-t max-lg:border-l-0
                   flex flex-col"
      >
        {/* Sidebar tab bar */}
        <div className="flex border-b border-border-warm px-5 pt-4 lg:px-6 lg:pt-5 shrink-0">
          <button
            onClick={() => setSidebarTab('tools')}
            className={`flex items-center gap-1.5 px-3 pb-2.5 text-sm transition-colors border-b-2 ${
              sidebarTab === 'tools'
                ? 'border-red-primary text-red-primary'
                : 'border-transparent text-text-muted hover:text-text-body'
            }`}
          >
            <Wrench size={14} strokeWidth={1.5} />
            分析工具
          </button>
          <button
            onClick={() => setSidebarTab('tutor')}
            className={`flex items-center gap-1.5 px-3 pb-2.5 text-sm transition-colors border-b-2 ${
              sidebarTab === 'tutor'
                ? 'border-red-primary text-red-primary'
                : 'border-transparent text-text-muted hover:text-text-body'
            }`}
          >
            <MessageCircle size={14} strokeWidth={1.5} />
            AI 助教
          </button>
        </div>

        {/* Tab content — visibility-based toggle preserves state + Framer Motion animations */}
        <div className="flex-1 min-h-0 relative">
          <div className={`absolute inset-0 overflow-y-auto p-5 lg:p-6 transition-opacity duration-150 ${sidebarTab === 'tools' ? 'opacity-100 z-10' : 'opacity-0 pointer-events-none z-0'}`}>
            <ErrorBoundary>
              <AIToolPanel
                materialId={material.id}
                courseId={courseId}
                courseName={course?.name}
                onModuleSelect={handleModuleSelect}
                onQuizReady={handleQuizReady}
              />
            </ErrorBoundary>
          </div>
          <div className={`absolute inset-0 overflow-y-auto p-5 lg:p-6 h-full transition-opacity duration-150 ${sidebarTab === 'tutor' ? 'opacity-100 z-10' : 'opacity-0 pointer-events-none z-0'}`}>
            <ErrorBoundary>
              <TutorSidebar
                materialId={material.id}
                moduleId={currentModuleId}
                onSpecialistView={(markdown, moduleName) => {
                  setSpecialistMarkdown(markdown)
                  setCurrentModuleName(moduleName)
                  setActiveTab('specialist')
                }}
                onQuizView={(questions) => {
                  setQuizQuestions(questions)
                  setActiveTab('quiz')
                }}
              />
            </ErrorBoundary>
          </div>
        </div>
      </motion.aside>
    </div>
  )
}
