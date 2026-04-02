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
  X,
  SplitSquareHorizontal,
} from 'lucide-react'

const mainNav = [
  { to: '/', label: '首页', icon: Home },
  { to: '/agenda', label: '学习日程', icon: CalendarDays },
  { to: '/explore', label: '知识网络', icon: Compass },
  { to: '/upload', label: '上传', icon: Upload },
  { to: '/dev/per-page', label: '对照阅读', icon: SplitSquareHorizontal },
]

const libraryNav = [
  { to: '/my/courses', label: '我的课程', icon: BookOpen },
  { to: '/my/materials', label: '我的材料', icon: FileText },
  { to: '/my/notes', label: '我的笔记', icon: StickyNote },
  { to: '/my/flashcards', label: '我的闪卡', icon: Brain },
]

function NavItem({
  to,
  label,
  icon: Icon,
  onClick,
}: {
  to: string
  label: string
  icon: typeof Home
  onClick?: () => void
}) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      onClick={onClick}
      className={({ isActive }) =>
        [
          'flex items-center gap-3 px-4 py-2 text-sm transition-colors duration-150 relative',
          isActive
            ? 'text-text-main font-medium bg-bg-accent/60'
            : 'text-text-body hover:text-text-main hover:bg-bg-accent/40',
          isActive ? 'before:absolute before:left-0 before:top-1 before:bottom-1 before:w-[3px] before:bg-red-primary before:rounded-r-full' : '',
        ].join(' ')
      }
    >
      <Icon size={16} strokeWidth={1.5} />
      <span className="font-body">{label}</span>
    </NavLink>
  )
}

interface SidebarProps {
  mobile?: boolean
  onClose?: () => void
}

export default function Sidebar({ mobile, onClose }: SidebarProps) {
  const classes = mobile
    ? 'flex w-60 h-full bg-bg-card flex-col overflow-hidden border-r border-border-warm'
    : 'hidden lg:flex w-60 shrink-0 h-screen sticky top-0 border-r border-border-warm bg-bg-card flex-col overflow-hidden'

  return (
    <aside className={classes}>
      {/* Brand — masthead style */}
      <div className="px-6 pt-7 pb-5 border-b border-border-warm flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl text-red-primary tracking-tight m-0 leading-none">
            智阶
          </h1>
          <p className="text-[11px] text-text-muted mt-1.5 font-body tracking-widest uppercase">
            课程知识社区
          </p>
        </div>
        {mobile && onClose && (
          <button
            onClick={onClose}
            className="p-1 text-text-muted hover:text-text-main transition-colors"
          >
            <X size={18} />
          </button>
        )}
      </div>

      {/* Navigation — table-of-contents style */}
      <nav className="flex-1 min-h-0 py-4 space-y-1 overflow-y-auto">
        <div className="space-y-0.5">
          {mainNav.map((item) => (
            <NavItem key={item.to} {...item} onClick={mobile ? onClose : undefined} />
          ))}
        </div>

        <div className="pt-4">
          <p className="px-5 mb-2 text-[10px] font-heading text-text-muted tracking-widest uppercase">
            我的资料库
          </p>
          <div className="space-y-0.5">
            {libraryNav.map((item) => (
              <NavItem key={item.to} {...item} onClick={mobile ? onClose : undefined} />
            ))}
          </div>
        </div>
      </nav>

      {/* Bottom: Settings */}
      <div className="border-t border-border-warm px-0 py-3">
        <NavItem to="/settings" label="设置" icon={Settings} onClick={mobile ? onClose : undefined} />
      </div>
    </aside>
  )
}
