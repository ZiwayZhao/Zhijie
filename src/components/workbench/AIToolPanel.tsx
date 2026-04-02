/**
 * AIToolPanel — orchestrator component for the AI learning tools.
 * State machine logic extracted to useAIToolPanel hook (useReducer pattern).
 * This component handles only rendering, delegating to sub-components:
 *   - IntentGatherer (idle + gathering phases)
 *   - ExamInfoCard + ExamUploadCard (exam-setup phase)
 *   - ProcessingView (processing phase)
 *   - ModuleDisplay (complete + error phases + manual tools)
 *   - LearningPlanPreview (plan-preview phase)
 */
import { motion, AnimatePresence } from 'framer-motion'
import type { MCQuestion } from '@/lib/api'
import LearningPlanPreview from '@/components/intent/LearningPlanPreview'
import { IdlePhase, GatheringPhase } from '@/components/workbench/IntentGatherer'
import ProcessingView from '@/components/workbench/ProcessingView'
import { CompletePhase, ErrorPhase, ManualToolSection } from '@/components/workbench/ModuleDisplay'
import ToolResultDisplay from '@/components/workbench/ToolResultDisplay'
import ExamInfoCard from '@/components/workbench/ExamInfoCard'
import ExamUploadCard from '@/components/workbench/ExamUploadCard'
import { useAIToolPanel } from '@/hooks/useAIToolPanel'

/* ---------- Types ---------- */

interface AIToolPanelProps {
  materialId: string
  courseId?: string
  courseName?: string
  specialistMarkdown?: string | null
  currentModuleName?: string | null
  quizQuestions?: MCQuestion[]
  onModuleSelect?: (moduleId: string, moduleName: string, markdown: string, keyConcepts?: string[], examTraps?: string[]) => void
  onQuizReady?: (questions: MCQuestion[]) => void
  onKnowledgeCardsReady?: (data: import('@/lib/types/knowledge-card').KnowledgeCardResult) => void
  onModuleQuiz?: (moduleId: string, moduleName: string) => void
  onSwitchToTutor?: (context?: string) => void
  onGenerateFlashcards?: () => void
}

/* ---------- Main Component ---------- */

export default function AIToolPanel({
  materialId,
  courseId,
  courseName,
  specialistMarkdown,
  currentModuleName,
  quizQuestions = [],
  onModuleSelect,
  onQuizReady,
  onKnowledgeCardsReady,
  onModuleQuiz,
  onSwitchToTutor,
  onGenerateFlashcards,
}: AIToolPanelProps) {
  const { state, actions } = useAIToolPanel({
    materialId,
    courseId,
    specialistMarkdown,
    currentModuleName,
    onModuleSelect,
    onQuizReady,
    onKnowledgeCardsReady,
    onSwitchToTutor,
    onModuleQuiz: onModuleQuiz
      ? (_moduleId: string, moduleName: string) => {
          onModuleQuiz(_moduleId, moduleName)
        }
      : undefined,
    onGenerateFlashcards,
  })

  const {
    phase, intent, gathering,
    progress, currentStep, pipelinePhase, progressDetail,
    modules, planSteps, loadingModule, errorMsg,
    manualExpanded, activeTool, toolResult, toolError,
  } = state

  const {
    handleIntentSelect,
    handleGatheringSubmit,
    handleGatheringChange,
    handleModuleClick,
    handleExamConfirm,
    handleExamSkip,
    handleExamUploadProfile,
    handleReset,
    handleConfirmPlan,
    handleToolClick,
    handleClearToolResult,
    handleToggleManual,
  } = actions

  return (
    <div className="space-y-5">
      <h3 className="font-heading text-lg text-text-main">AI 工具</h3>

      {/* NOTE: mode="sync" (default) avoids mode="wait" which blocks click
         events during exit animations — the exiting motion.div stays in the
         DOM and can intercept pointer events until its exit completes. */}
      <AnimatePresence>
        {phase === 'idle' && (
          <IdlePhase key="idle" onSelect={handleIntentSelect} />
        )}
        {phase === 'gathering' && intent && (
          <GatheringPhase
            key="gathering"
            intent={intent}
            data={gathering}
            onChange={handleGatheringChange}
            onSubmit={handleGatheringSubmit}
            onBack={handleReset}
          />
        )}
        {phase === 'exam-setup' && (
          <motion.div
            key="exam-setup"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.25 }}
            className="space-y-4"
          >
            <button
              onClick={handleReset}
              className="text-xs text-text-muted hover:text-text-body transition-colors"
            >
              &larr; 返回选择
            </button>
            <ExamInfoCard
              courseId={courseId || materialId}
              courseName={courseName}
              onConfirm={handleExamConfirm}
              onSkip={handleExamSkip}
            />
            <ExamUploadCard
              courseId={courseId || materialId}
              materialId={materialId}
              onProfileDetected={handleExamUploadProfile}
            />
          </motion.div>
        )}
        {phase === 'processing' && (
          <ProcessingView
            key="processing"
            phase={pipelinePhase}
            progress={progress}
            message={currentStep}
            detail={progressDetail}
            error={undefined}
          />
        )}
        {phase === 'plan-preview' && intent && (
          <motion.div
            key="plan-preview"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.25 }}
          >
            <LearningPlanPreview
              plan={planSteps}
              intent={intent}
              estimatedMinutes={planSteps.reduce((s, p) => s + p.estimatedMin, 0)}
              onConfirm={handleConfirmPlan}
              onCancel={handleReset}
            />
          </motion.div>
        )}
        {phase === 'complete' && (
          <CompletePhase
            key="complete"
            modules={modules}
            loadingModule={loadingModule}
            quizQuestions={quizQuestions}
            courseId={courseId}
            onModuleClick={handleModuleClick}
            onModuleQuiz={onModuleQuiz ? (mod) => onModuleQuiz(mod.id, mod.name) : undefined}
            onReset={handleReset}
          />
        )}
        {phase === 'error' && (
          <ErrorPhase key="error" message={errorMsg} onRetry={handleReset} />
        )}
      </AnimatePresence>

      <ManualToolSection
        expanded={manualExpanded}
        onToggle={handleToggleManual}
        activeTool={activeTool}
        onToolClick={handleToolClick}
      />

      {/* Tool error */}
      {toolError && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-3 border border-red-primary/20 rounded-md bg-red-primary/5 text-sm text-red-primary"
        >
          {toolError}
        </motion.div>
      )}

      {/* Tool result display */}
      <AnimatePresence>
        {toolResult && (
          <ToolResultDisplay result={toolResult} onDismiss={handleClearToolResult} />
        )}
      </AnimatePresence>
    </div>
  )
}
