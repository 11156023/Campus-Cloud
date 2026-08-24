"""共享 Storage 在設定頁的去重邏輯。

共享 Storage 是整個叢集共用同一份實體儲存，PVE 每個節點都會回報一次，
因此列表只保留一筆代表；非共享（local / local-lvm）是各節點獨立的實體儲存，
必須逐一列出。
"""

from __future__ import annotations

from app.api.routes.proxmox_config import (
    _cluster_node_names,
    _dedupe_shared_storages,
)
from app.models.proxmox_storage import ProxmoxStorage

# pve-a / pve-b 屬同一連線（叢集），pve-c 屬另一連線
CONN_MAP: dict[str, tuple[int | None, str | None]] = {
    "pve-a": (1, "cluster-a"),
    "pve-b": (1, "cluster-a"),
    "pve-c": (2, "cluster-b"),
}


def _storage(
    storage_id: int, node: str, name: str, *, shared: bool
) -> ProxmoxStorage:
    return ProxmoxStorage(
        id=storage_id,
        node_name=node,
        storage=name,
        storage_type="lvm",
        total_gb=100.0,
        used_gb=10.0,
        avail_gb=90.0,
        can_vm=True,
        can_lxc=True,
        can_iso=False,
        can_backup=False,
        is_shared=shared,
        active=True,
        enabled=True,
        speed_tier="unknown",
        user_priority=5,
    )


def test_shared_storage_collapses_into_one_row_per_cluster() -> None:
    storages = [
        _storage(1, "pve-a", "ceph-pool", shared=True),
        _storage(2, "pve-b", "ceph-pool", shared=True),
    ]

    result = _dedupe_shared_storages(storages, CONN_MAP)

    assert len(result) == 1
    assert result[0].storage == "ceph-pool"
    assert sorted(result[0].node_names) == ["pve-a", "pve-b"]
    assert result[0].connection_name == "cluster-a"


def test_same_name_shared_storage_in_other_cluster_stays_separate() -> None:
    storages = [
        _storage(1, "pve-a", "ceph-pool", shared=True),
        _storage(2, "pve-b", "ceph-pool", shared=True),
        _storage(3, "pve-c", "ceph-pool", shared=True),
    ]

    result = _dedupe_shared_storages(storages, CONN_MAP)

    assert len(result) == 2
    by_connection = {row.connection_name: row for row in result}
    assert sorted(by_connection["cluster-a"].node_names) == ["pve-a", "pve-b"]
    assert by_connection["cluster-b"].node_names == ["pve-c"]


def test_local_storage_is_listed_per_node() -> None:
    storages = [
        _storage(1, "pve-a", "local-lvm", shared=False),
        _storage(2, "pve-b", "local-lvm", shared=False),
    ]

    result = _dedupe_shared_storages(storages, CONN_MAP)

    assert len(result) == 2
    assert sorted(row.node_name for row in result) == ["pve-a", "pve-b"]
    assert all(row.node_names == [row.node_name] for row in result)


def test_unassigned_nodes_are_treated_as_one_cluster() -> None:
    """舊版單連線資料（節點沒有 connection_id）仍應去重。"""
    conn_map: dict[str, tuple[int | None, str | None]] = {
        "pve-a": (None, None),
        "pve-b": (None, None),
    }
    storages = [
        _storage(1, "pve-a", "nfs-share", shared=True),
        _storage(2, "pve-b", "nfs-share", shared=True),
    ]

    result = _dedupe_shared_storages(storages, conn_map)

    assert len(result) == 1
    assert sorted(result[0].node_names) == ["pve-a", "pve-b"]
    assert result[0].connection_name is None


def test_shared_rows_sort_before_local_rows_within_a_cluster() -> None:
    storages = [
        _storage(1, "pve-a", "local-lvm", shared=False),
        _storage(2, "pve-a", "ceph-pool", shared=True),
        _storage(3, "pve-b", "local-lvm", shared=False),
    ]

    result = _dedupe_shared_storages(storages, CONN_MAP)

    assert [row.storage for row in result] == ["ceph-pool", "local-lvm", "local-lvm"]


def test_cluster_node_names_scopes_to_the_same_connection() -> None:
    assert _cluster_node_names("pve-a", CONN_MAP) == {"pve-a", "pve-b"}
    assert _cluster_node_names("pve-c", CONN_MAP) == {"pve-c"}
    # 未知節點至少涵蓋自己，不會誤把別的叢集拉進來
    assert _cluster_node_names("pve-x", CONN_MAP) == {"pve-x"}
