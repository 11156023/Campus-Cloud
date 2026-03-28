import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime
from sqlmodel import Field, Relationship, SQLModel

from .base import get_datetime_utc

if TYPE_CHECKING:
    from .ai_api_request import AIAPIRequest
    from .user import User


class AIAPICredential(SQLModel, table=True):
    __tablename__ = "ai_api_credentials"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: uuid.UUID = Field(foreign_key="user.id")
    request_id: uuid.UUID = Field(foreign_key="ai_api_requests.id")
    base_url: str = Field(max_length=2048)
    api_key_encrypted: str = Field(max_length=4096)
    api_key_prefix: str = Field(max_length=32)
    expires_at: datetime | None = Field(default=None, sa_type=DateTime(timezone=True))
    revoked_at: datetime | None = Field(default=None, sa_type=DateTime(timezone=True))
    created_at: datetime = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),
    )

    user: "User" = Relationship(back_populates="ai_api_credentials")
    request: "AIAPIRequest" = Relationship(back_populates="credentials")


__all__ = ["AIAPICredential"]
