from types import SimpleNamespace

from app.ai.pve_log import collector
from app.ai.pve_log.schemas import ClusterInfo


class _FakeResourceEndpoint:
    def __init__(self) -> None:
        self.calls: list[dict[str, str]] = []

    def get(self, **kwargs):
        self.calls.append(kwargs)
        return [
            {
                "vmid": 101,
                "name": "test-vm",
                "type": "qemu",
                "node": "pve",
                "status": "stopped",
            },
            {
                "vmid": 102,
                "name": "test-lxc",
                "type": "lxc",
                "node": "pve",
                "status": "stopped",
            },
        ]


def test_collect_snapshot_uses_shared_client_and_includes_lxc(monkeypatch):
    resources = _FakeResourceEndpoint()
    proxmox = SimpleNamespace(
        cluster=SimpleNamespace(resources=resources),
    )
    client_calls = 0

    def fake_get_proxmox_api():
        nonlocal client_calls
        client_calls += 1
        return proxmox

    monkeypatch.setattr(collector, "get_proxmox_api", fake_get_proxmox_api)
    monkeypatch.setattr(
        collector,
        "_collect_cluster_info",
        lambda _proxmox: ClusterInfo(
            cluster_name="test",
            is_cluster=True,
            node_count=1,
            quorate=True,
        ),
    )
    monkeypatch.setattr(collector, "_collect_nodes", lambda _proxmox: [])
    monkeypatch.setattr(collector.settings, "collector_fetch_config", False)
    monkeypatch.setattr(
        collector.settings,
        "collector_fetch_lxc_interfaces",
        False,
    )

    snapshot = collector.collect_snapshot()

    assert client_calls == 1
    assert resources.calls == [{"type": "vm"}]
    assert [(item.vmid, item.resource_type) for item in snapshot.resources] == [
        (101, "qemu"),
        (102, "lxc"),
    ]
    assert snapshot.total_vms == 1
    assert snapshot.total_lxc == 1
