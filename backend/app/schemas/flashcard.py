"""Flashcard sync request/response schemas."""

from pydantic import BaseModel, Field, field_validator


class FlashcardNoteSync(BaseModel):
    """Note content for sync."""
    id: str
    card_type: str = "basic"  # basic | cloze | reverse | image-occlusion
    front: str
    back: str
    extra: str | None = None
    tags: list[str] = []
    generated_by: str = "ai"
    source_material_id: str | None = None
    source_module_id: str | None = None
    source_page: int | None = None
    created_at: int = 0  # timestamp ms


class FlashcardCardSync(BaseModel):
    """FSRS card state for sync."""
    id: str
    note_id: str
    # FSRS state
    due: str  # ISO datetime
    stability: float = 0
    difficulty: float = 0
    state: str = "new"  # new | learning | review | relearning

    @field_validator("state", mode="before")
    @classmethod
    def normalize_state(cls, v: str | int) -> str:
        """Accept both numeric (ts-fsrs State enum) and string state values."""
        _num_to_str = {0: "new", 1: "learning", 2: "review", 3: "relearning"}
        if isinstance(v, int):
            return _num_to_str.get(v, "new")
        return str(v)
    reps: int = 0
    lapses: int = 0
    # Evolution tracking
    consecutive_again: int = 0
    consecutive_easy: int = 0
    average_response_ms: int | None = None
    # Full ts-fsrs Card JSON for exact state restoration
    fsrs_card_json: dict | None = None


class FlashcardReviewLogSync(BaseModel):
    """Review log entry for sync."""
    card_id: str
    rating: int = Field(ge=1, le=4)  # 1=Again, 2=Hard, 3=Good, 4=Easy
    reviewed_at: str  # ISO datetime
    response_ms: int | None = None
    fsrs_log_json: dict | None = None


class FlashcardDeckSync(BaseModel):
    """Full deck sync payload (frontend → backend)."""
    course_id: str
    course_name: str = ""
    notes: list[FlashcardNoteSync] = Field(default=[], max_length=5000)
    cards: list[FlashcardCardSync] = Field(default=[], max_length=5000)
    review_logs: list[FlashcardReviewLogSync] = Field(default=[], max_length=10000)


class FlashcardDeckResponse(BaseModel):
    """Deck returned from backend."""
    course_id: str
    course_name: str = ""
    notes: list[FlashcardNoteSync] = []
    cards: list[FlashcardCardSync] = []
    review_logs: list[FlashcardReviewLogSync] = []
    total_notes: int = 0
    due_count: int = 0
