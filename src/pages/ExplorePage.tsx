import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Search, BookMarked, Users, TrendingUp } from 'lucide-react'
import { courses, categories, getCoursesByCategory } from '@/mocks/courses'
import type { Course } from '@/mocks/courses'

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.06, duration: 0.4, ease: 'easeOut' },
  }),
}

export default function ExplorePage() {
  const [query, setQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState('全部')

  const filtered = useMemo(() => {
    const byCat = getCoursesByCategory(activeCategory)
    if (!query.trim()) return byCat
    const q = query.toLowerCase()
    return byCat.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.school.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q),
    )
  }, [query, activeCategory])

  const trending = useMemo(
    () => [...courses].sort((a, b) => b.studentCount - a.studentCount).slice(0, 5),
    [],
  )

  return (
    <div className="p-8 max-w-6xl space-y-8">
      <SearchBar query={query} onChange={setQuery} />
      <CategoryFilter
        categories={categories}
        active={activeCategory}
        onSelect={setActiveCategory}
      />
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-8">
        <CourseGrid courses={filtered} />
        <TrendingSidebar courses={trending} />
      </div>
    </div>
  )
}

function SearchBar({ query, onChange }: { query: string; onChange: (v: string) => void }) {
  return (
    <motion.div initial="hidden" animate="visible" variants={fadeUp} custom={0}>
      <div className="relative max-w-xl mx-auto">
        <Search
          size={20}
          strokeWidth={1.5}
          className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => onChange(e.target.value)}
          placeholder="搜索课程、学校或关键词..."
          className="w-full pl-12 pr-4 py-3.5 text-base border border-border-warm rounded-md
                     bg-bg-card text-text-body placeholder:text-text-muted
                     focus:outline-none focus:border-red-primary transition-colors
                     font-body"
        />
      </div>
    </motion.div>
  )
}

function CategoryFilter({
  categories,
  active,
  onSelect,
}: {
  categories: string[]
  active: string
  onSelect: (c: string) => void
}) {
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={fadeUp}
      custom={1}
      className="flex gap-2 flex-wrap"
    >
      {categories.map((cat) => (
        <button
          key={cat}
          onClick={() => onSelect(cat)}
          className={[
            'px-4 py-1.5 text-sm rounded-sm border transition-colors cursor-pointer',
            active === cat
              ? 'border-red-primary bg-red-primary text-white'
              : 'border-border-warm bg-bg-card text-text-body hover:border-red-primary',
          ].join(' ')}
        >
          {cat}
        </button>
      ))}
    </motion.div>
  )
}

function CourseGrid({ courses }: { courses: Course[] }) {
  if (courses.length === 0) {
    return (
      <div className="py-16 text-center text-text-muted">
        <p className="text-lg">没有找到匹配的课程</p>
        <p className="text-sm mt-1">尝试更换搜索关键词或分类</p>
      </div>
    )
  }

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      className="columns-1 md:columns-2 gap-5 space-y-5"
    >
      {courses.map((course, i) => (
        <CourseCard key={course.id} course={course} index={i} />
      ))}
    </motion.div>
  )
}

function CourseCard({ course, index }: { course: Course; index: number }) {
  return (
    <motion.div variants={fadeUp} custom={index + 2} className="break-inside-avoid">
      <Link
        to={`/course/${course.id}`}
        className="block border border-border-warm border-l-3 border-l-red-primary rounded-md
                   bg-bg-card p-5 hover:border-red-primary transition-colors no-underline"
        style={{ contentVisibility: 'auto' }}
      >
        <h3 className="font-heading text-lg text-text-main mb-1">{course.name}</h3>
        <p className="text-xs text-text-muted mb-2">{course.school}</p>
        <p className="text-sm text-text-body line-clamp-2 mb-3">{course.description}</p>
        <div className="flex items-center gap-4 text-xs text-text-muted mb-3">
          <span className="flex items-center gap-1">
            <BookMarked size={13} strokeWidth={1.5} />
            {course.materialCount} 份材料
          </span>
          <span className="flex items-center gap-1">
            <Users size={13} strokeWidth={1.5} />
            {course.studentCount} 名学生
          </span>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {course.tags.map((tag) => (
            <span
              key={tag}
              className="px-2 py-0.5 text-xs rounded-sm border border-border-warm text-text-muted bg-bg-accent"
            >
              {tag}
            </span>
          ))}
        </div>
      </Link>
    </motion.div>
  )
}

function TrendingSidebar({ courses }: { courses: Course[] }) {
  return (
    <motion.aside initial="hidden" animate="visible" variants={fadeUp} custom={3}>
      <div className="border border-border-warm rounded-md bg-bg-card p-5 sticky top-24">
        <h3 className="font-heading text-base text-text-main mb-4 flex items-center gap-2">
          <TrendingUp size={16} className="text-red-primary" strokeWidth={1.5} />
          热门课程
        </h3>
        <div className="space-y-0">
          {courses.map((c, i) => (
            <Link
              key={c.id}
              to={`/course/${c.id}`}
              className="flex items-start gap-3 py-3 border-b border-border-warm last:border-b-0
                         no-underline hover:bg-bg-accent -mx-2 px-2 rounded-sm transition-colors"
            >
              <span className="text-sm font-medium text-text-muted w-5 shrink-0 mt-0.5">
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="text-sm text-text-main font-medium truncate">{c.name}</p>
                <p className="text-xs text-text-muted mt-0.5">
                  {c.school} · {c.studentCount} 学生
                </p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </motion.aside>
  )
}
