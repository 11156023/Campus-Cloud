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
        placement_plan, _allocation, cluster_issues = _evaluate_cluster_capacity(
            session,
            nodes=nodes,
            student_ids=[student.user_id for student in students],
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
    placement_plan, student_allocation = _check_cluster_capacity(
        session,
        nodes=nodes,
        student_ids=[student.user_id for student in students],
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
        student_clusters=json.dumps(
            {str(k): v for k, v in student_allocation.items()}, sort_keys=True
        ),
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


def class_eligibility(
    session: Session,
    *,
    nodes: list[TeachingClassMachineNode],
) -> tuple[dict[uuid.UUID, set[str]], set[int | None], list[str]]:
    """整堂課的可建節點與可用叢集。

    回傳 (每台機器的可建節點, 全班共用的叢集集合, issues)。共用叢集是各機器
    「可落腳連線」的交集 —— 一位學生的機器必須彼此互通，所以只能落在所有
    機器類型都建得起來的叢集裡。
    """
    if not nodes:
        return {}, set(), []

    eligibility: dict[uuid.UUID, set[str]] = {}
    for machine_node in nodes:
        try:
            eligibility[machine_node.id] = eligible_nodes_for_machine(
                session, machine_node=machine_node
            )
        except LookupError:
            return {}, set(), [
                t("class_capacity.template_not_found", name=machine_node.name)
            ]
        except Exception:
            logger.exception(
                "Failed to resolve placement for class machine node_id=%s",
                machine_node.id,
            )
            return {}, set(), [
                t("class_capacity.node_resolution_failed", name=machine_node.name)
            ]

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
        return {}, set(), [t("class_capacity.cross_cluster", detail=detail)]
    return eligibility, shared, []


def _preferred_node() -> str | None:
    """沿用各連線 default_node 的既有偏好；取不到時回 None。"""
    try:
        return provisioning_service._get_lxc_target_node()
    except Exception:
        return None


def targets_in_cluster(
    *,
    nodes: list[TeachingClassMachineNode],
    eligibility: dict[uuid.UUID, set[str]],
    connection_id: int | None,
    preferred: str | None = None,
) -> dict[uuid.UUID, str]:
    """指定叢集內每台課程機器的建機節點；有機器落不了時回空 dict。"""
    targets: dict[uuid.UUID, str] = {}
    for machine_node in nodes:
        in_cluster = sorted(
            name
            for name in eligibility.get(machine_node.id, set())
            if get_connection_id_for_node(name) == connection_id
        )
        if not in_cluster:
            return {}
        targets[machine_node.id] = (
            preferred if preferred in in_cluster else in_cluster[0]
        )
    return targets


def _student_footprint(
    nodes: list[TeachingClassMachineNode],
) -> tuple[float, int, int]:
    """一位學生整套環境的資源用量。"""
    return (
        float(sum(node.cpu for node in nodes)),
        sum(node.memory_mb * 1024**2 for node in nodes),
        sum(node.disk_gb * GIB for node in nodes),
    )


def _ratio(used: float, total: float) -> float:
    if total <= 0:
        return float("inf")
    return used / total


def allocate_students(
    *,
    nodes: list[TeachingClassMachineNode],
    student_ids: list[uuid.UUID],
    clusters: set[int | None],
    eligibility: dict[uuid.UUID, set[str]],
    capacities: dict[str, object],
) -> tuple[dict[uuid.UUID, int | None], list[str]]:
    """把學生分配到各叢集：一位學生的機器全在同一叢集，學生之間可以分開。

    策略是「能整班放同一個叢集就不拆」：叢集依可用容量由大到小排序，逐位學生
    放進第一個還塞得下的叢集。因此

    - 有任何叢集放得下全班 → 全班都在那裡（教室功能、監控、故障範圍都集中）
    - 放不下 → 先塞滿容量最大的，剩下的溢出到下一個。例如 A 只夠 25 位時，
      35 位學生的結果就是 25 位在 A、10 位在 B。

    全部叢集都塞不下時，剩餘學生歸到占用比例最低的那個，交由後續的節點容量
    檢查明確回報不足，而不是在這裡就無聲失敗。

    回傳 ({student_id: connection_id}, issues)。
    """
    if not nodes or not student_ids:
        return {}, []

    usable = [
        cid
        for cid in clusters
        if targets_in_cluster(
            nodes=nodes, eligibility=eligibility, connection_id=cid
        )
    ]
    if not usable:
        return {}, [t("class_capacity.no_node_in_cluster", name=nodes[0].name)]

    cpu_need, mem_need, disk_need = _student_footprint(nodes)
    # 每個叢集的可用總量：只計入這堂課真的用得到的節點
    headroom: dict[int | None, dict[str, float]] = {}
    for cid in usable:
        rows = [
            capacities[name]
            for name in {
                name
                for names in eligibility.values()
                for name in names
                if get_connection_id_for_node(name) == cid
            }
            if capacities.get(name) is not None
            and getattr(capacities[name], "status", "") == "online"
        ]
        headroom[cid] = {
            "cpu": sum(float(getattr(r, "allocatable_cpu_cores", 0.0)) for r in rows),
            "mem": sum(float(getattr(r, "allocatable_memory_bytes", 0)) for r in rows),
            "disk": sum(float(getattr(r, "allocatable_disk_bytes", 0)) for r in rows),
        }

    # 容量大的排前面：整班放得下時就會全部落在同一個叢集
    def _fits_students(cid: int | None) -> float:
        room = headroom[cid]
        return min(
            room["cpu"] / cpu_need if cpu_need > 0 else float("inf"),
            room["mem"] / mem_need if mem_need > 0 else float("inf"),
            room["disk"] / disk_need if disk_need > 0 else float("inf"),
        )

    ordered = sorted(
        usable, key=lambda cid: (-_fits_students(cid), cid is None, cid)
    )
    taken: dict[int | None, dict[str, float]] = {
        cid: {"cpu": 0.0, "mem": 0.0, "disk": 0.0} for cid in usable
    }

    def _projected(cid: int | None) -> float:
        room = headroom[cid]
        return max(
            _ratio(taken[cid]["cpu"] + cpu_need, room["cpu"]),
            _ratio(taken[cid]["mem"] + mem_need, room["mem"]),
            _ratio(taken[cid]["disk"] + disk_need, room["disk"]),
        )

    allocation: dict[uuid.UUID, int | None] = {}
    for student_id in student_ids:
        chosen = next(
            (cid for cid in ordered if _projected(cid) <= 1.0),
            min(ordered, key=_projected),
        )
        allocation[student_id] = chosen
        taken[chosen]["cpu"] += cpu_need
        taken[chosen]["mem"] += mem_need
        taken[chosen]["disk"] += disk_need
    return allocation, []


def resolve_class_targets(
    session: Session,
    *,
    nodes: list[TeachingClassMachineNode],
    connection_id: int | None = None,
) -> tuple[dict[uuid.UUID, str], list[str]]:
    """指定叢集（未指定時取全班唯一可用叢集）內每台課程機器的建機節點。

    同一位學生的機器必須互通：IP 由全域單例網段配發、bridge 名稱全域共用、
    firewall 規則逐台下在各自節點上。跨叢集時 L2 不通、同名 bridge 指向不同
    的實體網路，拓樸形同虛設。
    """
    eligibility, shared, issues = class_eligibility(session, nodes=nodes)
    if issues or not nodes:
        return {}, issues

    if connection_id is None:
        connection_id = sorted(shared, key=lambda item: (item is None, item))[0]
    elif connection_id not in shared:
        return {}, [t("class_capacity.no_node_in_cluster", name=nodes[0].name)]

    targets = targets_in_cluster(
        nodes=nodes,
        eligibility=eligibility,
        connection_id=connection_id,
        preferred=_preferred_node(),
    )
    if not targets:
        return {}, [t("class_capacity.no_node_in_cluster", name=nodes[0].name)]
    return targets, []


def _reserved_cluster_for_student(
    session: Session,
    *,
    class_id: uuid.UUID,
    user_id: uuid.UUID | None,
) -> int | None:
    """預留時記下的學生→叢集分配；查不到時回 None（沿用單一叢集行為）。"""
    if user_id is None:
        return None
    reservation = session.exec(
        select(ClassCapacityReservation).where(
            ClassCapacityReservation.class_id == class_id
        )
    ).first()
    if reservation is None:
        return None
    try:
        mapping = json.loads(reservation.student_clusters or "{}")
    except (TypeError, ValueError):
        return None
    raw = mapping.get(str(user_id), "__missing__")
    if raw == "__missing__":
        return None
    return None if raw is None else int(raw)


def target_node_for_machine(
    session: Session,
    *,
    machine_node: TeachingClassMachineNode,
    user_id: uuid.UUID | None = None,
) -> str | None:
    """建機時取這台課程機器的節點，與容量預留使用同一份分配。

    ``user_id`` 指定時先查該學生在預留階段被分到哪個叢集，再在該叢集內決定
    節點 —— 確保同一位學生的每一台機器都落在同一個叢集，也確保建機落點與
    預留時算的一致。查不到分配時退回全班唯一可用叢集。
    """
    siblings = list(
        session.exec(
            select(TeachingClassMachineNode).where(
                TeachingClassMachineNode.class_id == machine_node.class_id
            )
        ).all()
    )
    targets, issues = resolve_class_targets(
        session,
        nodes=siblings or [machine_node],
        connection_id=_reserved_cluster_for_student(
            session, class_id=machine_node.class_id, user_id=user_id
        ),
    )
    if issues:
        return None
    return targets.get(machine_node.id)


def _evaluate_cluster_capacity(
    session: Session,
    *,
    nodes: list[TeachingClassMachineNode],
    student_ids: list[uuid.UUID],
) -> tuple[dict[str, dict[str, int]], dict[uuid.UUID, int | None], list[str]]:
    """Return a placement plan, the student-to-cluster allocation and issues.

    分配單位是「一位學生的整套環境」：同一位學生的機器必須落在同一個叢集，
    不同學生則可以分屬不同叢集（例如 25 位在 A、10 位在 B）。
    """
    demand: dict[str, dict[str, int]] = defaultdict(
        lambda: {"cpu_cores": 0, "memory_bytes": 0, "disk_bytes": 0, "machines": 0}
    )
    eligibility, clusters, issues = class_eligibility(session, nodes=nodes)
    if issues:
        return {}, {}, issues

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
        return {}, {}, [t("class_capacity.capacity_check_failed")]

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

    # 先把學生分到各叢集，再依每個叢集實際承接的人數累加節點需求。
    allocation, allocation_issues = allocate_students(
        nodes=nodes,
        student_ids=student_ids,
        clusters=clusters,
        eligibility=eligibility,
        capacities=capacities,
    )
    if allocation_issues:
        return {}, {}, allocation_issues

    preferred = _preferred_node()
    per_cluster_counts: dict[int | None, int] = defaultdict(int)
    for connection_id in allocation.values():
        per_cluster_counts[connection_id] += 1
    for connection_id, count in per_cluster_counts.items():
        targets = targets_in_cluster(
            nodes=nodes,
            eligibility=eligibility,
            connection_id=connection_id,
            preferred=preferred,
        )
        if not targets:
            return {}, {}, [
                t("class_capacity.no_node_in_cluster", name=nodes[0].name)
            ]
        for node in nodes:
            target = demand[targets[node.id]]
            target["cpu_cores"] += node.cpu * count
            target["memory_bytes"] += node.memory_mb * 1024**2 * count
            target["disk_bytes"] += node.disk_gb * GIB * count
            target["machines"] += count

    issues = []
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
    return dict(demand), allocation, issues


def _check_cluster_capacity(
    session: Session,
    *,
    nodes: list[TeachingClassMachineNode],
    student_ids: list[uuid.UUID],
) -> tuple[dict[str, dict[str, int]], dict[uuid.UUID, int | None]]:
    """Validate capacity for reservation while preview uses structured issues."""
    placement_plan, allocation, issues = _evaluate_cluster_capacity(
        session,
        nodes=nodes,
        student_ids=student_ids,
    )
    if issues:
        raise BadRequestError("；".join(issues))
    return placement_plan, allocation
