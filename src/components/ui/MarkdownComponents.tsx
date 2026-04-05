/**
 * MarkdownComponents — shared react-markdown component map for the Editorial Academic design system.
 *
 * Usage:
 *   import { baseMdComponents, createMdComponents } from '@/components/ui/MarkdownComponents'
 *
 *   // Use the base components directly
 *   <ReactMarkdown components={baseMdComponents}>...</ReactMarkdown>
 *
 *   // Or merge custom overrides (e.g. compact sizing for a sidebar)
 *   <ReactMarkdown components={createMdComponents({ p: ({ children }) => <>{children}</> })}>...</ReactMarkdown>
 */

import type { Components } from 'react-markdown'

/* ------------------------------------------------------------------ */
/*  Base component map — full editorial Academic styling               */
/*  Matches the full prose layout used in MaterialReader / FormulaSheetTab */
/* ------------------------------------------------------------------ */

export const baseMdComponents: Components = {
  h1: ({ children, ...props }: React.ComponentPropsWithoutRef<'h1'>) => (
    <h1
      className="font-heading text-2xl text-text-main mt-8 mb-4 pb-2 border-b border-border-warm"
      {...props}
    >
      {children}
    </h1>
  ),
  h2: ({ children, ...props }: React.ComponentPropsWithoutRef<'h2'>) => (
    <h2
      className="font-heading text-xl text-text-main mt-8 mb-3 pl-3 border-l-3 border-l-red-primary"
      {...props}
    >
      {children}
    </h2>
  ),
  h3: ({ children, ...props }: React.ComponentPropsWithoutRef<'h3'>) => (
    <h3 className="font-heading text-lg text-text-main mt-6 mb-2" {...props}>
      {children}
    </h3>
  ),
  h4: ({ children, ...props }: React.ComponentPropsWithoutRef<'h4'>) => (
    <h4
      className="font-heading text-base font-semibold text-text-main mt-4 mb-1.5"
      {...props}
    >
      {children}
    </h4>
  ),
  p: ({ children, ...props }: React.ComponentPropsWithoutRef<'p'>) => (
    <p className="text-[15px] text-text-body leading-relaxed mb-4" {...props}>
      {children}
    </p>
  ),
  ul: ({ children, ...props }: React.ComponentPropsWithoutRef<'ul'>) => (
    <ul
      className="list-disc pl-5 space-y-1.5 text-[15px] text-text-body mb-4"
      {...props}
    >
      {children}
    </ul>
  ),
  ol: ({ children, ...props }: React.ComponentPropsWithoutRef<'ol'>) => (
    <ol
      className="list-decimal pl-5 space-y-1.5 text-[15px] text-text-body mb-4"
      {...props}
    >
      {children}
    </ol>
  ),
  blockquote: ({
    children,
    ...props
  }: React.ComponentPropsWithoutRef<'blockquote'>) => (
    <blockquote
      className="border-l-3 border-l-red-primary bg-bg-accent pl-4 py-3 my-4 italic text-text-body"
      {...props}
    >
      {children}
    </blockquote>
  ),
  table: ({ children, ...props }: React.ComponentPropsWithoutRef<'table'>) => (
    <div className="overflow-x-auto my-4">
      <table className="w-full text-sm border border-border-warm" {...props}>
        {children}
      </table>
    </div>
  ),
  th: ({ children, ...props }: React.ComponentPropsWithoutRef<'th'>) => (
    <th
      className="px-3 py-2 text-left font-medium text-text-main bg-bg-accent border border-border-warm"
      {...props}
    >
      {children}
    </th>
  ),
  td: ({ children, ...props }: React.ComponentPropsWithoutRef<'td'>) => (
    <td className="px-3 py-2 text-text-body border border-border-warm" {...props}>
      {children}
    </td>
  ),
  code: ({
    children,
    className,
    ...props
  }: React.ComponentPropsWithoutRef<'code'> & { className?: string }) => {
    const isBlock = className?.startsWith('language-')
    if (isBlock) {
      return (
        <code
          className="block bg-text-main text-bg-main p-4 rounded-sm overflow-x-auto text-sm font-mono my-4"
          {...props}
        >
          {children}
        </code>
      )
    }
    return (
      <code
        className="px-1.5 py-0.5 text-sm bg-bg-accent text-red-primary border border-border-warm rounded-sm font-mono"
        {...props}
      >
        {children}
      </code>
    )
  },
  pre: ({ children, ...props }: React.ComponentPropsWithoutRef<'pre'>) => (
    <pre className="my-4" {...props}>
      {children}
    </pre>
  ),
  strong: ({ children, ...props }: React.ComponentPropsWithoutRef<'strong'>) => (
    <strong className="font-semibold text-text-main" {...props}>
      {children}
    </strong>
  ),
  hr: (props: React.ComponentPropsWithoutRef<'hr'>) => (
    <hr className="border-t border-border-warm my-4" {...props} />
  ),
}

/* ------------------------------------------------------------------ */
/*  Compact variant — smaller text/spacing for card interiors          */
/*  Used by KnowledgeCardsTab where prose is inside a bordered card    */
/* ------------------------------------------------------------------ */

export const compactMdComponents: Components = createMdComponents({
  p: ({ children, ...props }: React.ComponentPropsWithoutRef<'p'>) => (
    <p className="text-[15px] text-text-body leading-relaxed mb-3" {...props}>
      {children}
    </p>
  ),
  table: ({ children, ...props }: React.ComponentPropsWithoutRef<'table'>) => (
    <div className="overflow-x-auto my-3">
      <table className="w-full text-sm border border-border-warm" {...props}>
        {children}
      </table>
    </div>
  ),
  code: ({
    children,
    className,
    ...props
  }: React.ComponentPropsWithoutRef<'code'> & { className?: string }) => {
    const isBlock = className?.startsWith('language-')
    if (isBlock) {
      return (
        <code
          className="block bg-text-main text-bg-main p-4 rounded-sm overflow-x-auto text-sm font-mono my-3"
          {...props}
        >
          {children}
        </code>
      )
    }
    return (
      <code
        className="px-1.5 py-0.5 text-sm bg-bg-accent text-red-primary border border-border-warm rounded-sm font-mono"
        {...props}
      >
        {children}
      </code>
    )
  },
})

/* ------------------------------------------------------------------ */
/*  Per-page variant — smaller font sizes for the split-view sidebar   */
/*  Used by PerPageViewer where the lecture panel is compact           */
/* ------------------------------------------------------------------ */

export const perPageMdComponents: Components = createMdComponents({
  h1: ({ children, ...props }: React.ComponentPropsWithoutRef<'h1'>) => (
    <h1
      className="font-heading text-2xl text-text-main mt-6 mb-3 pb-2 border-b border-border-warm"
      {...props}
    >
      {children}
    </h1>
  ),
  h2: ({ children, ...props }: React.ComponentPropsWithoutRef<'h2'>) => (
    <h2
      className="font-heading text-xl text-text-main mt-6 mb-3 pl-3 border-l-3 border-l-red-primary"
      {...props}
    >
      {children}
    </h2>
  ),
  h3: ({ children, ...props }: React.ComponentPropsWithoutRef<'h3'>) => (
    <h3 className="font-heading text-lg text-text-main mt-5 mb-2" {...props}>
      {children}
    </h3>
  ),
  p: ({ children, ...props }: React.ComponentPropsWithoutRef<'p'>) => (
    <p className="text-[14px] text-text-body leading-relaxed mb-3" {...props}>
      {children}
    </p>
  ),
  ul: ({ children, ...props }: React.ComponentPropsWithoutRef<'ul'>) => (
    <ul
      className="list-disc pl-5 space-y-1 text-[14px] text-text-body mb-3"
      {...props}
    >
      {children}
    </ul>
  ),
  ol: ({ children, ...props }: React.ComponentPropsWithoutRef<'ol'>) => (
    <ol
      className="list-decimal pl-5 space-y-1 text-[14px] text-text-body mb-3"
      {...props}
    >
      {children}
    </ol>
  ),
  blockquote: ({
    children,
    ...props
  }: React.ComponentPropsWithoutRef<'blockquote'>) => (
    <blockquote
      className="border-l-3 border-l-red-primary bg-bg-accent pl-3 py-2 my-3 italic text-text-body text-[13px]"
      {...props}
    >
      {children}
    </blockquote>
  ),
  table: ({ children, ...props }: React.ComponentPropsWithoutRef<'table'>) => (
    <div className="overflow-x-auto my-3">
      <table
        className="w-full text-[13px] border border-border-warm"
        {...props}
      >
        {children}
      </table>
    </div>
  ),
  th: ({ children, ...props }: React.ComponentPropsWithoutRef<'th'>) => (
    <th
      className="px-2 py-1.5 text-left font-medium text-text-main bg-bg-accent border border-border-warm text-[13px]"
      {...props}
    >
      {children}
    </th>
  ),
  td: ({ children, ...props }: React.ComponentPropsWithoutRef<'td'>) => (
    <td
      className="px-2 py-1.5 text-text-body border border-border-warm text-[13px]"
      {...props}
    >
      {children}
    </td>
  ),
  code: ({
    children,
    className,
    ...props
  }: React.ComponentPropsWithoutRef<'code'> & { className?: string }) => {
    if (className?.startsWith('language-')) {
      return (
        <code
          className="block bg-[#1a1a1a] text-[#e5e5e5] p-3 rounded-md overflow-x-auto text-[13px] font-mono my-3"
          {...props}
        >
          {children}
        </code>
      )
    }
    return (
      <code
        className="px-1 py-0.5 text-[13px] bg-bg-accent text-red-primary border border-border-warm rounded-sm font-mono"
        {...props}
      >
        {children}
      </code>
    )
  },
  pre: ({ children, ...props }: React.ComponentPropsWithoutRef<'pre'>) => (
    <pre className="my-3" {...props}>
      {children}
    </pre>
  ),
})

/* ------------------------------------------------------------------ */
/*  Factory — merge overrides onto baseMdComponents                   */
/* ------------------------------------------------------------------ */

export function createMdComponents(overrides?: Partial<Components>): Components {
  if (!overrides) return baseMdComponents
  return { ...baseMdComponents, ...overrides }
}
