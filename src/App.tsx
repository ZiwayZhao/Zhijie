import { Routes, Route } from 'react-router-dom'
import Layout from '@/components/layout/Layout'
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

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/explore" element={<ExplorePage />} />
        <Route path="/course/:id" element={<CoursePage />} />
        <Route path="/course/:id/material/:mid" element={<WorkbenchPage />} />
        <Route path="/upload" element={<UploadPage />} />
        <Route path="/my/courses" element={<MyCoursesPage />} />
        <Route path="/my/materials" element={<MyMaterialsPage />} />
        <Route path="/my/notes" element={<MyNotesPage />} />
        <Route path="/my/flashcards" element={<FlashcardsPage />} />
        <Route path="/my/flashcards/:deckId/review" element={<ReviewPage />} />
        <Route path="/agenda" element={<AgendaPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </Layout>
  )
}
