/**
 * FolderDropZone — Enhanced DropZone that supports folder drag-drop.
 * Uses webkitGetAsEntry() to recursively read folder contents.
 * Falls back to <input webkitdirectory> for click-based folder selection.
 */

import { useState, useRef, useCallback } from 'react'
import { motion } from 'framer-motion'
import { FolderOpen, FileUp, Upload } from 'lucide-react'
import type { FileWithPath } from '@/lib/folder-classifier'

interface FolderDropZoneProps {
  onFiles: (files: FileWithPath[]) => void
}

/** Recursively read all files from a FileSystemDirectoryEntry */
async function readEntryRecursive(
  entry: FileSystemEntry,
  basePath: string,
): Promise<FileWithPath[]> {
  if (entry.isFile) {
    return new Promise((resolve) => {
      ;(entry as FileSystemFileEntry).file((file) => {
        resolve([{ file, relativePath: basePath + file.name }])
      })
    })
  }

  if (entry.isDirectory) {
    const dirReader = (entry as FileSystemDirectoryEntry).createReader()
    const entries = await new Promise<FileSystemEntry[]>((resolve) => {
      const results: FileSystemEntry[] = []
      function readBatch() {
        dirReader.readEntries((batch) => {
          if (batch.length === 0) {
            resolve(results)
          } else {
            results.push(...batch)
            readBatch() // Keep reading until empty (Chrome batches at 100)
          }
        })
      }
      readBatch()
    })

    const nested = await Promise.all(
      entries.map((e) => readEntryRecursive(e, basePath + entry.name + '/')),
    )
    return nested.flat()
  }

  return []
}

export default function FolderDropZone({ onFiles }: FolderDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [isReading, setIsReading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      setIsReading(true)

      try {
        const items = e.dataTransfer.items
        const allFiles: FileWithPath[] = []

        // Try webkitGetAsEntry for folder support
        if (items?.length) {
          const entries = Array.from(items)
            .map((item) => item.webkitGetAsEntry?.())
            .filter(Boolean) as FileSystemEntry[]

          if (entries.length > 0) {
            const nested = await Promise.all(
              entries.map((entry) => readEntryRecursive(entry, '')),
            )
            allFiles.push(...nested.flat())
          }
        }

        // Fallback to flat file list if no entries
        if (allFiles.length === 0) {
          const files = Array.from(e.dataTransfer.files)
          allFiles.push(
            ...files.map((f) => ({ file: f, relativePath: f.name })),
          )
        }

        if (allFiles.length > 0) onFiles(allFiles)
      } finally {
        setIsReading(false)
      }
    },
    [onFiles],
  )

  /** Handle <input webkitdirectory> selection */
  const handleFolderInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files ? Array.from(e.target.files) : []
      const withPaths: FileWithPath[] = files.map((f) => ({
        file: f,
        relativePath: (f as any).webkitRelativePath || f.name,
      }))
      if (withPaths.length > 0) onFiles(withPaths)
      e.target.value = ''
    },
    [onFiles],
  )

  /** Handle regular file selection */
  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files ? Array.from(e.target.files) : []
      const withPaths: FileWithPath[] = files.map((f) => ({
        file: f,
        relativePath: f.name,
      }))
      if (withPaths.length > 0) onFiles(withPaths)
      e.target.value = ''
    },
    [onFiles],
  )

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={[
        'relative rounded-sm border-2 border-dashed py-14 px-10 text-center transition-all',
        isDragging
          ? 'border-red-primary bg-bg-accent'
          : 'border-border-warm bg-bg-card hover:border-red-primary/40 hover:bg-bg-accent/50',
      ].join(' ')}
    >
      {/* Hidden inputs */}
      <input
        ref={folderInputRef}
        type="file"
        // @ts-expect-error webkitdirectory is non-standard but widely supported
        webkitdirectory=""
        multiple
        onChange={handleFolderInput}
        className="hidden"
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.docx,.pptx,.ppt,.doc,.png,.jpg,.jpeg,.txt,.md"
        onChange={handleFileInput}
        className="hidden"
      />

      <div className="flex flex-col items-center gap-4">
        {isReading ? (
          <>
            <div className="w-14 h-14 flex items-center justify-center border border-red-primary rounded-sm">
              <div className="w-5 h-5 border-2 border-red-primary/30 border-t-red-primary rounded-full animate-spin" />
            </div>
            <p className="text-sm text-text-muted">读取文件夹内容...</p>
          </>
        ) : isDragging ? (
          <>
            <div className="w-14 h-14 flex items-center justify-center border-2 border-red-primary rounded-sm">
              <FileUp size={28} strokeWidth={1} className="text-red-primary" />
            </div>
            <p className="text-sm font-medium text-red-primary">
              松开以上传文件夹
            </p>
          </>
        ) : (
          <>
            <div className="w-14 h-14 flex items-center justify-center border border-border-warm rounded-sm">
              <FolderOpen size={28} strokeWidth={1} className="text-text-muted" />
            </div>
            <div>
              <p className="text-sm font-medium text-text-main">
                拖拽课程文件夹到此处
              </p>
              <p className="text-xs text-text-muted mt-1.5 leading-relaxed">
                支持整个文件夹上传，自动按文件名分类（课件 / 习题 / 考题）
              </p>
            </div>
            <div className="flex items-center gap-3 mt-1">
              <button
                onClick={() => folderInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs border border-red-primary text-red-primary
                           rounded-sm hover:bg-red-primary hover:text-white transition-colors"
              >
                <FolderOpen size={12} strokeWidth={1.5} />
                选择文件夹
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs border border-border-warm text-text-muted
                           rounded-sm hover:border-red-primary/40 hover:text-text-body transition-colors"
              >
                <Upload size={12} strokeWidth={1.5} />
                选择文件
              </button>
            </div>
          </>
        )}
      </div>
    </motion.div>
  )
}
