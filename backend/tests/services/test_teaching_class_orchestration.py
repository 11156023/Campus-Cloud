import uuid
from datetime import date, time
from types import SimpleNamespace

import pytest

from app.api.routes.teaching_classes import _recurrence
from app.exceptions import BadRequestError
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
