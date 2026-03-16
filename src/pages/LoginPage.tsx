import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { LogIn, AlertCircle } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'

export default function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const from = (location.state as { from?: string })?.from || '/'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (isSubmitting) return
    setError('')
    setIsSubmitting(true)

    try {
      await login({ email, password })
      navigate(from, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败，请重试')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-bg-main flex items-center justify-center px-4">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md"
      >
        {/* Brand header */}
        <div className="text-center mb-8">
          <h1 className="font-heading text-4xl text-red-primary tracking-tight">智阶</h1>
          <p className="text-text-muted text-sm font-body mt-2 tracking-wide">课程知识社区</p>
        </div>

        {/* Login card */}
        <div className="border border-border-warm bg-bg-card rounded-lg p-8">
          <div className="flex items-center gap-2 mb-6">
            <div className="w-4 h-[2px] bg-red-primary rounded-full" />
            <h2 className="font-heading text-xl text-text-main">登录</h2>
          </div>

          {error && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2 p-3 mb-4 border border-red-primary/20 bg-red-primary/5 rounded-md text-sm text-red-primary"
            >
              <AlertCircle size={16} />
              <span>{error}</span>
            </motion.div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-body text-text-body mb-1.5">
                邮箱
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3.5 py-2.5 border border-border-warm rounded-md bg-bg-main text-text-main font-body text-sm
                           placeholder:text-text-muted/60 focus:outline-none focus:border-red-primary/60 transition-colors"
                placeholder="your@email.com"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-body text-text-body mb-1.5">
                密码
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 border border-border-warm rounded-md bg-bg-main text-text-main font-body text-sm
                           placeholder:text-text-muted/60 focus:outline-none focus:border-red-primary/60 transition-colors"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-red-primary text-white font-body text-sm rounded-md
                         hover:bg-red-dark transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <LogIn size={16} />
              {isSubmitting ? '登录中...' : '登录'}
            </button>
          </form>

          <p className="text-center text-sm text-text-muted mt-6 font-body">
            还没有账号？{' '}
            <Link to="/auth/register" className="text-red-primary hover:text-red-dark transition-colors">
              注册
            </Link>
          </p>
        </div>
      </motion.div>
    </div>
  )
}
