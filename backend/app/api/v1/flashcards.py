"""Flashcard sync API — FSRS deck persistence."""

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.models.flashcard import FlashcardNote, FlashcardCard, FlashcardReviewLog
from app.schemas.flashcard import (
    FlashcardDeckSync,
    FlashcardDeckResponse,
    FlashcardNoteSync,
    FlashcardCardSync,
    FlashcardReviewLogSync,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/flashcards", tags=["flashcards"])


@router.get("/{course_id}/deck", response_model=FlashcardDeckResponse)
async def get_deck(
    course_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get full flashcard deck for a course."""
    # Load notes
    notes_result = await db.execute(
        select(FlashcardNote).where(
            FlashcardNote.user_id == user.id,
            FlashcardNote.course_id == course_id,
        ).order_by(FlashcardNote.created_at)
    )
    notes = notes_result.scalars().all()
    note_ids = [n.id for n in notes]

    if not note_ids:
        return FlashcardDeckResponse(course_id=course_id)

    # Load cards
    cards_result = await db.execute(
        select(FlashcardCard).where(FlashcardCard.note_id.in_(note_ids))
    )
    cards = cards_result.scalars().all()
    card_ids = [c.id for c in cards]

    # Load review logs (last 500 per deck)
    logs_result = await db.execute(
        select(FlashcardReviewLog).where(
            FlashcardReviewLog.card_id.in_(card_ids)
        ).order_by(FlashcardReviewLog.reviewed_at.desc()).limit(500)
    )
    logs = logs_result.scalars().all()

    # Count due cards
    now = datetime.now(timezone.utc)
    due_count = sum(1 for c in cards if c.due <= now)

    return FlashcardDeckResponse(
        course_id=course_id,
        notes=[
            FlashcardNoteSync(
                id=str(n.id),
                card_type=n.card_type,
                front=n.front,
                back=n.back,
                extra=n.extra,
                tags=n.tags or [],
                generated_by=n.generated_by,
                source_material_id=n.source_material_id,
                source_module_id=n.source_module_id,
                source_page=n.source_page,
                created_at=int(n.created_at.timestamp() * 1000) if n.created_at else 0,
            )
            for n in notes
        ],
        cards=[
            FlashcardCardSync(
                id=str(c.id),
                note_id=str(c.note_id),
                due=c.due.isoformat() if c.due else "",
                stability=c.stability,
                difficulty=c.difficulty,
                state=c.state,
                reps=c.reps,
                lapses=c.lapses,
                consecutive_again=c.consecutive_again,
                consecutive_easy=c.consecutive_easy,
                average_response_ms=c.average_response_ms,
                fsrs_card_json=c.fsrs_card_json,
            )
            for c in cards
        ],
        review_logs=[
            FlashcardReviewLogSync(
                card_id=str(l.card_id),
                rating=l.rating,
                reviewed_at=l.reviewed_at.isoformat() if l.reviewed_at else "",
                response_ms=l.response_ms,
                fsrs_log_json=l.fsrs_log_json,
            )
            for l in logs
        ],
        total_notes=len(notes),
        due_count=due_count,
    )


@router.post("/{course_id}/sync", response_model=FlashcardDeckResponse)
async def sync_deck(
    course_id: str,
    body: FlashcardDeckSync,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Sync full flashcard deck (frontend → backend).

    Strategy: upsert by note.id — frontend is source of truth for FSRS state.
    Review logs are append-only (deduplicated by card_id + reviewed_at).
    """
    # Load existing notes for this user+course
    existing_notes_result = await db.execute(
        select(FlashcardNote).where(
            FlashcardNote.user_id == user.id,
            FlashcardNote.course_id == course_id,
        )
    )
    existing_notes = {str(n.id): n for n in existing_notes_result.scalars().all()}

    # Upsert notes — server always generates UUIDs for new notes (prevents IDOR)
    note_id_map: dict[str, uuid.UUID] = {}  # client_id → db_id
    for note_sync in body.notes:
        if note_sync.id in existing_notes:
            # Update existing (already scoped to user_id + course_id)
            n = existing_notes[note_sync.id]
            n.card_type = note_sync.card_type
            n.front = note_sync.front
            n.back = note_sync.back
            n.extra = note_sync.extra
            n.tags = note_sync.tags
            n.generated_by = note_sync.generated_by
            n.source_material_id = note_sync.source_material_id
            n.source_module_id = note_sync.source_module_id
            n.source_page = note_sync.source_page
            note_id_map[note_sync.id] = n.id
        else:
            # Create new — always use server-generated UUID
            new_uuid = uuid.uuid4()
            n = FlashcardNote(
                id=new_uuid,
                user_id=user.id,
                course_id=course_id,
                card_type=note_sync.card_type,
                front=note_sync.front,
                back=note_sync.back,
                extra=note_sync.extra,
                tags=note_sync.tags,
                generated_by=note_sync.generated_by,
                source_material_id=note_sync.source_material_id,
                source_module_id=note_sync.source_module_id,
                source_page=note_sync.source_page,
            )
            db.add(n)
            note_id_map[note_sync.id] = new_uuid

    await db.flush()

    # Upsert cards
    all_note_ids = list(note_id_map.values())
    if all_note_ids:
        existing_cards_result = await db.execute(
            select(FlashcardCard).where(FlashcardCard.note_id.in_(all_note_ids))
        )
        existing_cards = {str(c.note_id): c for c in existing_cards_result.scalars().all()}
    else:
        existing_cards = {}

    for card_sync in body.cards:
        db_note_id = note_id_map.get(card_sync.note_id)
        if not db_note_id:
            continue

        due_dt = datetime.fromisoformat(card_sync.due) if card_sync.due else datetime.now(timezone.utc)

        if str(db_note_id) in existing_cards:
            c = existing_cards[str(db_note_id)]
            c.due = due_dt
            c.stability = card_sync.stability
            c.difficulty = card_sync.difficulty
            c.state = card_sync.state
            c.reps = card_sync.reps
            c.lapses = card_sync.lapses
            c.consecutive_again = card_sync.consecutive_again
            c.consecutive_easy = card_sync.consecutive_easy
            c.average_response_ms = card_sync.average_response_ms
            c.fsrs_card_json = card_sync.fsrs_card_json
        else:
            try:
                card_uuid = uuid.UUID(card_sync.id)
            except ValueError:
                card_uuid = uuid.uuid4()
            c = FlashcardCard(
                id=card_uuid,
                note_id=db_note_id,
                due=due_dt,
                stability=card_sync.stability,
                difficulty=card_sync.difficulty,
                state=card_sync.state,
                reps=card_sync.reps,
                lapses=card_sync.lapses,
                consecutive_again=card_sync.consecutive_again,
                consecutive_easy=card_sync.consecutive_easy,
                average_response_ms=card_sync.average_response_ms,
                fsrs_card_json=card_sync.fsrs_card_json,
            )
            db.add(c)

    await db.flush()

    # Build lookup: client card_id → DB card_id (O(1) instead of O(n) scan)
    card_client_to_note: dict[str, uuid.UUID] = {
        cs.id: note_id_map.get(cs.note_id) for cs in body.cards  # type: ignore
    }

    # Resolve DB card IDs in batch
    all_db_note_ids = [nid for nid in note_id_map.values()]
    if all_db_note_ids:
        all_cards_result = await db.execute(
            select(FlashcardCard.id, FlashcardCard.note_id).where(
                FlashcardCard.note_id.in_(all_db_note_ids)
            )
        )
        note_to_db_card: dict[str, uuid.UUID] = {
            str(row.note_id): row.id for row in all_cards_result.all()
        }
    else:
        note_to_db_card = {}

    # Batch-load existing review log timestamps for dedup
    all_db_card_ids = list(note_to_db_card.values())
    existing_log_keys: set[tuple[str, str]] = set()
    if all_db_card_ids:
        existing_logs_result = await db.execute(
            select(FlashcardReviewLog.card_id, FlashcardReviewLog.reviewed_at).where(
                FlashcardReviewLog.card_id.in_(all_db_card_ids)
            )
        )
        for row in existing_logs_result.all():
            existing_log_keys.add((str(row.card_id), row.reviewed_at.isoformat()))

    # Append review logs (O(1) dedup per log)
    for log_sync in body.review_logs:
        note_id_for_card = card_client_to_note.get(log_sync.card_id)
        if not note_id_for_card:
            continue

        db_card_id = note_to_db_card.get(str(note_id_for_card))
        if not db_card_id:
            continue

        reviewed_at = datetime.fromisoformat(log_sync.reviewed_at) if log_sync.reviewed_at else datetime.now(timezone.utc)

        # Dedup check (in-memory, no DB query)
        key = (str(db_card_id), reviewed_at.isoformat())
        if key in existing_log_keys:
            continue

        existing_log_keys.add(key)  # Prevent dupes within same batch
        log = FlashcardReviewLog(
            card_id=db_card_id,
            user_id=user.id,
            rating=log_sync.rating,
            response_ms=log_sync.response_ms,
            fsrs_log_json=log_sync.fsrs_log_json,
            reviewed_at=reviewed_at,
        )
        db.add(log)

    await db.commit()
    logger.info(
        "Synced deck for user %s, course %s: %d notes, %d cards, %d logs",
        user.id, course_id, len(body.notes), len(body.cards), len(body.review_logs),
    )

    return await get_deck(course_id=course_id, user=user, db=db)
