"""Tutor MVP endpoint — POST /chat/tutor → SSE stream.

Two-phase architecture:
  Plan  (structured_output, non-streaming) → decide intent + tools
  Execute (DB queries)                     → get tool results
  Stream  (stream_text, SSE)               → generate final answer
"""

import logging

from fastapi import APIRouter, Depends
from sse_starlette.sse import EventSourceResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.tutor import TutorChatRequest
from app.services.tutor_orchestrator import TutorOrchestrator

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["tutor"])


@router.post("/tutor")
async def tutor_chat(
    body: TutorChatRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """SSE stream for Tutor agent conversation.

    Events:
      session.started    → {session_id, material_id, module_id, available_tools}
      plan.completed     → {intent, reasoning, tools_to_call}
      tool.result        → {tool_name, ok, data, error}
      answer.delta       → {content}
      answer.completed   → {total_tokens}
      error              → {message, phase}
      session.completed  → {session_id}
    """
    orchestrator = TutorOrchestrator(db=db, user_id=user.id)

    async def event_generator():
        async for event in orchestrator.stream_chat(body):
            yield event

    return EventSourceResponse(event_generator())
