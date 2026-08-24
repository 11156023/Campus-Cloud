"""教學情境的 VM 存取檢查：owner 本人、班級老師、或 admin。

與 ``api/deps/proxmox.check_resource_ownership``（owner/admin only）的差異：
多放行「VM 擁有者所屬正式班級的擁有者（老師）」，供 E1 重置、
E4 快照管理等教學操作共用。

原 group 版本在 677ffca（群組制改為正式教室工作流）被移除，但
``api/deps/proxmox.get_resource_info_teaching`` 的延遲 import 仍指向
本模組；此為以 TeachingClass 模型的重寫。
"""

from __future__ import annotations

import logging
import uuid

from sqlmodel import Session, select

from app.core.authorizers import can_bypass_resource_ownership
from app.exceptions import NotFoundError, PermissionDeniedError
from app.models import Resource, TeachingClass, TeachingClassStudent, User

logger = logging.getLogger(__name__)


def _is_teacher_of_user(
    session: Session, teacher_id: uuid.UUID, student_user_id: uuid.UUID
) -> bool:
    """student_user_id 是否為 teacher_id 擁有的任一正式班級學生。"""
    stmt = (
        select(TeachingClassStudent.id)
        .join(
            TeachingClass,
            TeachingClassStudent.class_id == TeachingClass.id,  # type: ignore[arg-type]
        )
        .where(
            TeachingClass.owner_id == teacher_id,
            TeachingClassStudent.user_id == student_user_id,
        )
        .limit(1)
    )
    return session.exec(stmt).first() is not None


def require_vm_teaching_access(session: Session, user: User, vmid: int) -> Resource:
    resource = session.get(Resource, vmid)
    if resource is None:
        raise NotFoundError(f"Resource {vmid} not found")
    if resource.user_id == user.id:
        return resource
    if can_bypass_resource_ownership(user):
        return resource
    if resource.user_id is not None and _is_teacher_of_user(
        session, user.id, resource.user_id
    ):
        return resource
    logger.warning(
        "User %s denied teaching access to resource %s", user.id, vmid
    )
    raise PermissionDeniedError("You don't have permission to manage this resource")


__all__ = ["require_vm_teaching_access"]
