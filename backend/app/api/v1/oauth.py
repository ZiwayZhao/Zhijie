"""Google OAuth2 login flow with CSRF state protection.

Flow:
1. Frontend redirects user to GET /auth/google/authorize
2. Server generates state, stores in Redis, redirects to Google consent screen
3. Google redirects back to GET /auth/google/callback with ?code=...&state=...
4. Server verifies state, exchanges code, creates/finds user
5. Redirects to frontend with tokens in URL fragment (not query string)
"""

import logging
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import get_db
from app.core.config import settings
from app.core.rate_limit import limiter
from app.core.security import create_access_token, create_refresh_token
from app.models.user import RefreshToken, User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth/google", tags=["oauth"])

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"

# In-memory state store (use Redis in production for multi-instance)
_oauth_states: dict[str, float] = {}
_STATE_TTL_SECONDS = 600  # 10 minutes


def _cleanup_expired_states() -> None:
    now = datetime.now(timezone.utc).timestamp()
    expired = [k for k, v in _oauth_states.items() if now - v > _STATE_TTL_SECONDS]
    for k in expired:
        _oauth_states.pop(k, None)


@router.get("/authorize")
@limiter.limit("10/minute")
async def google_authorize(request: Request):
    """Redirect user to Google consent screen with CSRF state."""
    if not settings.google_client_id:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="Google OAuth not configured",
        )

    # Generate and store state for CSRF protection
    state = secrets.token_urlsafe(32)
    _cleanup_expired_states()
    _oauth_states[state] = datetime.now(timezone.utc).timestamp()

    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": settings.google_redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    }
    url = f"{GOOGLE_AUTH_URL}?{urlencode(params)}"
    return RedirectResponse(url)


@router.get("/callback")
@limiter.limit("10/minute")
async def google_callback(
    request: Request,
    code: str = Query(...),
    state: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Exchange Google auth code for tokens, create/find user."""
    if not settings.google_client_id or not settings.google_client_secret:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="Google OAuth not configured",
        )

    # Verify state to prevent CSRF / login CSRF
    stored_ts = _oauth_states.pop(state, None)
    if stored_ts is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired OAuth state",
        )
    if datetime.now(timezone.utc).timestamp() - stored_ts > _STATE_TTL_SECONDS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="OAuth state expired",
        )

    # Exchange code for Google access token
    async with httpx.AsyncClient(timeout=10.0) as client:
        token_resp = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "redirect_uri": settings.google_redirect_uri,
                "grant_type": "authorization_code",
            },
        )
        if token_resp.status_code != 200:
            logger.error("Google token exchange failed: %s", token_resp.text)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to exchange Google authorization code",
            )
        google_tokens = token_resp.json()

        # Get user info from Google
        userinfo_resp = await client.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {google_tokens['access_token']}"},
        )
        if userinfo_resp.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to get user info from Google",
            )
        userinfo = userinfo_resp.json()

    google_id = userinfo.get("sub")
    email = userinfo.get("email")
    email_verified = userinfo.get("email_verified", False)
    name = userinfo.get("name", email or "Google User")
    avatar = userinfo.get("picture")

    if not google_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid Google user info",
        )

    # Only use email if verified by Google
    if not email_verified:
        email = None

    # Find existing user by Google provider_id only (no auto-link by email)
    result = await db.execute(
        select(User).where(
            User.auth_provider == "google",
            User.provider_id == google_id,
        )
    )
    user = result.scalar_one_or_none()

    if not user:
        # Create new OAuth user (no auto-linking to existing email accounts)
        user = User(
            email=email,
            name=name,
            avatar_url=avatar,
            auth_provider="google",
            provider_id=google_id,
        )
        db.add(user)
        try:
            await db.flush()
        except IntegrityError:
            await db.rollback()
            # Email conflict — user already has an email account
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An account with this email already exists. Please log in with email/password first, then link your Google account.",
            )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is deactivated",
        )

    # Generate tokens
    access_token = create_access_token(str(user.id))
    raw_refresh, token_hash, token_family = create_refresh_token()

    refresh_row = RefreshToken(
        user_id=user.id,
        token_hash=token_hash,
        token_family=token_family,
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_expire_days),
        user_agent=request.headers.get("user-agent"),
        ip_address=request.client.host if request.client else None,
    )
    db.add(refresh_row)
    await db.commit()

    # Redirect to frontend with tokens in URL FRAGMENT (not query string)
    # Fragments are not sent to servers, reducing leakage risk
    frontend_url = settings.cors_origins[0] if settings.cors_origins else "http://localhost:5173"
    fragment = urlencode({"access_token": access_token, "refresh_token": raw_refresh})
    return RedirectResponse(f"{frontend_url}/auth/callback#{fragment}")
