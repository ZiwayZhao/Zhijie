/**
 * Dev test page for batch upload classification.
 * Simulates folder upload with mock files to test ClassificationTable rendering.
 * Route: /dev/test-batch
 */

import { useState, Component, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import ClassificationTable from '@/components/upload/ClassificationTable'

class ErrorCatcher extends Component<{children: ReactNode}, {error: string | null}> {
  state = { error: null as string | null }
  static getDerivedStateFromError(e: Error) { return { error: e.message + '\n' + e.stack } }
  render() {
    if (this.state.error) return <pre className="p-4 text-red-primary text-xs whitespace-pre-wrap border border-red-primary/20">{this.state.error}</pre>
    return this.props.children
  }
}
import { classifyFiles, filterSupportedFiles, type FileWithPath, type ClassifiedFile } from '@/lib/folder-classifier'

// Simulate the actual course folder structure
const MOCK_FILE_DATA = [
  { name: 'Slides Introduction to Database Systems.pdf', path: '1. Introduction to Database Systems/Slides Introduction to Database Systems.pdf' },
  { name: 'Exercises E01.pdf', path: '1. Introduction to Database Systems/Exercises E01.pdf' },
  { name: 'Solution E01.pdf', path: '1. Introduction to Database Systems/Solution E01.pdf' },
  { name: 'Slides ER and EER Models.pdf', path: '2. Entity-Relationship (ER)/Slides ER and EER Models.pdf' },
  { name: 'Exercises E02.pdf', path: '2. Entity-Relationship (ER)/Exercises E02.pdf' },
  { name: 'Solution E02.pdf', path: '2. Entity-Relationship (ER)/Solution E02.pdf' },
  { name: 'Slides The Relational Data Model.pdf', path: '3. Relational Data Model/Slides The Relational Data Model.pdf' },
  { name: 'Exercise E03.pdf', path: '3. Relational Data Model/Exercise E03.pdf' },
  { name: 'Solution E03.pdf', path: '3. Relational Data Model/Solution E03.pdf' },
  { name: 'Slides Relational Algebra and Calculus.pdf', path: '4. Relational Algebra/Slides Relational Algebra and Calculus.pdf' },
  { name: 'Exercise E04.pdf', path: '4. Relational Algebra/Exercise E04.pdf' },
  { name: 'Solution E04.pdf', path: '4. Relational Algebra/Solution E04.pdf' },
  { name: 'Slides The Structured Query Language (SQL).pdf', path: '5. SQL/Slides The Structured Query Language (SQL).pdf' },
  { name: 'Exercises E05.pdf', path: '5. SQL/Exercises E05.pdf' },
  { name: 'Solution E05.pdf', path: '5. SQL/Solution E05.pdf' },
  { name: 'Installation Guide PostgreSQL.pdf', path: '5. SQL/Installation Guide PostgreSQL.pdf' },
  { name: 'Exam (Example).pdf', path: 'Allgemeines/Exam (Example).pdf' },
  { name: 'Slides Recap.pdf', path: 'Recap/Slides Recap.pdf' },
  { name: 'Normal Forms Cheat Sheet (Unofficial).pdf', path: '8. Normalization/Normal Forms Cheat Sheet (Unofficial).pdf' },
  { name: 'Exercise Session Notes.pdf', path: '10. Query Processing/Exercise Session Notes.pdf' },
  { name: 'Installation Guide SQL Alchemy.pdf', path: '7. DB Programming/Installation Guide SQL Alchemy.pdf' },
  { name: '.DS_Store', path: '.DS_Store' },
  { name: 'Thumbs.db', path: '1. Introduction to Database Systems/Thumbs.db' },
]

export default function DevBatchTestPage() {
  const [classified, setClassified] = useState<ClassifiedFile[] | null>(null)
  const [uploadResult, setUploadResult] = useState<string>('')

  function simulateFolder() {
    const raw: FileWithPath[] = MOCK_FILE_DATA.map(f => ({
      file: new File([new ArrayBuffer(1024)], f.name, { type: 'application/pdf' }),
      relativePath: f.path,
    }))
    const supported = filterSupportedFiles(raw)
    const result = classifyFiles(supported)
    setClassified(result)
  }

  function handleConfirm(files: ClassifiedFile[], courseId: string, semester: string) {
    const summary = files.map(f => `${f.file.name} → ${f.suggestedType}`).join('\n')
    setUploadResult(`Course: ${courseId || '(none)'}\nSemester: ${semester}\n\n${files.length} files:\n${summary}`)
    setClassified(null)
  }

  function handleCancel() {
    setClassified(null)
    setUploadResult('')
  }

  return (
    <div className="max-w-[860px] mx-auto px-6 py-8">
      <h1 className="font-heading text-2xl text-text-main mb-2">Batch Upload Test</h1>
      <p className="text-sm text-text-muted mb-6">测试文件夹分类逻辑和 ClassificationTable 渲染</p>

      {!classified && !uploadResult && (
        <button
          onClick={simulateFolder}
          className="px-5 py-2.5 bg-red-primary text-white text-sm rounded-sm hover:bg-red-dark transition-colors"
        >
          模拟上传课程文件夹 ({MOCK_FILE_DATA.length} 个文件)
        </button>
      )}

      {classified && (
        <ErrorCatcher>
          <ClassificationTable
            files={classified}
            onConfirm={handleConfirm}
            onCancel={handleCancel}
          />
        </ErrorCatcher>
      )}

      {uploadResult && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-4 space-y-4"
        >
          <pre className="p-4 border border-border-warm rounded-sm bg-bg-card text-sm text-text-body whitespace-pre-wrap font-mono">
            {uploadResult}
          </pre>
          <button
            onClick={() => { setUploadResult(''); }}
            className="text-sm text-red-primary hover:text-red-dark"
          >
            重新测试
          </button>
        </motion.div>
      )}
    </div>
  )
}
