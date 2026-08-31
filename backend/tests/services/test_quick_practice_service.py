import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.models import (
    CourseEnvironment,
    CourseEnvironmentEdge,
    CourseEnvironmentNode,
    CourseEnvironmentVersion,
    CourseEnvironmentVersionStatus,
    IpAllocation,
    QuickPracticeSession,
    QuickPracticeSessionMachine,
    Resource,
    SubnetConfig,
    User,
    UserRole,
    VMProvisioningStatus,
    VMRequest,
    VMRequestStatus,
)
from app.services import quick_practice
from app.services.network import ip_management_service


@pytest.fixture
def quick_db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        yield session
    engine.dispose()


def _environment() -> CourseEnvironment:
    return CourseEnvironment(
        owner_id=uuid.uuid4(),
        code="DB-LAB",
        name="資料庫練習",
        usage_scope="quick_practice",
    )


def test_lxc_machine_request_uses_fixed_environment_configuration() -> None:
    now = datetime.now(UTC)
    node = CourseEnvironmentNode(
        version_id=uuid.uuid4(),
        node_key="mysql",
        source_type="custom",
        custom_image_ref="local:vztmpl/debian.tar.zst",
        name="MySQL",
        role="資料庫",
        resource_type="lxc",
        cpu=2,
        memory_mb=3072,
        disk_gb=20,
        sort_order=0,
    )

    request = quick_practice._machine_request(
        session=Mock(),
        node=node,
        environment=_environment(),
        practice_session_id=uuid.uuid4(),
        now=now,
        expires_at=now + timedelta(hours=3),
    )

    assert request.mode == "immediate"
    assert request.resource_type == "lxc"
    assert request.cores == 2
    assert request.memory == 3072
    assert request.rootfs_size == 20
    assert request.ostemplate == "local:vztmpl/debian.tar.zst"


def test_qemu_machine_request_uses_environment_template_and_time_limit() -> None:
    now = datetime.now(UTC)
    expires_at = now + timedelta(hours=3)
    node = CourseEnvironmentNode(
        version_id=uuid.uuid4(),
        node_key="windows",
        source_type="custom",
        custom_image_ref="9000",
        custom_username="student",
        name="Windows",
        role="操作主機",
        resource_type="qemu",
        cpu=2,
        memory_mb=4096,
        disk_gb=32,
        sort_order=1,
    )

    request = quick_practice._machine_request(
        session=Mock(),
        node=node,
        environment=_environment(),
        practice_session_id=uuid.uuid4(),
        now=now,
        expires_at=expires_at,
    )

    assert request.resource_type == "vm"
    assert request.template_id == 9000
    assert request.username == "student"
    assert request.disk_size == 32
    assert request.start_at == now
    assert request.end_at == expires_at


def _session_graph(db: Session) -> tuple[QuickPracticeSession, list[VMRequest]]:
    now = datetime.now(UTC)
    teacher = User(
        email=f"teacher-{uuid.uuid4()}@example.edu",
        hashed_password="hash",
        role=UserRole.teacher,
    )
    student = User(
        email=f"student-{uuid.uuid4()}@example.edu",
        hashed_password="hash",
        role=UserRole.student,
    )
    db.add_all([teacher, student])
    db.flush()
    environment = CourseEnvironment(
        owner_id=teacher.id,
        code=f"LAB-{uuid.uuid4().hex[:8]}",
        name="Web 與資料庫",
        usage_scope="quick_practice",
    )
    version = CourseEnvironmentVersion(
        environment_id=environment.id,
        version=1,
        status=CourseEnvironmentVersionStatus.published,
        published_at=now,
    )
    db.add_all([environment, version])
    db.flush()
    nodes = [
        CourseEnvironmentNode(
            version_id=version.id,
            node_key="web",
            source_type="custom",
            custom_image_ref="9000",
            name="Web",
            role="網站",
            resource_type="qemu",
            cpu=1,
            memory_mb=1024,
            disk_gb=10,
            network="lab-net",
            sort_order=0,
        ),
        CourseEnvironmentNode(
            version_id=version.id,
            node_key="db",
            source_type="custom",
            custom_image_ref="9001",
            name="DB",
            role="資料庫",
            resource_type="qemu",
            cpu=1,
            memory_mb=1024,
            disk_gb=10,
            network="lab-net",
            sort_order=1,
        ),
    ]
    edge = CourseEnvironmentEdge(
        version_id=version.id,
        source_node_key="web",
        target_node_key="db",
        direction="one_way",
        protocol="tcp",
        port=3306,
    )
    practice = QuickPracticeSession(
        user_id=student.id,
        environment_version_id=version.id,
        expires_at=now + timedelta(hours=3),
        status="creating",
    )
    db.add_all([*nodes, edge, practice])
    db.flush()
    requests: list[VMRequest] = []
    for index, node in enumerate(nodes):
        request = VMRequest(
            user_id=student.id,
            reason="quick practice",
            resource_type="vm",
            request_kind="quick_template",
            hostname=f"practice-{index}",
            password="encrypted",
            status=VMRequestStatus.approved,
            vmid=9100 + index,
            actual_node="pve1",
            provisioning_status=VMProvisioningStatus.completed,
            created_at=now,
        )
        db.add(request)
        db.flush()
        db.add(
            QuickPracticeSessionMachine(
                session_id=practice.id,
                vm_request_id=request.id,
                node_key=node.node_key,
                name=node.name,
                role=node.role,
                resource_type=node.resource_type,
                sort_order=index,
            )
        )
        db.add(
            IpAllocation(
                ip_address=f"10.20.0.{10 + index}",
                purpose="quick_practice",
                vmid=request.vmid,
            )
        )
        requests.append(request)
    db.commit()
    return practice, requests


def test_reconcile_session_applies_topology_before_ready(
    quick_db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    practice, requests = _session_graph(quick_db)
    calls: list[dict] = []
    from app.services.teaching import class_network_service

    monkeypatch.setattr(
        class_network_service,
        "allow_one_way",
        lambda session, **kwargs: calls.append(kwargs),
    )

    result = quick_practice.reconcile_session(quick_db, practice_id=practice.id)
    quick_db.commit()

    assert result is not None
    assert result.status == "ready"
    assert result.topology_applied_at is not None
    assert result.last_error is None
    assert calls == [
        {
            "scope_id": practice.id,
            "comment_prefix": quick_practice.QUICK_NETWORK_COMMENT_PREFIX,
            "source_vmid": requests[0].vmid,
            "target_vmid": requests[1].vmid,
            "protocol": "tcp",
            "port": 3306,
        }
    ]


def test_reconcile_session_keeps_topology_failure_retryable(
    quick_db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    practice, _requests = _session_graph(quick_db)
    from app.services.teaching import class_network_service

    def fail_topology(*_args, **_kwargs):
        raise RuntimeError("firewall unavailable")

    monkeypatch.setattr(class_network_service, "allow_one_way", fail_topology)

    result = quick_practice.reconcile_session(quick_db, practice_id=practice.id)
    quick_db.commit()

    assert result is not None
    assert result.status == "partial_failed"
    assert result.topology_applied_at is None
    assert "topology failed" in (result.last_error or "")


def test_queue_session_reclaim_uses_idempotent_deletion_queue(
    quick_db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    practice, requests = _session_graph(quick_db)
    now = datetime.now(UTC)
    for request in requests:
        quick_db.add(
            Resource(
                vmid=request.vmid,
                request_id=request.id,
                user_id=request.user_id,
                environment_type="快速練習",
                created_at=now,
            )
        )
    quick_db.commit()

    from app.services.proxmox import proxmox_service
    from app.services.resource import deletion_service

    monkeypatch.setattr(
        deletion_service,
        "list_active_for_vmids",
        lambda **_kwargs: {},
    )
    monkeypatch.setattr(
        proxmox_service,
        "find_resource",
        lambda vmid: {"vmid": vmid, "node": "pve1", "type": "qemu", "name": str(vmid)},
    )
    deletions: list[int] = []

    def create_deletion(**kwargs):
        deletions.append(kwargs["vmid"])
        return SimpleNamespace(id=uuid.uuid4())

    submitted: list[uuid.UUID] = []
    monkeypatch.setattr(deletion_service, "create_deletion_request", create_deletion)
    monkeypatch.setattr(
        quick_practice,
        "submit_sync",
        lambda _fn, request_id, **_kwargs: submitted.append(request_id),
    )

    queued = quick_practice._queue_session_reclaim(quick_db, practice=practice)

    assert queued == 2
    assert sorted(deletions) == sorted(request.vmid for request in requests)
    assert len(submitted) == 2
    quick_db.refresh(practice)
    assert practice.status == "reclaiming"
    assert practice.reclaim_started_at is not None


def test_failed_session_reclaim_preserves_error_for_quota_accounting(
    quick_db: Session,
) -> None:
    practice, _requests = _session_graph(quick_db)
    practice.status = "partial_failed"
    practice.last_error = "機器建立失敗：DB"
    quick_db.add(practice)
    quick_db.commit()

    queued = quick_practice._queue_session_reclaim(
        quick_db,
        practice=practice,
    )

    assert queued == 0
    quick_db.refresh(practice)
    assert practice.status == "reclaimed"
    assert practice.reclaimed_at is not None
    assert practice.last_error == "機器建立失敗：DB"


def test_quick_practice_ip_reservation_is_atomic_and_idempotent(
    quick_db: Session,
) -> None:
    quick_db.add(
        SubnetConfig(
            id=1,
            cidr="10.30.0.0/29",
            gateway="10.30.0.1",
            bridge_name="vmbr0",
            gateway_vm_ip="10.30.0.2",
        )
    )
    quick_db.add_all(
        [
            IpAllocation(
                ip_address="10.30.0.1",
                purpose="subnet_gateway",
            ),
            IpAllocation(
                ip_address="10.30.0.2",
                purpose="gateway_vm",
            ),
        ]
    )
    quick_db.commit()
    practice_id = uuid.uuid4()
    keys = [
        quick_practice._ip_reservation_key(practice_id, "web"),
        quick_practice._ip_reservation_key(practice_id, "db"),
    ]

    first = ip_management_service.reserve_ips(
        quick_db,
        teaching_class_id=None,
        reservation_keys=keys,
    )
    second = ip_management_service.reserve_ips(
        quick_db,
        teaching_class_id=None,
        reservation_keys=keys,
    )
    quick_db.commit()

    assert first == second
    assert set(first) == set(keys)
    assert len(set(first.values())) == 2
    released = ip_management_service.release_reservations_by_prefix(
        quick_db,
        quick_practice._ip_reservation_prefix(practice_id),
    )
    assert released == 2
