"""Student profile request/response schemas."""

from pydantic import BaseModel, Field


class ModuleMasteryItem(BaseModel):
    """Single module mastery entry."""
    module_id: str
    module_name: str
    course_id: str
    mastery: float = Field(ge=0, le=1, description="BKT probability 0-1")
    total_attempts: int = 0
    correct_attempts: int = 0
    last_updated: int = 0  # timestamp ms


class StudentProfileSync(BaseModel):
    """Full profile sync payload (frontend → backend)."""
    goal: str | None = None  # learn | exam | review
    total_study_minutes: int = 0
    streak_days: int = 0
    last_active_date: str | None = None  # YYYY-MM-DD
    modules: dict[str, ModuleMasteryItem] = {}


class StudentProfileResponse(BaseModel):
    """Profile returned from backend."""
    user_id: str
    goal: str | None = None
    total_study_minutes: int = 0
    streak_days: int = 0
    last_active_date: str | None = None
    modules: dict[str, ModuleMasteryItem] = {}
