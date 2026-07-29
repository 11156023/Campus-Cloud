import uuid
from datetime import date, time
from types import SimpleNamespace

import pytest

from app.api.routes.course_environments import (
    EnvironmentCreate,
    EnvironmentEdgeIn,
    EnvironmentNodeIn,
)
from app.api.routes.teaching_classes import _recurrence
from app.exceptions import BadRequestError
from app.services.teaching import class_capacity_service
from app.services.teaching.class_network_service import _segments
from app.services.vm import batch_provision_service


def test_recurrence_uses_boot_day_when_lead_crosses_midnight():
    teaching_class = SimpleNamespace(
        start_date=date(2026, 9, 1),
        start_time=time(0, 5),
        end_time=time(2, 0),
        boot_lead_minutes=10,
    )

    rule, duration = _recurrence(teaching_class)

    assert rule == "FREQ=WEEKLY;BYDAY=MO;BYHOUR=23;BYMINUTE=55"
    assert duration == 125


def test_submit_batch_for_class_students_does_not_require_group(monkeypatch):
    class_id = uuid.uuid4()
    student_ids = [uuid.uuid4(), uuid.uuid4()]
    created_id = uuid.uuid4()
    captured = {}

    monkeypatch.setattr(
        batch_provision_service.ip_management_service,
        "ensure_subnet_configured",
        lambda _session: None,
    )
    monkeypatch.setattr(
        batch_provision_service.ip_management_service,
        "get_ip_stats",
        lambda _session: {"available": 10},
    )

    def create_job(**kwargs):
        captured.update(kwargs)
        return SimpleNamespace(id=created_id)

    monkeypatch.setattr(batch_provision_service.bp_repo, "create_job", create_job)

    job_id = batch_provision_service.submit_batch_job_for_users(
        session=object(),
        member_user_ids=student_ids,
        teaching_class_id=class_id,
        initiated_by_id=uuid.uuid4(),
        resource_type="qemu",
        hostname_prefix="linux-class-web",
        params={"cores": 2, "memory": 4096, "disk_size": 30},
    )

    assert job_id == created_id
    assert captured["group_id"] is None
    assert captured["teaching_class_id"] == class_id
    assert captured["member_user_ids"] == student_ids


def test_submit_batch_for_class_requires_students():
    with pytest.raises(BadRequestError, match="班級沒有學生"):
        batch_provision_service.submit_batch_job_for_users(
            session=object(),
            member_user_ids=[],
            teaching_class_id=uuid.uuid4(),
            initiated_by_id=uuid.uuid4(),
            resource_type="qemu",
            hostname_prefix="empty-class",
            params={},
        )


def test_class_capacity_is_calculated_for_the_complete_roster():
    nodes = [
        SimpleNamespace(
            cpu=2,
            memory_mb=4096,
            disk_gb=30,
            network="lab-net",
        ),
        SimpleNamespace(
            cpu=2,
            memory_mb=8192,
            disk_gb=80,
            network="lab-net / backend-net",
        ),
    ]
    students = [SimpleNamespace(user_id=uuid.uuid4()) for _ in range(30)]

    result = class_capacity_service.calculate(nodes=nodes, students=students)

    assert result == {
        "student_count": 30,
        "machines_per_student": 2,
        "machine_count": 60,
        "cpu_cores": 120,
        "memory_mb": 368640,
        "disk_gb": 3300,
        "ip_count": 60,
        "network_count": 60,
    }


def test_reserved_class_batch_does_not_repeat_per_node_ip_check(monkeypatch):
    created_id = uuid.uuid4()
    monkeypatch.setattr(
        batch_provision_service.ip_management_service,
        "ensure_subnet_configured",
        lambda _session: None,
    )
    monkeypatch.setattr(
        batch_provision_service.ip_management_service,
        "get_ip_stats",
        lambda _session: {"available": 0},
    )
    monkeypatch.setattr(
        batch_provision_service.bp_repo,
        "create_job",
        lambda **_kwargs: SimpleNamespace(id=created_id),
    )

    assert (
        batch_provision_service.submit_batch_job_for_users(
            session=object(),
            member_user_ids=[uuid.uuid4(), uuid.uuid4()],
            teaching_class_id=uuid.uuid4(),
            initiated_by_id=uuid.uuid4(),
            resource_type="qemu",
            hostname_prefix="reserved-class",
            params={},
            capacity_reserved=True,
        )
        == created_id
    )


def test_network_labels_accept_ui_slash_or_comma_notation():
    assert _segments("lab-net / backend-net, management") == {
        "lab-net",
        "backend-net",
        "management",
    }


def test_course_environment_accepts_template_and_custom_nodes_with_three_node_limit():
    template_id = uuid.uuid4()
    body = EnvironmentCreate(
        code="NET-LAB",
        name="Network Lab",
        nodes=[
            EnvironmentNodeIn(
                node_key="gateway",
                source_type="custom",
                custom_image_ref="local:vztmpl/debian.tar.zst",
                name="Gateway",
                role="firewall",
                resource_type="lxc",
                cpu=2,
                memory_mb=2048,
                disk_gb=8,
            ),
            EnvironmentNodeIn(
                node_key="web",
                source_type="template",
                source_template_id=template_id,
                name="Web",
                role="server",
                resource_type="qemu",
                cpu=2,
                memory_mb=4096,
                disk_gb=30,
            ),
        ],
        edges=[
            EnvironmentEdgeIn(
                source_node_key="gateway",
                target_node_key="web",
                direction="one_way",
                protocol="tcp",
                port=443,
            )
        ],
    )

    assert body.nodes[0].source_template_id is None
    assert body.nodes[1].source_template_id == template_id
    assert body.edges[0].port == 443


def test_custom_vm_requires_numeric_base_template_vmid():
    with pytest.raises(ValueError, match="VMID"):
        EnvironmentNodeIn(
            node_key="vm",
            source_type="custom",
            custom_image_ref="ubuntu-cloud-image",
            name="VM",
            role="student",
            resource_type="qemu",
            cpu=2,
            memory_mb=2048,
            disk_gb=20,
        )


def test_course_edge_defaults_match_firewall_connection_dialog():
    edge = EnvironmentEdgeIn(
        source_node_key="client",
        target_node_key="server",
    )

    assert edge.direction == "one_way"
    assert edge.protocol == "tcp"
    assert edge.port == 22


def test_course_edge_rejects_portless_firewall_service():
    with pytest.raises(ValueError, match="Port"):
        EnvironmentEdgeIn(
            source_node_key="client",
            target_node_key="server",
            protocol="tcp",
            port=None,
        )
