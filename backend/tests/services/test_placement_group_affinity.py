"""群組 affinity 與 GPU 額度：多節點下的排程約束。

對應目標：

- G1 同一組機器絕不跨叢集（connection）
- G2 同一組機器落在同一節點；同節點放不下時整組失敗，不半組落地
- G3 GPU 額度在核准階段就擋下，不留到建機才失敗
- G4 審核預覽標示的選定節點與核准結果同源

這裡刻意不使用 conftest 的 `db` fixture（它要求連上真正的測試資料庫），
改以記憶體 SQLite 建表，讓群組查詢走真正的 SQL。
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlmodel import Session, SQLModel, create_engine

from app.domain.placement.models import PlacementTuning
from app.domain.placement.schemas import NodeCapacity, PlacementRequest
from app.models import VMRequest
from app.services.vm import placement_support

GIB = 1024**3


# ---------------------------------------------------------------------------
# 測試骨架
# ---------------------------------------------------------------------------

@pytest.fixture(name="session")
def _session():
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


def _tuning() -> PlacementTuning:
    return PlacementTuning(
        reassignment_cost=0.15,
        peak_cpu_margin=1.1,
        peak_memory_margin=1.05,
        loadavg_warn_per_core=0.8,
        loadavg_max_per_core=1.5,
        loadavg_penalty_weight=0.9,
        disk_contention_warn_share=0.7,
        disk_contention_high_share=0.9,
        disk_penalty_weight=0.75,
    )


def _node(name: str, *, cores: float = 32.0, memory_gb: int = 64, **overrides):
    defaults = dict(
        node=name,
        status="online",
        running_resources=0,
        guest_soft_limit=100,
        total_cpu_cores=cores,
        allocatable_cpu_cores=cores,
        total_memory_bytes=memory_gb * GIB,
        allocatable_memory_bytes=memory_gb * GIB,
        total_disk_bytes=2000 * GIB,
        allocatable_disk_bytes=2000 * GIB,
    )
    defaults.update(overrides)
    return NodeCapacity(**defaults)


def _persist_request(
    session: Session,
    *,
    group_id: uuid.UUID | None,
    assigned_node: str | None = None,
    actual_node: str | None = None,
    created_at: datetime | None = None,
    gpu_mapping_id: str | None = None,
) -> VMRequest:
    request = VMRequest(
        user_id=uuid.uuid4(),
        reason="group affinity test",
        resource_type="lxc",
        hostname=f"host-{uuid.uuid4().hex[:6]}",
        cores=2,
        memory=2048,
        password="enc",
        storage="local-lvm",
        environment_type="Test",
        rootfs_size=8,
        placement_group_id=group_id,
        assigned_node=assigned_node,
        actual_node=actual_node,
        gpu_mapping_id=gpu_mapping_id,
        created_at=created_at or datetime.now(UTC),
    )
    session.add(request)
    session.flush()
    return request


def _placement_request(group_id: uuid.UUID | None = None, **overrides):
    payload = dict(
        resource_type="lxc",
        cpu_cores=2,
        memory_mb=2048,
        disk_gb=8,
        instance_count=1,
        placement_group_id=group_id,
    )
    payload.update(overrides)
    return PlacementRequest(**payload)


def _build_plan(session, request, nodes, **overrides):
    """以注入的假依賴呼叫 build_plan，不碰資料庫設定與 Proxmox。"""
    kwargs = dict(
        session=session,
        request=request,
        node_capacities=nodes,
        effective_resource_type="lxc",
        resource_type_reason="test",
        build_storage_pool_state_fn=lambda *, session, node_names: (
            {name: [] for name in node_names},
            False,
        ),
        get_placement_tuning_fn=lambda *, session: _tuning(),
        get_overcommit_ratios_fn=lambda session: (1.0, 1.0),
        get_node_priorities_fn=lambda session: {},
        placement_sort_key_fn=placement_support.placement_sort_key,
    )
    kwargs.update(overrides)
    return placement_support.build_plan(**kwargs)


# ---------------------------------------------------------------------------
# G2 前提：群組錨點解析
# ---------------------------------------------------------------------------

class TestGroupAnchor:
    def test_no_group_id_is_unconstrained(self, session):
        assert (
            placement_support.allowed_affinity_nodes_for_request(
                session=session, request=_placement_request(None)
            )
            is None
        )

    def test_first_machine_of_group_is_unconstrained(self, session):
        group = uuid.uuid4()
        assert (
            placement_support.allowed_affinity_nodes_for_request(
                session=session, request=_placement_request(group)
            )
            is None
        )

    def test_second_machine_is_pinned_to_anchor(self, session):
        group = uuid.uuid4()
        _persist_request(session, group_id=group, assigned_node="pve2")
        assert placement_support.allowed_affinity_nodes_for_request(
            session=session, request=_placement_request(group)
        ) == {"pve2"}

    def test_other_groups_do_not_leak(self, session):
        _persist_request(session, group_id=uuid.uuid4(), assigned_node="pve2")
        assert (
            placement_support.allowed_affinity_nodes_for_request(
                session=session, request=_placement_request(uuid.uuid4())
            )
            is None
        )

    def test_anchor_is_the_earliest_created_peer(self, session):
        group = uuid.uuid4()
        base = datetime.now(UTC)
        _persist_request(
            session,
            group_id=group,
            assigned_node="pve3",
            created_at=base + timedelta(seconds=30),
        )
        _persist_request(
            session, group_id=group, assigned_node="pve1", created_at=base
        )
        # 錨點必須穩定，否則後建的機器會依查詢順序跟到不同節點
        assert placement_support.allowed_affinity_nodes_for_request(
            session=session, request=_placement_request(group)
        ) == {"pve1"}

    def test_actual_node_wins_over_assigned(self, session):
        """建機時退回別的節點後，同組後續機器要跟著實際落點走。"""
        group = uuid.uuid4()
        _persist_request(
            session, group_id=group, assigned_node="pve1", actual_node="pve2"
        )
        assert placement_support.allowed_affinity_nodes_for_request(
            session=session, request=_placement_request(group)
        ) == {"pve2"}

    def test_peer_without_any_node_is_not_an_anchor(self, session):
        group = uuid.uuid4()
        _persist_request(session, group_id=group)
        assert (
            placement_support.allowed_affinity_nodes_for_request(
                session=session, request=_placement_request(group)
            )
            is None
        )

    def test_self_can_be_excluded(self, session):
        group = uuid.uuid4()
        mine = _persist_request(session, group_id=group, assigned_node="pve1")
        assert (
            placement_support.allowed_affinity_nodes_for_request(
                session=session,
                request=_placement_request(group),
                exclude_request_id=mine.id,
            )
            is None
        )


# ---------------------------------------------------------------------------
# G2：整組同節點；放不下就整組失敗
# ---------------------------------------------------------------------------

class TestGroupLandsTogether:
    def test_group_follows_anchor_even_when_another_node_is_emptier(self, session):
        group = uuid.uuid4()
        _persist_request(session, group_id=group, assigned_node="pve1")
        # pve2 資源多很多，沒有 affinity 的話一定會選它
        plan = _build_plan(
            session,
            _placement_request(group),
            [_node("pve1", cores=8, memory_gb=16), _node("pve2", cores=64, memory_gb=256)],
        )
        assert plan.feasible
        assert plan.recommended_node == "pve1"

    def test_without_group_the_emptier_node_wins(self, session):
        """對照組：沒有群組鍵時本來就會選資源多的那台。"""
        plan = _build_plan(
            session,
            _placement_request(None),
            [_node("pve1", cores=8, memory_gb=16), _node("pve2", cores=64, memory_gb=256)],
        )
        assert plan.recommended_node == "pve2"

    def test_group_fails_when_anchor_cannot_fit(self, session):
        """錨點放不下時整組失敗，不會溢出到別的節點半組落地。"""
        group = uuid.uuid4()
        _persist_request(session, group_id=group, assigned_node="pve1")
        plan = _build_plan(
            session,
            _placement_request(group, cpu_cores=32, memory_mb=64 * 1024),
            [_node("pve1", cores=4, memory_gb=8), _node("pve2", cores=64, memory_gb=256)],
        )
        assert not plan.feasible
        assert plan.recommended_node is None

    def test_multi_instance_group_stays_on_anchor(self, session):
        group = uuid.uuid4()
        _persist_request(session, group_id=group, assigned_node="pve1")
        plan = _build_plan(
            session,
            _placement_request(group, instance_count=3),
            [_node("pve1"), _node("pve2")],
        )
        assert plan.feasible
        assert {item.node for item in plan.placements} == {"pve1"}


# ---------------------------------------------------------------------------
# G1：絕不跨叢集
# ---------------------------------------------------------------------------

class TestGroupNeverCrossesConnection:
    def test_anchor_excludes_nodes_of_other_connections(self, session):
        """錨點釘住單一節點，跨叢集的節點自然全部出局。

        同節點是比同叢集更強的約束，因此 G1 由 G2 的機制一併保證。
        """
        group = uuid.uuid4()
        _persist_request(session, group_id=group, assigned_node="clusterA-n1")
        allowed = placement_support.allowed_affinity_nodes_for_request(
            session=session, request=_placement_request(group)
        )
        assert allowed == {"clusterA-n1"}
        for foreign in ("clusterB-n1", "clusterB-n2"):
            assert not placement_support.node_can_host_request(
                _node(foreign),
                cores=2,
                memory_bytes=2 * GIB,
                disk_bytes=8 * GIB,
                gpu_required=0,
                has_managed_storage=False,
                allowed_affinity_nodes=allowed,
            )

    def test_plan_never_picks_a_node_outside_the_group(self, session):
        group = uuid.uuid4()
        _persist_request(session, group_id=group, assigned_node="clusterA-n1")
        plan = _build_plan(
            session,
            _placement_request(group),
            [_node("clusterA-n1"), _node("clusterB-n1"), _node("clusterB-n2")],
        )
        assert plan.feasible
        assert plan.recommended_node == "clusterA-n1"
        assert {item.node for item in plan.placements} == {"clusterA-n1"}


# ---------------------------------------------------------------------------
# G3：GPU 額度在核准階段就擋下
# ---------------------------------------------------------------------------

class TestGpuSlotAccounting:
    def test_capacity_defaults_to_full_gpu_count(self):
        assert _node("pve1", gpu_count=2).allocatable_gpu_slots == 2

    def test_explicit_slots_are_respected(self):
        assert _node("pve1", gpu_count=2, allocatable_gpu_slots=0).allocatable_gpu_slots == 0

    def test_node_rejected_when_slots_exhausted(self):
        node = _node("pve1", gpu_count=1, allocatable_gpu_slots=0)
        assert not placement_support.node_can_host_request(
            node,
            cores=2,
            memory_bytes=2 * GIB,
            disk_bytes=8 * GIB,
            gpu_required=1,
            has_managed_storage=False,
            # 白名單說「這個節點有這張卡」，但額度已用完
            allowed_gpu_nodes={"pve1"},
        )

    def test_node_accepted_while_slots_remain(self):
        node = _node("pve1", gpu_count=1)
        assert placement_support.node_can_host_request(
            node,
            cores=2,
            memory_bytes=2 * GIB,
            disk_bytes=8 * GIB,
            gpu_required=1,
            has_managed_storage=False,
            allowed_gpu_nodes={"pve1"},
        )

    def test_reserve_and_release_move_the_counter(self, session):
        nodes = [_node("pve1", gpu_count=2)]
        request = _persist_request(
            session, group_id=None, assigned_node="pve1", gpu_mapping_id="gpu-a"
        )
        placement_support.reserve_request_on_capacities(
            node_capacities=nodes,
            db_request=request,
            node_name="pve1",
            request_capacity_tuple_fn=placement_support.request_capacity_tuple,
            refresh_node_candidate_fn=placement_support.refresh_node_candidate,
        )
        assert nodes[0].allocatable_gpu_slots == 1

        placement_support.release_request_from_capacities(
            node_capacities=nodes,
            db_request=request,
            node_name="pve1",
            request_capacity_tuple_fn=placement_support.request_capacity_tuple,
            refresh_node_candidate_fn=placement_support.refresh_node_candidate,
        )
        assert nodes[0].allocatable_gpu_slots == 2

    def test_request_without_gpu_does_not_consume_slots(self, session):
        nodes = [_node("pve1", gpu_count=1)]
        request = _persist_request(session, group_id=None, assigned_node="pve1")
        placement_support.reserve_request_on_capacities(
            node_capacities=nodes,
            db_request=request,
            node_name="pve1",
            request_capacity_tuple_fn=placement_support.request_capacity_tuple,
            refresh_node_candidate_fn=placement_support.refresh_node_candidate,
        )
        assert nodes[0].allocatable_gpu_slots == 1

    def test_overlapping_reservation_consumes_the_slot(self, session):
        """核准階段的關鍵路徑：同時段已預約的 GPU 會讓節點退出候選。"""
        now = datetime.now(UTC)
        reserved = _persist_request(
            session, group_id=None, assigned_node="pve1", gpu_mapping_id="gpu-a"
        )
        reserved.start_at = now - timedelta(hours=1)
        reserved.end_at = now + timedelta(hours=1)

        adjusted = placement_support.apply_reserved_requests_to_capacities(
            baseline_capacities=[_node("pve1", gpu_count=1)],
            reserved_requests=[reserved],
            at_time=now,
            normalize_datetime_fn=placement_support.normalize_datetime,
            request_capacity_tuple_fn=placement_support.request_capacity_tuple,
        )
        assert adjusted[0].allocatable_gpu_slots == 0
        assert not placement_support.node_can_host_request(
            adjusted[0],
            cores=2,
            memory_bytes=2 * GIB,
            disk_bytes=8 * GIB,
            gpu_required=1,
            has_managed_storage=False,
            allowed_gpu_nodes={"pve1"},
        )

    def test_reservation_outside_the_window_leaves_the_slot(self, session):
        now = datetime.now(UTC)
        reserved = _persist_request(
            session, group_id=None, assigned_node="pve1", gpu_mapping_id="gpu-a"
        )
        reserved.start_at = now + timedelta(hours=5)
        reserved.end_at = now + timedelta(hours=6)

        adjusted = placement_support.apply_reserved_requests_to_capacities(
            baseline_capacities=[_node("pve1", gpu_count=1)],
            reserved_requests=[reserved],
            at_time=now,
            normalize_datetime_fn=placement_support.normalize_datetime,
            request_capacity_tuple_fn=placement_support.request_capacity_tuple,
        )
        assert adjusted[0].allocatable_gpu_slots == 1

    def test_second_gpu_request_is_refused_by_the_plan(self, session):
        """N=1 的節點被占用後，第 N+1 張申請在 build_plan 就不可行。"""
        plan = _build_plan(
            session,
            _placement_request(None, gpu_required=1, gpu_mapping_id="gpu-a"),
            [_node("pve1", gpu_count=1, allocatable_gpu_slots=0)],
        )
        assert not plan.feasible
        assert plan.recommended_node is None
