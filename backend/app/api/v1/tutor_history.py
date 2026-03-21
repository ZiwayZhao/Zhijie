"""Tutor chat history sync API."""

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.models.tutor_session import TutorSession
from app.schemas.tutor_session import (
    TutorMessageItem,
    TutorSessionSync,
    TutorSessionResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tutor", tags=["tutor-history"])


@router.get("/{material_id}/messages", response_model=TutorSessionResponse)
async def get_messages(
    material_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get chat history for a material."""
    result = await db.execute(
        select(TutorSession).where(
            TutorSession.user_id == user.id,
            TutorSession.material_id == material_id,
        )
    )
    session = result.scalar_one_or_none()

    if not session:
        return TutorSessionResponse(material_id=str(material_id))

    messages = [TutorMessageItem(**m) for m in (session.messages or [])]

    return TutorSessionResponse(
        material_id=str(material_id),
        messages=messages,
        message_count=session.message_count,
        last_activity_at=session.last_activity_at.isoformat() if session.last_activity_at else None,
    )


@router.post("/{material_id}/messages/sync", response_model=TutorSessionResponse)
async def sync_messages(
    material_id: uuid.UUID,
    body: TutorSessionSync,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Sync chat messages (frontend → backend, last 50 messages).

    Strategy: full replace — frontend manages message list.
    """
    # Cap at 50 messages
    messages = body.messages[-50:]
    messages_json = [m.model_dump() for m in messages]

    result = await db.execute(
        select(TutorSession).where(
            TutorSession.user_id == user.id,
            TutorSession.material_id == material_id,
        )
    )
    session = result.scalar_one_or_none()

    if session:
        session.messages = messages_json
        session.message_count = len(messages)
        session.last_activity_at = datetime.now(timezone.utc)
    else:
        session = TutorSession(
            user_id=user.id,
            material_id=material_id,
            messages=messages_json,
            message_count=len(messages),
            last_activity_at=datetime.now(timezone.utc),
        )
        db.add(session)

    await db.commit()
    logger.info(
        "Synced %d messages for user %s, material %s",
        len(messages), user.id, material_id,
    )

    return TutorSessionResponse(
        material_id=str(material_id),
        messages=messages,
        message_count=len(messages),
        last_activity_at=session.last_activity_at.isoformat() if session.last_activity_at else None,
    )
