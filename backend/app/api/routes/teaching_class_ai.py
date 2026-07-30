"""Teaching-class scoped AI PVE routes."""

import logging
import uuid

from fastapi import APIRouter, HTTPException

from app.ai.pve_log.chat import chat as pve_chat
from app.ai.pve_log.schemas import (
    ChatResponse,
    ScopedChatRequest,
    SSHConfirmRequest,
    SSHExecResult,
)
from app.api.deps import InstructorUser, SessionDep
from app.services.teaching_class_access import get_authorized_teaching_class
from app.services.teaching_class_machine_scope import (
    resolve_teaching_class_machine_targets,
)

logger = logging.getLogger(__name__)
router = APIRouter(
    prefix="/teaching-classes/{class_id}/ai/pve-log",
    tags=["teaching-class-ai"],
)


def _resolve_class_vmids(
    *,
    session: SessionDep,
    current_user: InstructorUser,
    class_id: uuid.UUID,
) -> set[int]:
    get_authorized_teaching_class(
        session=session,
        current_user=current_user,
        class_id=class_id,
    )
    return {
        target.vmid
        for target in resolve_teaching_class_machine_targets(
            session=session,
            class_id=class_id,
        )
    }


@router.post("/chat", response_model=ChatResponse)
async def chat(
    class_id: uuid.UUID,
    request: ScopedChatRequest,
    session: SessionDep,
    current_user: InstructorUser,
) -> ChatResponse:
    allowed_vmids = _resolve_class_vmids(
        session=session, current_user=current_user, class_id=class_id
    )
    try:
        return await pve_chat(
            message=request.message,
            history=request.messages,
            session=session,
            allowed_vmids=allowed_vmids,
            requester_id=current_user.id,
            scope_type="teaching_class",
            scope_id=class_id,
        )
    except Exception as exc:
        logger.exception("Teaching-class AI-PVE chat failed")
        raise HTTPException(status_code=500, detail="AI-PVE 對話失敗") from exc


@router.post("/ssh/confirm", response_model=SSHExecResult)
async def confirm_ssh(
    class_id: uuid.UUID,
    request: SSHConfirmRequest,
    session: SessionDep,
    current_user: InstructorUser,
) -> SSHExecResult:
    from app.ai.pve_log.ssh_exec import confirm_exec

    allowed_vmids = _resolve_class_vmids(
        session=session, current_user=current_user, class_id=class_id
    )
    return await confirm_exec(
        request,
        session=session,
        requester_id=current_user.id,
        scope_type="teaching_class",
        scope_id=class_id,
        allowed_vmids=allowed_vmids,
    )
