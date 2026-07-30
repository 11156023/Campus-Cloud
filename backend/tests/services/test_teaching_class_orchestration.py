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
from app.models import BatchProvisionJobStatus
from app.services.teaching import class_capacity_service, class_network_service
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


def test_submit_batch_for_class_students_uses_formal_class(monkeypatch):
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


def test_full_capacity_preview_checks_cluster_and_ip(monkeypatch):
    nodes = [
        SimpleNamespace(
            cpu=2,
            memory_mb=2048,
            disk_gb=20,
            network="lab-net",
        )
    ]
    students = [SimpleNamespace(user_id=uuid.uuid4()) for _ in range(3)]
    monkeypatch.setattr(
        class_capacity_service.ip_management_service,
        "get_ip_stats",
        lambda _session: {"available": 20},
    )
    monkeypatch.setattr(
        class_capacity_service,
        "_check_cluster_capacity",
        lambda _session, **_kwargs: {
            "pve1": {
                "cpu_cores": 6,
                "memory_bytes": 6 * 1024**3,
                "disk_bytes": 60 * 1024**3,
                "machines": 3,
            }
        },
    )

    result = class_capacity_service.preview(
        object(),
        nodes=nodes,
        students=students,
        check_cluster=True,
    )

    assert result["ready"] is True
    assert result["cluster_checked"] is True
    assert result["issues"] == []
    assert result["placement_plan"]["pve1"]["machines"] == 3


def test_full_capacity_preview_reports_cluster_issue(monkeypatch):
    nodes = [
        SimpleNamespace(
            cpu=2,
            memory_mb=2048,
            disk_gb=20,
            network="lab-net",
        )
    ]
    students = [SimpleNamespace(user_id=uuid.uuid4())]
    monkeypatch.setattr(
        class_capacity_service.ip_management_service,
        "get_ip_stats",
        lambda _session: {"available": 20},
    )

    def reject_capacity(*_args, **_kwargs):
        raise BadRequestError("pve1 RAM 不足")

    monkeypatch.setattr(
        class_capacity_service,
        "_check_cluster_capacity",
        reject_capacity,
    )

    result = class_capacity_service.preview(
        object(),
        nodes=nodes,
        students=students,
        check_cluster=True,
    )

    assert result["ready"] is False
    assert result["issues"] == ["pve1 RAM 不足"]


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


def test_class_jobs_are_approved_as_one_decision(monkeypatch):
    job_ids = [uuid.uuid4(), uuid.uuid4(), uuid.uuid4()]
    jobs = [SimpleNamespace(id=job_id) for job_id in job_ids]
    started = []

    monkeypatch.setattr(
        batch_provision_service.bp_repo,
        "transition_pending_reviews",
        lambda **_kwargs: jobs,
    )

    class FakeThread:
        def __init__(self, *, args, **_kwargs):
            self.job_id = args[0]

        def start(self):
            started.append(self.job_id)

    monkeypatch.setattr(batch_provision_service.threading, "Thread", FakeThread)

    reviewed = batch_provision_service.review_batch_jobs(
        session=object(),
        job_ids=job_ids,
        reviewer_id=uuid.uuid4(),
        decision=BatchProvisionJobStatus.approved,
    )

    assert reviewed == jobs
    assert started == job_ids


def test_network_labels_accept_ui_slash_or_comma_notation():
    assert class_network_service._segments("lab-net / backend-net, management") == {
        "lab-net",
        "backend-net",
        "management",
    }


def test_course_connection_creates_matching_source_out_and_target_in(monkeypatch):
    rules = []
    monkeypatch.setattr(
        class_network_service,
        "_ip_by_vmid",
        lambda _session, vmid: {101: "10.0.0.11", 102: "10.0.0.12"}[vmid],
    )
    monkeypatch.setattr(
        class_network_service.proxmox_service,
        "find_resource",
        lambda vmid: {"node": "pve1", "type": "qemu", "vmid": vmid},
    )
    monkeypatch.setattr(
        class_network_service,
        "_ensure_rule",
        lambda **kwargs: rules.append(kwargs),
    )

    class_network_service._allow_one_way(
        object(),
        class_id=uuid.uuid4(),
        source_vmid=101,
        target_vmid=102,
        protocol="tcp",
        port=443,
    )

    assert rules[0]["vmid"] == 101
    assert rules[0]["rule"] == {
        "type": "out",
        "action": "ACCEPT",
        "pos": 0,
        "dest": "10.0.0.12",
        "proto": "tcp",
        "dport": "443",
    }
    assert rules[1]["vmid"] == 102
    assert rules[1]["rule"] == {
        "type": "in",
        "action": "ACCEPT",
        "source": "10.0.0.11",
        "proto": "tcp",
        "dport": "443",
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
