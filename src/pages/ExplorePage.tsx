import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { motion, type Variants } from 'framer-motion'
import { Search, TrendingUp, Library, Star, Globe, ExternalLink } from 'lucide-react'
import { fetchCourses, fetchCategories, type CourseItem, type CategoryItem } from '@/lib/api'

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
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState<string>('')
  const [categories, setCategories] = useState<CategoryItem[]>([])
  const [courses, setCourses] = useState<CourseItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const pageSize = 30

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300)
    return () => clearTimeout(t)
  }, [query])

  // Fetch categories on mount
  useEffect(() => {
    fetchCategories()
      .then(setCategories)
      .catch((e) => console.error('Failed to load categories:', e))
  }, [])

  // Fetch courses when filters change
  const loadCourses = useCallback(async () => {
    setLoading(true)
    try {
      const result = await fetchCourses({
        page,
        pageSize,
        category: activeCategory || undefined,
        search: debouncedQuery || undefined,
      })
      setCourses(result.items)
      setTotal(result.total)
    } catch (e) {
      console.error('Failed to load courses:', e)
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, activeCategory, debouncedQuery])

  useEffect(() => { loadCourses() }, [loadCourses])

  // Reset page when filters change
  useEffect(() => { setPage(1) }, [activeCategory, debouncedQuery])

  // Top-level categories only (no sub-categories)
  const topCategories = categories.filter((c) => !c.parentId)

  return (
    <div className="p-8 lg:p-10 max-w-6xl space-y-10">
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
          浏览 {total} 门来自 csdiy.wiki 的优质计算机课程
        </p>
      </motion.header>

      <SearchBar query={query} onChange={setQuery} />
      <CategoryFilter
        categories={topCategories}
        active={activeCategory}
        onSelect={(slug) => setActiveCategory(slug === activeCategory ? '' : slug)}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-10">
        {loading ? (
          <CourseGridSkeleton />
        ) : (
          <CourseGrid courses={courses} />
        )}
        <TrendingSidebar categories={topCategories} />
      </div>

      {/* Pagination */}
      {total > pageSize && (
        <div className="flex justify-center gap-2 pt-4">
          {Array.from({ length: Math.ceil(total / pageSize) }, (_, i) => i + 1).map((p) => (
            <button
              key={p}
              onClick={() => setPage(p)}
              className={`w-8 h-8 text-sm rounded-sm border transition-colors ${
                p === page
                  ? 'border-red-primary text-red-primary bg-red-primary/5'
                  : 'border-border-warm text-text-muted hover:border-red-primary'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      )}
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
  categories: CategoryItem[]
  active: string
  onSelect: (slug: string) => void
}) {
  return (
    <motion.nav
      initial="hidden"
      animate="visible"
      variants={fadeUp}
      custom={2}
      className="flex gap-0 border-b border-border-warm overflow-x-auto"
    >
      {categories.map((cat) => (
        <button
          key={cat.slug}
          onClick={() => onSelect(cat.slug)}
          className={[
            'px-4 py-2.5 text-sm transition-colors cursor-pointer relative -mb-px font-body whitespace-nowrap',
            active === cat.slug
              ? 'text-red-primary border-b-2 border-b-red-primary font-medium'
              : 'text-text-muted hover:text-text-body border-b-2 border-transparent',
          ].join(' ')}
        >
          {cat.name}
          <span className="ml-1 text-xs opacity-60">{cat.courseCount}</span>
        </button>
      ))}
    </motion.nav>
  )
}

function CourseGrid({ courses }: { courses: CourseItem[] }) {
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
        <CourseCard key={course.slug} course={course} index={i} />
      ))}
    </motion.div>
  )
}

function CourseCard({ course, index }: { course: CourseItem; index: number }) {
  const stars = Array.from({ length: course.difficulty }, (_, i) => i)

  return (
    <motion.div variants={fadeUp} custom={index + 3} className="break-inside-avoid">
      <Link
        to={`/course/${course.slug}`}
        className="group block border border-border-warm rounded-sm
                   bg-bg-card p-6 hover:border-red-primary transition-colors no-underline"
        style={{ contentVisibility: 'auto' }}
      >
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] tracking-widest uppercase text-text-muted font-body">
            {course.category}
          </span>
          <div className="flex gap-0.5">
            {stars.map((s) => (
              <Star key={s} size={10} className="text-accent-gold fill-accent-gold" />
            ))}
          </div>
        </div>

        <h3 className="font-heading text-xl text-text-main mt-1 mb-1 group-hover:text-red-primary transition-colors leading-snug">
          {course.name}
        </h3>
        {course.school && (
          <p className="text-xs text-text-muted italic font-body mb-3">{course.school}</p>
        )}

        <div className="w-8 h-px bg-red-primary mb-3" />

        {course.description && (
          <p className="text-sm text-text-body line-clamp-2 mb-4 leading-relaxed">{course.description}</p>
        )}

        <div className="flex items-center gap-5 text-xs text-text-muted mb-3">
          {course.estimatedHours && (
            <span className="flex items-center gap-1">
              ~{course.estimatedHours}h
            </span>
          )}
          {course.programmingLang && (
            <span className="flex items-center gap-1">
              {course.programmingLang}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Globe size={11} strokeWidth={1.5} />
            {course.language === 'zh' ? '中文' : 'EN'}
          </span>
        </div>

        <div className="flex gap-1.5 flex-wrap">
          {course.tags.slice(0, 4).map((tag) => (
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

function CourseGridSkeleton() {
  return (
    <div className="columns-1 md:columns-2 gap-6 space-y-6">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="break-inside-avoid border border-border-warm rounded-sm bg-bg-card p-6 animate-pulse">
          <div className="h-3 w-20 bg-border-warm rounded mb-3" />
          <div className="h-6 w-3/4 bg-border-warm rounded mb-2" />
          <div className="h-4 w-1/3 bg-border-warm rounded mb-3" />
          <div className="h-px w-8 bg-border-warm mb-3" />
          <div className="h-4 w-full bg-border-warm rounded mb-1" />
          <div className="h-4 w-2/3 bg-border-warm rounded" />
        </div>
      ))}
    </div>
  )
}

function TrendingSidebar({ categories }: { categories: CategoryItem[] }) {
  // Show top categories by course count
  const top = [...categories].sort((a, b) => b.courseCount - a.courseCount).slice(0, 8)

  return (
    <motion.aside initial="hidden" animate="visible" variants={fadeUp} custom={4}>
      <div className="border border-border-warm rounded-sm bg-bg-card p-6 sticky top-24">
        <div className="flex items-center gap-2 mb-1">
          <TrendingUp size={14} className="text-red-primary" strokeWidth={1.5} />
          <span className="text-[10px] tracking-widest uppercase text-text-muted font-body">
            Categories
          </span>
        </div>
        <h3 className="font-heading text-lg text-text-main mb-4">
          热门分类
        </h3>
        <div className="w-full h-px bg-border-warm mb-4" />

        <div className="space-y-0">
          {top.map((c, i) => (
            <div
              key={c.slug}
              className="flex items-start gap-3 py-3 border-b border-border-warm last:border-b-0"
            >
              <span className="font-heading text-lg text-border-warm w-6 shrink-0 leading-tight">
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="text-sm text-text-main font-medium truncate">
                  {c.name}
                </p>
                <p className="text-xs text-text-muted mt-0.5 italic">
                  {c.courseCount} 门课程
                </p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 pt-4 border-t border-border-warm">
          <p className="text-xs text-text-muted leading-relaxed">
            课程数据来自{' '}
            <a
              href="https://csdiy.wiki"
              target="_blank"
              rel="noopener noreferrer"
              className="text-red-primary hover:underline inline-flex items-center gap-0.5"
            >
              csdiy.wiki <ExternalLink size={10} />
            </a>
          </p>
        </div>
      </div>
    </motion.aside>
  )
}
