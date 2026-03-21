"""Agenda/todo sync schemas."""

from pydantic import BaseModel, Field


class TodoItemSync(BaseModel):
    """Single todo for sync."""
    client_id: str = Field(max_length=100)
    title: str = Field(max_length=500)
    completed: bool = False


class TodoSyncRequest(BaseModel):
    """Batch todo sync (frontend → backend)."""
    todos: list[TodoItemSync] = Field(default=[], max_length=500)


class TodoSyncResponse(BaseModel):
    """Sync result."""
    synced: int = 0
    total: int = 0


class TodoListResponse(BaseModel):
    """List all user todos."""
    todos: list[TodoItemSync] = []
    total: int = 0
