import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import get_db
from app.core.config import settings
from app.core.rate_limit import limiter
from app.core.security import (
    create_access_token,
    create_refresh_token,
    get_current_user,
    hash_password,
    hash_refresh_token,
    verify_password,
)
from app.models.user import RefreshToken, User
from app.schemas.user import (
    TokenPair,
    TokenRefresh,
    UserLogin,
    UserRegister,
    UserResponse,
)

logger = logging.getLogger(__name__)

# Dummy hash for constant-time login failure (prevents timing side-channel)
_DUMMY_HASH = hash_password("dummy-password-for-timing-protection")

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenPair, status_code=status.HTTP_201_CREATED)
@limiter.limit("5/minute")
async def register(
    body: UserRegister,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    # Create user — rely on DB unique constraint as ultimate guard
    user = User(
        email=body.email,
        password_hash=hash_password(body.password),
        name=body.name,
        auth_provider="email",
    )
    db.add(user)
    try:
        await db.flush()  # get user.id; raises IntegrityError on duplicate
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered",
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

    return TokenPair(access_token=access_token, refresh_token=raw_refresh)


@router.post("/login", response_model=TokenPair)
@limiter.limit("10/minute")
async def login(
    body: UserLogin,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    # Constant-time: always run argon2 verify, even if user doesn't exist
    if not user or not user.password_hash:
        verify_password(body.password, _DUMMY_HASH)  # constant-time dummy
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    if not verify_password(body.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is deactivated",
        )

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

    return TokenPair(access_token=access_token, refresh_token=raw_refresh)


@router.post("/refresh", response_model=TokenPair)
@limiter.limit("20/minute")
async def refresh_token(
    body: TokenRefresh,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    incoming_hash = hash_refresh_token(body.refresh_token)
    now = datetime.now(timezone.utc)

    # Atomic CAS: revoke the token only if it's still valid
    # This prevents concurrent refresh from forking multiple valid tokens
    revoke_result = await db.execute(
        update(RefreshToken)
        .where(
            RefreshToken.token_hash == incoming_hash,
            RefreshToken.revoked == False,  # noqa: E712
            RefreshToken.expires_at > now,
        )
        .values(revoked=True, revoked_at=now)
        .returning(RefreshToken.id, RefreshToken.user_id, RefreshToken.token_family)
    )
    old_row = revoke_result.first()

    if not old_row:
        # Token not found as valid — check if it's a reuse attack
        reuse_result = await db.execute(
            select(RefreshToken.token_family).where(
                RefreshToken.token_hash == incoming_hash
            )
        )
        family = reuse_result.scalar_one_or_none()
        if family:
            # Reuse detected — revoke entire family
            logger.warning("Refresh token reuse detected for family=%s", family)
            await db.execute(
                update(RefreshToken)
                .where(RefreshToken.token_family == family)
                .values(revoked=True, revoked_at=now)
            )
            await db.commit()

        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
        )

    old_id, user_id, token_family = old_row

    # Verify user is still active before issuing new tokens
    user_result = await db.execute(
        select(User.is_active).where(User.id == user_id)
    )
    is_active = user_result.scalar_one_or_none()
    if not is_active:
        # User deactivated — revoke entire family
        await db.execute(
            update(RefreshToken)
            .where(RefreshToken.token_family == token_family)
            .values(revoked=True, revoked_at=now)
        )
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account is inactive",
        )

    # Issue new token in same family
    raw_refresh, new_hash, _ = create_refresh_token()
    new_token = RefreshToken(
        user_id=user_id,
        token_hash=new_hash,
        token_family=token_family,  # keep same family
        expires_at=now + timedelta(days=settings.refresh_token_expire_days),
        user_agent=request.headers.get("user-agent"),
        ip_address=request.client.host if request.client else None,
    )
    db.add(new_token)
    await db.commit()

    access_token = create_access_token(str(user_id))
    return TokenPair(access_token=access_token, refresh_token=raw_refresh)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    body: TokenRefresh,
    db: AsyncSession = Depends(get_db),
):
    incoming_hash = hash_refresh_token(body.refresh_token)
    now = datetime.now(timezone.utc)

    # Find token family, then revoke all in family
    result = await db.execute(
        select(RefreshToken.token_family).where(
            RefreshToken.token_hash == incoming_hash
        )
    )
    family = result.scalar_one_or_none()
    if family:
        await db.execute(
            update(RefreshToken)
            .where(RefreshToken.token_family == family)
            .values(revoked=True, revoked_at=now)
        )
        await db.commit()
    return None


@router.get("/me", response_model=UserResponse)
async def get_me(user: User = Depends(get_current_user)):
    return user
