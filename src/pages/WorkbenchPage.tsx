import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  ArrowLeft, Loader2, Wrench, MessageCircle, StickyNote,
  PanelRightClose, PanelRightOpen,
} from 'lucide-react'
import { Panel, Group, Separator } from 'react-resizable-panels'
import { fetchCourse, fetchMaterial, type CourseItem, type MaterialItem } from '@/lib/api'
import type { KnowledgeCardResult } from '@/lib/types/knowledge-card'
import MaterialReader from '@/components/workbench/MaterialReader'
import AIToolPanel from '@/components/workbench/AIToolPanel'
import TutorSidebar from '@/components/tutor/TutorSidebar'
import NotesPanel from '@/components/workbench/NotesPanel'
import ErrorBoundary from '@/components/ErrorBoundary'
import ToastContainer from '@/components/ui/ToastContainer'
import { showToast } from '@/lib/toast-store'
import type { MCQuestion } from '@/lib/api'

type SidebarTab = 'tools' | 'tutor' | 'notes'

const SIDEBAR_TABS: { key: SidebarTab; label: string; icon: typeof Wrench }[] = [
  { key: 'tools', label: '分析', icon: Wrench },
  { key: 'tutor', label: '助教', icon: MessageCircle },
  { key: 'notes', label: '笔记', icon: StickyNote },
]

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
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('tutor')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [pendingTutorMessage, setPendingTutorMessage] = useState<string | null>(null)

  // Keyboard shortcut: ] to toggle sidebar
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === ']' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const tag = (e.target as HTMLElement)?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return
        setSidebarCollapsed((prev) => !prev)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

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

  const handleModuleSelect = useCallback((
    moduleId: string,
    moduleName: string,
    markdown: string,
    concepts?: string[],
    traps?: string[],
  ) => {
    setCurrentModuleId(moduleId)
    setCurrentModuleName(moduleName)
    if (markdown && markdown.trim()) {
      setSpecialistMarkdown(markdown)
      setKeyConcepts(concepts ?? [])
      setExamTraps(traps ?? [])
      setActiveTab('specialist')
    } else {
      showToast(`模块「${moduleName}」暂无 AI 精讲内容`)
    }
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

  // Called from NotesPanel when user clicks AI explain on a highlight
  const handleAIExplain = useCallback((text: string) => {
    const prompt = `请解释以下从课件中选中的内容，帮我理解它的含义和重要性：\n\n「${text}」`
    setSidebarTab('tutor')
    setSidebarCollapsed(false)
    setPendingTutorMessage(prompt)
  }, [])

  const handleSwitchToTutor = useCallback((context?: string) => {
    setSidebarTab('tutor')
    setSidebarCollapsed(false)
    if (context) {
      showToast(`已切换到 AI 助教 — ${context}`)
    }
  }, [])

  const handleGenerateFlashcards = useCallback(() => {
    if (!specialistMarkdown || !currentModuleName) {
      showToast('请先选择一个模块查看 AI 精讲')
      return
    }
    const allItems = [...keyConcepts, ...examTraps]
    if (allItems.length === 0) {
      showToast('当前模块没有可提取的知识点')
      return
    }
    const cards = allItems.map((item) => ({
      id: crypto.randomUUID(),
      type: 'basic' as const,
      fields: { front: item, back: '(复习精讲内容)', extra: '' },
      tags: [courseId || 'unknown', currentModuleName],
      sourceRef: { materialId: material?.id || '', moduleId: currentModuleId || '' },
      createdAt: Date.now(),
      generatedBy: 'ai' as const,
    }))
    const deckKey = `zhijie_flashcards_${courseId || 'default'}`
    try {
      const existing = JSON.parse(localStorage.getItem(deckKey) || '[]')
      localStorage.setItem(deckKey, JSON.stringify([...existing, ...cards]))
    } catch {
      showToast('闪卡保存失败：存储空间不足')
      return
    }
    showToast(`已生成 ${cards.length} 张闪卡`)
  }, [specialistMarkdown, currentModuleName, keyConcepts, examTraps, courseId, material?.id, currentModuleId])

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
        <p className="text-text-muted mt-2">无法找到对应的学习材料。</p>
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
    <div className="h-[calc(100vh-3.5rem)] flex flex-col print:h-auto">
      {/* Compact toolbar */}
      <div className="flex items-center justify-between px-4 py-1.5 border-b border-border-warm bg-bg-card shrink-0 print:hidden">
        <nav className="flex items-center gap-1.5 text-[11px] text-text-muted min-w-0">
          <Link to="/" className="hover:text-text-body transition-colors no-underline text-text-muted shrink-0">
            首页
          </Link>
          {course && (
            <>
              <span className="text-border-warm">/</span>
              <Link
                to={`/course/${course.slug}`}
                className="hover:text-text-body transition-colors no-underline text-text-muted shrink-0 max-w-[120px] truncate"
              >
                {course.name}
              </Link>
            </>
          )}
          <span className="text-border-warm">/</span>
          <span className="text-text-body truncate max-w-[200px]">{material.title || material.filename}</span>
        </nav>

        <button
          onClick={() => setSidebarCollapsed((p) => !p)}
          className="p-1 text-text-muted hover:text-red-primary transition-colors rounded-sm hover:bg-bg-accent/60"
          title={sidebarCollapsed ? '展开面板 ]' : '收起面板 ]'}
        >
          {sidebarCollapsed ? <PanelRightOpen size={14} /> : <PanelRightClose size={14} />}
        </button>
      </div>

      {/* Main resizable panels */}
      <Group orientation="horizontal" className="flex-1 min-h-0" style={{ display: 'flex' }}>
        {/* Left: Material reader */}
        <Panel defaultSize="65%" minSize="40%" id="reader">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
            className="h-full overflow-y-auto p-4 lg:py-5 lg:px-6"
          >
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
          </motion.div>
        </Panel>

        {/* Resize handle */}
        {!sidebarCollapsed && (
          <Separator className="w-[5px] bg-transparent hover:bg-red-primary/20 active:bg-red-primary/30 transition-colors cursor-col-resize relative group">
            <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-border-warm group-hover:bg-red-primary/40 transition-colors" />
          </Separator>
        )}

        {/* Right: Sidebar */}
        {!sidebarCollapsed && (
          <Panel defaultSize="35%" minSize="25%" maxSize="50%" id="sidebar">
            <aside className="h-full flex flex-col bg-bg-card border-l border-border-warm">
              {/* Sidebar tab bar */}
              <div className="flex border-b border-border-warm shrink-0">
                {SIDEBAR_TABS.map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    onClick={() => setSidebarTab(key)}
                    className={`flex-1 flex items-center justify-center gap-1 py-2 text-[11px] transition-colors border-b-2 ${
                      sidebarTab === key
                        ? 'border-red-primary text-red-primary font-medium'
                        : 'border-transparent text-text-muted hover:text-text-body'
                    }`}
                  >
                    <Icon size={13} strokeWidth={1.5} />
                    {label}
                  </button>
                ))}
              </div>

              {/* Tab content — visibility toggle preserves state */}
              <div className="flex-1 min-h-0 relative">
                {/* Tools tab */}
                <div
                  className={`absolute inset-0 overflow-y-auto p-4 lg:p-5 transition-opacity duration-150 ${
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

                {/* Tutor tab */}
                <div
                  className={`absolute inset-0 overflow-y-auto transition-opacity duration-150 ${
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
                      pendingMessage={pendingTutorMessage}
                      onPendingMessageSent={() => setPendingTutorMessage(null)}
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

                {/* Notes tab */}
                <div
                  className={`absolute inset-0 overflow-y-auto p-4 lg:p-5 transition-opacity duration-150 ${
                    sidebarTab === 'notes'
                      ? 'opacity-100 z-20'
                      : 'opacity-0 pointer-events-none z-0 invisible'
                  }`}
                >
                  <ErrorBoundary>
                    <NotesPanel
                      materialId={material.id}
                      materialTitle={material.title || material.filename}
                      courseId={courseId}
                      courseName={course?.name}
                      onAIExplain={handleAIExplain}
                    />
                  </ErrorBoundary>
                </div>
              </div>
            </aside>
          </Panel>
        )}
      </Group>

      <ToastContainer />
    </div>
  )
}
