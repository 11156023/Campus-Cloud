"""Whole-class capacity calculation and hard IP reservation."""

import json
import logging
import uuid
from collections import defaultdict

from sqlmodel import Session, select

from app.core.i18n import t
from app.domain.placement import advisor as placement_advisor
from app.exceptions import BadRequestError
from app.infrastructure.proxmox import (
    get_connection_id_for_node,
    get_nodes_for_connection,
)
from app.models import (
    ClassCapacityReservation,
    TeachingClassMachineNode,
    TeachingClassStudent,
    VMTemplate,
)
from app.services.network import ip_management_service
from app.services.proxmox import provisioning_service, proxmox_service
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


def eligible_nodes_for_machine(
    session: Session,
    *,
    machine_node: TeachingClassMachineNode,
) -> set[str]:
    """這台課程機器實際上能被建立在哪些節點。

    刻意不重用 placement 的 allowed_template_nodes_for_request：那個函式對
    「LXC + 範本克隆」回傳不受限（節點由 provisioning 稍後以範本節點覆寫），
    容量計畫若照它算，就會出現「檢查說可行、建機卻落在別處」的落差。

    - LXC 範本克隆：linked clone 必須與範本同節點同 storage（PVE 限制），
      只有範本節點一個選擇。
    - VM 範本／自訂 VM：clone 不可跨連線，限制在範本所屬連線的節點。
    - 自訂 LXC：只有 iso_storage 看得到該 vztmpl 的節點。
    """
    if machine_node.source_type == "template":
        template = session.get(VMTemplate, machine_node.source_template_id)
        if template is None:
            raise LookupError("template not found")
        if str(template.resource_type) == "lxc":
            return {template.node}
        return _connection_nodes(template.node)

    if machine_node.resource_type == "lxc":
        node_map = proxmox_service.get_lxc_template_node_map()
        # 整張映射為空多半是查詢失敗，沿用舊的單一節點行為而非誤判為全叢集可用
        if not node_map:
            return {provisioning_service._get_lxc_target_node()}
        return set(node_map.get(str(machine_node.custom_image_ref or ""), set()))

    return _connection_nodes(
        provisioning_service._get_vm_target_node(
            int(machine_node.custom_image_ref or "0")
        )
    )


def _connection_nodes(node_name: str) -> set[str]:
    """節點所屬連線的全部節點；查不到時退回該節點本身（clone 不可跨連線）。"""
    return get_nodes_for_connection(get_connection_id_for_node(node_name)) or {
        node_name
    }


def resolve_class_targets(
    session: Session,
    *,
    nodes: list[TeachingClassMachineNode],
) -> tuple[dict[uuid.UUID, str], list[str]]:
    """每台課程機器的建機節點，且全部落在同一個叢集。

    同一堂課的機器必須互通：IP 由全域單例網段配發、bridge 名稱全域共用、
    firewall 規則逐台下在各自節點上。跨叢集時 L2 不通、同名 bridge 指向不同
    實體網路，拓樸形同虛設 —— 因此寧可在預留階段就擋下，也不要建出一堂
    彼此連不到的課。

    回傳 ({machine_node_id: 節點名}, issues)。issues 非空時計畫無效。
    """
    if not nodes:
        return {}, []

    eligibility: dict[uuid.UUID, set[str]] = {}
    for machine_node in nodes:
        try:
            eligibility[machine_node.id] = eligible_nodes_for_machine(
                session, machine_node=machine_node
            )
        except LookupError:
            return {}, [
                t("class_capacity.template_not_found", name=machine_node.name)
            ]
        except Exception:
            logger.exception(
                "Failed to resolve placement for class machine node_id=%s",
                machine_node.id,
            )
            return {}, [
                t("class_capacity.node_resolution_failed", name=machine_node.name)
            ]

    # 每台機器可落腳的連線集合，取交集就是整堂課能共用的叢集
    options: dict[uuid.UUID, set[int | None]] = {
        node_id: {get_connection_id_for_node(name) for name in names}
        for node_id, names in eligibility.items()
    }
    shared: set[int | None] = set.intersection(*options.values())
    if not shared:
        detail = "；".join(
            f"{machine_node.name}: "
            f"{', '.join(sorted(eligibility[machine_node.id])) or '無可用節點'}"
            for machine_node in nodes
        )
        return {}, [t("class_capacity.cross_cluster", detail=detail)]

    connection_id = sorted(shared, key=lambda item: (item is None, item))[0]

    # 沿用各連線 default_node 的既有偏好，僅在它不合格時才改挑其他節點
    try:
        preferred = provisioning_service._get_lxc_target_node()
    except Exception:
        preferred = None

    targets: dict[uuid.UUID, str] = {}
    for machine_node in nodes:
        in_cluster = sorted(
            name
            for name in eligibility[machine_node.id]
            if get_connection_id_for_node(name) == connection_id
        )
        if not in_cluster:
            return {}, [
                t("class_capacity.no_node_in_cluster", name=machine_node.name)
            ]
        targets[machine_node.id] = (
            preferred if preferred in in_cluster else in_cluster[0]
        )
    return targets, []


def target_node_for_machine(
    session: Session,
    *,
    machine_node: TeachingClassMachineNode,
) -> str | None:
    """建機時取這台課程機器的節點，與容量預留使用同一份計算。

    以整堂課的機器一起求解，確保建機當下得到的節點與預留時算的一致，
    也確保它與同班其他機器在同一個叢集。
    """
    siblings = list(
        session.exec(
            select(TeachingClassMachineNode).where(
                TeachingClassMachineNode.class_id == machine_node.class_id
            )
        ).all()
    )
    targets, issues = resolve_class_targets(session, nodes=siblings or [machine_node])
    if issues:
        return None
    return targets.get(machine_node.id)


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
    targets, target_issues = resolve_class_targets(session, nodes=nodes)
    if target_issues:
        return {}, target_issues
    for node in nodes:
        target_node = targets[node.id]
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
