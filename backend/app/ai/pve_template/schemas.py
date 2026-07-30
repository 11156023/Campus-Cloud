"""API schemas for the AI PVE template test feature."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, model_validator

from app.ai.pve_log.schemas import SSHConfirmRequest, SSHExecResult, ToolCallRecord


class AIPVETemplateRead(BaseModel):
    id: uuid.UUID
    template_key: str
    display_name: str
    description: str
    enabled: bool
    created_at: datetime
    updated_at: datetime


class AIPVETemplateChatRequest(BaseModel):
    template_key: str = Field(min_length=1, max_length=50)
    vmid: int = Field(default=102, ge=1)
    message: str | None = Field(default=None, min_length=1, max_length=2000)
    messages: list[dict[str, Any]] | None = Field(default=None, max_length=40)

    @model_validator(mode="after")
    def require_message_or_history(self) -> AIPVETemplateChatRequest:
        if not self.message and not self.messages:
            raise ValueError("message 或 messages 至少需要一項")
        return self


class AIPVETemplateChatResponse(BaseModel):
    template_key: str
    vmid: int
    reply: str = ""
    tools_called: list[ToolCallRecord] = Field(default_factory=list)
    needs_confirmation: bool = False
    messages: list[dict[str, Any]] = Field(default_factory=list)
    error: str | None = None
    confirmation_result: SSHExecResult | None = None


class AIPVETemplateSSHConfirmRequest(SSHConfirmRequest):
    """Confirmation body; host, key, and VMID are never accepted from client."""

    pass
