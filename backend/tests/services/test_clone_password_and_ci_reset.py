"""克隆隨機登入密碼與轉範本前 cloud-init 重設的單元測試。

- 克隆側：qemu 走 cipassword（cloud-init 首次開機套用）、LXC 開機後
  pct exec chpasswd（best-effort，失敗不記錄密碼）。
- 轉換側：run_convert_task / run_update_convert_task 關機前對運行中的
  qemu 母機執行 cloud-init clean + machine-id / host key 清理。
"""

from __future__ import annotations

import uuid
from types import SimpleNamespace
from typing import Any

import pytest

from app.infrastructure.proxmox import guest
from app.models import Resource, VMTemplate, VMTemplateStatus
from app.services.template import clone_service, template_service

# ---------------------------------------------------------------------------
# generate_login_password
# ---------------------------------------------------------------------------


def test_generate_login_password_charset_and_length() -> None:
    for _ in range(50):
        password = clone_service.generate_login_password()
        assert len(password) == clone_service._PASSWORD_LENGTH
        assert all(ch in clone_service._PASSWORD_ALPHABET for ch in password)
        # 易混淆字元必須排除在字母表外
        assert not set("0O1lI") & set(password)


# ---------------------------------------------------------------------------
# _reconfigure_qemu：cipassword 必須寫入 config
# ---------------------------------------------------------------------------


def test_reconfigure_qemu_sets_cipassword(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, Any] = {}

    def fake_update_config(node: str, vmid: int, rtype: str, **params: Any) -> None:
        captured.update(params)

    monkeypatch.setattr(
        clone_service.proxmox_ops, "update_config", fake_update_config
    )
    monkeypatch.setattr(
        clone_service.proxmox_ops, "resize_disk", lambda *a, **kw: None
    )

    clone_service._reconfigure_qemu(
        node="pve1",
        vmid=200,
        hostname="stu-01",
        cores=2,
        memory=2048,
        disk=None,
        public_key="ssh-ed25519 AAAA test",
        login_password="Xy37abcdefgh",
        net_cfg={
            "bridge_name": "vmbr1",
            "prefix_len": 24,
            "gateway": "10.0.0.1",
        },
        allocated_ip="10.0.0.50",
    )

    assert captured["cipassword"] == "Xy37abcdefgh"
    assert captured["ciupgrade"] == 0


# ---------------------------------------------------------------------------
# _set_lxc_root_password：重試與失敗容忍
# ---------------------------------------------------------------------------


def test_set_lxc_root_password_retries_until_success(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(clone_service.time, "sleep", lambda s: None)
    attempts: list[str] = []
    outcomes: list[Any] = [
        RuntimeError("container not running"),
        (1, "", "chpasswd: PAM failure"),
        (0, "", ""),
    ]

    def fake_exec_lxc(node: str, vmid: int, command: str, **kw: Any) -> Any:
        attempts.append(command)
        outcome = outcomes[len(attempts) - 1]
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    monkeypatch.setattr(guest, "exec_lxc", fake_exec_lxc)

    assert clone_service._set_lxc_root_password("pve1", 201, "abcd2345efgh")
    assert len(attempts) == 3
    assert "root:abcd2345efgh" in attempts[0]
    assert "chpasswd" in attempts[0]


def test_set_lxc_root_password_gives_up_and_returns_false(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(clone_service.time, "sleep", lambda s: None)
    calls: list[int] = []

    def always_fail(node: str, vmid: int, command: str, **kw: Any) -> Any:
        calls.append(vmid)
        raise RuntimeError("no route to node")

    monkeypatch.setattr(guest, "exec_lxc", always_fail)

    assert not clone_service._set_lxc_root_password("pve1", 202, "abcd2345efgh")
    assert len(calls) == clone_service._LXC_PASSWORD_ATTEMPTS


# ---------------------------------------------------------------------------
# _reset_cloud_init_state
# ---------------------------------------------------------------------------


def test_reset_cloud_init_skips_lxc(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(*a: Any, **kw: Any) -> None:
        raise AssertionError("should not touch PVE for lxc")

    monkeypatch.setattr(template_service.proxmox_ops, "get_status", boom)
    assert template_service._reset_cloud_init_state("pve1", 300, "lxc") is False


def test_reset_cloud_init_boots_stopped_vm_and_resets(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(template_service.time, "sleep", lambda s: None)
    monkeypatch.setattr(
        template_service.proxmox_ops,
        "get_status",
        lambda node, vmid, rtype: {"status": "stopped"},
    )
    actions: list[str] = []
    monkeypatch.setattr(
        template_service.proxmox_ops,
        "control",
        lambda node, vmid, rtype, action: actions.append(action),
    )
    # 開機後 agent 第三次 ping 才起來
    pings: list[int] = []
    monkeypatch.setattr(
        guest,
        "ping_qemu_agent",
        lambda node, vmid: (pings.append(vmid), len(pings) >= 3)[1],
    )
    # 舊版 agent 不支援 get-osinfo → 走預設 /bin/sh 分支
    monkeypatch.setattr(guest, "get_osinfo_qemu", lambda node, vmid: None)
    executed: list[list[str]] = []
    monkeypatch.setattr(
        guest,
        "exec_qemu",
        lambda node, vmid, command, **kw: (executed.append(command), (0, "", ""))[1],
    )

    assert template_service._reset_cloud_init_state("pve1", 301, "qemu") is True
    assert actions == ["start"]
    assert len(pings) == 3
    assert len(executed) == 1


def test_reset_cloud_init_stopped_vm_agent_never_up(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(template_service.time, "sleep", lambda s: None)
    # 讓等待迴圈只跑幾次就逾時
    clock = iter(range(0, 10_000, 100))
    monkeypatch.setattr(
        template_service.time, "monotonic", lambda: float(next(clock))
    )
    monkeypatch.setattr(
        template_service.proxmox_ops,
        "get_status",
        lambda node, vmid, rtype: {"status": "stopped"},
    )
    actions: list[str] = []
    monkeypatch.setattr(
        template_service.proxmox_ops,
        "control",
        lambda node, vmid, rtype, action: actions.append(action),
    )
    monkeypatch.setattr(guest, "ping_qemu_agent", lambda node, vmid: False)

    def boom(*a: Any, **kw: Any) -> None:
        raise AssertionError("agent exec must not run when agent never came up")

    monkeypatch.setattr(guest, "exec_qemu", boom)

    assert template_service._reset_cloud_init_state("pve1", 305, "qemu") is False
    assert actions == ["start"]


def test_reset_cloud_init_runs_script_on_running_vm(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        template_service.proxmox_ops,
        "get_status",
        lambda node, vmid, rtype: {"status": "running"},
    )
    monkeypatch.setattr(
        guest, "get_osinfo_qemu", lambda node, vmid: {"id": "ubuntu"}
    )
    executed: list[list[str]] = []
    monkeypatch.setattr(
        guest,
        "exec_qemu",
        lambda node, vmid, command, **kw: (executed.append(command), (0, "", ""))[1],
    )

    assert template_service._reset_cloud_init_state("pve1", 302, "qemu") is True
    assert len(executed) == 1
    assert executed[0][0] == "/bin/sh"
    script = executed[0][-1]
    assert "cloud-init clean" in script
    assert "/etc/machine-id" in script
    assert "ssh_host_" in script


def test_reset_cloud_init_windows_uses_cloudbase_reset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        template_service.proxmox_ops,
        "get_status",
        lambda node, vmid, rtype: {"status": "running"},
    )
    monkeypatch.setattr(
        guest,
        "get_osinfo_qemu",
        lambda node, vmid: {"id": "mswindows", "name": "Microsoft Windows"},
    )
    executed: list[list[str]] = []
    monkeypatch.setattr(
        guest,
        "exec_qemu",
        lambda node, vmid, command, **kw: (executed.append(command), (0, "", ""))[1],
    )

    assert template_service._reset_cloud_init_state("pve1", 304, "qemu") is True
    assert len(executed) == 1
    command = executed[0]
    assert command[0] == "powershell.exe"
    script = command[-1]
    assert "Cloudbase Solutions\\Cloudbase-Init" in script
    assert "ssh_host_" in script
    # 雙引號會被 qemu-ga 的命令列跳脫弄壞，腳本必須只用單引號
    assert '"' not in script


def test_reset_cloud_init_tolerates_agent_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        template_service.proxmox_ops,
        "get_status",
        lambda node, vmid, rtype: {"status": "running"},
    )

    def agent_down(*a: Any, **kw: Any) -> None:
        raise RuntimeError("guest agent not responding")

    monkeypatch.setattr(guest, "get_osinfo_qemu", lambda node, vmid: None)
    monkeypatch.setattr(guest, "exec_qemu", agent_down)
    assert template_service._reset_cloud_init_state("pve1", 303, "qemu") is False


# ---------------------------------------------------------------------------
# run_convert_task 串接：重設在關機之前
# ---------------------------------------------------------------------------


class FakeSession:
    def __init__(self, objects: dict[tuple[type, Any], Any]) -> None:
        self.objects = objects
        self.deleted: list[Any] = []

    def __enter__(self) -> FakeSession:
        return self

    def __exit__(self, *exc: Any) -> None:
        return None

    def get(self, model: type, key: Any) -> Any:
        return self.objects.get((model, key))

    def delete(self, obj: Any) -> None:
        self.deleted.append(obj)

    def add(self, obj: Any) -> None:
        pass

    def commit(self) -> None:
        pass


def test_run_convert_task_resets_cloud_init_before_shutdown(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    template_id = uuid.uuid4()
    template = SimpleNamespace(status=VMTemplateStatus.creating, error_message=None)
    fake_session = FakeSession({(VMTemplate, template_id): template, (Resource, 400): None})
    monkeypatch.setattr(template_service, "Session", lambda engine: fake_session)
    monkeypatch.setattr(template_service, "report_progress", lambda *a: None)
    monkeypatch.setattr(template_service.template_repo, "touch", lambda **kw: None)

    order: list[str] = []
    monkeypatch.setattr(
        template_service,
        "_reset_cloud_init_state",
        lambda node, vmid, rtype: (order.append("reset"), True)[1],
    )
    monkeypatch.setattr(
        template_service,
        "_ensure_stopped",
        lambda node, vmid, rtype: order.append("stop"),
    )
    monkeypatch.setattr(
        template_service.proxmox_ops, "list_snapshots", lambda *a: []
    )
    monkeypatch.setattr(
        template_service.proxmox_ops,
        "convert_to_template",
        lambda *a: order.append("convert"),
    )

    from app.services.resource import resource_service

    monkeypatch.setattr(
        resource_service, "mark_linked_request_consumed", lambda **kw: None
    )

    result = template_service.run_convert_task(
        uuid.uuid4(),
        {
            "template_id": str(template_id),
            "pve_vmid": 400,
            "resource_type": "qemu",
            "node": "pve1",
        },
    )

    assert order == ["reset", "stop", "convert"]
    assert result == {"vmid": 400, "cloud_init_reset": True}
    assert template.status == VMTemplateStatus.ready
