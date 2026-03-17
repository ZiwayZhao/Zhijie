/**
 * API service layer for 智阶 backend.
 * Course browsing (public) + Material CRUD (authenticated).
 *
 * Disassembly/analysis APIs are in api-disassembly.ts.
 */

import { authFetch } from '@/lib/auth-api'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8003/api'
const AUTH_API = `${API_BASE}/v1`

/* ---------- Re-exports from api-disassembly ---------- */
export type {
  DisassemblyModule,
  DisassemblyTask,
  SpecialistResult,
  MCQuestion,
  QuizResult,
  ProgressEvent,
  AnalysisResult,
} from '@/lib/api-disassembly'
export {
  startDisassembly,
  subscribeProgress,
  getAnalysisResult,
  getSpecialistResult,
  getLatestAnalysis,
  cancelAnalysis,
} from '@/lib/api-disassembly'

/* ---------- Course Types & API ---------- */

export interface CourseItem {
  id: string
  name: string
  slug: string
  school: string
  description: string
  platformDescription: string
  learningObjectives: string[] | null
  targetAudience: string | null
  tags: string[]
  materialCount: number
  studentCount: number
  category: string
  categorySlug: string
  categoryId: string
  language: string
  programmingLang: string | null
  difficulty: number
  estimatedHours: number | null
  prerequisites: string | null
  websiteUrl: string | null
  videoUrl: string | null
  sourcePlatform: string
  level: string | null
  semester: string | null
  department: string | null
  imageUrl: string | null
}

export interface CategoryItem {
  id: string
  name: string
  slug: string
  courseCount: number
  parentId: string | null
}

function mapCourse(raw: any): CourseItem {
  return {
    id: raw.slug,
    name: raw.name,
    slug: raw.slug,
    school: raw.university || '',
    // Prefer curated platform_description; fall back to raw description
    description: raw.platform_description || raw.description || '',
    platformDescription: raw.platform_description || '',
    learningObjectives: raw.learning_objectives ?? null,
    targetAudience: raw.target_audience ?? null,
    tags: raw.tags || [],
    materialCount: raw.material_count ?? 0,
    studentCount: raw.student_count ?? 0,
    category: raw.category_name || '',
    categorySlug: raw.category_slug || '',
    categoryId: raw.category_id,
    language: raw.language || 'en',
    programmingLang: raw.programming_lang,
    difficulty: raw.difficulty ?? 3,
    estimatedHours: raw.estimated_hours,
    prerequisites: raw.prerequisites,
    websiteUrl: raw.website_url,
    videoUrl: raw.video_url,
    sourcePlatform: raw.source_platform || 'csdiy',
    level: raw.level ?? null,
    semester: raw.semester ?? null,
    department: raw.department ?? null,
    imageUrl: raw.image_url ?? null,
  }
}

export async function fetchCourses(opts: {
  page?: number
  pageSize?: number
  category?: string
  search?: string
} = {}): Promise<{ items: CourseItem[]; total: number }> {
  const params = new URLSearchParams()
  if (opts.page != null) params.set('page', String(opts.page))
  if (opts.pageSize != null) params.set('page_size', String(opts.pageSize))
  if (opts.category) params.set('category', opts.category)
  if (opts.search) params.set('search', opts.search)

  const res = await fetch(`${AUTH_API}/courses?${params}`)
  if (!res.ok) throw new Error(`Courses fetch failed: ${res.status}`)
  const data = await res.json()
  return { items: data.items.map(mapCourse), total: data.total }
}

export async function fetchCourse(slug: string): Promise<CourseItem | null> {
  const res = await fetch(`${AUTH_API}/courses/${encodeURIComponent(slug)}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Course fetch failed: ${res.status}`)
  const data = await res.json()
  return mapCourse(data)
}

export async function fetchCategories(): Promise<CategoryItem[]> {
  const res = await fetch(`${AUTH_API}/courses/categories`)
  if (!res.ok) throw new Error(`Categories fetch failed: ${res.status}`)
  const data = await res.json()
  return data.items.map((c: any) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    courseCount: c.course_count ?? 0,
    parentId: c.parent_id,
  }))
}

/* ---------- Showcase (public featured materials with pipeline results) ---------- */

export interface ShowcaseItem {
  task_id: string
  material_id: string
  title: string
  description: string
  module_count: number
  quiz_count: number
}

export async function fetchShowcase(): Promise<ShowcaseItem[]> {
  const res = await fetch(`${AUTH_API}/disassembly/showcase`)
  if (!res.ok) return []
  const data = await res.json()
  return data.items || []
}

/* ---------- Course Resource Sources API ---------- */

export interface CourseResourceItem {
  id: string
  courseId: string
  title: string
  sourceUrl: string
  contentType: string
  contentFeature: string | null
  fileExtension: string | null
  downloadUrl: string | null
  downloaded: boolean
  license: string | null
  attribution: string | null
}

export async function fetchCourseResources(
  slug: string,
  opts: { page?: number; pageSize?: number; contentType?: string } = {},
): Promise<{ items: CourseResourceItem[]; total: number }> {
  const params = new URLSearchParams()
  if (opts.page != null) params.set('page', String(opts.page))
  if (opts.pageSize != null) params.set('page_size', String(opts.pageSize))
  if (opts.contentType) params.set('content_type', opts.contentType)

  const res = await fetch(`${AUTH_API}/courses/${encodeURIComponent(slug)}/resources?${params}`)
  if (!res.ok) throw new Error(`Resources fetch failed: ${res.status}`)
  const data = await res.json()
  return {
    items: data.items.map((r: any) => ({
      id: r.id,
      courseId: r.course_id,
      title: r.title,
      sourceUrl: r.source_url,
      contentType: r.content_type,
      contentFeature: r.content_feature || null,
      fileExtension: r.file_extension || null,
      downloadUrl: r.download_url || null,
      downloaded: r.downloaded ?? false,
      license: r.license || null,
      attribution: r.attribution || null,
    })),
    total: data.total,
  }
}

/* ---------- Material Upload API ---------- */

export interface MaterialItem {
  id: string
  userId: string
  courseId: string | null
  filename: string
  contentType: string
  fileSize: number
  title: string
  description: string | null
  materialType: string
  semester: string | null
  analysisStatus: string
  downloadCount: number
  createdAt: string
  downloadUrl: string | null
}

export async function fetchMaterial(materialId: string): Promise<MaterialItem> {
  const res = await authFetch(`${AUTH_API}/materials/${materialId}`)
  if (!res.ok) throw new Error(`Material fetch failed: ${res.status}`)
  const m = await res.json()
  return {
    id: m.id,
    userId: m.user_id,
    courseId: m.course_id,
    filename: m.filename,
    contentType: m.content_type,
    fileSize: m.file_size,
    title: m.title,
    description: m.description,
    materialType: m.material_type,
    semester: m.semester,
    analysisStatus: m.analysis_status,
    downloadCount: m.download_count,
    createdAt: m.created_at,
    downloadUrl: m.download_url,
  }
}

/** Max upload size: 50 MB */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

export async function requestUpload(params: {
  filename: string
  contentType: string
  fileSize: number
  title: string
  description?: string
  materialType?: string
  semester?: string
  courseId?: string
}): Promise<{ materialId: string; uploadUrl: string; s3Key: string }> {
  if (params.fileSize > MAX_UPLOAD_BYTES) {
    throw new Error(`文件过大，最大支持 ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`)
  }

  const res = await authFetch(`${AUTH_API}/materials/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: params.filename,
      content_type: params.contentType,
      file_size: params.fileSize,
      title: params.title,
      description: params.description,
      material_type: params.materialType || 'pdf',
      semester: params.semester,
      course_id: params.courseId || null,
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Upload request failed' }))
    throw new Error(err.detail || `Upload request failed: ${res.status}`)
  }
  const data = await res.json()
  return { materialId: data.material_id, uploadUrl: data.upload_url, s3Key: data.s3_key }
}

export async function uploadFileToS3(uploadUrl: string, file: File, contentType?: string): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType || file.type || 'application/octet-stream' },
    body: file,
  })
  if (!res.ok) throw new Error(`S3 upload failed: ${res.status}`)
}

export async function confirmUpload(materialId: string): Promise<void> {
  const res = await authFetch(`${AUTH_API}/materials/${materialId}/confirm`, {
    method: 'POST',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Confirm failed' }))
    throw new Error(err.detail || `Confirm failed: ${res.status}`)
  }
}

export async function fetchMaterials(opts: {
  courseId?: string
  skip?: number
  limit?: number
} = {}): Promise<{ items: MaterialItem[]; total: number }> {
  const params = new URLSearchParams()
  if (opts.courseId) params.set('course_id', opts.courseId)
  if (opts.skip != null) params.set('skip', String(opts.skip))
  if (opts.limit != null) params.set('limit', String(opts.limit))

  const res = await authFetch(`${AUTH_API}/materials?${params}`)
  if (!res.ok) throw new Error(`Materials fetch failed: ${res.status}`)
  const data = await res.json()
  return {
    items: data.items.map((m: any) => ({
      id: m.id,
      userId: m.user_id,
      courseId: m.course_id,
      filename: m.filename,
      contentType: m.content_type,
      fileSize: m.file_size,
      title: m.title,
      description: m.description,
      materialType: m.material_type,
      semester: m.semester,
      analysisStatus: m.analysis_status,
      downloadCount: m.download_count,
      createdAt: m.created_at,
      downloadUrl: m.download_url,
    })),
    total: data.total,
  }
}

export async function deleteMaterial(materialId: string): Promise<void> {
  const res = await authFetch(`${AUTH_API}/materials/${materialId}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error(`Delete failed: ${res.status}`)
}
