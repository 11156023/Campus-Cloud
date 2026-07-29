"""Whole-class capacity calculation and hard IP reservation."""

import json
import uuid
from collections import defaultdict

from sqlmodel import Session, select

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
) -> dict[str, object]:
    totals = calculate(nodes=nodes, students=students)
    ip_stats = ip_management_service.get_ip_stats(session)
    return {
        **totals,
        "available_ips": ip_stats["available"],
        "ready": bool(nodes)
        and bool(students)
        and ip_stats["available"] >= totals["ip_count"],
        "issues": (
            []
            if ip_stats["available"] >= totals["ip_count"]
            else [
                f"IP 不足：需要 {totals['ip_count']} 個，"
                f"目前只剩 {ip_stats['available']} 個"
            ]
        ),
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
            raise BadRequestError("班級已使用其他課程版本完成容量預留")
        return existing

    totals = calculate(nodes=nodes, students=students)
    if not nodes or not students:
        raise BadRequestError("學生名單與課程環境必須完成")
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


def _check_cluster_capacity(
    session: Session,
    *,
    nodes: list[TeachingClassMachineNode],
    student_count: int,
) -> dict[str, dict[str, int]]:
    """Validate the complete class against the PVE nodes that own its templates."""
    demand: dict[str, dict[str, int]] = defaultdict(
        lambda: {"cpu_cores": 0, "memory_bytes": 0, "disk_bytes": 0, "machines": 0}
    )
    for node in nodes:
        if node.source_type == "template":
            template = session.get(VMTemplate, node.source_template_id)
            if template is None:
                raise BadRequestError(f"課程機器「{node.name}」的來源範本不存在")
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
            except Exception as exc:
                raise BadRequestError(
                    f"無法確認自訂機器「{node.name}」的建機節點：{exc}"
                )
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
    except Exception as exc:
        raise BadRequestError(f"無法取得 Proxmox 容量，暫時不能鎖定班級：{exc}")

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
            issues.append(f"PVE 節點 {node_name} 不存在或不在線")
            continue
        if capacity.allocatable_cpu_cores < values["cpu_cores"]:
            issues.append(
                f"{node_name} CPU 不足：需要 {values['cpu_cores']}，"
                f"可用 {capacity.allocatable_cpu_cores:.1f}"
            )
        if capacity.allocatable_memory_bytes < values["memory_bytes"]:
            issues.append(
                f"{node_name} RAM 不足：需要 "
                f"{values['memory_bytes'] // GIB} GB，可用 "
                f"{capacity.allocatable_memory_bytes // GIB} GB"
            )
        if capacity.allocatable_disk_bytes < values["disk_bytes"]:
            issues.append(
                f"{node_name} Disk 不足：需要 "
                f"{values['disk_bytes'] // GIB} GB，可用 "
                f"{capacity.allocatable_disk_bytes // GIB} GB"
            )
    if issues:
        raise BadRequestError("；".join(issues))
    return dict(demand)
