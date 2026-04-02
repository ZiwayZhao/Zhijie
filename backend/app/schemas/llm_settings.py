"""Schemas for user LLM settings API."""

from pydantic import BaseModel, Field


# ── Preset providers ────────────────────────────────────────────

PROVIDER_PRESETS: dict[str, dict[str, str]] = {
    "system": {
        "label": "系统默认",
        "base_url": "",
    },
    "openrouter": {
        "label": "OpenRouter",
        "base_url": "https://openrouter.ai/api/v1",
    },
    "tencent": {
        "label": "腾讯云 CodingPlan",
        "base_url": "https://api.lkeap.cloud.tencent.com/coding/v3",
    },
    "openai": {
        "label": "OpenAI",
        "base_url": "https://api.openai.com/v1",
    },
    "deepseek": {
        "label": "DeepSeek",
        "base_url": "https://api.deepseek.com/v1",
    },
    "custom": {
        "label": "自定义",
        "base_url": "",
    },
}


class LLMSettingsUpdate(BaseModel):
    """Request body for updating LLM settings."""
    llm_provider: str = Field(
        default="system",
        description="Provider preset: system, openrouter, tencent, openai, deepseek, custom",
    )
    llm_api_key: str | None = Field(
        default=None,
        description="API key (will be encrypted on server). Send null to clear.",
    )
    llm_base_url: str | None = Field(
        default=None,
        description="Custom base URL (only used when provider=custom)",
    )
    llm_model: str | None = Field(
        default=None,
        description="Preferred model name",
    )


class LLMSettingsResponse(BaseModel):
    """Response body — never exposes the raw API key."""
    llm_provider: str
    llm_base_url: str | None
    has_api_key: bool
    llm_api_key_masked: str | None = Field(
        description="Masked key like sk-...abc1",
    )
    llm_model: str | None

    model_config = {"from_attributes": True}


class ProviderPreset(BaseModel):
    id: str
    label: str
    base_url: str


class ProviderListResponse(BaseModel):
    providers: list[ProviderPreset]
