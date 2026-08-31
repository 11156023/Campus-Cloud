from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from app.ai.pve_log.chat import chat as pve_chat
from app.ai.pve_log.schemas import (
    ChatRequest,
    ChatResponse,
    SSHConfirmRequest,
    SSHExecResult,
)
from app.api.deps import AdminUser, SessionDep

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ai/pve-log", tags=["ai-pve-log"])


@router.post("/chat", response_model=ChatResponse)
async def chat(
    request: ChatRequest,
    _current_user: AdminUser,
    session: SessionDep,
) -> ChatResponse:
    try:
        return await pve_chat(
            message=request.message,
            history=request.messages,
            session=session,
        )
    except Exception:
        logger.exception("AI-PVE 對話失敗")
        raise HTTPException(status_code=500, detail="AI-PVE 對話失敗")


@router.post("/ssh/confirm", response_model=SSHExecResult, tags=["ai-pve-log-ssh"])
async def post_ssh_confirm(
    request: SSHConfirmRequest,
    _current_user: AdminUser,
    session: SessionDep,
) -> SSHExecResult:
    from app.ai.pve_log.ssh_exec import confirm_exec as _confirm_exec

    try:
        return await _confirm_exec(request, session=session)
    except Exception as exc:
        logger.exception("SSH 確認失敗")
        raise HTTPException(status_code=500, detail=str(exc))
