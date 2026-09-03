"""課堂機器必須放在同一個叢集。

同一堂課的機器要能彼此連通：IP 由全域單例網段配發、bridge 名稱全域共用、
firewall 規則逐台下在各自節點上。跨叢集時 L2 不通、同名 bridge 指向不同的
實體網路，拓樸形同虛設。

自訂 LXC 原本走 provisioning_service._get_lxc_target_node()（各連線
default_node → nodes[0]），可以挑到與範本機器不同的叢集 —— 這裡固定住
「整班同叢集」的行為。
"""

import uuid

import pytest
from sqlmodel import Session, SQLModel, create_engine

from app.models import TeachingClassMachineNode, VMTemplate, VMTemplateStatus
from app.services.teaching import class_capacity_service

# 兩個叢集：clusterA = 連線 1，clusterB = 連線 2
_NODE_CONNECTIONS = {
    "a1": 1,
    "a2": 1,
    "b1": 2,
    "b2": 2,
}


@pytest.fixture(name="session")
def _session():
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


@pytest.fixture(autouse=True)
def _stub_topology(monkeypatch):
    monkeypatch.setattr(
        class_capacity_service,
        "get_connection_id_for_node",
        lambda name: _NODE_CONNECTIONS.get(name),
    )
    monkeypatch.setattr(
        class_capacity_service,
        "get_nodes_for_connection",
        lambda cid: {n for n, c in _NODE_CONNECTIONS.items() if c == cid},
    )


def _template(session, *, node: str, resource_type: str) -> VMTemplate:
    template = VMTemplate(
        pve_vmid=int(uuid.uuid4().int % 100000),
        name=f"tpl-{node}-{resource_type}",
        node=node,
        storage="local-lvm",
        resource_type=resource_type,
        status=VMTemplateStatus.ready,
    )
    session.add(template)
    session.flush()
    return template


def _machine(
    session,
    *,
    class_id: uuid.UUID,
    name: str,
    source_type: str = "template",
    source_template_id: uuid.UUID | None = None,
    custom_image_ref: str | None = None,
    resource_type: str = "lxc",
) -> TeachingClassMachineNode:
    machine = TeachingClassMachineNode(
        class_id=class_id,
        node_key=name,
        source_type=source_type,
        source_template_id=source_template_id,
        custom_image_ref=custom_image_ref,
        name=name,
        role="target",
        resource_type=resource_type,
        cpu=2,
        memory_mb=2048,
        disk_gb=10,
    )
    session.add(machine)
    session.flush()
    return machine


# ---------------------------------------------------------------------------
# 單台機器的可建節點
# ---------------------------------------------------------------------------

class TestEligibleNodes:
    def test_lxc_template_is_pinned_to_its_own_node(self, session):
        """LXC linked clone 必須與範本同節點同 storage，沒有第二個選擇。"""
        template = _template(session, node="a1", resource_type="lxc")
        machine = _machine(
            session,
            class_id=uuid.uuid4(),
            name="lab",
            source_template_id=template.id,
        )
        assert class_capacity_service.eligible_nodes_for_machine(
            session, machine_node=machine
        ) == {"a1"}

    def test_vm_template_can_use_the_whole_connection(self, session):
        template = _template(session, node="a1", resource_type="qemu")
        machine = _machine(
            session,
            class_id=uuid.uuid4(),
            name="lab",
            source_template_id=template.id,
            resource_type="vm",
        )
        assert class_capacity_service.eligible_nodes_for_machine(
            session, machine_node=machine
        ) == {"a1", "a2"}

    def test_custom_lxc_is_limited_to_nodes_that_see_the_image(
        self, session, monkeypatch
    ):
        monkeypatch.setattr(
            class_capacity_service.proxmox_service,
            "get_lxc_template_node_map",
            lambda: {"local:vztmpl/deb.tar.zst": {"a2", "b1"}},
        )
        machine = _machine(
            session,
            class_id=uuid.uuid4(),
            name="lab",
            source_type="custom",
            custom_image_ref="local:vztmpl/deb.tar.zst",
        )
        assert class_capacity_service.eligible_nodes_for_machine(
            session, machine_node=machine
        ) == {"a2", "b1"}

    def test_missing_template_is_reported(self, session):
        machine = _machine(
            session,
            class_id=uuid.uuid4(),
            name="lab",
            source_template_id=uuid.uuid4(),
        )
        with pytest.raises(LookupError):
            class_capacity_service.eligible_nodes_for_machine(
                session, machine_node=machine
            )


# ---------------------------------------------------------------------------
# 整堂課的叢集約束
# ---------------------------------------------------------------------------

class TestClassStaysInOneCluster:
    def test_machines_in_one_cluster_resolve_cleanly(self, session):
        class_id = uuid.uuid4()
        t1 = _template(session, node="a1", resource_type="lxc")
        t2 = _template(session, node="a2", resource_type="lxc")
        m1 = _machine(session, class_id=class_id, name="attacker", source_template_id=t1.id)
        m2 = _machine(session, class_id=class_id, name="target", source_template_id=t2.id)

        targets, issues = class_capacity_service.resolve_class_targets(
            session, nodes=[m1, m2]
        )
        assert issues == []
        assert targets == {m1.id: "a1", m2.id: "a2"}

    def test_machines_in_different_clusters_are_refused(self, session):
        """兩台範本分屬不同叢集 —— 這堂課建不出可連通的環境，必須擋下。"""
        class_id = uuid.uuid4()
        t1 = _template(session, node="a1", resource_type="lxc")
        t2 = _template(session, node="b1", resource_type="lxc")
        m1 = _machine(session, class_id=class_id, name="attacker", source_template_id=t1.id)
        m2 = _machine(session, class_id=class_id, name="target", source_template_id=t2.id)

        targets, issues = class_capacity_service.resolve_class_targets(
            session, nodes=[m1, m2]
        )
        assert targets == {}
        assert len(issues) == 1
        # 訊息要指出是哪些機器、各自能落在哪，才有辦法排除
        assert "attacker" in issues[0] and "target" in issues[0]

    def test_custom_lxc_follows_the_class_cluster(self, session, monkeypatch):
        """關鍵案例：自訂 LXC 在兩個叢集都看得到映像檔時，必須跟著班級走。"""
        monkeypatch.setattr(
            class_capacity_service.proxmox_service,
            "get_lxc_template_node_map",
            lambda: {"local:vztmpl/deb.tar.zst": {"a2", "b1", "b2"}},
        )
        # 預設節點在另一個叢集，舊行為會選到它
        monkeypatch.setattr(
            class_capacity_service.provisioning_service,
            "_get_lxc_target_node",
            lambda: "b1",
        )
        class_id = uuid.uuid4()
        template = _template(session, node="a1", resource_type="lxc")
        pinned = _machine(
            session, class_id=class_id, name="lab", source_template_id=template.id
        )
        custom = _machine(
            session,
            class_id=class_id,
            name="extra",
            source_type="custom",
            custom_image_ref="local:vztmpl/deb.tar.zst",
        )

        targets, issues = class_capacity_service.resolve_class_targets(
            session, nodes=[pinned, custom]
        )
        assert issues == []
        assert targets[pinned.id] == "a1"
        # b1 雖是預設節點且看得到映像檔，但不在班級所屬叢集內
        assert targets[custom.id] == "a2"

    def test_default_node_is_kept_when_it_is_valid(self, session, monkeypatch):
        """對照組：預設節點合格時不改變既有選擇。"""
        monkeypatch.setattr(
            class_capacity_service.proxmox_service,
            "get_lxc_template_node_map",
            lambda: {"local:vztmpl/deb.tar.zst": {"a1", "a2"}},
        )
        monkeypatch.setattr(
            class_capacity_service.provisioning_service,
            "_get_lxc_target_node",
            lambda: "a2",
        )
        class_id = uuid.uuid4()
        template = _template(session, node="a1", resource_type="lxc")
        pinned = _machine(
            session, class_id=class_id, name="lab", source_template_id=template.id
        )
        custom = _machine(
            session,
            class_id=class_id,
            name="extra",
            source_type="custom",
            custom_image_ref="local:vztmpl/deb.tar.zst",
        )
        targets, _ = class_capacity_service.resolve_class_targets(
            session, nodes=[pinned, custom]
        )
        assert targets[custom.id] == "a2"

    def test_machine_with_no_node_in_the_cluster_is_refused(
        self, session, monkeypatch
    ):
        monkeypatch.setattr(
            class_capacity_service.proxmox_service,
            "get_lxc_template_node_map",
            lambda: {"local:vztmpl/deb.tar.zst": set()},
        )
        class_id = uuid.uuid4()
        template = _template(session, node="a1", resource_type="lxc")
        pinned = _machine(
            session, class_id=class_id, name="lab", source_template_id=template.id
        )
        custom = _machine(
            session,
            class_id=class_id,
            name="extra",
            source_type="custom",
            custom_image_ref="local:vztmpl/deb.tar.zst",
        )
        targets, issues = class_capacity_service.resolve_class_targets(
            session, nodes=[pinned, custom]
        )
        assert targets == {}
        assert issues

    def test_empty_class_is_not_an_error(self, session):
        assert class_capacity_service.resolve_class_targets(session, nodes=[]) == ({}, [])


# ---------------------------------------------------------------------------
# 建機時取得的節點必須與預留時一致
# ---------------------------------------------------------------------------

class TestProvisioningUsesTheSamePlan:
    def test_target_node_matches_the_reservation_plan(self, session, monkeypatch):
        monkeypatch.setattr(
            class_capacity_service.proxmox_service,
            "get_lxc_template_node_map",
            lambda: {"local:vztmpl/deb.tar.zst": {"a2", "b1"}},
        )
        monkeypatch.setattr(
            class_capacity_service.provisioning_service,
            "_get_lxc_target_node",
            lambda: "b1",
        )
        class_id = uuid.uuid4()
        template = _template(session, node="a1", resource_type="lxc")
        pinned = _machine(
            session, class_id=class_id, name="lab", source_template_id=template.id
        )
        custom = _machine(
            session,
            class_id=class_id,
            name="extra",
            source_type="custom",
            custom_image_ref="local:vztmpl/deb.tar.zst",
        )
        plan, _ = class_capacity_service.resolve_class_targets(
            session, nodes=[pinned, custom]
        )
        # 建機端只拿到單一台機器，仍須解出與整班計畫相同的節點
        assert (
            class_capacity_service.target_node_for_machine(
                session, machine_node=custom
            )
            == plan[custom.id]
            == "a2"
        )

    def test_unresolvable_class_returns_none(self, session):
        class_id = uuid.uuid4()
        t1 = _template(session, node="a1", resource_type="lxc")
        t2 = _template(session, node="b1", resource_type="lxc")
        _machine(session, class_id=class_id, name="attacker", source_template_id=t1.id)
        m2 = _machine(session, class_id=class_id, name="target", source_template_id=t2.id)
        # 跨叢集無解時回 None，讓建機沿用既有預設行為而不是中斷
        assert (
            class_capacity_service.target_node_for_machine(session, machine_node=m2)
            is None
        )
