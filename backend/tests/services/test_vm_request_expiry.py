"""VM 申請逾時自動過期的測試。

過期規則：status == pending AND end_at IS NOT NULL AND end_at <= now。
過期只改 status，不碰任何審核欄位。
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Any

import pytest
from sqlmodel import Session, select

from app.core.config import settings
from app.models import (
    AuditAction,
    User,
    VMProvisioningStatus,
    VMRequest,
    VMRequestStatus,
)
from app.repositories import vm_request as vm_request_repo
from app.services.scheduling import coordinator
from app.services.user import audit_service
from app.services.vm import vm_request_expiry_service


def _db_fixture_available() -> bool:
    """conftest 的 db fixture 會拒絕非測試資料庫（保護共用開發庫）。

    重用它自己的判斷而非複製一份條件，避免兩邊漂移。條件不滿足時整組
    DB 測試 skip；設好測試庫後會自動開始跑。
    """
    from tests.conftest import _assert_safe_pytest_database_target

    try:
        _assert_safe_pytest_database_target()
    except RuntimeError:
        return False
    return True


requires_test_db = pytest.mark.skipif(
    not _db_fixture_available(),
    reason=(
        "需要測試用資料庫（localhost 且 DB 名含 test/pytest/ci），"
        "見 tests/conftest.py 的 _assert_safe_pytest_database_target"
    ),
)


def test_expired_status_exists() -> None:
    assert VMRequestStatus.expired.value == "expired"


def test_expired_audit_action_exists_and_is_categorised() -> None:
    assert AuditAction.vm_request_expired.value == "vm_request_expired"
    # 漏掉分類會讓後台稽核頁的下拉分組落到 "other"。
    assert audit_service.ACTION_CATEGORY[AuditAction.vm_request_expired] == "request"


NOW = datetime(2026, 8, 3, 12, 0, tzinfo=timezone.utc)


def _superuser_id(db: Session) -> uuid.UUID:
    """conftest 的 _seed_first_superuser fixture 保證這個帳號存在。"""
    user = db.exec(select(User).where(User.email == settings.FIRST_SUPERUSER)).one()
    return user.id


def _make_row(
    user_id: uuid.UUID,
    *,
    status: VMRequestStatus,
    end_at: datetime | None,
) -> VMRequest:
    return VMRequest(
        user_id=user_id,
        reason="expiry boundary test",
        resource_type="lxc",
        hostname=f"expiry-{uuid.uuid4().hex[:8]}",
        password="encrypted-placeholder",
        status=status,
        provisioning_status=VMProvisioningStatus.idle,
        start_at=NOW - timedelta(days=2),
        end_at=end_at,
        created_at=NOW - timedelta(days=3),
    )


@requires_test_db
def test_only_pending_requests_past_end_at_are_selected(db: Session) -> None:
    user_id = _superuser_id(db)
    expired = _make_row(
        user_id, status=VMRequestStatus.pending, end_at=NOW - timedelta(hours=1)
    )
    open_ended = _make_row(user_id, status=VMRequestStatus.pending, end_at=None)
    future = _make_row(
        user_id, status=VMRequestStatus.pending, end_at=NOW + timedelta(hours=1)
    )
    approved = _make_row(
        user_id, status=VMRequestStatus.approved, end_at=NOW - timedelta(hours=1)
    )

    try:
        db.add_all([expired, open_ended, future, approved])
        db.flush()

        picked = vm_request_repo.list_expired_pending_vm_requests(
            session=db, at_time=NOW, limit=1000
        )
        picked_ids = {row.id for row in picked}

        assert expired.id in picked_ids
        # end_at 為 null = immediate 模式的無限期申請，永不過期
        assert open_ended.id not in picked_ids
        # 時段還沒結束，還能正常審核
        assert future.id not in picked_ids
        # approved 由 process_due_request_stops 管，動它會讓機器變孤兒
        assert approved.id not in picked_ids
    finally:
        db.rollback()


@requires_test_db
def test_mark_vm_request_expired_leaves_review_fields_untouched(db: Session) -> None:
    user_id = _superuser_id(db)
    row = _make_row(
        user_id, status=VMRequestStatus.pending, end_at=NOW - timedelta(hours=1)
    )

    try:
        db.add(row)
        db.flush()

        vm_request_repo.mark_vm_request_expired(
            session=db, db_request=row, commit=False
        )

        assert row.status == VMRequestStatus.expired
        assert row.reviewer_id is None
        assert row.reviewed_at is None
        assert row.review_comment is None
    finally:
        db.rollback()


class _FakeSession:
    """站在 `with Session(engine) as session:` 位置的替身。"""

    def __init__(self) -> None:
        self.committed = False
        self.rolled_back = False

    def __enter__(self) -> _FakeSession:
        return self

    def __exit__(self, *exc: Any) -> bool:
        return False

    def commit(self) -> None:
        self.committed = True

    def rollback(self) -> None:
        self.rolled_back = True


def test_process_expired_requests_marks_and_audits_each_row(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    req_a = SimpleNamespace(id=uuid.uuid4(), end_at=NOW - timedelta(hours=1))
    req_b = SimpleNamespace(id=uuid.uuid4(), end_at=NOW - timedelta(days=1))
    fake_session = _FakeSession()
    monkeypatch.setattr(
        vm_request_expiry_service, "Session", lambda _engine: fake_session
    )

    marked: list[Any] = []
    monkeypatch.setattr(
        vm_request_expiry_service,
        "vm_request_repo",
        SimpleNamespace(
            list_expired_pending_vm_requests=lambda **kw: [req_a, req_b],
            mark_vm_request_expired=lambda **kw: marked.append(kw["db_request"]),
        ),
    )

    audited: list[dict[str, Any]] = []
    monkeypatch.setattr(
        vm_request_expiry_service,
        "audit_service",
        SimpleNamespace(log_action=lambda **kw: audited.append(kw)),
    )

    count = vm_request_expiry_service.process_expired_requests()

    assert count == 2
    assert marked == [req_a, req_b]
    assert [entry["action"] for entry in audited] == [
        AuditAction.vm_request_expired,
        AuditAction.vm_request_expired,
    ]
    # 系統動作，沒有操作者
    assert all(entry["user_id"] is None for entry in audited)
    # 整批一次 commit，避免中途釋放 FOR UPDATE 鎖
    assert fake_session.committed
    assert not fake_session.rolled_back


def test_process_expired_requests_is_noop_when_nothing_due(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_session = _FakeSession()
    monkeypatch.setattr(
        vm_request_expiry_service, "Session", lambda _engine: fake_session
    )
    monkeypatch.setattr(
        vm_request_expiry_service,
        "vm_request_repo",
        SimpleNamespace(list_expired_pending_vm_requests=lambda **kw: []),
    )

    assert vm_request_expiry_service.process_expired_requests() == 0
    assert not fake_session.committed


def test_process_expired_requests_rolls_back_on_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    req = SimpleNamespace(id=uuid.uuid4(), end_at=NOW - timedelta(hours=1))
    fake_session = _FakeSession()
    monkeypatch.setattr(
        vm_request_expiry_service, "Session", lambda _engine: fake_session
    )

    def _boom(**kw: Any) -> None:
        raise RuntimeError("db is on fire")

    monkeypatch.setattr(
        vm_request_expiry_service,
        "vm_request_repo",
        SimpleNamespace(
            list_expired_pending_vm_requests=lambda **kw: [req],
            mark_vm_request_expired=_boom,
        ),
    )
    monkeypatch.setattr(
        vm_request_expiry_service,
        "audit_service",
        SimpleNamespace(log_action=lambda **kw: None),
    )

    # tick 不該把例外往上拋，否則整個 scheduler 迴圈會被打斷
    assert vm_request_expiry_service.process_expired_requests() == 0
    assert fake_session.rolled_back
    assert not fake_session.committed


def test_coordinator_task_delegates_to_expiry_service(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[bool] = []
    monkeypatch.setattr(
        vm_request_expiry_service,
        "process_expired_requests",
        lambda: calls.append(True) or 3,
    )

    assert coordinator.process_expired_requests_task() == 3
    assert calls == [True]
