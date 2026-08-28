import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import Mock

from app.models import CourseEnvironment, CourseEnvironmentNode
from app.services import quick_practice


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
