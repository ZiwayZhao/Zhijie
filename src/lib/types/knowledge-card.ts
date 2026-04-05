/**
 * Knowledge Card types — structured study reference cards.
 */

export interface SymbolDef {
  symbol: string
  meaning: string
}

export interface KnowledgeCard {
  title: string
  card_type: 'formula' | 'comparison' | 'definition' | 'procedure' | 'theorem' | 'example' | 'pitfall' | 'method'
  content_markdown: string
  symbols: SymbolDef[] | null
  related_modules: string[]
  difficulty_stars: number
}

export interface KnowledgeCardResult {
  id: string
  task_id: string
  cards: KnowledgeCard[]
  formula_sheet: string
  error_taxonomy: string
  model_used: string
  prompt_version: string
}
