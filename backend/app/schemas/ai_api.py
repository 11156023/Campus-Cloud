import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.models.ai_api_request import AIAPIRequestStatus


class AIAPIRequestCreate(BaseModel):
    purpose: str = Field(min_length=10, max_length=2000)


class AIAPIRequestReview(BaseModel):
    status: AIAPIRequestStatus
    review_comment: str | None = Field(default=None, max_length=2000)


class AIAPIRequestPublic(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    user_email: str | None = None
    user_full_name: str | None = None
    purpose: str
    status: AIAPIRequestStatus
    reviewer_id: uuid.UUID | None = None
    reviewer_email: str | None = None
    review_comment: str | None = None
    reviewed_at: datetime | None = None
    created_at: datetime


class AIAPIRequestsPublic(BaseModel):
    data: list[AIAPIRequestPublic]
    count: int


class AIAPICredentialPublic(BaseModel):
    id: uuid.UUID
    request_id: uuid.UUID
    base_url: str
    api_key: str
    api_key_prefix: str
    expires_at: datetime | None = None
    revoked_at: datetime | None = None
    created_at: datetime


class AIAPICredentialsPublic(BaseModel):
    data: list[AIAPICredentialPublic]
    count: int
