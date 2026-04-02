import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, MessageCircle, Loader2, Wrench } from 'lucide-react'
import { fetchCourse, fetchMaterial, type CourseItem, type MaterialItem } from '@/lib/api'
import type { KnowledgeCardResult } from '@/lib/types/knowledge-card'
import MaterialReader from '@/components/workbench/MaterialReader'
import AIToolPanel from '@/components/workbench/AIToolPanel'
import TutorSidebar from '@/components/tutor/TutorSidebar'
import ErrorBoundary from '@/components/ErrorBoundary'
import ToastContainer from '@/components/ui/ToastContainer'
import { showToast } from '@/lib/toast-store'
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
  const [keyConcepts, setKeyConcepts] = useState<string[]>([])
  const [examTraps, setExamTraps] = useState<string[]>([])
  const [quizQuestions, setQuizQuestions] = useState<MCQuestion[]>([])
  const [quizModuleFilter, setQuizModuleFilter] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState('original')
  const [currentModuleId, setCurrentModuleId] = useState<string | null>(null)
  const [currentModuleName, setCurrentModuleName] = useState<string | null>(null)
  const [knowledgeCards, setKnowledgeCards] = useState<KnowledgeCardResult | null>(null)
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

  const handleModuleSelect = useCallback((
    moduleId: string,
    moduleName: string,
    markdown: string,
    concepts?: string[],
    traps?: string[],
  ) => {
    setSpecialistMarkdown(markdown)
    setKeyConcepts(concepts ?? [])
    setExamTraps(traps ?? [])
    setActiveTab('specialist')
    setCurrentModuleId(moduleId)
    setCurrentModuleName(moduleName)
  }, [])

  const handleQuizReady = useCallback((questions: MCQuestion[]) => {
    setQuizQuestions(questions)
    if (questions.length > 0) {
      showToast(`测验已生成（${questions.length} 题），切换到自测验标签查看`)
    }
  }, [])

  const handleKnowledgeCardsReady = useCallback((data: KnowledgeCardResult) => {
    setKnowledgeCards(data)
  }, [])

  // Switch sidebar to Tutor tab (triggered by qa tool click)
  const handleSwitchToTutor = useCallback((context?: string) => {
    setSidebarTab('tutor')
    if (context) {
      showToast(`已切换到 AI 助教 — ${context}`)
    }
  }, [])

  // Generate flashcards from current specialist content
  const handleGenerateFlashcards = useCallback(() => {
    if (!specialistMarkdown || !currentModuleName) {
      showToast('请先选择一个模块查看 AI 精讲')
      return
    }

    const concepts = keyConcepts.length > 0 ? keyConcepts : []
    const traps = examTraps.length > 0 ? examTraps : []
    const allItems = [...concepts, ...traps]

    if (allItems.length === 0) {
      showToast('当前模块没有可提取的知识点')
      return
    }

    const cards = allItems.map((item, _i) => ({
      id: crypto.randomUUID(),
      type: 'basic' as const,
      fields: {
        front: item,
        back: '(复习精讲内容)',
        extra: '',
      },
      tags: [courseId || 'unknown', currentModuleName],
      sourceRef: {
        materialId: material?.id || '',
        moduleId: currentModuleId || '',
      },
      createdAt: Date.now(),
      generatedBy: 'ai' as const,
    }))

    const deckKey = `zhijie_flashcards_${courseId || 'default'}`
    try {
      const existing = JSON.parse(localStorage.getItem(deckKey) || '[]')
      localStorage.setItem(deckKey, JSON.stringify([...existing, ...cards]))
    } catch {
      // localStorage quota exceeded
      showToast('闪卡保存失败：存储空间不足')
      return
    }

    showToast(`已生成 ${cards.length} 张闪卡`)
  }, [specialistMarkdown, currentModuleName, keyConcepts, examTraps, courseId, material?.id, currentModuleId])

  // Handle module quiz from manual tool (filter questions and switch to quiz tab)
  const handleModuleQuizFromTool = useCallback((_moduleId: string, moduleName: string) => {
    const count = quizQuestions.filter((q) => q.source_module_name === moduleName).length
    if (count > 0) {
      setQuizModuleFilter(moduleName)
      setActiveTab('quiz')
      showToast(`已筛选 ${count} 道「${moduleName}」测验题`)
    } else {
      showToast('当前模块暂无测验题，请先完成课件分析')
    }
  }, [quizQuestions])

  // Filter quiz questions by module when a filter is active, without losing the full set
  const displayedQuizQuestions = useMemo(() => {
    if (!quizModuleFilter) return quizQuestions
    return quizQuestions.filter((q) => q.source_module_name === quizModuleFilter)
  }, [quizQuestions, quizModuleFilter])

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
        className="flex-[7] min-w-0 p-6 lg:py-10 lg:px-12 overflow-y-auto print:flex-[1] print:p-0"
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
            courseId={courseId}
            courseName={course?.name}
            courseSchool={course?.school}
            specialistMarkdown={specialistMarkdown}
            keyConcepts={keyConcepts}
            examTraps={examTraps}
            knowledgeCards={knowledgeCards}
            quizQuestions={displayedQuizQuestions}
            quizModuleFilter={quizModuleFilter}
            onClearQuizFilter={() => setQuizModuleFilter(null)}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            onGenerateFlashcards={handleGenerateFlashcards}
          />
        </ErrorBoundary>

        {/* CTA: switch to AI Tutor tab for Socratic dialogue */}
        {specialistMarkdown && currentModuleId && sidebarTab !== 'tutor' && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.3 }}
            className="mt-8"
          >
            <button
              onClick={() => setSidebarTab('tutor')}
              className="group flex items-center gap-3 w-full py-4 px-5 border border-border-warm rounded-sm
                         bg-bg-card hover:border-red-primary transition-colors text-left"
            >
              <div className="w-8 h-8 flex items-center justify-center border border-border-warm
                              group-hover:border-red-primary transition-colors">
                <MessageCircle size={15} strokeWidth={1.5} className="text-text-muted group-hover:text-red-primary transition-colors" />
              </div>
              <div>
                <p className="text-sm font-medium text-text-main group-hover:text-red-primary transition-colors">
                  向 AI 助教提问
                </p>
                <p className="text-xs text-text-muted mt-0.5">
                  AI 助教用苏格拉底式提问引导你深入理解
                </p>
              </div>
            </button>
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
                   flex flex-col print:hidden"
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

        {/* Tab content — visibility-based toggle preserves state.
             The active panel gets z-20 to sit clearly above the hidden one (z-0).
             Hidden panel uses pointer-events-none + visibility-hidden after opacity
             transition to ensure no ghost click interception. */}
        <div className="flex-1 min-h-0 relative">
          <div
            className={`absolute inset-0 overflow-y-auto p-5 lg:p-6 transition-opacity duration-150 ${
              sidebarTab === 'tools'
                ? 'opacity-100 z-20'
                : 'opacity-0 pointer-events-none z-0 invisible'
            }`}
          >
            <ErrorBoundary>
              <AIToolPanel
                materialId={material.id}
                courseId={courseId}
                courseName={course?.name}
                specialistMarkdown={specialistMarkdown}
                currentModuleName={currentModuleName}
                quizQuestions={quizQuestions}
                onModuleSelect={handleModuleSelect}
                onQuizReady={handleQuizReady}
                onKnowledgeCardsReady={handleKnowledgeCardsReady}
                onModuleQuiz={(_modId, modName) => {
                  setQuizModuleFilter(modName)
                  setActiveTab('quiz')
                }}
                onSwitchToTutor={handleSwitchToTutor}
                onGenerateFlashcards={handleGenerateFlashcards}
              />
            </ErrorBoundary>
          </div>
          <div
            className={`absolute inset-0 overflow-y-auto p-5 lg:p-6 transition-opacity duration-150 ${
              sidebarTab === 'tutor'
                ? 'opacity-100 z-20'
                : 'opacity-0 pointer-events-none z-0 invisible'
            }`}
          >
            <ErrorBoundary>
              <TutorSidebar
                materialId={material.id}
                moduleId={currentModuleId}
                moduleName={currentModuleName}
                courseId={courseId}
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

      <ToastContainer />
    </div>
  )
}
