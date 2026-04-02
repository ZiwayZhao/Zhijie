import { useState, lazy, Suspense, useCallback } from 'react'
import { motion } from 'framer-motion'
import { FileText, Calendar, BookOpen, Loader2, Printer } from 'lucide-react'

const PdfAnnotator = lazy(() => import('./PdfAnnotator'))
const PerPageViewer = lazy(() => import('./PerPageViewer'))
const KnowledgeCardsTab = lazy(() => import('./KnowledgeCardsTab'))
const FormulaSheetTab = lazy(() => import('./FormulaSheetTab'))
import ErrorBoundary from '@/components/ErrorBoundary'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import remarkGfm from 'remark-gfm'
import rehypeKatex from 'rehype-katex'
import type { MaterialItem, MCQuestion } from '@/lib/api'
import type { QuestionItem } from '@/lib/types/question'
import type { KnowledgeCardResult } from '@/lib/types/knowledge-card'
import QuizPanel from '@/components/workbench/QuizPanel'
import QuizPanelV2 from '@/components/quiz/QuizPanelV2'
import { useQuizSession } from '@/hooks/useQuizSession'

/* ---------- Types ---------- */

interface MaterialReaderProps {
  material: MaterialItem
  courseId?: string
  courseName?: string
  courseSchool?: string
  specialistMarkdown?: string | null
  keyConcepts?: string[]
  examTraps?: string[]
  perPageMarkdown?: string | null
  knowledgeCards?: KnowledgeCardResult | null
  quizQuestions?: MCQuestion[]
  quizModuleFilter?: string | null
  onClearQuizFilter?: () => void
  activeTab?: string
  onTabChange?: (tab: string) => void
  onGenerateFlashcards?: () => void
}

/* ---------- Tabs ---------- */

interface TabDef {
  key: string
  label: string
  available: boolean
}

/* ---------- Markdown fixer ---------- */

function fixMarkdown(md: string): string {
  let fixed = md
  fixed = fixed.replace(/(\$\$[\s\S]*?\$\$)|(\$[^$\n]*?\$)/g, (match) => {
    if (match.indexOf('|') === -1) return match
    return match.replace(/\|/g, '\\vert')
  })
  fixed = fixed.replace(/^\s*\*\*\s*(#{1,6})\s*(.*?)\*\*\s*$/gm, '$1 $2')
  fixed = fixed.replace(/(^|\n)(#{1,6})\s+(?:#+\s+)+/g, '$1$2 ')
  fixed = fixed.replace(/^(#{1,6})(?=[^# \n])/gm, '$1 ')
  return fixed
}

/* ---------- V2 question detection ---------- */

/** Check if questions use the v2 multi-type format (have question_type field) */
function hasV2Questions(questions: MCQuestion[]): boolean {
  return questions.length > 0 && 'question_type' in questions[0]
}

/* ---------- Main Component ---------- */

export default function MaterialReader({
  material,
  courseId,
  courseName,
  courseSchool,
  specialistMarkdown,
  keyConcepts = [],
  examTraps = [],
  perPageMarkdown,
  knowledgeCards,
  quizQuestions,
  quizModuleFilter,
  onClearQuizFilter,
  activeTab: controlledTab,
  onTabChange,
  onGenerateFlashcards,
}: MaterialReaderProps) {
  const [internalTab, setInternalTab] = useState('original')
  const activeTab = controlledTab ?? internalTab
  const setActiveTab = onTabChange ?? setInternalTab

  // Mastery feedback loop: quiz answers → BKT → student model
  const { handleQuizComplete } = useQuizSession(courseId || material.id)

  const courseInfo = (courseName || courseSchool)
    ? { name: courseName || '', school: courseSchool || '' }
    : null
  const isPdf = material.contentType === 'application/pdf'
  const pdfUrl = isPdf && material.downloadUrl ? material.downloadUrl : null

  const hasQuiz = !!quizQuestions && quizQuestions.length > 0
  const hasPerPage = !!perPageMarkdown && perPageMarkdown.length > 0
  const hasKnowledgeCards = !!knowledgeCards && knowledgeCards.cards.length > 0
  const hasFormulaSheet = !!knowledgeCards && !!knowledgeCards.formula_sheet && knowledgeCards.formula_sheet.trim().length > 0
  const tabs: TabDef[] = [
    { key: 'original', label: '原文', available: true },
    { key: 'specialist', label: 'AI 精讲', available: !!specialistMarkdown },
    { key: 'per-page', label: '逐页精讲', available: hasPerPage },
    { key: 'knowledge-cards', label: '知识卡片', available: hasKnowledgeCards },
    { key: 'formula-sheet', label: '公式速查', available: hasFormulaSheet },
    { key: 'quiz', label: `自测验${hasQuiz ? ` (${quizQuestions!.length})` : ''}`, available: hasQuiz },
  ]

  const canExport = !!specialistMarkdown || hasQuiz
  const handleExport = useCallback(() => {
    // Print current tab content using browser print
    window.print()
  }, [])

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="space-y-6 print:space-y-4"
    >
      {/* Material header */}
      <MaterialHeader material={material} courseInfo={courseInfo} />

      {/* Tab bar */}
      <div className="flex items-center justify-between">
        <TabBar tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />
        {canExport && (
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-muted
                       border border-border-warm rounded-sm
                       hover:border-red-primary hover:text-red-primary transition-colors
                       print:hidden shrink-0 ml-3"
          >
            <Printer size={12} strokeWidth={1.5} />
            导出打印
          </button>
        )}
      </div>

      {/* Tab content */}
      {activeTab === 'original' && (
        <OriginalContent isPdf={isPdf} pdfUrl={pdfUrl} materialId={material.id} />
      )}
      {activeTab === 'specialist' && specialistMarkdown && (
        <div className="space-y-6">
          {/* Key concepts + exam traps summary */}
          {(keyConcepts.length > 0 || examTraps.length > 0) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 print:grid-cols-2">
              {keyConcepts.length > 0 && (
                <div className="border border-border-warm rounded-sm p-4 bg-bg-accent/30">
                  <h4 className="text-xs font-medium text-text-main uppercase tracking-wider mb-2.5">
                    核心知识点
                  </h4>
                  <ul className="space-y-1.5">
                    {keyConcepts.map((kp, i) => (
                      <li key={i} className="text-sm text-text-body flex items-start gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-primary mt-1.5 shrink-0" />
                        <span className="inline-math-wrap">
                          <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}
                            components={{ p: ({ children }) => <>{children}</> }}>
                            {kp}
                          </ReactMarkdown>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {examTraps.length > 0 && (
                <div className="border border-accent-gold/30 rounded-sm p-4 bg-accent-gold/5">
                  <h4 className="text-xs font-medium text-accent-gold uppercase tracking-wider mb-2.5">
                    考试陷阱
                  </h4>
                  <ul className="space-y-1.5">
                    {examTraps.map((trap, i) => (
                      <li key={i} className="text-sm text-text-body flex items-start gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-accent-gold mt-1.5 shrink-0" />
                        <span className="inline-math-wrap">
                          <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}
                            components={{ p: ({ children }) => <>{children}</> }}>
                            {trap}
                          </ReactMarkdown>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div className="prose-academic">
            <ReactMarkdown
              remarkPlugins={[remarkMath, remarkGfm]}
              rehypePlugins={[rehypeKatex]}
              components={mdComponents}
            >
              {fixMarkdown(specialistMarkdown)}
            </ReactMarkdown>
          </div>
        </div>
      )}
      {activeTab === 'per-page' && hasPerPage && pdfUrl && (
        <div className="min-h-[500px]">
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-[400px]">
                <Loader2 size={20} className="animate-spin text-red-primary/60" />
              </div>
            }
          >
            <PerPageViewer
              pdfSource={pdfUrl}
              lectureMarkdown={perPageMarkdown!}
              title={material.title}
            />
          </Suspense>
        </div>
      )}
      {activeTab === 'knowledge-cards' && hasKnowledgeCards && (
        <Suspense
          fallback={
            <div className="flex items-center justify-center h-[200px]">
              <Loader2 size={20} className="animate-spin text-red-primary/60" />
            </div>
          }
        >
          <KnowledgeCardsTab
            cards={knowledgeCards!.cards}
            errorTaxonomy={knowledgeCards!.error_taxonomy}
          />
        </Suspense>
      )}
      {activeTab === 'formula-sheet' && hasFormulaSheet && (
        <Suspense
          fallback={
            <div className="flex items-center justify-center h-[200px]">
              <Loader2 size={20} className="animate-spin text-red-primary/60" />
            </div>
          }
        >
          <FormulaSheetTab formulaSheet={knowledgeCards!.formula_sheet} />
        </Suspense>
      )}
      {activeTab === 'quiz' && hasQuiz && (
        <>
          {quizModuleFilter && onClearQuizFilter && (
            <div className="flex items-center gap-2 mb-3 text-xs text-text-muted">
              <span>当前筛选：<span className="text-text-body font-medium">{quizModuleFilter}</span></span>
              <button
                onClick={onClearQuizFilter}
                className="px-2 py-0.5 border border-border-warm rounded-sm hover:border-red-primary transition-colors text-text-muted hover:text-red-primary"
              >
                显示全部
              </button>
            </div>
          )}
          {hasV2Questions(quizQuestions!) ? (
            <QuizPanelV2
              questions={quizQuestions! as QuestionItem[]}
              onGenerateFlashcards={onGenerateFlashcards}
              onQuizComplete={handleQuizComplete}
            />
          ) : (
            <QuizPanel
              questions={quizQuestions!}
              onGenerateFlashcards={onGenerateFlashcards}
              onQuizComplete={handleQuizComplete}
            />
          )}
        </>
      )}
    </motion.article>
  )
}

/* ---------- Sub-components ---------- */

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function MaterialHeader({
  material,
  courseInfo,
}: {
  material: MaterialItem
  courseInfo: { name: string; school: string } | null
}) {
  return (
    <header className="border-b border-border-warm pb-8">
      {/* Type badge */}
      <span className="inline-block px-2.5 py-0.5 text-[11px] border border-red-primary text-red-primary mb-3">
        {material.materialType || 'PDF'}
      </span>

      <h1 className="font-heading text-3xl text-text-main leading-snug">
        {material.title || material.filename}
      </h1>

      {/* Thin red accent */}
      <div className="w-10 h-px bg-red-primary mt-3 mb-4" />

      <div className="flex flex-wrap items-center gap-4 text-sm text-text-muted">
        <span className="flex items-center gap-1.5">
          <Calendar size={13} strokeWidth={1.5} />
          {new Date(material.createdAt).toLocaleDateString()}
        </span>
        <span className="flex items-center gap-1.5">
          <FileText size={13} strokeWidth={1.5} />
          {formatFileSize(material.fileSize)}
        </span>
        {courseInfo && (
          <span className="flex items-center gap-1.5 italic">
            <BookOpen size={13} strokeWidth={1.5} />
            {courseInfo.name}{courseInfo.school ? ` — ${courseInfo.school}` : ''}
          </span>
        )}
      </div>
    </header>
  )
}

function TabBar({
  tabs,
  activeTab,
  onTabChange,
}: {
  tabs: TabDef[]
  activeTab: string
  onTabChange: (key: string) => void
}) {
  return (
    <nav className="flex gap-0 border-b border-border-warm">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => tab.available && onTabChange(tab.key)}
          disabled={!tab.available}
          className={[
            'px-5 py-2.5 text-sm transition-colors relative -mb-px font-body',
            activeTab === tab.key
              ? 'text-red-primary border-b-2 border-b-red-primary font-medium'
              : tab.available
                ? 'text-text-muted hover:text-text-body border-b-2 border-transparent'
                : 'text-text-muted/40 cursor-not-allowed border-b-2 border-transparent',
          ].join(' ')}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  )
}

function OriginalContent({
  isPdf,
  pdfUrl,
  materialId,
}: {
  isPdf: boolean
  pdfUrl: string | null
  materialId: string
}) {
  if (isPdf && pdfUrl) {
    return (
      <ErrorBoundary>
        <Suspense
          fallback={
            <div className="flex items-center justify-center h-[80vh] gap-2 text-text-muted">
              <Loader2 size={20} className="animate-spin" />
              <span className="text-sm">加载 PDF 阅读器...</span>
            </div>
          }
        >
          <PdfAnnotator pdfUrl={pdfUrl} materialId={materialId} />
        </Suspense>
      </ErrorBoundary>
    )
  }

  return (
    <div className="flex items-center justify-center h-64 text-text-muted">
      <p className="text-sm">此文件类型暂不支持在线预览</p>
    </div>
  )
}

/* ---------- Markdown components ---------- */

const mdComponents = {
  h1: ({ children, ...props }: React.ComponentPropsWithoutRef<'h1'>) => (
    <h1 className="font-heading text-2xl text-text-main mt-8 mb-4 pb-2 border-b border-border-warm" {...props}>
      {children}
    </h1>
  ),
  h2: ({ children, ...props }: React.ComponentPropsWithoutRef<'h2'>) => (
    <h2 className="font-heading text-xl text-text-main mt-8 mb-3 pl-3 border-l-3 border-l-red-primary" {...props}>
      {children}
    </h2>
  ),
  h3: ({ children, ...props }: React.ComponentPropsWithoutRef<'h3'>) => (
    <h3 className="font-heading text-lg text-text-main mt-6 mb-2" {...props}>
      {children}
    </h3>
  ),
  p: ({ children, ...props }: React.ComponentPropsWithoutRef<'p'>) => (
    <p className="text-[15px] text-text-body leading-relaxed mb-4" {...props}>
      {children}
    </p>
  ),
  ul: ({ children, ...props }: React.ComponentPropsWithoutRef<'ul'>) => (
    <ul className="list-disc pl-5 space-y-1.5 text-[15px] text-text-body mb-4" {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, ...props }: React.ComponentPropsWithoutRef<'ol'>) => (
    <ol className="list-decimal pl-5 space-y-1.5 text-[15px] text-text-body mb-4" {...props}>
      {children}
    </ol>
  ),
  blockquote: ({ children, ...props }: React.ComponentPropsWithoutRef<'blockquote'>) => (
    <blockquote
      className="border-l-3 border-l-red-primary bg-bg-accent pl-4 py-3 my-4 italic text-text-body"
      {...props}
    >
      {children}
    </blockquote>
  ),
  table: ({ children, ...props }: React.ComponentPropsWithoutRef<'table'>) => (
    <div className="overflow-x-auto my-4">
      <table className="w-full text-sm border border-border-warm" {...props}>
        {children}
      </table>
    </div>
  ),
  th: ({ children, ...props }: React.ComponentPropsWithoutRef<'th'>) => (
    <th className="px-3 py-2 text-left font-medium text-text-main bg-bg-accent border border-border-warm" {...props}>
      {children}
    </th>
  ),
  td: ({ children, ...props }: React.ComponentPropsWithoutRef<'td'>) => (
    <td className="px-3 py-2 text-text-body border border-border-warm" {...props}>
      {children}
    </td>
  ),
  code: ({ children, className, ...props }: React.ComponentPropsWithoutRef<'code'> & { className?: string }) => {
    const isBlock = className?.startsWith('language-')
    if (isBlock) {
      return (
        <code
          className="block bg-text-main text-bg-main p-4 rounded-sm overflow-x-auto text-sm font-mono my-4"
          {...props}
        >
          {children}
        </code>
      )
    }
    return (
      <code className="px-1.5 py-0.5 text-sm bg-bg-accent text-red-primary border border-border-warm rounded-sm font-mono" {...props}>
        {children}
      </code>
    )
  },
  pre: ({ children, ...props }: React.ComponentPropsWithoutRef<'pre'>) => (
    <pre className="my-4" {...props}>{children}</pre>
  ),
  strong: ({ children, ...props }: React.ComponentPropsWithoutRef<'strong'>) => (
    <strong className="font-semibold text-text-main" {...props}>{children}</strong>
  ),
}
