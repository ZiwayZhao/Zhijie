"""SSE ticket service — short-lived auth for EventSource connections.

Replaces raw JWT in query parameter:
  1. Client calls POST /stream-ticket (Bearer auth) → gets ticket
  2. Client opens EventSource with ?ticket=... (short-lived, hash-verified)
"""

import hashlib
import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.sse_ticket import SSETicket

logger = logging.getLogger(__name__)

TICKET_EXPIRY_MINUTES = 15


def _hash_ticket(token: str) -> str:
    """SHA-256 hash of ticket token (same pattern as refresh tokens)."""
    return hashlib.sha256(token.encode()).hexdigest()


async def create_ticket(
    db: AsyncSession,
    user_id: uuid.UUID,
    resource_type: str,
    resource_id: uuid.UUID,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> str:
    """Create a short-lived SSE ticket. Returns the raw token to send to client."""
    token = secrets.token_urlsafe(32)
    token_hash = _hash_ticket(token)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=TICKET_EXPIRY_MINUTES)

    ticket = SSETicket(
        user_id=user_id,
        resource_type=resource_type,
        resource_id=resource_id,
        token_hash=token_hash,
        expires_at=expires_at,
        ip_address=ip_address,
        user_agent=user_agent,
    )
    db.add(ticket)
    await db.flush()

    logger.debug(
        "Created SSE ticket for user %s, resource %s:%s (expires %s)",
        user_id, resource_type, resource_id, expires_at,
    )
    return token


async def verify_ticket(
    db: AsyncSession,
    token: str,
    resource_type: str,
    resource_id: uuid.UUID,
) -> uuid.UUID:
    """Verify a ticket and return user_id. Raises 401 if invalid/expired."""
    token_hash = _hash_ticket(token)
    now = datetime.now(timezone.utc)

    result = await db.execute(
        select(SSETicket).where(
            SSETicket.token_hash == token_hash,
            SSETicket.resource_type == resource_type,
            SSETicket.resource_id == resource_id,
            SSETicket.expires_at > now,
        )
    )
    ticket = result.scalar_one_or_none()

    if not ticket:
        raise HTTPException(status_code=401, detail="Invalid or expired SSE ticket")

    return ticket.user_id


async def cleanup_expired(db: AsyncSession) -> int:
    """Delete expired tickets. Call periodically."""
    now = datetime.now(timezone.utc)
    result = await db.execute(
        delete(SSETicket).where(SSETicket.expires_at <= now)
    )
    count = result.rowcount
    if count:
        await db.commit()
        logger.info("Cleaned up %d expired SSE tickets", count)
    return count
