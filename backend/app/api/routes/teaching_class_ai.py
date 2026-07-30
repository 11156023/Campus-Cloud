"""Teaching-class scoped AI PVE routes."""

import logging
import uuid

from fastapi import APIRouter, HTTPException
from sqlmodel import col, select

from app.ai.pve_log.chat import chat as pve_chat
from app.ai.pve_log.schemas import (
    ChatResponse,
    ScopedChatRequest,
    SSHConfirmRequest,
    SSHExecResult,
)
from app.api.deps import InstructorUser, SessionDep
from app.models import TeachingClass, TeachingClassStudent, TeachingClassStudentMachine

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
    teaching_class = session.get(TeachingClass, class_id)
    if teaching_class is None:
        raise HTTPException(status_code=404, detail="Teaching class not found")
    if (
        teaching_class.owner_id != current_user.id
        and not current_user.is_superuser
        and current_user.role != "admin"
    ):
        raise HTTPException(status_code=403, detail="Not enough permissions")
    enrollment_ids = session.exec(
        select(TeachingClassStudent.id).where(
            TeachingClassStudent.class_id == class_id
        )
    ).all()
    if not enrollment_ids:
        return set()
    vmids = session.exec(
        select(TeachingClassStudentMachine.vmid).where(
            col(TeachingClassStudentMachine.class_student_id).in_(enrollment_ids),
            col(TeachingClassStudentMachine.vmid).is_not(None),
        )
    ).all()
    return {int(vmid) for vmid in vmids if vmid is not None}


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
