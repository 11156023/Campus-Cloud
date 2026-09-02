"""Materialize a course's logical per-student topology as PVE firewall rules."""

import logging
import uuid
from typing import Any, cast

from sqlmodel import Session, select

from app.infrastructure.proxmox.operations import ResourceType
from app.models import (
    CourseEnvironmentEdge,
    IpAllocation,
    TeachingClass,
    TeachingClassMachineNode,
    TeachingClassStudent,
    TeachingClassStudentMachine,
)
from app.services.network import firewall_service
from app.services.proxmox import proxmox_service

COMMENT_PREFIX = "SkyLab:class-net:"
logger = logging.getLogger(__name__)


def _segments(value: str | None) -> set[str]:
    return {
        item.strip()
        for item in (value or "lab-net").replace("/", ",").split(",")
        if item.strip()
    }


def _ip_by_vmid(session: Session, vmid: int) -> str | None:
    return session.exec(
        select(IpAllocation.ip_address).where(IpAllocation.vmid == vmid)
    ).first()


def _ensure_rule(
    *,
    node: str,
    vmid: int,
    resource_type: ResourceType,
    comment: str,
    rule: dict[str, Any],
) -> None:
    existing = firewall_service.get_vm_firewall_rules(node, vmid, resource_type)
    if any(row.get("comment") == comment for row in existing):
        return
    firewall_service.create_rule(
        node,
        vmid,
        resource_type,
        {**rule, "enable": 1, "comment": comment},
    )


def allow_one_way(
    session: Session,
    *,
    scope_id: uuid.UUID,
    comment_prefix: str,
    source_vmid: int,
    target_vmid: int,
    protocol: str = "any",
    port: int | None = None,
) -> None:
    source_ip = _ip_by_vmid(session, source_vmid)
    target_ip = _ip_by_vmid(session, target_vmid)
    if not source_ip or not target_ip:
        raise RuntimeError("課程機器缺少已預留 IP，無法套用隔離網路")
    source = proxmox_service.find_resource(source_vmid)
    target = proxmox_service.find_resource(target_vmid)
    service = protocol if port is None else f"{protocol}/{port}"
    comment = (
        f"{comment_prefix}{str(scope_id)[:8]}:{source_vmid}>{target_vmid}:{service}"
    )
    protocol_fields: dict[str, Any] = {}
    if protocol != "any":
        protocol_fields["proto"] = protocol
    if port is not None:
        protocol_fields["dport"] = str(port)
    _ensure_rule(
        node=source["node"],
        vmid=source_vmid,
        resource_type=cast(ResourceType, source["type"]),
        comment=comment,
        rule={
            "type": "out",
            "action": "ACCEPT",
            "pos": 0,
            "dest": target_ip,
            **protocol_fields,
        },
    )
    _ensure_rule(
        node=target["node"],
        vmid=target_vmid,
        resource_type=cast(ResourceType, target["type"]),
        comment=comment,
        rule={
            "type": "in",
            "action": "ACCEPT",
            "source": source_ip,
            **protocol_fields,
        },
    )


def _allow_one_way(
    session: Session,
    *,
    class_id: uuid.UUID,
    source_vmid: int,
    target_vmid: int,
    protocol: str = "any",
    port: int | None = None,
) -> None:
    """Backward-compatible wrapper for class topology and existing tests."""
    allow_one_way(
        session,
        scope_id=class_id,
        comment_prefix=COMMENT_PREFIX,
        source_vmid=source_vmid,
        target_vmid=target_vmid,
        protocol=protocol,
        port=port,
    )


def apply_class_topology(session: Session, *, class_id: uuid.UUID) -> list[str]:
    """Allow peers sharing a logical segment inside each student environment.

    Default VM firewall rules continue to block the managed local subnet, so
    machines owned by different students remain isolated.
    """
    nodes = {
        row.id: row
        for row in session.exec(
            select(TeachingClassMachineNode).where(
                TeachingClassMachineNode.class_id == class_id
            )
        ).all()
    }
    teaching_class = session.get(TeachingClass, class_id)
    edges = (
        list(
            session.exec(
                select(CourseEnvironmentEdge).where(
                    CourseEnvironmentEdge.version_id == teaching_class.course_version_id
                )
            ).all()
        )
        if teaching_class and teaching_class.course_version_id
        else []
    )
    enrollments = session.exec(
        select(TeachingClassStudent).where(TeachingClassStudent.class_id == class_id)
    ).all()
    errors: list[str] = []
    for enrollment in enrollments:
        machines = [
            row
            for row in session.exec(
                select(TeachingClassStudentMachine).where(
                    TeachingClassStudentMachine.class_student_id == enrollment.id
                )
            ).all()
            if row.vmid is not None and row.status == "completed"
        ]
        machines_by_key = {
            nodes[row.machine_node_id].node_key: row
            for row in machines
            if row.machine_node_id in nodes
        }
        if edges:
            for edge in edges:
                source = machines_by_key.get(edge.source_node_key)
                target = machines_by_key.get(edge.target_node_key)
                if source is None or target is None:
                    continue
                directions = [(source, target)]
                if edge.direction == "bidirectional":
                    directions.append((target, source))
                for direction_source, direction_target in directions:
                    try:
                        if (
                            direction_source.vmid is None
                            or direction_target.vmid is None
                        ):
                            continue
                        _allow_one_way(
                            session,
                            class_id=class_id,
                            source_vmid=direction_source.vmid,
                            target_vmid=direction_target.vmid,
                            protocol=edge.protocol,
                            port=edge.port,
                        )
                    except Exception:
                        logger.exception(
                            "Failed to apply class firewall rule class_id=%s source_vmid=%s target_vmid=%s",
                            class_id,
                            direction_source.vmid,
                            direction_target.vmid,
                        )
                        errors.append(
                            f"{direction_source.vmid} → "
                            f"{direction_target.vmid}: firewall configuration failed"
                        )
            continue
        for source in machines:
            source_node = nodes.get(source.machine_node_id)
            if source_node is None:
                continue
            for target in machines:
                if source.id == target.id:
                    continue
                target_node = nodes.get(target.machine_node_id)
                if target_node is None or not (
                    _segments(source_node.network) & _segments(target_node.network)
                ):
                    continue
                try:
                    source_vmid = source.vmid
                    target_vmid = target.vmid
                    if source_vmid is None or target_vmid is None:
                        continue
                    _allow_one_way(
                        session,
                        class_id=class_id,
                        source_vmid=source_vmid,
                        target_vmid=target_vmid,
                    )
                except Exception:
                    logger.exception(
                        "Failed to remove class firewall rule class_id=%s source_vmid=%s target_vmid=%s",
                        class_id,
                        source.vmid,
                        target.vmid,
                    )
                    errors.append(
                        f"{source.vmid} → {target.vmid}: firewall cleanup failed"
                    )
    return errors
