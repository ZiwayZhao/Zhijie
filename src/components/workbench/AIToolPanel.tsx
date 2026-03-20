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
import ExamInfoCard from '@/components/workbench/ExamInfoCard'
import ExamUploadCard from '@/components/workbench/ExamUploadCard'
import { useAIToolPanel } from '@/hooks/useAIToolPanel'

/* ---------- Types ---------- */

interface AIToolPanelProps {
  materialId: string
  courseId?: string
  courseName?: string
  onModuleSelect?: (moduleId: string, moduleName: string, markdown: string) => void
  onQuizReady?: (questions: MCQuestion[]) => void
}

/* ---------- Main Component ---------- */

export default function AIToolPanel({
  materialId,
  courseId,
  courseName,
  onModuleSelect,
  onQuizReady,
}: AIToolPanelProps) {
  const { state, actions } = useAIToolPanel({
    materialId,
    courseId,
    onModuleSelect,
    onQuizReady,
  })

  const {
    phase, intent, gathering,
    progress, currentStep, pipelinePhase, progressDetail,
    modules, planSteps, loadingModule, errorMsg,
    manualExpanded, activeTool,
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
    handleToggleManual,
  } = actions

  return (
    <div className="space-y-5">
      <h3 className="font-heading text-lg text-text-main">AI 工具</h3>

      <AnimatePresence mode="wait">
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
            onModuleClick={handleModuleClick}
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
    </div>
  )
}
