"""Whole-class capacity calculation and hard IP reservation."""

import json
import logging
import uuid
from collections import defaultdict

from sqlmodel import Session, select

from app.core.i18n import t
from app.domain.placement import advisor as placement_advisor
from app.exceptions import BadRequestError
from app.models import (
    ClassCapacityReservation,
    TeachingClassMachineNode,
    TeachingClassStudent,
    VMTemplate,
)
from app.services.network import ip_management_service
from app.services.proxmox import provisioning_service
from app.services.vm import placement_service

GIB = 1024**3
logger = logging.getLogger(__name__)


def calculate(
    *,
    nodes: list[TeachingClassMachineNode],
    students: list[TeachingClassStudent],
) -> dict[str, int]:
    student_count = len(students)
    per_student_networks = {
        name.strip()
        for node in nodes
        for name in (node.network or "lab-net").replace("/", ",").split(",")
        if name.strip()
    }
    return {
        "student_count": student_count,
        "machines_per_student": len(nodes),
        "machine_count": student_count * len(nodes),
        "cpu_cores": student_count * sum(node.cpu for node in nodes),
        "memory_mb": student_count * sum(node.memory_mb for node in nodes),
        "disk_gb": student_count * sum(node.disk_gb for node in nodes),
        "ip_count": student_count * len(nodes),
        "network_count": student_count * max(1, len(per_student_networks)),
    }


def preview(
    session: Session,
    *,
    nodes: list[TeachingClassMachineNode],
    students: list[TeachingClassStudent],
    check_cluster: bool = False,
) -> dict[str, object]:
    totals = calculate(nodes=nodes, students=students)
    ip_stats = ip_management_service.get_ip_stats(session)
    issues = (
        []
        if ip_stats["available"] >= totals["ip_count"]
        else [
            f"IP 不足：需要 {totals['ip_count']} 個，"
            f"目前只剩 {ip_stats['available']} 個"
        ]
    )
    placement_plan: dict[str, dict[str, int]] = {}
    if check_cluster and nodes and students:
        placement_plan, cluster_issues = _evaluate_cluster_capacity(
            session,
            nodes=nodes,
            student_count=len(students),
        )
        issues.extend(cluster_issues)
    return {
        **totals,
        "available_ips": ip_stats["available"],
        "ready": bool(nodes) and bool(students) and not issues,
        "issues": issues,
        "cluster_checked": check_cluster,
        "placement_plan": placement_plan,
    }


def reserve(
    session: Session,
    *,
    class_id: uuid.UUID,
    course_version_id: uuid.UUID,
    nodes: list[TeachingClassMachineNode],
    students: list[TeachingClassStudent],
) -> ClassCapacityReservation:
    existing = session.exec(
        select(ClassCapacityReservation).where(
            ClassCapacityReservation.class_id == class_id
        )
    ).first()
    if existing:
        if existing.course_version_id != course_version_id:
            raise BadRequestError(t("class_capacity.version_mismatch"))
        if existing.status != "released":
            return existing
        session.delete(existing)
        session.flush()

    totals = calculate(nodes=nodes, students=students)
    if not nodes or not students:
        raise BadRequestError(t("class_capacity.missing_students_or_nodes"))
    placement_plan = _check_cluster_capacity(
        session,
        nodes=nodes,
        student_count=len(students),
    )
    reservation_keys = [
        f"{class_id}:{node.node_key}:{student.user_id}"
        for node in nodes
        for student in students
    ]
    ip_management_service.reserve_ips(
        session,
        teaching_class_id=class_id,
        reservation_keys=reservation_keys,
    )
    reservation = ClassCapacityReservation(
        class_id=class_id,
        course_version_id=course_version_id,
        student_count=totals["student_count"],
        machine_count=totals["machine_count"],
        cpu_cores=totals["cpu_cores"],
        memory_mb=totals["memory_mb"],
        disk_gb=totals["disk_gb"],
        ip_count=totals["ip_count"],
        network_count=totals["network_count"],
        placement_plan=json.dumps(placement_plan, sort_keys=True),
    )
    session.add(reservation)
    session.flush()
    return reservation


def release(
    session: Session,
    *,
    class_id: uuid.UUID,
    delete_snapshot: bool = True,
) -> int:
    """Release unused class IPs and its capacity snapshot."""
    released_ips = ip_management_service.release_class_reservations(
        session, class_id
    )
    reservation = session.exec(
        select(ClassCapacityReservation).where(
            ClassCapacityReservation.class_id == class_id
        )
    ).first()
    if reservation:
        if delete_snapshot:
            session.delete(reservation)
        else:
            reservation.status = "released"
            session.add(reservation)
    session.flush()
    return released_ips


def _evaluate_cluster_capacity(
    session: Session,
    *,
    nodes: list[TeachingClassMachineNode],
    student_count: int,
) -> tuple[dict[str, dict[str, int]], list[str]]:
    """Return a placement plan and safe, user-facing capacity issues."""
    demand: dict[str, dict[str, int]] = defaultdict(
        lambda: {"cpu_cores": 0, "memory_bytes": 0, "disk_bytes": 0, "machines": 0}
    )
    for node in nodes:
        if node.source_type == "template":
            template = session.get(VMTemplate, node.source_template_id)
            if template is None:
                return {}, [t("class_capacity.template_not_found", name=node.name)]
            target_node = template.node
        else:
            try:
                target_node = (
                    provisioning_service._get_lxc_target_node()
                    if node.resource_type == "lxc"
                    else provisioning_service._get_vm_target_node(
                        int(node.custom_image_ref or "0")
                    )
                )
            except Exception:
                logger.exception(
                    "Failed to resolve placement for custom class machine node_id=%s",
                    node.id,
                )
                return {}, [
                    t("class_capacity.node_resolution_failed", name=node.name)
                ]
        target = demand[target_node]
        target["cpu_cores"] += node.cpu * student_count
        target["memory_bytes"] += node.memory_mb * 1024**2 * student_count
        target["disk_bytes"] += node.disk_gb * GIB * student_count
        target["machines"] += student_count

    try:
        cluster_nodes, resources = placement_advisor._load_cluster_state()
        cpu_ratio, disk_ratio = placement_service.get_overcommit_ratios(session)
        capacities = {
            row.node: row
            for row in placement_advisor._build_node_capacities(
                nodes=cluster_nodes,
                resources=resources,
                cpu_overcommit_ratio=cpu_ratio,
                disk_overcommit_ratio=disk_ratio,
            )
        }
    except Exception:
        logger.exception("Failed to fetch Proxmox capacity for class reservation")
        return {}, [t("class_capacity.capacity_check_failed")]

    # Pending reviewed classes are not necessarily visible as PVE guests yet.
    for reservation in session.exec(
        select(ClassCapacityReservation).where(
            ClassCapacityReservation.status == "reserved"
        )
    ).all():
        try:
            pending = json.loads(reservation.placement_plan or "{}")
        except (TypeError, ValueError):
            continue
        for node_name, values in pending.items():
            capacity = capacities.get(node_name)
            if capacity is None:
                continue
            capacity.allocatable_cpu_cores = max(
                0,
                capacity.allocatable_cpu_cores - float(values.get("cpu_cores") or 0),
            )
            capacity.allocatable_memory_bytes = max(
                0,
                capacity.allocatable_memory_bytes
                - int(values.get("memory_bytes") or 0),
            )
            capacity.allocatable_disk_bytes = max(
                0,
                capacity.allocatable_disk_bytes - int(values.get("disk_bytes") or 0),
            )

    issues: list[str] = []
    for node_name, values in demand.items():
        capacity = capacities.get(node_name)
        if capacity is None or capacity.status != "online":
            issues.append(t("class_capacity.node_offline", node=node_name))
            continue
        if capacity.allocatable_cpu_cores < values["cpu_cores"]:
            issues.append(
                t(
                    "class_capacity.cpu_insufficient",
                    node=node_name,
                    required=values["cpu_cores"],
                    available=f"{capacity.allocatable_cpu_cores:.1f}",
                )
            )
        if capacity.allocatable_memory_bytes < values["memory_bytes"]:
            issues.append(
                t(
                    "class_capacity.ram_insufficient",
                    node=node_name,
                    required=values["memory_bytes"] // GIB,
                    available=capacity.allocatable_memory_bytes // GIB,
                )
            )
        if capacity.allocatable_disk_bytes < values["disk_bytes"]:
            issues.append(
                t(
                    "class_capacity.disk_insufficient",
                    node=node_name,
                    required=values["disk_bytes"] // GIB,
                    available=capacity.allocatable_disk_bytes // GIB,
                )
            )
    return dict(demand), issues


def _check_cluster_capacity(
    session: Session,
    *,
    nodes: list[TeachingClassMachineNode],
    student_count: int,
) -> dict[str, dict[str, int]]:
    """Validate capacity for reservation while preview uses structured issues."""
    placement_plan, issues = _evaluate_cluster_capacity(
        session,
        nodes=nodes,
        student_count=student_count,
    )
    if issues:
        raise BadRequestError("；".join(issues))
    return placement_plan
