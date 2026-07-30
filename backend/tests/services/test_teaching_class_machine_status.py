import uuid
from types import SimpleNamespace

import pytest

from app.services import teaching_class_machine_status as service


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class _Session:
    def __init__(self, results):
        self._results = iter(results)

    def exec(self, _statement):
        return _Result(next(self._results))


def test_student_machine_status_keeps_all_mappings_and_collects_snapshot_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class_id = uuid.uuid4()
    enrollment = SimpleNamespace(
        id=uuid.uuid4(),
        class_id=class_id,
        user_id=uuid.uuid4(),
        joined_at=None,
    )
    nodes = [
        SimpleNamespace(
            id=uuid.uuid4(),
            class_id=class_id,
            node_key="worker-1",
            name="Worker 1",
            role="student",
            resource_type="qemu",
            sort_order=1,
        ),
        SimpleNamespace(
            id=uuid.uuid4(),
            class_id=class_id,
            node_key="worker-2",
            name="Worker 2",
            role="student",
            resource_type="qemu",
            sort_order=2,
        ),
    ]
    mappings = [
        SimpleNamespace(
            id=uuid.uuid4(),
            class_student_id=enrollment.id,
            machine_node_id=nodes[0].id,
            vmid=101,
            status="completed",
            error=None,
        ),
        SimpleNamespace(
            id=uuid.uuid4(),
            class_student_id=enrollment.id,
            machine_node_id=nodes[1].id,
            vmid=102,
            status="completed",
            error=None,
        ),
    ]
    user = SimpleNamespace(
        id=enrollment.user_id,
        full_name="Student",
        email="student@example.com",
    )
    session = _Session([[enrollment], nodes, mappings, [user]])
    calls = 0

    def _resources():
        nonlocal calls
        calls += 1
        return [
            {"vmid": 101, "type": "qemu", "status": "running", "cpu": 0.1},
            {"vmid": 102, "type": "qemu", "status": "stopped", "cpu": 0},
        ]

    monkeypatch.setattr(service.proxmox_ops, "list_all_resources", _resources)
    monkeypatch.setattr(
        service.resource_repo,
        "get_resource_by_vmid",
        lambda **_kwargs: SimpleNamespace(ssh_private_key_encrypted="encrypted"),
    )
    monkeypatch.setattr(
        service.resource_repo,
        "get_cached_ip_address",
        lambda **_kwargs: "192.0.2.10",
    )

    result = service.get_teaching_class_machine_status(
        session=session,
        class_id=class_id,
    )

    assert calls == 1
    assert [machine.vmid for machine in result.students[0].machines] == [101, 102]
    assert result.summary.machines == 2
    assert result.summary.running == 1
    assert result.summary.stopped == 1


def test_student_machine_status_survives_snapshot_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class_id = uuid.uuid4()
    enrollment = SimpleNamespace(
        id=uuid.uuid4(),
        class_id=class_id,
        user_id=uuid.uuid4(),
        joined_at=None,
    )
    node = SimpleNamespace(
        id=uuid.uuid4(),
        class_id=class_id,
        node_key="worker",
        name="Worker",
        role="student",
        resource_type="qemu",
        sort_order=1,
    )
    mapping = SimpleNamespace(
        id=uuid.uuid4(),
        class_student_id=enrollment.id,
        machine_node_id=node.id,
        vmid=None,
        status="failed",
        error="provision failed",
    )
    user = SimpleNamespace(
        id=enrollment.user_id,
        full_name=None,
        email="student@example.com",
    )
    session = _Session([[enrollment], [node], [mapping], [user]])
    monkeypatch.setattr(
        service.proxmox_ops,
        "list_all_resources",
        lambda: (_ for _ in ()).throw(RuntimeError("offline")),
    )

    result = service.get_teaching_class_machine_status(
        session=session,
        class_id=class_id,
    )

    machine = result.students[0].machines[0]
    assert machine.provision_error == "provision failed"
    assert machine.runtime_status == "unknown"
    assert result.summary.failed == 1
