import { NavLink } from 'react-router-dom'
import {
  Home,
  CalendarDays,
  Compass,
  Upload,
  BookOpen,
  FileText,
  StickyNote,
  Brain,
  Settings,
} from 'lucide-react'

const navItems = [
  { to: '/', label: '首页', icon: Home },
  { to: '/agenda', label: '学习日程', icon: CalendarDays },
  { to: '/explore', label: '知识网络', icon: Compass },
  { to: '/upload', label: '上传', icon: Upload },
  { to: '/my/courses', label: '我的课程', icon: BookOpen },
  { to: '/my/materials', label: '我的材料', icon: FileText },
  { to: '/my/notes', label: '我的笔记', icon: StickyNote },
  { to: '/my/flashcards', label: '我的闪卡', icon: Brain },
]

export default function Sidebar() {
  return (
    <aside className="w-60 shrink-0 h-screen sticky top-0 border-r border-border-warm bg-bg-card flex flex-col">
      {/* Brand */}
      <div className="px-6 py-6">
        <h1 className="font-heading text-2xl text-red-primary tracking-tight m-0">
          智阶
        </h1>
        <p className="text-xs text-text-muted mt-1">课程知识社区</p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 space-y-1">
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              [
                'flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors',
                isActive
                  ? 'border-l-3 border-red-primary bg-bg-accent text-text-main font-medium'
                  : 'border-l-3 border-transparent text-text-body hover:bg-bg-accent hover:text-text-main',
              ].join(' ')
            }
          >
            <Icon size={18} strokeWidth={1.5} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Bottom: Settings */}
      <div className="px-3 pb-4 border-t border-border-warm pt-3">
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            [
              'flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors',
              isActive
                ? 'border-l-3 border-red-primary bg-bg-accent text-text-main font-medium'
                : 'border-l-3 border-transparent text-text-body hover:bg-bg-accent hover:text-text-main',
            ].join(' ')
          }
        >
          <Settings size={18} strokeWidth={1.5} />
          <span>设置</span>
        </NavLink>
      </div>
    </aside>
  )
}
