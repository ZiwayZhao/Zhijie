"""Agenda todo sync API."""

import logging

from fastapi import APIRouter, Depends
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.models.agenda import AgendaTodo
from app.schemas.agenda import (
    TodoItemSync,
    TodoSyncRequest,
    TodoSyncResponse,
    TodoListResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/agenda", tags=["agenda"])


@router.get("/todos", response_model=TodoListResponse)
async def get_todos(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get all user todos."""
    result = await db.execute(
        select(AgendaTodo).where(
            AgendaTodo.user_id == user.id,
        ).order_by(AgendaTodo.created_at)
    )
    todos = result.scalars().all()

    return TodoListResponse(
        todos=[
            TodoItemSync(
                client_id=t.client_id,
                title=t.title,
                completed=t.completed,
            )
            for t in todos
        ],
        total=len(todos),
    )


@router.post("/todos/sync", response_model=TodoSyncResponse)
async def sync_todos(
    body: TodoSyncRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Sync todos (full replace — frontend is source of truth)."""
    # Delete existing
    await db.execute(
        delete(AgendaTodo).where(AgendaTodo.user_id == user.id)
    )

    # Insert all
    for item in body.todos:
        todo = AgendaTodo(
            user_id=user.id,
            client_id=item.client_id,
            title=item.title,
            completed=item.completed,
        )
        db.add(todo)

    await db.commit()
    logger.info("Synced %d todos for user %s", len(body.todos), user.id)

    return TodoSyncResponse(synced=len(body.todos), total=len(body.todos))
