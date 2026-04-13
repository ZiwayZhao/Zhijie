import { Routes, Route } from 'react-router-dom'
import { STORAGE_KEYS } from '@/lib/storage-keys'
import Layout from '@/components/layout/Layout'
import ProtectedRoute from '@/components/auth/ProtectedRoute'
import HomePage from '@/pages/HomePage'
import ExplorePage from '@/pages/ExplorePage'
import CoursePage from '@/pages/CoursePage'
import WorkbenchPage from '@/pages/WorkbenchPage'
import UploadPage from '@/pages/UploadPage'
import MyCoursesPage from '@/pages/MyCoursesPage'
import MyMaterialsPage from '@/pages/MyMaterialsPage'
import MyNotesPage from '@/pages/MyNotesPage'
import SettingsPage from '@/pages/SettingsPage'
import FlashcardsPage from '@/pages/FlashcardsPage'
import ReviewPage from '@/pages/ReviewPage'
import AgendaPage from '@/pages/AgendaPage'
import { lazy, Suspense } from 'react'
import PerPageDemoPage from '@/pages/PerPageDemoPage'
import LoginPage from '@/pages/LoginPage'
import RegisterPage from '@/pages/RegisterPage'

const StudyDeskPage = lazy(() => import('@/pages/StudyDeskPage'))
const DevBatchTestPage = lazy(() => import('@/pages/DevBatchTestPage'))

// Apply saved theme/fontSize before first render to avoid flash
;(() => {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.USER_PREFERENCES)
    if (raw) {
      const prefs = JSON.parse(raw)
      if (prefs.theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark')
      const sizeMap: Record<string, string> = { '小': '14px', '标准': '16px', '大': '18px' }
      if (prefs.fontSize && sizeMap[prefs.fontSize]) document.documentElement.style.fontSize = sizeMap[prefs.fontSize]
    }
  } catch { /* ignore */ }
})()

export default function App() {
  return (
    <Routes>
      {/* Auth routes — no Layout, no sidebar/header */}
      <Route path="/auth/login" element={<LoginPage />} />
      <Route path="/auth/register" element={<RegisterPage />} />

      {/* Public routes (browse without auth) */}
      <Route path="/explore" element={<Layout><ExplorePage /></Layout>} />
      <Route path="/course/:id" element={<Layout><CoursePage /></Layout>} />

      {/* Protected routes — ProtectedRoute wraps Layout so redirect
          happens BEFORE rendering app chrome (Sidebar/Header) */}
      {/* Home is public — shows different content for auth vs guest */}
      <Route path="/" element={<Layout><HomePage /></Layout>} />
      <Route path="/course/:id/material/:mid" element={<ProtectedRoute><Layout><WorkbenchPage /></Layout></ProtectedRoute>} />
      <Route path="/course/:id/study" element={<ProtectedRoute><Layout><Suspense fallback={<div className="flex items-center justify-center min-h-[60vh]"><div className="w-6 h-6 border-2 border-red-primary/30 border-t-red-primary rounded-full animate-spin" /></div>}><StudyDeskPage /></Suspense></Layout></ProtectedRoute>} />
      <Route path="/upload" element={<ProtectedRoute><Layout><UploadPage /></Layout></ProtectedRoute>} />
      <Route path="/my/courses" element={<ProtectedRoute><Layout><MyCoursesPage /></Layout></ProtectedRoute>} />
      <Route path="/my/materials" element={<ProtectedRoute><Layout><MyMaterialsPage /></Layout></ProtectedRoute>} />
      <Route path="/my/notes" element={<ProtectedRoute><Layout><MyNotesPage /></Layout></ProtectedRoute>} />
      <Route path="/my/flashcards" element={<ProtectedRoute><Layout><FlashcardsPage /></Layout></ProtectedRoute>} />
      <Route path="/my/flashcards/:deckId/review" element={<ProtectedRoute><Layout><ReviewPage /></Layout></ProtectedRoute>} />
      <Route path="/agenda" element={<ProtectedRoute><Layout><AgendaPage /></Layout></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><Layout><SettingsPage /></Layout></ProtectedRoute>} />
      <Route path="/dev/per-page" element={<Layout><PerPageDemoPage /></Layout>} />
      <Route path="/dev/test-batch" element={<Layout><Suspense fallback={null}><DevBatchTestPage /></Suspense></Layout>} />
    </Routes>
  )
}
