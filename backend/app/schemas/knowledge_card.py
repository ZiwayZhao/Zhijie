"""Knowledge Card schemas — structured knowledge cards for study reference.

Includes:
  - SymbolDef: symbol-meaning pair for formula cards
  - KnowledgeCard: single knowledge card (formula/comparison/definition/procedure)
  - KnowledgeCardResult: full output including formula sheet and error taxonomy
  - KnowledgeCardResponse: API response DTO
"""

import uuid
from typing import Any, Literal

from pydantic import BaseModel, Field


class SymbolDef(BaseModel):
    """A single symbol definition for formula cards."""
    symbol: str
    meaning: str


class KnowledgeCard(BaseModel):
    """A single structured knowledge card."""
    title: str = Field(description="Card title, e.g. 'GRACE Hash Join Cost Formula'")
    card_type: Literal["formula", "comparison", "definition", "procedure"]
    content_markdown: str = Field(description="Card body in markdown with LaTeX")
    symbols: list[SymbolDef] | None = Field(
        default=None,
        description="Symbol definitions for formula cards",
    )
    related_modules: list[str] = Field(default_factory=list)
    difficulty_stars: int = Field(ge=1, le=5, default=3)


class KnowledgeCardResult(BaseModel):
    """Full knowledge card agent output."""
    cards: list[KnowledgeCard] = Field(min_length=1, max_length=50)
    formula_sheet_markdown: str = Field(
        description="Consolidated formula quick-reference sheet",
    )
    error_taxonomy_markdown: str = Field(
        description="Error taxonomy table: wrong approach | correct approach | why confused",
    )


class KnowledgeCardResponse(BaseModel):
    """GET /disassembly/tasks/{task_id}/knowledge-cards response."""
    id: uuid.UUID
    task_id: uuid.UUID
    cards: list[dict[str, Any]]
    formula_sheet: str
    error_taxonomy: str
    model_used: str
    prompt_version: str

    model_config = {"from_attributes": True}
