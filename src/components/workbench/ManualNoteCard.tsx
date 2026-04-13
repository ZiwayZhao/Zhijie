/**
 * ManualNoteCard — Display card for a single manual note.
 * Extracted from NotesPanel.tsx.
 */

import { Trash2 } from 'lucide-react'
import type { ManualNote } from './NotesPanel'

export interface ManualNoteCardProps {
  note: ManualNote
  onDelete: () => void
}

export default function ManualNoteCard({ note, onDelete }: ManualNoteCardProps) {
  return (
    <div className="border border-border-warm rounded-sm p-2.5 bg-bg-main group hover:border-red-primary/30 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-[11px] font-medium text-text-main">{note.title}</h4>
        <button
          onClick={() => onDelete()}
          className="opacity-0 group-hover:opacity-100 p-0.5 text-text-muted hover:text-red-500 transition-all shrink-0"
          title="删除"
        >
          <Trash2 size={10} />
        </button>
      </div>
      <p className="text-[11px] text-text-body mt-1 leading-relaxed whitespace-pre-wrap line-clamp-3">
        {note.content}
      </p>
      <p className="text-[10px] text-text-muted/40 mt-1">
        {new Date(note.createdAt).toLocaleString()}
      </p>
    </div>
  )
}
