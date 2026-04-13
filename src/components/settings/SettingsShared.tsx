/**
 * Shared presentational components used across settings sections.
 */
import type { LucideIcon } from 'lucide-react'

export function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative w-10 h-[22px] rounded-full border transition-colors ${
        checked
          ? 'bg-red-primary border-red-primary'
          : 'bg-bg-accent border-border-warm'
      }`}
    >
      <span
        className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}

export function SectionDivider() {
  return <div className="border-b border-border-warm" />
}

export function SettingRow({
  icon: Icon,
  label,
  description,
  children,
}: {
  icon: LucideIcon
  label: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between py-4">
      <div className="flex items-start gap-3 min-w-0">
        <div className="w-8 h-8 rounded-full bg-bg-accent flex items-center justify-center shrink-0 mt-0.5">
          <Icon size={14} strokeWidth={1.5} className="text-red-primary" />
        </div>
        <div className="min-w-0">
          <p className="text-sm text-text-main">{label}</p>
          {description && (
            <p className="text-xs text-text-muted mt-0.5">{description}</p>
          )}
        </div>
      </div>
      <div className="shrink-0 ml-4">{children}</div>
    </div>
  )
}

export function PillSelector<T extends string | number>({
  options,
  value,
  onChange,
  format,
}: {
  options: readonly T[]
  value: T
  onChange: (v: T) => void
  format?: (v: T) => string
}) {
  return (
    <div className="flex gap-1.5">
      {options.map((opt) => (
        <button
          key={String(opt)}
          onClick={() => onChange(opt)}
          className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
            value === opt
              ? 'bg-red-primary text-white border-red-primary'
              : 'bg-bg-card text-text-body border-border-warm hover:border-red-primary/40'
          }`}
        >
          {format ? format(opt) : String(opt)}
        </button>
      ))}
    </div>
  )
}
