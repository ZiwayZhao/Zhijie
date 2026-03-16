import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { motion, type Variants } from 'framer-motion'
import { Search, BookMarked, Users, TrendingUp, Library } from 'lucide-react'
import { courses, categories, getCoursesByCategory } from '@/mocks/courses'
import type { Course } from '@/mocks/courses'

const fadeUp: Variants = {
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
    <div className="p-8 lg:p-10 max-w-6xl space-y-10">
      {/* Page header — editorial masthead */}
      <motion.header
        initial="hidden"
        animate="visible"
        variants={fadeUp}
        custom={0}
        className="border-b border-border-warm pb-6"
      >
        <div className="flex items-center gap-3 mb-2">
          <Library size={20} strokeWidth={1.5} className="text-red-primary" />
          <span className="text-xs tracking-widest uppercase text-text-muted font-body">
            Knowledge Network
          </span>
        </div>
        <h1 className="font-heading text-4xl text-text-main leading-tight">
          知识网络
        </h1>
        <p className="text-sm text-text-muted mt-2 max-w-lg leading-relaxed">
          浏览课程知识节点，发现学习材料与社区资源
        </p>
      </motion.header>

      <SearchBar query={query} onChange={setQuery} />
      <CategoryFilter
        categories={categories}
        active={activeCategory}
        onSelect={setActiveCategory}
      />
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-10">
        <CourseGrid courses={filtered} />
        <TrendingSidebar courses={trending} />
      </div>
    </div>
  )
}

function SearchBar({ query, onChange }: { query: string; onChange: (v: string) => void }) {
  return (
    <motion.div initial="hidden" animate="visible" variants={fadeUp} custom={1}>
      <div className="relative max-w-xl">
        <Search
          size={18}
          strokeWidth={1.5}
          className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => onChange(e.target.value)}
          placeholder="搜索课程、学校或关键词..."
          className="w-full pl-12 pr-4 py-3 text-sm border border-border-warm rounded-sm
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
    <motion.nav
      initial="hidden"
      animate="visible"
      variants={fadeUp}
      custom={2}
      className="flex gap-0 border-b border-border-warm"
    >
      {categories.map((cat) => (
        <button
          key={cat}
          onClick={() => onSelect(cat)}
          className={[
            'px-5 py-2.5 text-sm transition-colors cursor-pointer relative -mb-px font-body',
            active === cat
              ? 'text-red-primary border-b-2 border-b-red-primary font-medium'
              : 'text-text-muted hover:text-text-body border-b-2 border-transparent',
          ].join(' ')}
        >
          {cat}
        </button>
      ))}
    </motion.nav>
  )
}

function CourseGrid({ courses }: { courses: Course[] }) {
  if (courses.length === 0) {
    return (
      <div className="py-20 text-center text-text-muted">
        <p className="font-heading text-lg">没有找到匹配的课程</p>
        <p className="text-sm mt-1">尝试更换搜索关键词或分类</p>
      </div>
    )
  }

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      className="columns-1 md:columns-2 gap-6 space-y-6"
    >
      {courses.map((course, i) => (
        <CourseCard key={course.id} course={course} index={i} />
      ))}
    </motion.div>
  )
}

function CourseCard({ course, index }: { course: Course; index: number }) {
  return (
    <motion.div variants={fadeUp} custom={index + 3} className="break-inside-avoid">
      <Link
        to={`/course/${course.id}`}
        className="group block border border-border-warm rounded-sm
                   bg-bg-card p-6 hover:border-red-primary transition-colors no-underline"
        style={{ contentVisibility: 'auto' }}
      >
        {/* Category label */}
        <span className="text-[10px] tracking-widest uppercase text-text-muted font-body">
          {course.category}
        </span>

        <h3 className="font-heading text-xl text-text-main mt-1.5 mb-1 group-hover:text-red-primary transition-colors">
          {course.name}
        </h3>
        <p className="text-xs text-text-muted italic font-body mb-3">{course.school}</p>

        {/* Thin red accent line */}
        <div className="w-8 h-px bg-red-primary mb-3" />

        <p className="text-sm text-text-body line-clamp-2 mb-4 leading-relaxed">{course.description}</p>

        <div className="flex items-center gap-5 text-xs text-text-muted mb-3">
          <span className="flex items-center gap-1.5">
            <BookMarked size={12} strokeWidth={1.5} />
            {course.materialCount} 份材料
          </span>
          <span className="flex items-center gap-1.5">
            <Users size={12} strokeWidth={1.5} />
            {course.studentCount} 名学生
          </span>
        </div>

        <div className="flex gap-1.5 flex-wrap">
          {course.tags.map((tag) => (
            <span
              key={tag}
              className="px-2 py-0.5 text-[11px] border border-border-warm text-text-muted bg-bg-main"
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
    <motion.aside initial="hidden" animate="visible" variants={fadeUp} custom={4}>
      <div className="border border-border-warm rounded-sm bg-bg-card p-6 sticky top-24">
        {/* Section label */}
        <div className="flex items-center gap-2 mb-1">
          <TrendingUp size={14} className="text-red-primary" strokeWidth={1.5} />
          <span className="text-[10px] tracking-widest uppercase text-text-muted font-body">
            Trending
          </span>
        </div>
        <h3 className="font-heading text-lg text-text-main mb-4">
          热门课程
        </h3>
        <div className="w-full h-px bg-border-warm mb-4" />

        <div className="space-y-0">
          {courses.map((c, i) => (
            <Link
              key={c.id}
              to={`/course/${c.id}`}
              className="flex items-start gap-3 py-3 border-b border-border-warm last:border-b-0
                         no-underline hover:bg-bg-accent -mx-2 px-2 rounded-sm transition-colors group"
            >
              <span className="font-heading text-lg text-border-warm group-hover:text-red-primary transition-colors w-6 shrink-0 leading-tight">
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="text-sm text-text-main font-medium truncate group-hover:text-red-primary transition-colors">
                  {c.name}
                </p>
                <p className="text-xs text-text-muted mt-0.5 italic">
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
