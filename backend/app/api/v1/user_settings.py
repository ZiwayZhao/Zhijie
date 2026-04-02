"""User LLM settings API — GET/PUT per-user API key and model configuration."""

import logging

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.encryption import decrypt_api_key, encrypt_api_key, mask_api_key
from app.core.security import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.models.user_llm_settings import UserLLMSettings
from app.schemas.llm_settings import (
    PROVIDER_PRESETS,
    LLMSettingsResponse,
    LLMSettingsUpdate,
    ProviderListResponse,
    ProviderPreset,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/user/settings", tags=["user-settings"])


@router.get("/llm/providers", response_model=ProviderListResponse)
async def list_providers():
    """List available LLM providers with their preset base URLs."""
    return ProviderListResponse(
        providers=[
            ProviderPreset(id=k, label=v["label"], base_url=v["base_url"])
            for k, v in PROVIDER_PRESETS.items()
        ]
    )


@router.get("/llm", response_model=LLMSettingsResponse)
async def get_llm_settings(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get current user's LLM settings."""
    result = await db.execute(
        select(UserLLMSettings).where(UserLLMSettings.user_id == user.id)
    )
    settings = result.scalar_one_or_none()

    if not settings:
        return LLMSettingsResponse(
            llm_provider="system",
            llm_base_url=None,
            has_api_key=False,
            llm_api_key_masked=None,
            llm_model=None,
        )

    # Decrypt and mask key for display
    masked = None
    has_key = False
    if settings.llm_api_key_encrypted:
        try:
            raw_key = decrypt_api_key(settings.llm_api_key_encrypted)
            masked = mask_api_key(raw_key)
            has_key = True
        except Exception:
            logger.warning("Failed to decrypt API key for user %s", user.id)

    return LLMSettingsResponse(
        llm_provider=settings.llm_provider,
        llm_base_url=settings.llm_base_url,
        has_api_key=has_key,
        llm_api_key_masked=masked,
        llm_model=settings.llm_model,
    )


@router.put("/llm", response_model=LLMSettingsResponse)
async def update_llm_settings(
    body: LLMSettingsUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create or update the user's LLM settings."""
    result = await db.execute(
        select(UserLLMSettings).where(UserLLMSettings.user_id == user.id)
    )
    settings = result.scalar_one_or_none()

    if not settings:
        settings = UserLLMSettings(user_id=user.id)
        db.add(settings)

    settings.llm_provider = body.llm_provider

    # Resolve base_url from preset or custom
    if body.llm_provider in PROVIDER_PRESETS and body.llm_provider != "custom":
        settings.llm_base_url = PROVIDER_PRESETS[body.llm_provider]["base_url"] or None
    elif body.llm_base_url:
        settings.llm_base_url = body.llm_base_url.rstrip("/")
    else:
        settings.llm_base_url = None

    # Encrypt API key if provided
    if body.llm_api_key is not None:
        if body.llm_api_key == "":
            settings.llm_api_key_encrypted = None
        else:
            settings.llm_api_key_encrypted = encrypt_api_key(body.llm_api_key)

    settings.llm_model = body.llm_model

    await db.commit()
    await db.refresh(settings)

    # Build response
    masked = None
    has_key = False
    if settings.llm_api_key_encrypted:
        try:
            raw_key = decrypt_api_key(settings.llm_api_key_encrypted)
            masked = mask_api_key(raw_key)
            has_key = True
        except Exception:
            pass

    return LLMSettingsResponse(
        llm_provider=settings.llm_provider,
        llm_base_url=settings.llm_base_url,
        has_api_key=has_key,
        llm_api_key_masked=masked,
        llm_model=settings.llm_model,
    )
