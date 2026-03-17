import { Routes, Route } from 'react-router-dom'
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
import LoginPage from '@/pages/LoginPage'
import RegisterPage from '@/pages/RegisterPage'
import GaolingLifePage from '@/pages/GaolingLifePage'
import config from '@/config'

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
      <Route path="/upload" element={<ProtectedRoute><Layout><UploadPage /></Layout></ProtectedRoute>} />
      <Route path="/my/courses" element={<ProtectedRoute><Layout><MyCoursesPage /></Layout></ProtectedRoute>} />
      <Route path="/my/materials" element={<ProtectedRoute><Layout><MyMaterialsPage /></Layout></ProtectedRoute>} />
      <Route path="/my/notes" element={<ProtectedRoute><Layout><MyNotesPage /></Layout></ProtectedRoute>} />
      <Route path="/my/flashcards" element={<ProtectedRoute><Layout><FlashcardsPage /></Layout></ProtectedRoute>} />
      <Route path="/my/flashcards/:deckId/review" element={<ProtectedRoute><Layout><ReviewPage /></Layout></ProtectedRoute>} />
      <Route path="/agenda" element={<ProtectedRoute><Layout><AgendaPage /></Layout></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><Layout><SettingsPage /></Layout></ProtectedRoute>} />

      {/* RUC-only: 高瓴生活 — route exists only when feature is enabled */}
      {config.features.gaolingLife && (
        <Route path="/gaoling" element={<Layout><GaolingLifePage /></Layout>} />
      )}
    </Routes>
  )
}
