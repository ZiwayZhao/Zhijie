import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, EmailStr, StringConstraints, field_validator


Password = Annotated[str, StringConstraints(min_length=8, max_length=128)]


class UserRegister(BaseModel):
    email: EmailStr
    password: Password
    name: Annotated[str, StringConstraints(min_length=1, max_length=200)]

    @field_validator("password")
    @classmethod
    def validate_password_strength(cls, v: str) -> str:
        if v.isdigit():
            raise ValueError("Password cannot be all digits")
        if v.isalpha():
            raise ValueError("Password must contain at least one digit or special character")
        return v


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserResponse(BaseModel):
    id: uuid.UUID
    email: str | None
    name: str
    avatar_url: str | None
    auth_provider: str
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class TokenRefresh(BaseModel):
    refresh_token: Annotated[str, StringConstraints(min_length=32, max_length=128)]
