"""教室權限檢查與 session 編排（DB session 由呼叫端注入）。

權限模型：
- 觀看（monitor）：admin/RESOURCE_OWNERSHIP_BYPASS 直接過；
  teacher 只能看「自己擁有的群組的成員」的 VM。
- 直播（broadcast）：需 CLASSROOM_MONITOR + 群組擁有者（admin bypass）
  + 直播源 VM 是自己的（admin bypass）。
"""

import logging
import uuid
from typing import Any, Protocol

from sqlmodel import Session, col, select

from app.core.authorizers import (
    require_classroom_monitor,
    require_group_access,
    require_resource_access,
)
from app.core.permissions import Permission, has_permission, is_admin
from app.exceptions import BadRequestError, NotFoundError, PermissionDeniedError
from app.models import (
    Group,
    GroupMember,
    Resource,
    TeachingClass,
    TeachingClassMachineNode,
    TeachingClassStatus,
    TeachingClassStudent,
    TeachingClassStudentMachine,
    User,
)
from app.repositories import group as group_repo
from app.schemas.classroom import ClassroomStudent, ClassroomVm
from app.services.classroom.presence import classroom_presence_hub
from app.services.classroom.vnc_session_manager import (
    ClassroomSession,
    SessionMode,
    vnc_session_manager,
)

logger = logging.getLogger(__name__)


class _BroadcastFinder(Protocol):
    def find_broadcast_for_groups(
        self, group_ids: set[uuid.UUID]
    ) -> ClassroomSession | None: ...

    def find_broadcast_for_classes(
        self, class_ids: set[uuid.UUID]
    ) -> ClassroomSession | None: ...


# ---------------------------------------------------------------------------
# 權限檢查
# ---------------------------------------------------------------------------


def require_can_watch(session: Session, user: User, vmid: int) -> Resource:
    """觀看（monitor）權限：admin bypass 或 teacher 看自己群組成員的 VM。"""
    resource = session.get(Resource, vmid)
    if resource is None:
        raise NotFoundError(f"Resource {vmid} not found")
    if has_permission(user, Permission.RESOURCE_OWNERSHIP_BYPASS):
        return resource
    if group_repo.is_user_in_any_owned_group(
        session=session, instructor_id=user.id, member_user_id=resource.user_id
    ):
        return resource
    raise PermissionDeniedError("You don't have permission to watch this VM")


def require_can_broadcast(
    session: Session, user: User, vmid: int, group_id: uuid.UUID
) -> None:
    """直播權限：CLASSROOM_MONITOR + 自己的群組 + 自己的 VM（admin bypass）。"""
    require_classroom_monitor(user)
    group = session.get(Group, group_id)
    if group is None:
        raise NotFoundError("Group not found")
    require_group_access(user, group.owner_id)
    resource = session.get(Resource, vmid)
    if resource is None:
        raise NotFoundError(f"Resource {vmid} not found")
    require_resource_access(
        user,
        resource.user_id,
        detail="You can only broadcast your own VM",
    )


def _require_active_class(
    session: Session, user: User, class_id: uuid.UUID
) -> TeachingClass:
    teaching_class = session.get(TeachingClass, class_id)
    if teaching_class is None:
        raise NotFoundError("Teaching class not found")
    require_group_access(user, teaching_class.owner_id)
    if teaching_class.status != TeachingClassStatus.active:
        raise BadRequestError("班級機器全部就緒後才能使用上課監看")
    return teaching_class


def require_can_watch_class(
    session: Session, user: User, class_id: uuid.UUID, vmid: int
) -> TeachingClassStudentMachine:
    """教師只能觀看自己班級中已建立的 QEMU 機器。"""
    _require_active_class(session, user, class_id)
    machine = session.exec(
        select(TeachingClassStudentMachine)
        .join(
            TeachingClassStudent,
            TeachingClassStudentMachine.class_student_id == TeachingClassStudent.id,
        )
        .where(
            TeachingClassStudent.class_id == class_id,
            TeachingClassStudentMachine.vmid == vmid,
        )
    ).first()
    if machine is None:
        raise PermissionDeniedError("This machine does not belong to the teaching class")
    node = session.get(TeachingClassMachineNode, machine.machine_node_id)
    if node is None or node.resource_type.lower() == "lxc":
        raise BadRequestError("目前上課監看只支援 VM")
    return machine


def require_can_broadcast_class(
    session: Session, user: User, class_id: uuid.UUID, vmid: int
) -> None:
    """班級擁有者可將自己的 QEMU 示範機直播給班級。"""
    require_classroom_monitor(user)
    _require_active_class(session, user, class_id)
    resource = session.get(Resource, vmid)
    if resource is None:
        raise NotFoundError(f"Resource {vmid} not found")
    require_resource_access(
        user,
        resource.user_id,
        detail="You can only broadcast your own VM",
    )


def get_group_ids_of_user(session: Session, user_id: uuid.UUID) -> set[uuid.UUID]:
    """使用者相關的群組：作為成員的 ∪ 作為擁有者的。"""
    member_ids = session.exec(
        select(GroupMember.group_id).where(GroupMember.user_id == user_id)
    ).all()
    owned_ids = session.exec(select(Group.id).where(Group.owner_id == user_id)).all()
    return set(member_ids) | set(owned_ids)


def get_class_ids_of_user(session: Session, user_id: uuid.UUID) -> set[uuid.UUID]:
    """使用者作為學生或擁有者所屬的正式班級。"""
    member_ids = session.exec(
        select(TeachingClassStudent.class_id).where(
            TeachingClassStudent.user_id == user_id
        )
    ).all()
    owned_ids = session.exec(
        select(TeachingClass.id).where(TeachingClass.owner_id == user_id)
    ).all()
    return set(member_ids) | set(owned_ids)


# ---------------------------------------------------------------------------
# 查詢
# ---------------------------------------------------------------------------


def list_classroom_students(
    session: Session,
    group_id: uuid.UUID,
    user: User,
    *,
    cluster_resources: list[dict[str, Any]],
) -> list[ClassroomStudent]:
    """群組學生卡片：VM 清單（含叢集狀態）+ 信令連線 online 狀態。"""
    group = session.get(Group, group_id)
    if group is None:
        raise NotFoundError("Group not found")
    require_group_access(user, group.owner_id)

    members = group_repo.get_group_members(session=session, group_id=group_id)
    member_ids = [member.id for member in members]
    resources = (
        list(
            session.exec(
                select(Resource).where(col(Resource.user_id).in_(member_ids))
            ).all()
        )
        if member_ids
        else []
    )
    vms_by_user: dict[uuid.UUID, list[Resource]] = {}
    for resource in resources:
        vms_by_user.setdefault(resource.user_id, []).append(resource)

    listing: dict[int, dict[str, Any]] = {}
    for item in cluster_resources:
        raw_vmid = item.get("vmid")
        if raw_vmid is not None:
            listing[int(raw_vmid)] = item

    online = classroom_presence_hub.online_user_ids(group_id)

    students: list[ClassroomStudent] = []
    for member in members:
        vms = []
        for resource in vms_by_user.get(member.id, []):
            info = listing.get(resource.vmid, {})
            vms.append(
                ClassroomVm(
                    vmid=resource.vmid,
                    name=info.get("name"),
                    status=info.get("status"),
                    vm_type=info.get("type"),
                )
            )
        students.append(
            ClassroomStudent(
                user_id=member.id,
                email=member.email,
                full_name=member.full_name,
                vms=sorted(vms, key=lambda v: v.vmid),
                online=member.id in online,
            )
        )
    return students


def list_class_students(
    session: Session,
    class_id: uuid.UUID,
    user: User,
    *,
    cluster_resources: list[dict[str, Any]],
) -> list[ClassroomStudent]:
    """班級學生及其固定多機器，供班級內的上課監看使用。"""
    _require_active_class(session, user, class_id)
    enrollments = list(
        session.exec(
            select(TeachingClassStudent)
            .where(TeachingClassStudent.class_id == class_id)
            .order_by(TeachingClassStudent.joined_at)
        ).all()
    )
    enrollment_ids = [row.id for row in enrollments]
    user_ids = [row.user_id for row in enrollments]
    users = (
        {
            row.id: row
            for row in session.exec(select(User).where(col(User.id).in_(user_ids))).all()
        }
        if user_ids
        else {}
    )
    machines = (
        list(
            session.exec(
                select(TeachingClassStudentMachine).where(
                    col(TeachingClassStudentMachine.class_student_id).in_(
                        enrollment_ids
                    )
                )
            ).all()
        )
        if enrollment_ids
        else []
    )
    nodes = {
        row.id: row
        for row in session.exec(
            select(TeachingClassMachineNode).where(
                TeachingClassMachineNode.class_id == class_id
            )
        ).all()
    }
    machines_by_enrollment: dict[uuid.UUID, list[TeachingClassStudentMachine]] = {}
    for machine in machines:
        machines_by_enrollment.setdefault(machine.class_student_id, []).append(machine)
    listing = {
        int(row["vmid"]): row
        for row in cluster_resources
        if row.get("vmid") is not None
    }
    online = classroom_presence_hub.online_user_ids_for_class(class_id)

    result: list[ClassroomStudent] = []
    for enrollment in enrollments:
        account = users.get(enrollment.user_id)
        if account is None:
            continue
        vms: list[ClassroomVm] = []
        for machine in machines_by_enrollment.get(enrollment.id, []):
            node = nodes.get(machine.machine_node_id)
            if machine.vmid is None or node is None:
                continue
            info = listing.get(machine.vmid, {})
            vms.append(
                ClassroomVm(
                    vmid=machine.vmid,
                    name=node.name,
                    status=info.get("status") or machine.status,
                    vm_type=node.resource_type.lower(),
                )
            )
        result.append(
            ClassroomStudent(
                user_id=account.id,
                email=account.email,
                full_name=account.full_name,
                vms=sorted(vms, key=lambda row: row.vmid),
                online=account.id in online,
            )
        )
    return result


def list_class_broadcast_sources(
    session: Session,
    class_id: uuid.UUID,
    user: User,
    *,
    cluster_resources: list[dict[str, Any]],
) -> list[ClassroomVm]:
    """列出教師自己的執行中 QEMU，作為班級直播來源。"""
    _require_active_class(session, user, class_id)
    owned = list(session.exec(select(Resource).where(Resource.user_id == user.id)).all())
    listing = {
        int(row["vmid"]): row
        for row in cluster_resources
        if row.get("vmid") is not None
    }
    result = []
    for resource in owned:
        info = listing.get(resource.vmid, {})
        if info.get("type") == "lxc" or info.get("status") != "running":
            continue
        result.append(
            ClassroomVm(
                vmid=resource.vmid,
                name=info.get("name") or f"VM {resource.vmid}",
                status="running",
                vm_type=info.get("type") or "qemu",
            )
        )
    return result


def get_live_for_user(
    session: Session,
    user: User,
    *,
    manager: _BroadcastFinder = vnc_session_manager,
) -> ClassroomSession | None:
    """學生自己群組進行中的 broadcast session（沒有則 None）。"""
    group_ids = get_group_ids_of_user(session, user.id)
    group_live = manager.find_broadcast_for_groups(group_ids)
    if group_live is not None:
        return group_live
    class_finder = getattr(manager, "find_broadcast_for_classes", None)
    if class_finder is None:
        return None
    return class_finder(get_class_ids_of_user(session, user.id))


def list_sessions_for(user: User) -> list[ClassroomSession]:
    """admin 看全部；其他人只看自己發起的。"""
    sessions = vnc_session_manager.list_sessions()
    if is_admin(user):
        return sessions
    return [s for s in sessions if s.started_by == user.id]


# ---------------------------------------------------------------------------
# 編排（session 生命週期 + 事件推播）
# ---------------------------------------------------------------------------


def _event(event_type: str, session: ClassroomSession) -> dict[str, Any]:
    return {
        "type": event_type,
        "session_id": session.id,
        "vmid": session.vmid,
        "group_id": str(session.group_id) if session.group_id else None,
        "class_id": str(session.class_id) if session.class_id else None,
    }


async def start_watch(session: Session, user: User, vmid: int) -> ClassroomSession:
    require_can_watch(session, user, vmid)
    return await vnc_session_manager.start_session(
        vmid=vmid, mode=SessionMode.monitor, group_id=None, started_by=user.id
    )


async def start_class_watch(
    session: Session, user: User, vmid: int, class_id: uuid.UUID
) -> ClassroomSession:
    require_can_watch_class(session, user, class_id, vmid)
    return await vnc_session_manager.start_session(
        vmid=vmid,
        mode=SessionMode.monitor,
        group_id=None,
        class_id=class_id,
        started_by=user.id,
    )


async def start_broadcast(
    session: Session, user: User, vmid: int, group_id: uuid.UUID
) -> ClassroomSession:
    require_can_broadcast(session, user, vmid, group_id)
    live = await vnc_session_manager.start_session(
        vmid=vmid, mode=SessionMode.broadcast, group_id=group_id, started_by=user.id
    )
    await classroom_presence_hub.broadcast_to_group(
        group_id, _event("live_started", live)
    )
    return live


async def start_class_broadcast(
    session: Session, user: User, vmid: int, class_id: uuid.UUID
) -> ClassroomSession:
    require_can_broadcast_class(session, user, class_id, vmid)
    live = await vnc_session_manager.start_session(
        vmid=vmid,
        mode=SessionMode.broadcast,
        group_id=None,
        class_id=class_id,
        started_by=user.id,
    )
    await classroom_presence_hub.broadcast_to_class(
        class_id, _event("live_started", live)
    )
    return live


async def stop_session(user: User, session_id: str) -> None:
    """發起者或 admin 可停止；live_stopped 由 on_session_end 統一推播。"""
    live = vnc_session_manager.get_session(session_id)
    if live is None:
        raise NotFoundError("Classroom session not found")
    if live.started_by != user.id and not is_admin(user):
        raise PermissionDeniedError("Only the session starter or an admin can stop it")
    await vnc_session_manager.stop_session(session_id)


async def set_control(
    session: Session, user: User, session_id: str, action: str
) -> ClassroomSession:
    """接管 / 釋放學生 VM 的控制權（僅 monitor session 發起者或 admin）。"""
    live = vnc_session_manager.get_session(session_id)
    if live is None:
        raise NotFoundError("Classroom session not found")
    if live.mode is not SessionMode.monitor:
        raise BadRequestError("Control is only available for monitor sessions")
    if live.started_by != user.id and not is_admin(user):
        raise PermissionDeniedError("Only the session starter or an admin can take control")

    if action == "take":
        await vnc_session_manager.set_controller(session_id, user.id)
        event_type = "takeover_started"
    else:
        await vnc_session_manager.set_controller(session_id, None)
        event_type = "takeover_stopped"

    resource = session.get(Resource, live.vmid)
    if resource is not None:
        await classroom_presence_hub.send_to_user(
            resource.user_id, _event(event_type, live)
        )
    updated = vnc_session_manager.get_session(session_id)
    return updated if updated is not None else live


# ---------------------------------------------------------------------------
# session 結束事件（上游關閉 / 手動停止都會經過這裡）
# ---------------------------------------------------------------------------


def _lookup_resource_owner(vmid: int) -> uuid.UUID | None:
    from app.core.db import engine  # 延遲 import：測試環境不一定有 DB 設定

    try:
        with Session(engine) as db:
            resource = db.get(Resource, vmid)
            return resource.user_id if resource else None
    except Exception:
        logger.exception("Failed to look up resource owner for vmid %s", vmid)
        return None


async def _on_session_end(session: ClassroomSession, _reason: str) -> None:
    try:
        if session.mode is SessionMode.broadcast and session.group_id is not None:
            await classroom_presence_hub.broadcast_to_group(
                session.group_id, _event("live_stopped", session)
            )
        elif session.mode is SessionMode.broadcast and session.class_id is not None:
            await classroom_presence_hub.broadcast_to_class(
                session.class_id, _event("live_stopped", session)
            )
        elif (
            session.mode is SessionMode.monitor
            and session.controller_user_id is not None
        ):
            # 接管中結束 → 解除學生端的「老師接管中」覆蓋
            owner_id = _lookup_resource_owner(session.vmid)
            if owner_id is not None:
                await classroom_presence_hub.send_to_user(
                    owner_id, _event("takeover_stopped", session)
                )
    except Exception:
        logger.exception("Classroom session end event push failed")


vnc_session_manager.on_session_end(_on_session_end)
