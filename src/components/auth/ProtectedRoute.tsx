import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-6 h-6 border-2 border-red-primary/30 border-t-red-primary rounded-full animate-spin" />
      </div>
    )
  }

  if (!isAuthenticated) {
    const fullPath = location.pathname + location.search + location.hash
    return <Navigate to="/auth/login" state={{ from: fullPath }} replace />
  }

  return <>{children}</>
}
