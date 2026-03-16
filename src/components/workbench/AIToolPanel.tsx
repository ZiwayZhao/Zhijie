/**
 * AIToolPanel — orchestrator component for the AI learning tools.
 * Manages the phase state machine and delegates rendering to sub-components:
 *   - IntentGatherer (idle + gathering phases)
 *   - ProcessingView (processing phase)
 *   - ModuleDisplay (complete + error phases + manual tools)
 *   - LearningPlanPreview (plan-preview phase)
 */
import { useState, useCallback, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { startDisassembly, subscribeProgress, getSpecialistResult } from '@/lib/api'
import type { DisassemblyModule, ProgressEvent } from '@/lib/api'
import LearningPlanPreview from '@/components/intent/LearningPlanPreview'
import type { LearningPlanStep } from '@/components/intent/LearningPlanPreview'
import { loadProfile } from '@/lib/student-model'
import { IdlePhase, GatheringPhase } from '@/components/workbench/IntentGatherer'
import type { Intent, GatheringData } from '@/components/workbench/IntentGatherer'
import ProcessingView from '@/components/workbench/ProcessingView'
import { CompletePhase, ErrorPhase, ManualToolSection } from '@/components/workbench/ModuleDisplay'

/* ---------- Types ---------- */

type Phase = 'idle' | 'gathering' | 'processing' | 'plan-preview' | 'complete' | 'error'

interface AIToolPanelProps {
  materialId: string
  onModuleSelect?: (moduleId: string, markdown: string) => void
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

export default function AIToolPanel({ materialId, onModuleSelect }: AIToolPanelProps) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [intent, setIntent] = useState<Intent | null>(null)
  const [gathering, setGathering] = useState<GatheringData>({})
  const [progress, setProgress] = useState(0)
  const [currentStep, setCurrentStep] = useState('')
  const [modules, setModules] = useState<DisassemblyModule[]>([])
  const [loadingModule, setLoadingModule] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [manualExpanded, setManualExpanded] = useState(false)
  const [activeTool, setActiveTool] = useState<string | null>(null)
  const [planSteps, setPlanSteps] = useState<LearningPlanStep[]>([])

  const taskIdRef = useRef<string | null>(null)
  const unsubRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    return () => { unsubRef.current?.() }
  }, [])

  const startProcessing = useCallback(async (i: Intent, _data: GatheringData) => {
    setPhase('processing')
    setProgress(0)
    setCurrentStep('正在启动分析...')
    setErrorMsg('')

    try {
      const mapped = i === 'review' ? 'learn' : i
      const { taskId } = await startDisassembly(materialId, mapped)
      taskIdRef.current = taskId

      unsubRef.current = subscribeProgress(taskId, (evt: ProgressEvent) => {
        setProgress(evt.progress)
        if (evt.currentStep) setCurrentStep(evt.currentStep)
        if (evt.status === 'completed' && evt.modules) {
          setModules(evt.modules)
          const profile = loadProfile()
          const steps = generatePlanSteps(evt.modules, i, profile)
          setPlanSteps(steps)
          setPhase('plan-preview')
        }
        if (evt.status === 'error') {
          setErrorMsg(evt.currentStep ?? '分析过程中出现错误')
          setPhase('error')
        }
      })
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '启动失败')
      setPhase('error')
    }
  }, [materialId])

  const handleIntentSelect = useCallback((i: Intent) => {
    setIntent(i)
    if (i === 'review') {
      startProcessing(i, {})
    } else {
      setPhase('gathering')
      setGathering({})
    }
  }, [startProcessing])

  const handleGatheringSubmit = useCallback(() => {
    if (!intent) return
    startProcessing(intent, gathering)
  }, [intent, gathering, startProcessing])

  const handleModuleClick = useCallback(async (mod: DisassemblyModule) => {
    if (!taskIdRef.current || !onModuleSelect) return
    setLoadingModule(mod.id)
    try {
      const result = await getSpecialistResult(taskIdRef.current, mod.id)
      onModuleSelect(mod.id, result.markdown)
    } catch { /* silently fail */ }
    setLoadingModule(null)
  }, [onModuleSelect])

  const handleReset = useCallback(() => {
    unsubRef.current?.()
    unsubRef.current = null
    taskIdRef.current = null
    setPhase('idle')
    setIntent(null)
    setGathering({})
    setProgress(0)
    setModules([])
    setErrorMsg('')
  }, [])

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
        {phase === 'processing' && (
          <ProcessingView key="processing" progress={progress} step={currentStep} />
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
              onConfirm={() => setPhase('complete')}
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
