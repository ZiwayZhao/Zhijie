import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  clearTokens,
  getAccessToken,
  getCurrentUser,
  login as apiLogin,
  logout as apiLogout,
  register as apiRegister,
  setOnSessionExpired,
  type LoginPayload,
  type RegisterPayload,
  type UserResponse,
} from '@/lib/auth-api'
// Lazy import to keep sync-service chunk-splittable
const triggerBootSync = () =>
  import('@/lib/sync-service').then(({ bootSync }) => bootSync()).catch(() => {})

/* ---------- Types ---------- */

interface AuthState {
  user: UserResponse | null
  isLoading: boolean
  isAuthenticated: boolean
}

interface AuthActions {
  login: (payload: LoginPayload) => Promise<void>
  register: (payload: RegisterPayload) => Promise<void>
  logout: () => Promise<void>
}

type AuthContextValue = AuthState & AuthActions

/* ---------- Context ---------- */

const AuthContext = createContext<AuthContextValue | null>(null)

/* ---------- Provider ---------- */

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Register global session-expired handler (clears user on refresh failure)
  useEffect(() => {
    setOnSessionExpired(() => setUser(null))
  }, [])

  // On mount: check if we have a valid token and fetch user (with cleanup)
  useEffect(() => {
    const token = getAccessToken()
    if (!token) {
      setIsLoading(false)
      return
    }

    const controller = new AbortController()
    let cancelled = false

    getCurrentUser()
      .then((u) => {
        if (!cancelled) {
          setUser(u)
          // Boot sync: pull backend data → merge with localStorage
          triggerBootSync()
        }
      })
      .catch(() => {
        if (!cancelled) clearTokens()
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [])

  // Cross-tab sync: listen for localStorage changes (login/logout in other tabs)
  useEffect(() => {
    function handleStorageChange(e: StorageEvent) {
      if (e.key === 'zhijie_access_token') {
        if (!e.newValue) {
          // Token removed in another tab → logout here too
          setUser(null)
        } else if (!user && e.newValue) {
          // Token added in another tab → fetch user
          getCurrentUser()
            .then(setUser)
            .catch(() => clearTokens())
        }
      }
    }

    window.addEventListener('storage', handleStorageChange)
    return () => window.removeEventListener('storage', handleStorageChange)
  }, [user])

  const login = useCallback(async (payload: LoginPayload) => {
    await apiLogin(payload)
    const u = await getCurrentUser()
    setUser(u)
    triggerBootSync()
  }, [])

  const register = useCallback(async (payload: RegisterPayload) => {
    // Backend /register already returns TokenPair and stores tokens
    await apiRegister(payload)
    const u = await getCurrentUser()
    setUser(u)
    triggerBootSync()
  }, [])

  const logout = useCallback(async () => {
    await apiLogout()
    setUser(null)
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      isAuthenticated: user !== null,
      login,
      register,
      logout,
    }),
    [user, isLoading, login, register, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

/* ---------- Hook ---------- */

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return ctx
}
