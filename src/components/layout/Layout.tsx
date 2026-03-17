import { useState, type ReactNode } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import Header from '@/components/layout/Header'

interface LayoutProps {
  children: ReactNode
}

export default function Layout({ children }: LayoutProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  return (
    <div className="flex min-h-screen bg-bg-main">
      {/* Desktop sidebar */}
      <Sidebar />

      {/* Mobile overlay */}
      {mobileMenuOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/30 z-40 lg:hidden"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 w-60 z-50 lg:hidden">
            <Sidebar mobile onClose={() => setMobileMenuOpen(false)} />
          </div>
        </>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <Header onMenuToggle={() => setMobileMenuOpen((v) => !v)} />
        <main className="flex-1">{children}</main>
      </div>
    </div>
  )
}
