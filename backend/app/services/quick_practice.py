"""Launch and inspect fixed, multi-machine quick-practice environments."""

import secrets
import uuid
from datetime import UTC, datetime, timedelta

import sqlalchemy as sa
from sqlmodel import Session, col, func, select

from app.exceptions import BadRequestError, NotFoundError
from app.models import (
    CourseEnvironment,
    CourseEnvironmentNode,
    CourseEnvironmentVersion,
    CourseEnvironmentVersionStatus,
    QuickPracticeSession,
    QuickPracticeSessionMachine,
    Resource,
    User,
    VMProvisioningStatus,
    VMRequest,
    VMRequestStatus,
    VMTemplate,
    VMTemplateStatus,
)
from app.repositories import resource as resource_repo
from app.schemas import VMRequestCreate
from app.services.resource import quota_service
from app.services.scheduling.recurrence import get_schedule_policy
from app.services.vm import vm_request_service

MAX_ACTIVE_SESSIONS_PER_USER = 1
MAX_SESSIONS_PER_24_HOURS = 3


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _ensure_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _environment_for_version(
    session: Session, version: CourseEnvironmentVersion
) -> CourseEnvironment:
    environment = session.get(CourseEnvironment, version.environment_id)
    if environment is None:
        raise NotFoundError("Quick-practice environment not found")
    return environment


def get_published_template(
    session: Session, *, environment_id: uuid.UUID
) -> tuple[CourseEnvironment, CourseEnvironmentVersion]:
    environment = session.get(CourseEnvironment, environment_id)
    if environment is None or environment.usage_scope not in {"quick_practice", "both"}:
        raise NotFoundError("Quick-practice template not found")
    version = session.exec(
        select(CourseEnvironmentVersion)
        .where(
            CourseEnvironmentVersion.environment_id == environment.id,
            CourseEnvironmentVersion.status == CourseEnvironmentVersionStatus.published,
        )
        .order_by(col(CourseEnvironmentVersion.version).desc())
    ).first()
    if version is None:
        raise NotFoundError("Published quick-practice template not found")
    return environment, version


def list_published_templates(
    session: Session,
) -> list[tuple[CourseEnvironment, CourseEnvironmentVersion]]:
    environments = session.exec(
        select(CourseEnvironment)
        .where(col(CourseEnvironment.usage_scope).in_(["quick_practice", "both"]))
        .order_by(col(CourseEnvironment.updated_at).desc())
    ).all()
    result: list[tuple[CourseEnvironment, CourseEnvironmentVersion]] = []
    for environment in environments:
        version = session.exec(
            select(CourseEnvironmentVersion)
            .where(
                CourseEnvironmentVersion.environment_id == environment.id,
                CourseEnvironmentVersion.status == CourseEnvironmentVersionStatus.published,
            )
            .order_by(col(CourseEnvironmentVersion.version).desc())
        ).first()
        if version is not None:
            result.append((environment, version))
    return result


def nodes_for_version(
    session: Session, *, version_id: uuid.UUID
) -> list[CourseEnvironmentNode]:
    return list(
        session.exec(
            select(CourseEnvironmentNode)
            .where(CourseEnvironmentNode.version_id == version_id)
            .order_by(col(CourseEnvironmentNode.sort_order))
        ).all()
    )


def _machine_request(
    *,
    session: Session,
    node: CourseEnvironmentNode,
    environment: CourseEnvironment,
    practice_session_id: uuid.UUID,
    now: datetime,
    expires_at: datetime,
) -> VMRequestCreate:
    is_lxc = node.resource_type.lower() == "lxc"
    template: VMTemplate | None = None
    if node.source_type == "template" and node.source_template_id:
        template = session.get(VMTemplate, node.source_template_id)
        if template is None or template.status != VMTemplateStatus.ready:
            raise BadRequestError(f"機器「{node.name}」的來源範本尚未就緒")

    template_id: int | None = None
    ostemplate: str | None = None
    storage = node.custom_storage or "local-lvm"
    username: str | None = None
    if template is not None:
        template_id = template.pve_vmid
        storage = template.storage or storage
        if not is_lxc:
            username = "student"
    elif is_lxc:
        ostemplate = node.custom_image_ref
    else:
        try:
            template_id = int(node.custom_image_ref or "0")
        except ValueError as exc:
            raise BadRequestError(f"機器「{node.name}」的 VM 範本無效") from exc
        username = node.custom_username or "student"

    return VMRequestCreate(
        reason=f"Quick practice environment: {environment.name[:120]}",
        resource_type="lxc" if is_lxc else "vm",
        hostname=f"practice-{practice_session_id.hex[:6]}-{node.sort_order + 1}",
        cores=node.cpu,
        memory=node.memory_mb,
        password=secrets.token_urlsafe(24),
        storage=storage,
        environment_type=f"快速練習｜{environment.name}",
        os_info=node.name,
        mode="immediate",
        start_at=now,
        end_at=expires_at,
        ostemplate=ostemplate,
        rootfs_size=node.disk_gb if is_lxc else None,
        template_id=template_id,
        disk_size=None if is_lxc else node.disk_gb,
        username=username,
    )


def _session_has_live_request(session: Session, item: QuickPracticeSession) -> bool:
    requests = list(
        session.exec(
            select(VMRequest)
            .join(
                QuickPracticeSessionMachine,
                QuickPracticeSessionMachine.vm_request_id == VMRequest.id,
            )
            .where(QuickPracticeSessionMachine.session_id == item.id)
        ).all()
    )
    return any(
        request.status == VMRequestStatus.approved
        and (
            request.vmid is not None
            or request.provisioning_status != VMProvisioningStatus.failed
        )
        for request in requests
    )


def launch(
    session: Session, *, user, environment_id: uuid.UUID
) -> QuickPracticeSession:
    environment, version = get_published_template(
        session, environment_id=environment_id
    )
    nodes = nodes_for_version(session, version_id=version.id)
    if not nodes:
        raise BadRequestError("快速練習模板沒有機器")

    # Serialize launches for one user so simultaneous clicks cannot bypass the
    # one-active-session and rolling 24-hour limits.
    locked_user = session.exec(
        select(User).where(User.id == user.id).with_for_update()
    ).one_or_none()
    if locked_user is None:
        raise NotFoundError("User not found")

    now = _utc_now()
    active_sessions = list(
        session.exec(
            select(QuickPracticeSession).where(
                QuickPracticeSession.user_id == user.id,
                QuickPracticeSession.expires_at > now,
            )
        ).all()
    )
    if sum(_session_has_live_request(session, item) for item in active_sessions) >= MAX_ACTIVE_SESSIONS_PER_USER:
        raise BadRequestError("你已經有一個進行中的快速練習環境")

    recent_count = session.exec(
        select(func.count(col(QuickPracticeSession.id))).where(
            QuickPracticeSession.user_id == user.id,
            QuickPracticeSession.created_at >= now - timedelta(hours=24),
        )
    ).one()
    if int(recent_count or 0) >= MAX_SESSIONS_PER_24_HOURS:
        raise BadRequestError("已達 24 小時內快速練習建立上限")

    quota_service.check_quota(
        session,
        user.id,
        delta_cores=sum(node.cpu for node in nodes),
        delta_memory_mb=sum(node.memory_mb for node in nodes),
        delta_disk_gb=sum(node.disk_gb for node in nodes),
        delta_instances=len(nodes),
    )

    duration_hours = get_schedule_policy(session=session).practice_session_hours
    practice = QuickPracticeSession(
        user_id=user.id,
        environment_version_id=version.id,
        expires_at=now + timedelta(hours=duration_hours),
    )
    session.add(practice)
    session.flush()

    request_ids: list[uuid.UUID] = []
    for node in nodes:
        request_in = _machine_request(
            session=session,
            node=node,
            environment=environment,
            practice_session_id=practice.id,
            now=now,
            expires_at=practice.expires_at,
        )
        db_request = vm_request_service.create_quick_practice_request(
            session=session,
            request_in=request_in,
            user=user,
        )
        session.add(
            QuickPracticeSessionMachine(
                session_id=practice.id,
                vm_request_id=db_request.id,
                node_key=node.node_key,
                name=node.name,
                role=node.role,
                resource_type=node.resource_type,
                sort_order=node.sort_order,
            )
        )
        request_ids.append(db_request.id)

    session.commit()
    session.refresh(practice)
    for request_id in request_ids:
        vm_request_service.submit_course_provision(request_id)
    return practice


def list_sessions(
    session: Session, *, user_id: uuid.UUID | None = None
) -> list[QuickPracticeSession]:
    now = _utc_now()
    sessions_with_resources = select(QuickPracticeSessionMachine.session_id).join(
        Resource,
        Resource.request_id == QuickPracticeSessionMachine.vm_request_id,
    )
    statement = select(QuickPracticeSession).where(
        sa.or_(
            QuickPracticeSession.expires_at > now,
            col(QuickPracticeSession.id).in_(sessions_with_resources),
        )
    )
    if user_id is not None:
        statement = statement.where(QuickPracticeSession.user_id == user_id)
    return list(
        session.exec(
            statement.order_by(col(QuickPracticeSession.created_at).desc()).limit(100)
        ).all()
    )


def serialize_session(session: Session, item: QuickPracticeSession) -> dict:
    version = session.get(CourseEnvironmentVersion, item.environment_version_id)
    if version is None:
        raise NotFoundError("Quick-practice environment version not found")
    environment = _environment_for_version(session, version)
    rows = list(
        session.exec(
            select(QuickPracticeSessionMachine, VMRequest)
            .join(VMRequest, QuickPracticeSessionMachine.vm_request_id == VMRequest.id)
            .where(QuickPracticeSessionMachine.session_id == item.id)
            .order_by(col(QuickPracticeSessionMachine.sort_order))
        ).all()
    )
    machines = []
    for machine, request in rows:
        if request.vmid is not None:
            status = "running" if request.provisioning_status == VMProvisioningStatus.completed else "provisioning"
        elif request.provisioning_status == VMProvisioningStatus.failed:
            status = "failed"
        else:
            status = "provisioning"
        machines.append(
            {
                "id": machine.id,
                "node_key": machine.node_key,
                "name": machine.name,
                "role": machine.role,
                "resource_type": machine.resource_type,
                "request_id": request.id,
                "vmid": request.vmid,
                "status": status,
                "node": request.actual_node or request.assigned_node or request.desired_node,
                "ip_address": (
                    resource_repo.get_cached_ip_address(session=session, vmid=request.vmid)
                    if request.vmid is not None
                    else None
                ),
                "os_info": request.os_info,
            }
        )
    statuses = {machine["status"] for machine in machines}
    group_status = (
        "failed"
        if statuses == {"failed"}
        else "partial_failed"
        if "failed" in statuses
        else "running"
        if statuses == {"running"}
        else "provisioning"
    )
    return {
        "id": item.id,
        "kind": "quick_practice",
        "kind_label": "快速模板",
        "title": environment.name,
        "environment_id": environment.id,
        "environment_version_id": version.id,
        "version": version.version,
        "status": group_status,
        "created_at": item.created_at,
        "expires_at": item.expires_at,
        "machines": machines,
    }
