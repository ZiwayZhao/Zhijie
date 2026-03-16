/**
 * Auth API client for 智阶 backend.
 * Handles token storage, refresh, and authenticated requests.
 */

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8003/api'
const AUTH_BASE = `${API_BASE}/v1/auth`

/* ---------- Types ---------- */

export interface UserResponse {
  id: string
  email: string | null
  name: string
  avatar_url: string | null
  auth_provider: string
  is_active: boolean
  created_at: string
}

export interface TokenPair {
  access_token: string
  refresh_token: string
  token_type: string
}

export interface RegisterPayload {
  email: string
  password: string
  name: string
}

export interface LoginPayload {
  email: string
  password: string
}

export interface ApiError {
  detail: string
}

/* ---------- Token Storage ---------- */

const ACCESS_TOKEN_KEY = 'zhijie_access_token'
const REFRESH_TOKEN_KEY = 'zhijie_refresh_token'

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_TOKEN_KEY)
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY)
}

export function storeTokens(tokens: TokenPair): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, tokens.access_token)
  localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refresh_token)
}

export function clearTokens(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY)
  localStorage.removeItem(REFRESH_TOKEN_KEY)
}

/* ---------- Session Expiry Callback ---------- */

let _onSessionExpired: (() => void) | null = null

export function setOnSessionExpired(cb: () => void): void {
  _onSessionExpired = cb
}

/* ---------- Refresh Lock ---------- */

let refreshPromise: Promise<TokenPair | null> | null = null

async function refreshAccessToken(): Promise<TokenPair | null> {
  // Deduplicate concurrent refresh calls
  if (refreshPromise) return refreshPromise

  refreshPromise = (async () => {
    const refreshToken = getRefreshToken()
    if (!refreshToken) return null

    try {
      const res = await fetch(`${AUTH_BASE}/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      })

      if (!res.ok) {
        clearTokens()
        _onSessionExpired?.()
        return null
      }

      const tokens = (await res.json()) as TokenPair
      storeTokens(tokens)
      return tokens
    } catch {
      // Network failure during refresh — clear tokens and signal session expired
      clearTokens()
      _onSessionExpired?.()
      return null
    } finally {
      refreshPromise = null
    }
  })()

  return refreshPromise
}

/* ---------- Authenticated Fetch ---------- */

export async function authFetch(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  const accessToken = getAccessToken()

  const headers = new Headers(options.headers)
  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`)
  }

  let res = await fetch(url, { ...options, headers })

  // If 401, try refreshing the token once
  if (res.status === 401 && getRefreshToken()) {
    const newTokens = await refreshAccessToken()
    if (newTokens) {
      headers.set('Authorization', `Bearer ${newTokens.access_token}`)
      res = await fetch(url, { ...options, headers })
    }
  }

  return res
}

/* ---------- Auth API Functions ---------- */

export async function register(payload: RegisterPayload): Promise<TokenPair> {
  const res = await fetch(`${AUTH_BASE}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const err = (await res.json().catch(() => ({ detail: 'Registration failed' }))) as ApiError
    throw new Error(err.detail)
  }

  const tokens = (await res.json()) as TokenPair
  storeTokens(tokens)
  return tokens
}

export async function login(payload: LoginPayload): Promise<TokenPair> {
  const res = await fetch(`${AUTH_BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const err = (await res.json().catch(() => ({ detail: 'Login failed' }))) as ApiError
    throw new Error(err.detail)
  }

  const tokens = (await res.json()) as TokenPair
  storeTokens(tokens)
  return tokens
}

export async function logout(): Promise<void> {
  // Read CURRENT refresh token (not stale) and use plain fetch
  // to avoid authFetch's auto-refresh rotating the token first
  const refreshToken = getRefreshToken()
  const accessToken = getAccessToken()
  clearTokens() // Clear immediately so no further requests use old tokens

  if (refreshToken) {
    try {
      await fetch(`${AUTH_BASE}/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ refresh_token: refreshToken }),
      })
    } catch {
      // Best-effort server logout
    }
  }
}

export async function getCurrentUser(): Promise<UserResponse> {
  const res = await authFetch(`${AUTH_BASE}/me`)

  if (!res.ok) {
    throw new Error('Failed to fetch user')
  }

  return (await res.json()) as UserResponse
}
