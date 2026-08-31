"""範本政策（密碼/GPU/磁碟鎖定）與 icon/附件檔案的單元測試。

mock PVE operations 與 repo，無 DB / Redis：
- request_clone：密碼政策、GPU 節點相容、payload 加密
- _reconfigure_qemu：login_password=None 時不得帶 cipassword
- template_files：icon 與附件的實體檔案生命週期
- add_attachment：副檔名 / 大小 / 數量上限
"""

from __future__ import annotations

import shutil
import tempfile
import uuid
from collections.abc import Iterator
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.core.security import decrypt_value
from app.exceptions import BadRequestError, ConflictError
from app.models import VMTemplate, VMTemplateStatus
from app.schemas.template import TemplateCloneRequest
from app.services.proxmox import provisioning_service
from app.services.template import clone_service, template_files, template_service


def make_user(role: str) -> SimpleNamespace:
    return SimpleNamespace(id=uuid.uuid4(), role=role, is_superuser=False)


def make_template(**overrides: Any) -> VMTemplate:
    defaults: dict[str, Any] = dict(
        id=uuid.uuid4(),
        pve_vmid=9001,
        name="lab-vm",
        owner_id=None,
        node="pve1",
        resource_type="qemu",
        status=VMTemplateStatus.ready,
    )
    defaults.update(overrides)
    return VMTemplate(**defaults)


@pytest.fixture
def clone_target(monkeypatch: pytest.MonkeyPatch) -> VMTemplate:
    template = make_template()
    monkeypatch.setattr(
        template_service, "_get_or_404", lambda session, template_id: template
    )
    monkeypatch.setattr(
        template_service, "_require_view", lambda session, user, template: None
    )
    return template


# ---------------------------------------------------------------------------
# request_clone：政策驗證
# ---------------------------------------------------------------------------


async def test_request_clone_rejects_custom_password_when_locked(
    clone_target: VMTemplate,
) -> None:
    clone_target.allow_password_change = False

    with pytest.raises(BadRequestError, match="不允許自訂登入密碼"):
        await clone_service.request_clone(
            session=None,  # type: ignore[arg-type]
            user=make_user("teacher"),
            template_id=clone_target.id,
            data=TemplateCloneRequest(count=1, login_password="Secret123"),
        )


async def test_request_clone_rejects_gpu_on_lxc_template(
    clone_target: VMTemplate,
) -> None:
    clone_target.resource_type = "lxc"

    with pytest.raises(BadRequestError, match="LXC"):
        await clone_service.request_clone(
            session=None,  # type: ignore[arg-type]
            user=make_user("teacher"),
            template_id=clone_target.id,
            data=TemplateCloneRequest(count=1, gpu_mapping_id="h200"),
        )


async def test_request_clone_rejects_gpu_not_on_template_node(
    clone_target: VMTemplate, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        provisioning_service, "_gpu_mapping_nodes", lambda mapping_id: {"pve2"}
    )

    with pytest.raises(BadRequestError, match="不在範本所在節點"):
        await clone_service.request_clone(
            session=None,  # type: ignore[arg-type]
            user=make_user("teacher"),
            template_id=clone_target.id,
            data=TemplateCloneRequest(count=1, gpu_mapping_id="h200"),
        )


async def test_request_clone_payload_encrypts_password_and_locks_disk(
    clone_target: VMTemplate, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        provisioning_service, "_gpu_mapping_nodes", lambda mapping_id: {"pve1"}
    )
    payloads: list[dict[str, Any]] = []

    async def fake_enqueue(**kwargs: Any) -> Any:
        payloads.append(kwargs["payload"])
        return SimpleNamespace(id=uuid.uuid4())

    monkeypatch.setattr(clone_service, "enqueue_task", fake_enqueue)

    await clone_service.request_clone(
        session=None,  # type: ignore[arg-type]
        user=make_user("teacher"),
        template_id=clone_target.id,
        data=TemplateCloneRequest(
            count=1,
            login_password="Secret123",
            gpu_mapping_id="h200",
            gpu_mdev_profile="nvidia-1028",
        ),
    )

    payload = payloads[0]
    # payload 會落 DB：密碼必須是密文且可還原；磁碟不得出現在 payload
    assert payload["login_password_enc"] != "Secret123"
    assert decrypt_value(payload["login_password_enc"]) == "Secret123"
    assert payload["allow_password_reset"] is True
    assert payload["gpu_mapping_id"] == "h200"
    assert payload["gpu_mdev_profile"] == "nvidia-1028"
    assert "disk" not in payload


async def test_request_clone_locked_password_payload(
    clone_target: VMTemplate, monkeypatch: pytest.MonkeyPatch
) -> None:
    clone_target.allow_password_change = False
    payloads: list[dict[str, Any]] = []

    async def fake_enqueue(**kwargs: Any) -> Any:
        payloads.append(kwargs["payload"])
        return SimpleNamespace(id=uuid.uuid4())

    monkeypatch.setattr(clone_service, "enqueue_task", fake_enqueue)

    await clone_service.request_clone(
        session=None,  # type: ignore[arg-type]
        user=make_user("teacher"),
        template_id=clone_target.id,
        data=TemplateCloneRequest(count=1),
    )

    assert payloads[0]["allow_password_reset"] is False
    assert payloads[0]["login_password_enc"] is None


# ---------------------------------------------------------------------------
# _reconfigure_qemu：密碼鎖定時不得帶 cipassword
# ---------------------------------------------------------------------------


def _reconfigure(monkeypatch: pytest.MonkeyPatch, password: str | None) -> dict:
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
        login_password=password,
        net_cfg={
            "bridge_name": "vmbr1",
            "prefix_len": 24,
            "gateway": "10.0.0.1",
        },
        allocated_ip="10.0.0.50",
    )
    return captured


def test_reconfigure_qemu_omits_cipassword_when_locked(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured = _reconfigure(monkeypatch, None)
    assert "cipassword" not in captured


def test_reconfigure_qemu_sets_custom_password(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured = _reconfigure(monkeypatch, "Custom1234")
    assert captured["cipassword"] == "Custom1234"


# ---------------------------------------------------------------------------
# template_files：實體檔案生命週期
# ---------------------------------------------------------------------------


@pytest.fixture
def file_dirs(
    monkeypatch: pytest.MonkeyPatch,
) -> Iterator[tuple[Path, Path]]:
    # 不用 tmp_path：部分環境的 pytest basetemp 目錄有 ACL 問題
    base = Path(tempfile.mkdtemp(prefix="tpl-files-"))
    icon_dir = base / "icons"
    attach_dir = base / "files"
    monkeypatch.setattr(template_files, "ICON_DIR", icon_dir)
    monkeypatch.setattr(template_files, "ATTACHMENT_DIR", attach_dir)
    yield icon_dir, attach_dir
    shutil.rmtree(base, ignore_errors=True)


def test_icon_save_replaces_old_extension(
    file_dirs: tuple[Path, Path],
) -> None:
    template_id = uuid.uuid4()
    template_files.save_icon(template_id, ".png", b"png-bytes")
    template_files.save_icon(template_id, ".webp", b"webp-bytes")

    found = template_files.find_icon(template_id)
    assert found is not None and found.suffix == ".webp"
    icon_dir = file_dirs[0]
    assert not (icon_dir / f"{template_id}.png").exists()


def test_attachment_lifecycle_and_bulk_cleanup(
    file_dirs: tuple[Path, Path],
) -> None:
    template_id = uuid.uuid4()
    attachment_id = uuid.uuid4()
    template_files.save_icon(template_id, ".png", b"icon")
    template_files.save_attachment(template_id, attachment_id, b"manual")

    assert template_files.attachment_path(template_id, attachment_id) is not None

    template_files.delete_all_for_template(template_id)
    assert template_files.find_icon(template_id) is None
    assert template_files.attachment_path(template_id, attachment_id) is None
    assert not (file_dirs[1] / str(template_id)).exists()


# ---------------------------------------------------------------------------
# add_attachment：驗證規則
# ---------------------------------------------------------------------------


@pytest.fixture
def owned_template(monkeypatch: pytest.MonkeyPatch) -> VMTemplate:
    template = make_template()
    monkeypatch.setattr(
        template_service, "_get_or_404", lambda session, template_id: template
    )
    monkeypatch.setattr(
        template_service, "_require_owner", lambda user, template: None
    )
    return template


def test_add_attachment_rejects_disallowed_extension(
    owned_template: VMTemplate,
) -> None:
    with pytest.raises(BadRequestError, match="不支援的檔案類型"):
        template_service.add_attachment(
            session=None,  # type: ignore[arg-type]
            user=make_user("teacher"),
            template_id=owned_template.id,
            filename="malware.exe",
            content_type="application/octet-stream",
            data=b"MZ",
        )


def test_add_attachment_rejects_oversize(
    owned_template: VMTemplate, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(template_files, "ATTACHMENT_MAX_BYTES", 10)

    with pytest.raises(BadRequestError, match="50MB"):
        template_service.add_attachment(
            session=None,  # type: ignore[arg-type]
            user=make_user("teacher"),
            template_id=owned_template.id,
            filename="manual.pdf",
            content_type="application/pdf",
            data=b"x" * 11,
        )


def test_add_attachment_rejects_over_count_limit(
    owned_template: VMTemplate, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        template_service,
        "list_attachments",
        lambda **kw: [SimpleNamespace()] * template_files.ATTACHMENT_MAX_COUNT,
    )

    with pytest.raises(BadRequestError, match="上限"):
        template_service.add_attachment(
            session=None,  # type: ignore[arg-type]
            user=make_user("teacher"),
            template_id=owned_template.id,
            filename="manual.pdf",
            content_type="application/pdf",
            data=b"pdf",
        )
# ---------------------------------------------------------------------------
# 資源詳情頁：依 Resource.template_id 反查來源範本手冊
# ---------------------------------------------------------------------------


class _ManualSession:
    """session.get(Resource, vmid) 的最小替身。"""

    def __init__(self, resource: object) -> None:
        self._resource = resource

    def get(self, model: type, key: object) -> object:
        return self._resource


def test_manual_lookup_returns_empty_for_non_clone(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = _ManualSession(SimpleNamespace(template_id=None))
    template, attachments = template_service.get_manual_for_cloned_resource(
        session=session,  # type: ignore[arg-type]
        vmid=400,
    )
    assert template is None
    assert attachments == []

    session = _ManualSession(None)
    template, attachments = template_service.get_manual_for_cloned_resource(
        session=session,  # type: ignore[arg-type]
        vmid=400,
    )
    assert template is None


def test_manual_lookup_resolves_template_by_pve_vmid(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = make_template(pve_vmid=9001)
    attachment = SimpleNamespace(id=uuid.uuid4(), filename="manual.pdf")
    monkeypatch.setattr(
        template_service.template_repo,
        "get_template_by_pve_vmid",
        lambda **kw: source if kw["pve_vmid"] == 9001 else None,
    )
    monkeypatch.setattr(
        template_service,
        "_template_attachments",
        lambda session, template_id: [attachment],
    )

    session = _ManualSession(SimpleNamespace(template_id=9001))
    template, attachments = template_service.get_manual_for_cloned_resource(
        session=session,  # type: ignore[arg-type]
        vmid=400,
    )
    assert template is source
    assert attachments == [attachment]


def test_manual_download_validates_attachment_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.exceptions import NotFoundError

    source = make_template(pve_vmid=9001)
    attachment = SimpleNamespace(id=uuid.uuid4(), filename="manual.pdf")
    monkeypatch.setattr(
        template_service,
        "get_manual_for_cloned_resource",
        lambda **kw: (source, [attachment]),
    )
    fake_path = Path("manual-on-disk.pdf")
    monkeypatch.setattr(
        template_service.template_files,
        "attachment_path",
        lambda template_id, attachment_id: fake_path,
    )

    path, found = template_service.get_manual_attachment_for_cloned_resource(
        session=None,  # type: ignore[arg-type]
        vmid=400,
        attachment_id=attachment.id,
    )
    assert path is fake_path
    assert found is attachment

    with pytest.raises(NotFoundError, match="Attachment not found"):
        template_service.get_manual_attachment_for_cloned_resource(
            session=None,  # type: ignore[arg-type]
            vmid=400,
            attachment_id=uuid.uuid4(),
        )


# ---------------------------------------------------------------------------
# 學生可申請的應用範本目錄
# ---------------------------------------------------------------------------


def _catalog_rows() -> list[VMTemplate]:
    return [
        make_template(
            pve_vmid=9001,
            name="n8n",
            resource_type="lxc",
            student_requestable=True,
        ),
        make_template(
            pve_vmid=9002,
            name="jupyter",
            resource_type="qemu",
            student_requestable=True,
            default_cores=4,
            default_memory=8192,
            default_disk=60,
        ),
        make_template(pve_vmid=9003, name="gone", student_requestable=True),
    ]


def test_student_catalog_uses_pve_facts_and_skips_missing_templates(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        template_service.template_repo,
        "list_student_catalog",
        lambda **kwargs: _catalog_rows(),
    )
    monkeypatch.setattr(
        template_service.proxmox_ops,
        "get_vm_templates",
        lambda: [
            # 16 GiB disk, 2 GiB RAM
            {"vmid": 9001, "type": "lxc", "maxcpu": 2, "maxmem": 2147483648, "maxdisk": 17179869184},
            {"vmid": 9002, "type": "qemu", "maxcpu": 2, "maxmem": 2147483648, "maxdisk": 21474836480},
        ],
    )
    monkeypatch.setattr(
        "app.services.proxmox.provisioning_service.is_windows_template",
        lambda vmid: False,
    )

    catalog = template_service.list_student_catalog(session=None)  # type: ignore[arg-type]

    by_vmid = {item.pve_vmid: item for item in catalog}
    # PVE 上已經不存在的範本不能留在目錄裡，否則學生按下去才失敗
    assert set(by_vmid) == {9001, 9002}
    # 沒有設定預設值的容器範本，規格與磁碟下限來自 PVE 本身
    assert (by_vmid[9001].cores, by_vmid[9001].memory_mb, by_vmid[9001].disk_gb) == (
        2,
        2048,
        16,
    )
    # 教師設定過的預設值優先於 PVE 的實際大小
    assert (by_vmid[9002].cores, by_vmid[9002].memory_mb, by_vmid[9002].disk_gb) == (
        4,
        8192,
        60,
    )


def test_lxc_templates_are_not_offered_as_vm_sources(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.services.proxmox import provisioning_service

    monkeypatch.setattr(
        provisioning_service.proxmox_service,
        "get_vm_templates",
        lambda: [
            {"vmid": 9001, "type": "lxc", "name": "n8n", "node": "pve1"},
            {"vmid": 9002, "type": "qemu", "name": "ubuntu", "node": "pve1"},
        ],
    )
    monkeypatch.setattr(provisioning_service, "_template_ostype", lambda vm: "l26")

    assert [item.vmid for item in provisioning_service.get_vm_templates()] == [9002]


# ---------------------------------------------------------------------------
# 刪除保護：已被多機環境引用的母範本不得硬刪
# ---------------------------------------------------------------------------


async def test_delete_template_refuses_while_an_environment_references_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    template = make_template()
    monkeypatch.setattr(
        template_service, "_get_or_404", lambda session, template_id: template
    )
    monkeypatch.setattr(
        template_service, "_require_owner", lambda user, template: None
    )
    monkeypatch.setattr(
        template_service, "_clone_children_vmids", lambda session, pve_vmid: []
    )
    monkeypatch.setattr(
        template_service,
        "_environments_referencing",
        lambda session, template_id: ["Linux 三層式", "資安攻防"],
    )

    with pytest.raises(ConflictError, match="Linux 三層式"):
        await template_service.delete_template(
            session=None,  # type: ignore[arg-type]
            user=make_user("teacher"),
            template_id=template.id,
        )
