import { useState, useRef, useEffect } from 'react'
import { Search, User, LogOut, ChevronDown } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'

const pageTitles: Record<string, string> = {
  '/': '首页',
  '/agenda': '学习日程',
  '/explore': '知识网络',
  '/upload': '上传',
  '/my/courses': '我的课程',
  '/my/materials': '我的材料',
  '/my/notes': '我的笔记',
  '/my/flashcards': '我的闪卡',
  '/settings': '设置',
}

export default function Header() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, isAuthenticated, logout } = useAuth()
  const title = pageTitles[location.pathname] ?? '智阶'

  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close menu on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    if (menuOpen) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [menuOpen])

  async function handleLogout() {
    setMenuOpen(false)
    await logout()
    navigate('/auth/login', { replace: true })
  }

  return (
    <header className="flex items-center justify-between px-10 py-4 border-b border-border-warm bg-bg-card">
      {/* Page title — serif with decorative accent */}
      <div className="flex items-center gap-3">
        <div className="w-5 h-[2px] bg-red-primary rounded-full" />
        <h2 className="font-heading text-xl text-text-main m-0 tracking-tight">{title}</h2>
      </div>

      <div className="flex items-center gap-4">
        {/* Search — warm editorial styling */}
        <div className="flex items-center gap-2 px-3.5 py-2 border border-border-warm rounded-md bg-bg-main text-text-muted text-sm
                        hover:border-red-primary/40 transition-colors duration-200 cursor-pointer">
          <Search size={15} strokeWidth={1.5} />
          <span className="font-body text-xs tracking-wide">搜索...</span>
        </div>

        {/* User menu */}
        {isAuthenticated && user ? (
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-bg-accent/60 transition-colors"
            >
              <div className="w-8 h-8 rounded-full border border-border-warm bg-bg-accent flex items-center justify-center overflow-hidden">
                {user.avatar_url ? (
                  <img src={user.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover" />
                ) : (
                  <span className="text-xs font-body font-medium text-text-body">
                    {user.name.charAt(0).toUpperCase()}
                  </span>
                )}
              </div>
              <span className="text-sm font-body text-text-body max-w-[120px] truncate hidden sm:inline">
                {user.name}
              </span>
              <ChevronDown size={14} className="text-text-muted" />
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 w-48 border border-border-warm bg-bg-card rounded-md py-1 z-50">
                <div className="px-3 py-2 border-b border-border-warm">
                  <p className="text-sm font-body font-medium text-text-main truncate">{user.name}</p>
                  <p className="text-xs font-body text-text-muted truncate">{user.email}</p>
                </div>
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm font-body text-text-body hover:bg-bg-accent/60 transition-colors"
                >
                  <LogOut size={14} />
                  退出登录
                </button>
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={() => navigate('/auth/login')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-body text-red-primary border border-red-primary/30 rounded-md
                       hover:bg-red-primary/5 transition-colors"
          >
            <User size={15} strokeWidth={1.5} />
            登录
          </button>
        )}
      </div>
    </header>
  )
}
