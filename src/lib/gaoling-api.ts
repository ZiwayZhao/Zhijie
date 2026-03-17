/**
 * Gaoling Life API service — campus post browsing + RAG chat.
 */

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8003/api'
const GAOLING_API = `${API_BASE}/v1/gaoling`

/* ---------- Types ---------- */

export type CategoryType = 'sport' | 'medical' | 'lecture' | 'dining' | 'study'
export type SourceFilter = 'all' | 'official' | 'personal'
export type SortType = 'time' | 'hot'

export interface GaolingPost {
  id: number
  title: string
  summary: string
  category: CategoryType
  is_official: boolean
  status: string
  likes: number
  view_count: number
  author_name: string | null
  cover_image: string | null
  images: string[]
  source_url: string | null
  publish_time: string | null
  created_at: string
}

export interface PostListResponse {
  items: GaolingPost[]
  total: number
  page: number
  page_size: number
}

export interface CitedPost {
  post_id: number
  citation_index: number
  excerpt: string | null
}

export interface ChatResponse {
  success: boolean
  answer: string | null
  sorted_post_ids: number[] | null
  cited_posts: CitedPost[] | null
  session_id: string | null
  error: string | null
}

/* ---------- Post API ---------- */

export async function fetchPosts(params: {
  category?: CategoryType
  source?: SourceFilter
  sort?: SortType
  page?: number
  page_size?: number
  search?: string
}): Promise<PostListResponse> {
  const qs = new URLSearchParams()
  if (params.category) qs.set('category', params.category)
  if (params.source && params.source !== 'all') qs.set('source', params.source)
  if (params.sort) qs.set('sort', params.sort)
  if (params.page) qs.set('page', String(params.page))
  if (params.page_size) qs.set('page_size', String(params.page_size))
  if (params.search) qs.set('search', params.search)

  const resp = await fetch(`${GAOLING_API}/posts?${qs}`)
  if (!resp.ok) throw new Error(`Failed to fetch posts: ${resp.status}`)
  return resp.json()
}

export async function fetchPost(postId: number): Promise<GaolingPost> {
  const resp = await fetch(`${GAOLING_API}/posts/${postId}`)
  if (!resp.ok) throw new Error(`Failed to fetch post: ${resp.status}`)
  return resp.json()
}

export async function likePost(postId: number): Promise<{ ok: boolean; likes: number }> {
  const resp = await fetch(`${GAOLING_API}/posts/${postId}/like`, { method: 'POST' })
  if (!resp.ok) throw new Error(`Failed to like post: ${resp.status}`)
  return resp.json()
}

/* ---------- Chat API ---------- */

export async function sendChatMessage(params: {
  message: string
  category?: CategoryType
  session_id?: string
}): Promise<ChatResponse> {
  const resp = await fetch(`${GAOLING_API}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  if (!resp.ok) throw new Error(`Chat request failed: ${resp.status}`)
  return resp.json()
}
