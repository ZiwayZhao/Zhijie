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
    <header className="flex items-center justify-between px-8 py-4 border-b border-border-warm bg-bg-card">
      <h2 className="font-heading text-xl text-text-main m-0">{title}</h2>

      <div className="flex items-center gap-4">
        {/* Search */}
        <div className="flex items-center gap-2 px-3 py-2 border border-border-warm rounded-md bg-bg-main text-text-muted text-sm">
          <Search size={16} strokeWidth={1.5} />
          <span>搜索...</span>
        </div>

        {/* User avatar placeholder */}
        <div className="w-8 h-8 rounded-full border border-border-warm bg-bg-accent flex items-center justify-center">
          <User size={16} strokeWidth={1.5} className="text-text-muted" />
        </div>
      </div>
    </header>
  )
}
