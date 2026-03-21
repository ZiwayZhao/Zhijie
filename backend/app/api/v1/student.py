"""Student profile sync API — BKT learning profile persistence."""

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.models.student import StudentProfile, ModuleMastery
from app.schemas.student import (
    StudentProfileSync,
    StudentProfileResponse,
    ModuleMasteryItem,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/student", tags=["student"])


async def _get_or_create_profile(
    user: User, db: AsyncSession,
) -> StudentProfile:
    """Get or create student profile for user."""
    result = await db.execute(
        select(StudentProfile).where(StudentProfile.user_id == user.id)
    )
    profile = result.scalar_one_or_none()
    if not profile:
        profile = StudentProfile(user_id=user.id)
        db.add(profile)
        await db.flush()
    return profile


@router.get("/profile", response_model=StudentProfileResponse)
async def get_profile(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get student learning profile with all module masteries."""
    profile = await _get_or_create_profile(user, db)

    # Load masteries
    result = await db.execute(
        select(ModuleMastery).where(ModuleMastery.profile_id == profile.id)
    )
    masteries = result.scalars().all()

    modules: dict[str, ModuleMasteryItem] = {}
    for m in masteries:
        modules[m.module_id] = ModuleMasteryItem(
            module_id=m.module_id,
            module_name=m.module_name,
            course_id=m.course_id,
            mastery=m.mastery,
            total_attempts=m.total_attempts,
            correct_attempts=m.correct_attempts,
            last_updated=int(m.last_updated.timestamp() * 1000) if m.last_updated else 0,
        )

    await db.commit()
    return StudentProfileResponse(
        user_id=str(user.id),
        goal=profile.goal,
        total_study_minutes=profile.total_study_minutes,
        streak_days=profile.streak_days,
        last_active_date=profile.last_active_date,
        modules=modules,
    )


@router.put("/profile", response_model=StudentProfileResponse)
async def sync_profile(
    body: StudentProfileSync,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Sync full learning profile from frontend (upsert).

    Strategy: frontend wins (last-write-wins) since BKT state
    is computed client-side after each quiz/flashcard review.
    """
    profile = await _get_or_create_profile(user, db)

    # Update profile fields
    profile.goal = body.goal
    profile.total_study_minutes = body.total_study_minutes
    profile.streak_days = body.streak_days
    profile.last_active_date = body.last_active_date

    # Upsert module masteries
    existing_result = await db.execute(
        select(ModuleMastery).where(ModuleMastery.profile_id == profile.id)
    )
    existing = {m.module_id: m for m in existing_result.scalars().all()}

    for mod_id, mod_data in body.modules.items():
        if mod_id in existing:
            # Update existing
            m = existing[mod_id]
            m.module_name = mod_data.module_name
            m.course_id = mod_data.course_id
            m.mastery = mod_data.mastery
            m.total_attempts = mod_data.total_attempts
            m.correct_attempts = mod_data.correct_attempts
        else:
            # Create new
            m = ModuleMastery(
                profile_id=profile.id,
                module_id=mod_id,
                module_name=mod_data.module_name,
                course_id=mod_data.course_id,
                mastery=mod_data.mastery,
                total_attempts=mod_data.total_attempts,
                correct_attempts=mod_data.correct_attempts,
            )
            db.add(m)

    # Delete modules absent from frontend (full sync = frontend is source of truth)
    stale_ids = set(existing.keys()) - set(body.modules.keys())
    for stale_id in stale_ids:
        await db.delete(existing[stale_id])

    await db.commit()
    logger.info("Synced profile for user %s: %d modules", user.id, len(body.modules))

    # Return updated profile
    return await get_profile(user=user, db=db)
