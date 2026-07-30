"""Merge teaching-class machine mappings with one Proxmox resource snapshot."""

from __future__ import annotations

import logging
import uuid
from collections.abc import Iterable
from datetime import datetime, timezone
from typing import Any

from sqlmodel import Session, col, select

from app.infrastructure.proxmox import operations as proxmox_ops
from app.models import User
from app.models.teaching_class import (
    TeachingClassMachineNode,
    TeachingClassStudent,
    TeachingClassStudentMachine,
)
from app.repositories import resource as resource_repo
from app.schemas.teaching_class_machine import (
    TeachingClassMachineStatusResponse,
    TeachingClassMachineSummary,
    TeachingClassStudentMachinePublic,
    TeachingClassStudentMachinesPublic,
)
from app.services.proxmox_usage import safe_usage_pct

logger = logging.getLogger(__name__)


def _resources_by_vmid(resources: Iterable[dict[str, Any]]) -> dict[int, dict[str, Any]]:
    result: dict[int, dict[str, Any]] = {}
    for resource in resources:
        try:
            vmid = int(resource["vmid"])
        except (KeyError, TypeError, ValueError):
            continue
        if str(resource.get("type") or "") in {"qemu", "lxc"}:
            result[vmid] = resource
    return result


def get_teaching_class_machine_status(
    *,
    session: Session,
    class_id: uuid.UUID,
) -> TeachingClassMachineStatusResponse:
    enrollments = session.exec(
        select(TeachingClassStudent)
        .where(TeachingClassStudent.class_id == class_id)
        .order_by(col(TeachingClassStudent.joined_at))
    ).all()
    enrollment_ids = [row.id for row in enrollments]
    nodes = session.exec(
        select(TeachingClassMachineNode).where(
            TeachingClassMachineNode.class_id == class_id
        )
    ).all()
    nodes_by_id = {row.id: row for row in nodes}
    mappings = (
        session.exec(
            select(TeachingClassStudentMachine).where(
                col(TeachingClassStudentMachine.class_student_id).in_(enrollment_ids)
            )
        ).all()
        if enrollment_ids
        else []
    )
    mappings_by_student: dict[uuid.UUID, list[TeachingClassStudentMachine]] = {}
    for mapping in mappings:
        mappings_by_student.setdefault(mapping.class_student_id, []).append(mapping)

    try:
        live_by_vmid = _resources_by_vmid(proxmox_ops.list_all_resources())
    except Exception:
        logger.warning(
            "Teaching-class machine snapshot unavailable class_id=%s",
            class_id,
            exc_info=True,
        )
        live_by_vmid = {}

    user_ids = [row.user_id for row in enrollments]
    users = (
        {
            user.id: user
            for user in session.exec(select(User).where(col(User.id).in_(user_ids))).all()
        }
        if user_ids
        else {}
    )
    summary = TeachingClassMachineSummary(students=len(enrollments))
    students: list[TeachingClassStudentMachinesPublic] = []

    for enrollment in enrollments:
        user = users.get(enrollment.user_id)
        machine_rows: list[TeachingClassStudentMachinePublic] = []
        def _mapping_order(row: TeachingClassStudentMachine) -> int:
            node_for_order = nodes_by_id.get(row.machine_node_id)
            return node_for_order.sort_order if node_for_order else 0

        for mapping in sorted(
            mappings_by_student.get(enrollment.id, []),
            key=_mapping_order,
        ):
            node = nodes_by_id.get(mapping.machine_node_id)
            if node is None:
                continue
            live = live_by_vmid.get(mapping.vmid) if mapping.vmid is not None else None
            runtime_status = str(live.get("status") or "unknown") if live else "unknown"
            resource = (
                resource_repo.get_resource_by_vmid(session=session, vmid=mapping.vmid)
                if mapping.vmid is not None
                else None
            )
            machine_rows.append(
                TeachingClassStudentMachinePublic(
                    mapping_id=mapping.id,
                    machine_node_id=node.id,
                    node_key=node.node_key,
                    name=node.name,
                    role=node.role,
                    vmid=mapping.vmid,
                    resource_type=node.resource_type,
                    provision_status=mapping.status,
                    provision_error=mapping.error,
                    runtime_status=runtime_status,
                    proxmox_node=str(live.get("node")) if live and live.get("node") else None,
                    cpu_usage_pct=safe_usage_pct(live.get("cpu"), 1)
                    if live
                    else None,
                    ram_usage_pct=safe_usage_pct(live.get("mem"), live.get("maxmem"))
                    if live
                    else None,
                    disk_usage_pct=safe_usage_pct(live.get("disk"), live.get("maxdisk"))
                    if live
                    else None,
                    ip_address=(
                        resource_repo.get_cached_ip_address(
                            session=session, vmid=mapping.vmid
                        )
                        if mapping.vmid is not None
                        else None
                    ),
                    has_ssh_key=bool(resource and resource.ssh_private_key_encrypted),
                )
            )
            summary.machines += 1
            if mapping.status == "failed":
                summary.failed += 1
            elif mapping.vmid is None or mapping.status not in {"completed", "ready"}:
                summary.provisioning += 1
            if runtime_status == "running":
                summary.running += 1
            elif runtime_status == "stopped":
                summary.stopped += 1
            else:
                summary.unknown += 1

        students.append(
            TeachingClassStudentMachinesPublic(
                student_id=enrollment.id,
                user_id=enrollment.user_id,
                name=(user.full_name or user.email) if user else str(enrollment.user_id),
                email=user.email if user else "",
                machines=machine_rows,
            )
        )

    return TeachingClassMachineStatusResponse(
        class_id=class_id,
        refreshed_at=datetime.now(timezone.utc),
        summary=summary,
        students=students,
    )
