/**
 * Folder upload auto-classification.
 * Classifies files by filename patterns into material types.
 */

export interface FileWithPath {
  file: File
  /** Relative path within the uploaded folder, e.g. "Ch1/DB-L01-Intro.pdf" */
  relativePath: string
}

export interface ClassifiedFile extends FileWithPath {
  /** Auto-detected material type */
  suggestedType: string
  /** Whether to include this file in the upload (user can uncheck) */
  included: boolean
}

interface ClassifyRule {
  pattern: RegExp
  type: string
}

const CLASSIFY_RULES: ClassifyRule[] = [
  // 课件 / Lectures
  { pattern: /\b(L\d+|Lecture|Vorlesung|VL|课件|Slides?)\b/i, type: '课件' },
  // 习题 / Exercises
  { pattern: /\b(Exercises?|Übung(?:en)?|UB|习题|Assignments?|HW|Homework|Aufgabe[n]?)\b/i, type: '习题' },
  // 考题 / Exams
  { pattern: /\b(Exam|Klausur|考题|Midterm|Final|Test|Prüfung|Quiz)\b/i, type: '考题' },
  // 解答 / Solutions
  { pattern: /\b(Solution|Lösung|解答|Answer|Key|Musterlösung)\b/i, type: '解答' },
  // 笔记 / Notes
  { pattern: /\b(Notes?|笔记|Summary|Zusammenfassung|Recap)\b/i, type: '笔记' },
]

/**
 * Classify a single file by its name and path.
 * Tests against filename first, then falls back to path segments.
 */
function classifySingle(f: FileWithPath): string {
  const testString = `${f.file.name} ${f.relativePath}`
  for (const rule of CLASSIFY_RULES) {
    if (rule.pattern.test(testString)) {
      return rule.type
    }
  }
  return '其他'
}

/**
 * Classify an array of files by filename/path patterns.
 * Each file gets a suggestedType that the user can override before upload.
 */
export function classifyFiles(files: FileWithPath[]): ClassifiedFile[] {
  return files.map((f) => ({
    ...f,
    suggestedType: classifySingle(f),
    included: true,
  }))
}

/**
 * Extract a chapter/lecture number from a filename for sorting.
 * Returns the number if found, or Infinity for files without a number.
 *
 * Examples:
 *   "DB-L01-Introduction.pdf" → 1
 *   "Ch3_Relational_Model.pdf" → 3
 *   "Lecture 12.pdf" → 12
 */
export function extractChapterNumber(filename: string): number {
  // Try patterns: L01, Ch.3, Chapter 12, Lecture-5, 第3章
  const patterns = [
    /\bL(\d+)/i,
    /\bCh\.?(\d+)/i,
    /\bChapter\s*(\d+)/i,
    /\bLecture\s*(\d+)/i,
    /\bVL\s*(\d+)/i,
    /第(\d+)[章课节]/,
    /\b(\d{1,2})\s*[-_]\s*\w/,  // "01-Introduction", "3_Relational"
  ]

  for (const pat of patterns) {
    const m = filename.match(pat)
    if (m) return parseInt(m[1], 10)
  }
  return Infinity
}

/**
 * Sort materials by extracted chapter number, then alphabetically.
 */
export function sortByChapter<T extends { filename?: string; title?: string }>(
  items: T[],
): T[] {
  return [...items].sort((a, b) => {
    const nameA = a.title || a.filename || ''
    const nameB = b.title || b.filename || ''
    const numA = extractChapterNumber(nameA)
    const numB = extractChapterNumber(nameB)
    if (numA !== numB) return numA - numB
    return nameA.localeCompare(nameB)
  })
}

/** Supported file extensions for upload */
const UPLOAD_EXTENSIONS = new Set([
  'pdf', 'docx', 'doc', 'pptx', 'ppt',
  'png', 'jpg', 'jpeg', 'gif', 'webp',
  'txt', 'md',
])

/**
 * Filter files to only those with supported extensions.
 * Also filters out hidden files (starting with .) and OS junk files.
 */
export function filterSupportedFiles(files: FileWithPath[]): FileWithPath[] {
  return files.filter((f) => {
    const name = f.file.name
    // Skip hidden files and OS junk
    if (name.startsWith('.') || name === 'Thumbs.db' || name === 'desktop.ini') {
      return false
    }
    const ext = name.split('.').pop()?.toLowerCase() ?? ''
    return UPLOAD_EXTENSIONS.has(ext)
  })
}
