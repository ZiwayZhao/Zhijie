/**
 * AIToolPanel — orchestrator component for the AI learning tools.
 * Manages the phase state machine and delegates rendering to sub-components:
 *   - IntentGatherer (idle + gathering phases)
 *   - ExamInfoCard + ExamUploadCard (exam-setup phase)
 *   - ProcessingView (processing phase)
 *   - ModuleDisplay (complete + error phases + manual tools)
 *   - LearningPlanPreview (plan-preview phase)
 */
import { useState, useCallback, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { startDisassembly, subscribeProgress, getSpecialistResult, getAnalysisResult, getLatestAnalysis } from '@/lib/api'
import type { DisassemblyModule, MCQuestion, ProgressEvent } from '@/lib/api'
import LearningPlanPreview from '@/components/intent/LearningPlanPreview'
import type { LearningPlanStep } from '@/components/intent/LearningPlanPreview'
import { loadProfile } from '@/lib/student-model'
import { IdlePhase, GatheringPhase } from '@/components/workbench/IntentGatherer'
import type { Intent, GatheringData } from '@/components/workbench/IntentGatherer'
import ProcessingView from '@/components/workbench/ProcessingView'
import type { PipelinePhase } from '@/components/workbench/ProcessingView'
import { CompletePhase, ErrorPhase, ManualToolSection } from '@/components/workbench/ModuleDisplay'
import ExamInfoCard from '@/components/workbench/ExamInfoCard'
import ExamUploadCard from '@/components/workbench/ExamUploadCard'
import type { ExamProfile } from '@/lib/exam-profile'
import { loadExamProfile } from '@/lib/exam-profile'

/* ---------- Types ---------- */

type Phase = 'idle' | 'gathering' | 'exam-setup' | 'processing' | 'plan-preview' | 'complete' | 'error'

interface AIToolPanelProps {
  materialId: string
  courseId?: string
  courseName?: string
  onModuleSelect?: (moduleId: string, moduleName: string, markdown: string) => void
  onQuizReady?: (questions: MCQuestion[]) => void
}

/* ---------- Plan generation helper ---------- */

function generatePlanSteps(
  modules: DisassemblyModule[],
  intent: Intent,
  profile: { modules: Record<string, { mastery: number }> },
): LearningPlanStep[] {
  return modules.map((mod, i) => {
    const mastery = profile.modules[mod.id]?.mastery ?? 0.3
    const isWeak = mastery < 0.6
    const isHighWeight = mod.examWeight === 'high'

    let action: LearningPlanStep['action'] = 'read'
    let priority: LearningPlanStep['priority'] = 'medium'
    let estimatedMin = 10

    if (intent === 'exam') {
      action = isWeak ? 'deep-dive' : 'quiz'
      priority = isHighWeight && isWeak ? 'high' : isHighWeight ? 'medium' : 'low'
      estimatedMin = isWeak ? 15 : 5
    } else if (intent === 'review') {
      action = 'flashcard'
      priority = mastery < 0.3 ? 'high' : mastery < 0.6 ? 'medium' : 'low'
      estimatedMin = 5
    } else {
      action = i === modules.length - 1 ? 'quiz' : 'read'
      priority = isHighWeight ? 'high' : 'medium'
      estimatedMin = 10
    }

    return {
      id: `step-${mod.id}`,
      moduleId: mod.id,
      moduleName: mod.name,
      action,
      estimatedMin,
      mastery,
      priority,
      skippable: mastery > 0.7 || priority === 'low',
    }
  })
}

/* ---------- Main Component ---------- */

export default function AIToolPanel({ materialId, courseId, courseName, onModuleSelect, onQuizReady }: AIToolPanelProps) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [intent, setIntent] = useState<Intent | null>(null)
  const [gathering, setGathering] = useState<GatheringData>({})
  const [examProfile, setExamProfile] = useState<ExamProfile | null>(null)
  const [progress, setProgress] = useState(0)
  const [currentStep, setCurrentStep] = useState('')
  const [pipelinePhase, setPipelinePhase] = useState<PipelinePhase>('init')
  const [progressDetail, setProgressDetail] = useState<{ completed?: number; total?: number } | undefined>()
  const [modules, setModules] = useState<DisassemblyModule[]>([])
  const [loadingModule, setLoadingModule] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [manualExpanded, setManualExpanded] = useState(false)
  const [activeTool, setActiveTool] = useState<string | null>(null)
  const [planSteps, setPlanSteps] = useState<LearningPlanStep[]>([])

  const taskIdRef = useRef<string | null>(null)
  const unsubRef = useRef<(() => void) | null>(null)
  const skipAutoDetectRef = useRef(false)
  const onQuizReadyRef = useRef(onQuizReady)
  onQuizReadyRef.current = onQuizReady

  // Load saved exam profile on mount
  useEffect(() => {
    if (courseId) {
      const saved = loadExamProfile(courseId)
      if (saved) setExamProfile(saved)
    }
  }, [courseId])

  useEffect(() => {
    return () => { unsubRef.current?.() }
  }, [])

  // Auto-detect existing completed analysis (skip if user explicitly reset)
  useEffect(() => {
    let cancelled = false
    if (skipAutoDetectRef.current) return
    getLatestAnalysis(materialId).then(async (task) => {
      if (cancelled || skipAutoDetectRef.current || !task || task.status !== 'completed') return
      try {
        const result = await getAnalysisResult(task.task_id)
        if (cancelled || skipAutoDetectRef.current) return
        taskIdRef.current = task.task_id
        setModules(result.modules as DisassemblyModule[])
        setPhase('complete')
        if (result.quiz?.questions.length) {
          onQuizReadyRef.current?.(result.quiz.questions)
        }
      } catch { /* ignore — user can start fresh */ }
    }).catch(() => {})
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materialId])

  const startProcessing = useCallback(async (i: Intent, data: GatheringData) => {
    setPhase('processing')
    setProgress(0)
    setCurrentStep('正在启动分析...')
    setErrorMsg('')

    try {
      const mapped = i === 'review' ? 'learn' : i
      const profile = data.examProfile ?? examProfile ?? undefined
      const { taskId } = await startDisassembly(materialId, mapped, {
        examProfile: profile,
        referenceMaterialIds: data.referenceMaterialIds,
      })
      taskIdRef.current = taskId

      unsubRef.current = subscribeProgress(taskId, (evt: ProgressEvent) => {
        setProgress(evt.progress)
        if (evt.currentStep) setCurrentStep(evt.currentStep)
        if (evt.phase) setPipelinePhase(evt.phase as PipelinePhase)
        if (evt.detail) setProgressDetail(evt.detail)
        if (evt.status === 'completed') {
          // Fetch full result (modules + quiz) from API
          getAnalysisResult(taskId).then((result) => {
            const mods = result.modules as DisassemblyModule[]
            setModules(mods)
            const profile = loadProfile()
            const steps = generatePlanSteps(mods, i, profile)
            setPlanSteps(steps)
            setPhase('plan-preview')
          }).catch(() => {
            setErrorMsg('获取分析结果失败')
            setPhase('error')
          })
        }
        if (evt.status === 'failed') {
          setErrorMsg(evt.currentStep ?? '分析过程中出现错误')
          setPhase('error')
        }
      })
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '启动失败')
      setPhase('error')
    }
  }, [materialId, examProfile])

  const handleIntentSelect = useCallback((i: Intent) => {
    setIntent(i)
    if (i === 'review') {
      startProcessing(i, {})
    } else if (i === 'exam') {
      // If we already have a saved exam profile, skip exam-setup
      if (examProfile && courseId) {
        setGathering({ examProfile })
        setPhase('exam-setup')
      } else {
        setPhase('exam-setup')
      }
    } else {
      setPhase('gathering')
      setGathering({})
    }
  }, [startProcessing, examProfile, courseId])

  const handleGatheringSubmit = useCallback(() => {
    if (!intent) return
    startProcessing(intent, gathering)
  }, [intent, gathering, startProcessing])

  const handleModuleClick = useCallback(async (mod: DisassemblyModule) => {
    if (!taskIdRef.current || !onModuleSelect) return
    setLoadingModule(mod.id)
    try {
      const result = await getSpecialistResult(taskIdRef.current, mod.id)
      onModuleSelect(mod.id, mod.name, result.markdown)
    } catch { /* silently fail */ }
    setLoadingModule(null)
  }, [onModuleSelect])

  const handleExamConfirm = useCallback((profile: ExamProfile) => {
    setExamProfile(profile)
    const data: GatheringData = { examProfile: profile }
    setGathering(data)
    startProcessing('exam', data)
  }, [startProcessing])

  const handleExamSkip = useCallback(() => {
    // No exam profile → v1 fallback
    startProcessing('exam', {})
  }, [startProcessing])

  const handleExamUploadProfile = useCallback((profile: ExamProfile) => {
    // Update from uploaded past exam analysis
    setExamProfile(profile)
  }, [])

  const handleReset = useCallback(() => {
    unsubRef.current?.()
    unsubRef.current = null
    taskIdRef.current = null
    skipAutoDetectRef.current = true
    setPhase('idle')
    setIntent(null)
    setGathering({})
    setProgress(0)
    setPipelinePhase('init')
    setProgressDetail(undefined)
    setModules([])
    setErrorMsg('')
    // Clear quiz in parent to prevent stale data
    onQuizReady?.([])
  }, [onQuizReady])

  const handleToolClick = useCallback((toolId: string) => {
    setActiveTool(toolId)
    setTimeout(() => setActiveTool(null), 3000)
  }, [])

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
            onChange={setGathering}
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
              onConfirm={() => {
                setPhase('complete')
                // Fetch quiz data in background after confirming plan
                if (taskIdRef.current && onQuizReady) {
                  getAnalysisResult(taskIdRef.current)
                    .then((result) => {
                      if (result.quiz?.questions.length) {
                        onQuizReady(result.quiz.questions)
                      }
                    })
                    .catch(() => { /* quiz fetch failure is non-blocking */ })
                }
              }}
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
        onToggle={() => setManualExpanded(!manualExpanded)}
        activeTool={activeTool}
        onToolClick={handleToolClick}
      />
    </div>
  )
}
