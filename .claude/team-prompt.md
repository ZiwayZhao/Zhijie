You are the Team Lead for the Zhijie (智阶新版) project.
Working directory: /Users/ziway/Downloads/工程项目/智阶新版/

## Context
Read CLAUDE.md for full project context. Key points:
- Editorial Academic design system (Instrument Serif headings, Satoshi body, warm paper tones, borders over shadows)
- Colors: red-primary #A5192E, bg-main #F7F5F2, bg-card #FFFEFB, text-main #1A1A1A, accent-gold #C49A2A
- Tailwind CSS v4 with @theme directive in src/index.css
- Framer Motion for animations
- All operations MUST stay inside /Users/ziway/Downloads/工程项目/智阶新版/

## Your Mission
Launch 4 Teammates working in parallel. Each teammate must:
1. Research best practices online before coding
2. Implement changes
3. Run `npx tsc --noEmit` to verify

### Teammate 1: Frontend Design Lead — 全局风格协调
**Goal**: Make the entire app feel cohesive with the Editorial Academic design system. The recent Phase 3-5 additions broke visual harmony.

Tasks:
1. Read src/index.css to understand the @theme setup
2. Audit ALL page files in src/pages/ — check every page uses consistent:
   - Background: bg-main for page, bg-card for cards
   - Typography: font-heading for all h1/h2, text-text-main for headings, text-text-body for body
   - Cards: border border-border-warm, NO box-shadow anywhere
   - Accent: border-l-3 border-l-red-primary for emphasis blocks
3. Fix HomePage.tsx — the greeting section and stats should feel like a magazine editorial spread, not a dashboard
4. Fix AgendaPage.tsx — ensure AgendaTimeline matches the warm paper aesthetic
5. Fix FlashcardsPage.tsx — DeckList cards should have clear hierarchy (serif heading, warm bg, red accent)
6. Verify staggered fade-in animations on all list views (delay: index * 0.05)

After fixes: `npx tsc --noEmit`

### Teammate 2: Mock Data Expert — 专业化 Mock 数据
**Goal**: Make mock data realistic and comprehensive so the app feels alive during demo.

Tasks:
1. **Research**: Search the web for "university course flashcard data examples", "spaced repetition demo data", "student learning analytics mock data" to get realistic content
2. Enrich src/mocks/flashcards.ts:
   - Add 3-4 diverse decks (离散数学, 量子力学, 有机化学, 算法设计)
   - Each deck: 8-15 cards with realistic academic content (formulas, definitions, concepts)
   - Include cloze type cards with LaTeX: `{{c1::formula}}`
   - Mix of new/learning/review states with realistic FSRS parameters
3. Enrich src/mocks/agenda.ts:
   - More diverse agenda items (3+ courses, varied priorities)
   - Realistic exam dates (some in 3 days, some in 2 weeks)
   - Todo items that feel like real student tasks
4. Enrich src/mocks/materials.ts:
   - Add 2-3 more course materials with realistic titles/descriptions
   - Ensure material types are diverse (lecture slides, problem sets, notes)
5. Enrich src/mocks/courses.ts (if exists) or create richer course data

After changes: `npx tsc --noEmit`

### Teammate 3: Interaction & Animation Polish — 交互细节打磨
**Goal**: Make every interaction feel premium and smooth.

Tasks:
1. **Research**: Search the web for "framer motion card flip animation best practices", "editorial web design micro-interactions"
2. Review src/components/flashcard/FlashcardCard.tsx:
   - Card flip should be smooth 3D perspective transform
   - Add subtle scale on hover
   - Rating buttons should have clear visual feedback (active state)
3. Review src/components/workbench/SocraticChat.tsx:
   - Chat messages should animate in smoothly
   - Typing indicator before AI response appears
   - Scroll behavior should be smooth
4. Review src/components/agenda/DailyPlan.tsx and AgendaItem:
   - Todo checkbox should have satisfying check animation
   - Completed items should fade/strike-through smoothly
5. Review all page transitions — ensure consistent staggered entrance animations

After changes: `npx tsc --noEmit`

### Teammate 4: Code Quality & Build Verification — 代码质量验收
**Goal**: Final quality gate — ensure everything compiles, builds, and meets standards.

Tasks:
1. Run `npx tsc --noEmit` — fix any type errors
2. Run `npx vite build` — fix any build errors
3. Check all files in src/ are <= 400 lines: `wc -l src/**/*.tsx src/**/*.ts`
4. Verify src/lib/storage-keys.ts is used consistently — grep for any remaining hardcoded 'zhijie_' strings
5. Verify ErrorBoundary wraps all lazy-loaded components
6. Check for unused imports across all modified files
7. Ensure no `console.log` left in production code (console.error is OK)

After ALL checks pass, report status.

## After All Teammates Complete
1. Run final: `npx tsc --noEmit && npx vite build`
2. If errors, assign fixes
3. Stage all changes: `git add -A`
4. Commit: `git commit -m "refactor: agent team polish — visual harmony, rich mocks, interaction smoothness, code quality"`
5. Push: `git push origin master`
