from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # App
    environment: str = "dev"
    app_name: str = "智阶 API"
    debug: bool = False
    api_v1_prefix: str = "/api/v1"

    # Database — no default, must come from .env
    database_url: str = Field(..., alias="DATABASE_URL")

    # Redis — no default, must come from .env
    redis_url: str = Field(..., alias="REDIS_URL")

    # JWT — secret_key must be strong
    secret_key: str = Field(..., alias="SECRET_KEY")
    access_token_expire_minutes: int = 1440
    refresh_token_expire_days: int = 7
    algorithm: str = "HS256"

    # Google OAuth2
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "http://localhost:8003/api/v1/auth/google/callback"

    # S3 / MinIO — credentials from .env
    s3_endpoint_url: str = Field(..., alias="S3_ENDPOINT_URL")
    s3_public_endpoint_url: str = Field(default="", alias="S3_PUBLIC_ENDPOINT_URL")
    s3_public_url_prefix: str = Field(default="", alias="S3_PUBLIC_URL_PREFIX")
    s3_access_key: str = Field(..., alias="S3_ACCESS_KEY")
    s3_secret_key: str = Field(..., alias="S3_SECRET_KEY")
    s3_bucket_name: str = "zhijie-materials"
    s3_region: str = "us-east-1"

    # LLM (OpenRouter or Tencent CodingPlan)
    openrouter_api_key: str = Field(default="", alias="OPENROUTER_API_KEY")
    llm_base_url: str = Field(default="", alias="LLM_BASE_URL")
    llm_api_key: str = Field(default="", alias="LLM_API_KEY")

    # OpenDataLoader PDF (enhanced extraction with image bounding boxes)
    odl_enabled: bool = True
    odl_image_description_enabled: bool = True

    # CORS
    cors_origins: list[str] = Field(default_factory=lambda: [
        "http://localhost:5173",
        "http://localhost:3000",
        "http://localhost:51772",
    ])

    @field_validator("secret_key")
    @classmethod
    def validate_secret_key(cls, v: str) -> str:
        if len(v) < 32:
            raise ValueError("SECRET_KEY must be at least 32 characters")
        return v


settings = Settings()
