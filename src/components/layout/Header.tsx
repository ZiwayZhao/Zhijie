import { Search, User } from 'lucide-react'
import { useLocation } from 'react-router-dom'

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
  const title = pageTitles[location.pathname] ?? '智阶'

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

        {/* User avatar placeholder */}
        <div className="w-8 h-8 rounded-full border border-border-warm bg-bg-accent flex items-center justify-center
                        hover:border-red-primary/40 transition-colors duration-200">
          <User size={15} strokeWidth={1.5} className="text-text-muted" />
        </div>
      </div>
    </header>
  )
}
