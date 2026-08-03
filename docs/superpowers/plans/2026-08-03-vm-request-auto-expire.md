# VM 申請逾時自動過期 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 排程器自動把「使用時段已結束卻仍停在 pending」的 VM 申請標為新的 `expired` 狀態，讓永遠卡住的申請不再假裝自己在審核中。

**Architecture:** 兩個 PostgreSQL enum 擴充（`vmrequeststatus.expired`、`auditaction.vm_request_expired`）→ repository 加查詢與標記函式 → 獨立的 `vm_request_expiry_service` 做協調 → 掛進既有的 `run_scheduler` tick 清單 → 前端補狀態標籤。

**Tech Stack:** FastAPI / SQLModel / Alembic / PostgreSQL / pytest（backend）；React 19 + SCSS Modules（frontend）。

**Spec:** `docs/superpowers/specs/2026-08-03-vm-request-auto-expire-design.md`

## Global Constraints

- 過期規則（唯一真相，任何地方都不得改寫）：`status == pending AND end_at IS NOT NULL AND end_at <= now`。
- 過期時**只改 `status`**。`reviewer_id`、`reviewed_at`、`review_comment` 一律保持不動（維持 null）—— 沒人審核過它，不得偽造審核痕跡。
- `end_at IS NULL`（immediate 模式的無限期申請）永不過期。
- `approved` / `rejected` / `cancelled` 一律不動。
- 不寄信、不加治理設定開關、不做歷史資料 backfill。
- 遵守 CLAUDE.md：業務規則放 `services/`，DB 查詢放 `repositories/`，route 不變（本功能不新增 API）。
- 後端 lint：`uv run ruff check .` 與 `uv run mypy .` 必須通過。函式內 import 一律加 `# noqa: PLC0415` 註明避免 import cycle。
- 所有新測試放 `backend/tests/services/test_vm_request_expiry.py`（單一檔案，逐 Task 累加）。
- 專案指令一律在 `backend/` 目錄下執行。

## File Structure

| 檔案 | 責任 | 動作 |
|---|---|---|
| `backend/app/models/vm_request.py` | 申請狀態 enum | 修改 |
| `backend/app/models/audit_log.py` | 稽核動作 enum | 修改 |
| `backend/app/services/user/audit_service.py` | 稽核動作 → UI 分類 | 修改 |
| `backend/app/alembic/versions/vmexp01_add_expired_status_and_audit_action.py` | 兩個 enum 的 DB 擴充 | 建立 |
| `backend/app/repositories/vm_request.py` | 過期查詢 + 標記（SQL 是規則的唯一真相） | 修改 |
| `backend/app/services/vm/vm_request_expiry_service.py` | 過期協調流程（查 → 標記 → 稽核 → commit） | 建立 |
| `backend/app/services/vm/__init__.py` | 延遲 import 註冊表 | 修改 |
| `backend/app/services/scheduling/coordinator.py` | scheduler tick 掛載點 | 修改 |
| `backend/app/services/jobs/jobs_service.py` | 申請狀態 → 工作狀態對應 | 修改 |
| `backend/tests/services/test_vm_request_expiry.py` | 全部新測試 | 建立 |
| `frontend/src/pages/personal/requests/RequestsPage.jsx` | 個人申請頁狀態標籤 | 修改 |
| `frontend/src/pages/resource/request-review/RequestReviewPage.jsx` | 審核頁狀態標籤 | 修改 |

---

### Task 1: 兩個 enum 擴充與 migration

讓資料庫與模型能表達 `expired` 狀態與 `vm_request_expired` 稽核動作。這是所有後續 Task 的前提。

**Files:**
- Modify: `backend/app/models/vm_request.py:16-25`
- Modify: `backend/app/models/audit_log.py:43-48`
- Modify: `backend/app/services/user/audit_service.py:46-51`
- Create: `backend/app/alembic/versions/vmexp01_add_expired_status_and_audit_action.py`
- Test: `backend/tests/services/test_vm_request_expiry.py`

**Interfaces:**
- Consumes: 無（第一個 Task）。
- Produces:
  - `app.models.VMRequestStatus.expired`（值 `"expired"`）
  - `app.models.AuditAction.vm_request_expired`（值 `"vm_request_expired"`）
  - Alembic revision id `"vmexp01_expired"`，`down_revision = "qc01_quota_config"`

- [ ] **Step 1: 寫失敗測試**

建立 `backend/tests/services/test_vm_request_expiry.py`：

```python
"""VM 申請逾時自動過期的測試。

過期規則：status == pending AND end_at IS NOT NULL AND end_at <= now。
過期只改 status，不碰任何審核欄位。
"""

from __future__ import annotations

from app.models import AuditAction, VMRequestStatus
from app.services.user import audit_service


def test_expired_status_exists() -> None:
    assert VMRequestStatus.expired.value == "expired"


def test_expired_audit_action_exists_and_is_categorised() -> None:
    assert AuditAction.vm_request_expired.value == "vm_request_expired"
    # 漏掉分類會讓後台稽核頁的下拉分組落到 "other"。
    assert audit_service.ACTION_CATEGORY[AuditAction.vm_request_expired] == "request"
```

> **關於 import**：ruff 有啟用 isort（`select` 含 `"I"`，且 `tests/*` 的 per-file-ignores 不含 `I001`），所以測試 import 一律集中在檔頭單一區塊並保持排序。後續每個 Task 的 Step 1 都會給出「該時間點的完整 import 區塊」，照抄取代舊的即可 —— 不要在檔案中段散落 import。

- [ ] **Step 2: 執行測試確認失敗**

```bash
cd backend && uv run pytest tests/services/test_vm_request_expiry.py -v
```

Expected: 兩個測試都 FAIL，錯誤為 `AttributeError: expired` 與 `AttributeError: vm_request_expired`。

- [ ] **Step 3: 加 `VMRequestStatus.expired`**

`backend/app/models/vm_request.py` 的 `VMRequestStatus`（第 16 行起）改成：

```python
class VMRequestStatus(str, enum.Enum):
    """Review lifecycle for a VM/LXC request.

    Runtime resource state belongs to ResourcePublic.status, not here.
    """

    pending = "pending"
    approved = "approved"
    rejected = "rejected"
    cancelled = "cancelled"
    # 使用時段已結束卻始終沒被審核 —— 由 scheduler 自動標記，非人為決定。
    expired = "expired"
```

- [ ] **Step 4: 加 `AuditAction.vm_request_expired`**

`backend/app/models/audit_log.py` 的「# VM 申請」區塊（第 43 行起）改成：

```python
    # VM 申請
    vm_request_submit = "vm_request_submit"
    vm_request_submit_auto_approved = "vm_request_submit_auto_approved"
    vm_request_review = "vm_request_review"
    vm_request_expired = "vm_request_expired"
    ai_api_request_submit = "ai_api_request_submit"
    ai_api_request_review = "ai_api_request_review"
```

- [ ] **Step 5: 加 ACTION_CATEGORY 分類**

`backend/app/services/user/audit_service.py` 的「# 申請」區塊（第 46 行起）改成：

```python
    # 申請
    AuditAction.vm_request_submit: "request",
    AuditAction.vm_request_submit_auto_approved: "request",
    AuditAction.vm_request_review: "request",
    AuditAction.vm_request_expired: "request",
    AuditAction.ai_api_request_submit: "request",
    AuditAction.ai_api_request_review: "request",
```

- [ ] **Step 6: 建立 migration**

建立 `backend/app/alembic/versions/vmexp01_add_expired_status_and_audit_action.py`：

```python
"""add expired to vmrequeststatus and vm_request_expired to auditaction

Revision ID: vmexp01_expired
Revises: qc01_quota_config
Create Date: 2026-08-03 00:00:00.000000

"""

from alembic import op

revision = "vmexp01_expired"
down_revision = "qc01_quota_config"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    op.execute(
        "ALTER TYPE vmrequeststatus ADD VALUE IF NOT EXISTS 'expired' AFTER 'cancelled'"
    )
    op.execute("ALTER TYPE auditaction ADD VALUE IF NOT EXISTS 'vm_request_expired'")


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    # PostgreSQL 無法移除 enum 值；把資料映回 rejected 即可。
    op.execute("UPDATE vm_requests SET status = 'rejected' WHERE status = 'expired'")
```

- [ ] **Step 7: 執行測試確認通過**

```bash
cd backend && uv run pytest tests/services/test_vm_request_expiry.py -v
```

Expected: 2 passed。

- [ ] **Step 8: 套用 migration 並確認 head 唯一**

```bash
docker compose exec backend alembic upgrade head
```

Expected: 輸出含 `Running upgrade qc01_quota_config -> vmexp01_expired`。

```bash
docker compose exec backend alembic heads
```

Expected: 只列出一行 `vmexp01_expired (head)`。若列出多行代表分岔，需要 merge migration。

- [ ] **Step 9: Lint**

```bash
cd backend && uv run ruff check . && uv run mypy .
```

Expected: 兩者皆無錯誤。

- [ ] **Step 10: Commit**

```bash
git add backend/app/models/vm_request.py backend/app/models/audit_log.py backend/app/services/user/audit_service.py backend/app/alembic/versions/vmexp01_add_expired_status_and_audit_action.py backend/tests/services/test_vm_request_expiry.py
git commit -m "feat(vm-request): 新增 expired 狀態與 vm_request_expired 稽核動作"
```

---

### Task 2: Repository 查詢與標記

把過期規則實作成 SQL WHERE 條件（唯一真相），並提供不碰審核欄位的標記函式。

**Files:**
- Modify: `backend/app/repositories/vm_request.py`（檔尾追加）
- Test: `backend/tests/services/test_vm_request_expiry.py`（追加）

**Interfaces:**
- Consumes: Task 1 的 `VMRequestStatus.expired`
- Produces:
  ```python
  def list_expired_pending_vm_requests(
      *, session: Session, at_time: datetime, limit: int = 100,
  ) -> list[VMRequest]: ...

  def mark_vm_request_expired(
      *, session: Session, db_request: VMRequest, commit: bool = True,
  ) -> VMRequest: ...
  ```

- [ ] **Step 1: 寫失敗測試**

先把 `backend/tests/services/test_vm_request_expiry.py` 的 import 區塊**整段取代**成：

```python
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

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
from app.services.user import audit_service
```

然後在**檔尾追加**（Task 1 的兩個測試保持原位不動）：

```python
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
```

- [ ] **Step 2: 執行測試確認失敗**

```bash
cd backend && uv run pytest tests/services/test_vm_request_expiry.py -v
```

Expected: 兩個新測試 FAIL，錯誤為 `AttributeError: module 'app.repositories.vm_request' has no attribute 'list_expired_pending_vm_requests'`。Task 1 的兩個測試仍 PASS。

> 這兩個測試需要真實 PostgreSQL（宣告了 `db` fixture）。若本機沒有測試資料庫，改在容器內跑：
> ```bash
> docker compose exec backend uv run pytest tests/services/test_vm_request_expiry.py -v
> ```

- [ ] **Step 3: 實作兩個 repository 函式**

在 `backend/app/repositories/vm_request.py` **檔尾追加**：

```python
def list_expired_pending_vm_requests(
    *,
    session: Session,
    at_time: datetime,
    limit: int = 100,
) -> list[VMRequest]:
    """Pending requests whose usage window has already ended.

    ``end_at IS NULL`` means an open-ended (immediate-mode) request, which
    never expires. Rows are locked with SKIP LOCKED so concurrent scheduler
    ticks pick disjoint batches instead of blocking on each other.
    """
    statement = (
        select(VMRequest)
        .where(
            VMRequest.status == VMRequestStatus.pending,
            VMRequest.end_at.is_not(None),
            VMRequest.end_at <= at_time,
        )
        .order_by(VMRequest.end_at.asc())  # type: ignore[union-attr]
        .limit(limit)
        .with_for_update(skip_locked=True)
    )
    return list(session.exec(statement).all())


def mark_vm_request_expired(
    *,
    session: Session,
    db_request: VMRequest,
    commit: bool = True,
) -> VMRequest:
    """Mark a request expired without touching any review field.

    ``reviewer_id`` / ``reviewed_at`` / ``review_comment`` are deliberately
    left alone: nobody reviewed this request, so no review trace should be
    fabricated. This is why ``update_vm_request_status`` cannot be reused —
    it requires a ``reviewer_id`` and always overwrites ``reviewed_at``.
    """
    db_request.status = VMRequestStatus.expired
    session.add(db_request)
    if commit:
        session.commit()
    else:
        session.flush()
    session.refresh(db_request)
    return db_request
```

- [ ] **Step 4: 執行測試確認通過**

```bash
cd backend && uv run pytest tests/services/test_vm_request_expiry.py -v
```

Expected: 4 passed。

- [ ] **Step 5: Lint**

```bash
cd backend && uv run ruff check . && uv run mypy .
```

Expected: 兩者皆無錯誤。

- [ ] **Step 6: Commit**

```bash
git add backend/app/repositories/vm_request.py backend/tests/services/test_vm_request_expiry.py
git commit -m "feat(vm-request): 加逾時申請查詢與過期標記的 repository 函式"
```

---

### Task 3: 過期協調 service

**Files:**
- Create: `backend/app/services/vm/vm_request_expiry_service.py`
- Modify: `backend/app/services/vm/__init__.py:9-25`
- Test: `backend/tests/services/test_vm_request_expiry.py`（追加）

**Interfaces:**
- Consumes: Task 2 的 `list_expired_pending_vm_requests` / `mark_vm_request_expired`；Task 1 的 `AuditAction.vm_request_expired`
- Produces:
  ```python
  # app.services.vm.vm_request_expiry_service
  EXPIRY_BATCH_SIZE: int          # = 100
  def process_expired_requests() -> int: ...   # 回傳本次過期的筆數
  ```

- [ ] **Step 1: 寫失敗測試**

先把 import 區塊**整段取代**成（新增 `SimpleNamespace` / `Any` / `pytest` / 待建的 service 模組）：

```python
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
from app.services.user import audit_service
from app.services.vm import vm_request_expiry_service
```

然後在**檔尾追加**：

```python
class _FakeSession:
    """站在 `with Session(engine) as session:` 位置的替身。"""

    def __init__(self) -> None:
        self.committed = False
        self.rolled_back = False

    def __enter__(self) -> "_FakeSession":
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
```

- [ ] **Step 2: 執行測試確認失敗**

```bash
cd backend && uv run pytest tests/services/test_vm_request_expiry.py -v
```

Expected: 整個檔案在 collection 階段就失敗（檔頭 import 了還不存在的模組），錯誤為 `ImportError: cannot import name 'vm_request_expiry_service' from 'app.services.vm'`。

- [ ] **Step 3: 建立 service 模組**

建立 `backend/app/services/vm/vm_request_expiry_service.py`：

```python
"""申請逾時自動過期。

``vm_request_service.review()`` 早已擋掉「end_at 已過不得核准」，卻沒有任何
機制清理這些申請，於是它們永遠停在 pending：管理員看得到卻核准不了，使用者
看到的「審核中」也是假的。本模組由 scheduler 每個 tick 呼叫，把它們標為
``expired``。

只動 pending —— ``approved`` 的申請由 ``coordinator.process_due_request_stops``
負責到期關機，改它的狀態會讓已開通的機器脫離排程管理變成孤兒。
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from sqlmodel import Session

from app.core.db import engine
from app.models import AuditAction
from app.repositories import vm_request as vm_request_repo
from app.services.user import audit_service

logger = logging.getLogger(__name__)

# 單一 tick 最多處理的筆數，避免長交易佔住 scheduler。
EXPIRY_BATCH_SIZE = 100


def _utc_now() -> datetime:
    return datetime.now(UTC)


def process_expired_requests() -> int:
    """把已過使用時段的 pending 申請標為 expired，回傳處理筆數。"""
    now = _utc_now()

    with Session(engine) as session:
        due = vm_request_repo.list_expired_pending_vm_requests(
            session=session,
            at_time=now,
            limit=EXPIRY_BATCH_SIZE,
        )
        if not due:
            return 0

        # commit 後 ORM 物件會被 expire，屆時讀 id 會觸發額外查詢；先取好。
        expired_ids = [request.id for request in due]

        try:
            for request in due:
                vm_request_repo.mark_vm_request_expired(
                    session=session,
                    db_request=request,
                    commit=False,
                )
                audit_service.log_action(
                    session=session,
                    user_id=None,
                    action=AuditAction.vm_request_expired,
                    details=(
                        f"Auto-expired VM request {request.id}: "
                        f"usage window ended at {request.end_at}"
                    ),
                    commit=False,
                )
            # 整批一次 commit：這裡沒有外部 I/O，逐筆 commit 反而會在第一次
            # commit 後釋放 FOR UPDATE 鎖，讓剩下的列失去併發保護。
            session.commit()
        except Exception:
            session.rollback()
            logger.exception("Failed to expire %d VM request(s)", len(expired_ids))
            return 0

    logger.info(
        "Auto-expired %d VM request(s): %s", len(expired_ids), expired_ids
    )
    return len(expired_ids)
```

- [ ] **Step 4: 註冊到延遲 import 表**

`backend/app/services/vm/__init__.py` 的 `__all__` 與 `_MODULES` 各加一筆（維持字母序）：

```python
__all__ = [
    "batch_provision_service",
    "spec_change_service",
    "vm_request_availability_service",
    "vm_request_expiry_service",
    "vm_request_placement_service",
    "vm_request_service",
    "workload_advisor",
]

_MODULES = {
    "batch_provision_service": "app.services.vm.batch_provision_service",
    "spec_change_service": "app.services.vm.spec_change_service",
    "vm_request_availability_service": "app.services.vm.vm_request_availability_service",
    "vm_request_expiry_service": "app.services.vm.vm_request_expiry_service",
    "vm_request_placement_service": "app.services.vm.placement_service",
    "vm_request_service": "app.services.vm.vm_request_service",
    "workload_advisor": "app.services.vm.workload_advisor",
}
```

- [ ] **Step 5: 執行測試確認通過**

```bash
cd backend && uv run pytest tests/services/test_vm_request_expiry.py -v
```

Expected: 7 passed。

- [ ] **Step 6: Lint**

```bash
cd backend && uv run ruff check . && uv run mypy .
```

Expected: 兩者皆無錯誤。

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/vm/vm_request_expiry_service.py backend/app/services/vm/__init__.py backend/tests/services/test_vm_request_expiry.py
git commit -m "feat(vm-request): 加逾時申請自動過期的協調 service"
```

---

### Task 4: 掛上 scheduler tick

**Files:**
- Modify: `backend/app/services/scheduling/coordinator.py:953-996`（`run_scheduler` 的 tasks 清單）與檔尾（新 wrapper）
- Test: `backend/tests/services/test_vm_request_expiry.py`（追加）

**Interfaces:**
- Consumes: Task 3 的 `vm_request_expiry_service.process_expired_requests`
- Produces:
  ```python
  # app.services.scheduling.coordinator
  def process_expired_requests_task() -> int: ...
  ```
  並在 `run_scheduler` 註冊 `ScheduledTask(name="process_expired_requests", ...)`

- [ ] **Step 1: 寫失敗測試**

先在 import 區塊的 `from app.services.user import audit_service` **之前**插入一行（維持排序）：

```python
from app.services.scheduling import coordinator
```

然後在**檔尾追加**：

```python
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
```

- [ ] **Step 2: 執行測試確認失敗**

```bash
cd backend && uv run pytest tests/services/test_vm_request_expiry.py::test_coordinator_task_delegates_to_expiry_service -v
```

Expected: FAIL，錯誤為 `AttributeError: module 'app.services.scheduling.coordinator' has no attribute 'process_expired_requests_task'`。

- [ ] **Step 3: 加 coordinator wrapper**

在 `backend/app/services/scheduling/coordinator.py` 的 `process_resource_alerts_task` 定義**之前**（也就是 `run_scheduler` 結束後的第一個 task wrapper 位置）插入：

```python
def process_expired_requests_task() -> int:
    """Scheduler tick：已過使用時段仍未審核的申請自動過期。"""
    from app.services.vm import (
        vm_request_expiry_service,  # noqa: PLC0415 — 避免 import cycle
    )

    return vm_request_expiry_service.process_expired_requests()
```

- [ ] **Step 4: 註冊 ScheduledTask**

在 `run_scheduler` 的 `tasks=[...]` 清單中，緊接在 `process_due_request_stops` 之後插入：

```python
            ScheduledTask(
                name="process_expired_requests",
                handler=process_expired_requests_task,
            ),
```

插入後該段應長這樣：

```python
            ScheduledTask(name="process_due_request_starts", handler=process_due_request_starts),
            ScheduledTask(name="process_due_request_stops", handler=process_due_request_stops),
            ScheduledTask(
                name="process_expired_requests",
                handler=process_expired_requests_task,
            ),
            ScheduledTask(name="process_pending_deletions", handler=process_pending_deletions_task),
```

- [ ] **Step 5: 執行測試確認通過**

```bash
cd backend && uv run pytest tests/services/test_vm_request_expiry.py -v
```

Expected: 8 passed。

- [ ] **Step 6: Lint**

```bash
cd backend && uv run ruff check . && uv run mypy .
```

Expected: 兩者皆無錯誤。

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/scheduling/coordinator.py backend/tests/services/test_vm_request_expiry.py
git commit -m "feat(scheduler): 把申請逾時過期掛進 run_scheduler tick"
```

---

### Task 5: 工作頁狀態對應

`_VM_REQUEST_STATUS_MAP` 用 `.get(req.status, JobStatus.pending)` 查表，缺鍵不會拋錯而是**靜默把過期申請顯示成「等待中」**。補上對應，並加一個涵蓋性測試防止日後再漏。

**Files:**
- Modify: `backend/app/services/jobs/jobs_service.py:51-56`
- Test: `backend/tests/services/test_vm_request_expiry.py`（追加）

**Interfaces:**
- Consumes: Task 1 的 `VMRequestStatus.expired`
- Produces: 無新公開介面（僅補既有查表）

- [ ] **Step 1: 寫失敗測試**

先把 import 區塊**整段取代**成（`JobStatus` 定義在 `app.schemas.jobs`，不在 `app.models`）：

```python
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
from app.schemas.jobs import JobStatus
from app.services.jobs import jobs_service
from app.services.scheduling import coordinator
from app.services.user import audit_service
from app.services.vm import vm_request_expiry_service
```

然後在**檔尾追加**：

```python
def test_every_vm_request_status_maps_to_a_job_status() -> None:
    """查表用 .get() 帶預設值，缺鍵會靜默顯示成「等待中」而不是報錯。"""
    missing = [
        status.value
        for status in VMRequestStatus
        if status not in jobs_service._VM_REQUEST_STATUS_MAP
    ]
    assert missing == []


def test_expired_request_maps_to_cancelled_job() -> None:
    # 什麼都沒失敗，申請只是失效了 —— 語意上貼近 cancelled 而非 failed。
    assert (
        jobs_service._VM_REQUEST_STATUS_MAP[VMRequestStatus.expired]
        == JobStatus.cancelled
    )
```

- [ ] **Step 2: 執行測試確認失敗**

```bash
cd backend && uv run pytest tests/services/test_vm_request_expiry.py -k "job_status or cancelled_job" -v
```

Expected: 兩個測試 FAIL —— 第一個 `assert ['expired'] == []`，第二個 `KeyError: <VMRequestStatus.expired>`。

- [ ] **Step 3: 補上對應**

`backend/app/services/jobs/jobs_service.py` 第 51 行的 `_VM_REQUEST_STATUS_MAP` 改成：

```python
_VM_REQUEST_STATUS_MAP: dict[VMRequestStatus, JobStatus] = {
    VMRequestStatus.pending: JobStatus.pending,
    VMRequestStatus.approved: JobStatus.pending,        # 已核准、等待派發
    VMRequestStatus.rejected: JobStatus.failed,
    VMRequestStatus.cancelled: JobStatus.cancelled,
    VMRequestStatus.expired: JobStatus.cancelled,       # 時段過完沒人審，失效
}
```

- [ ] **Step 4: 執行測試確認通過**

```bash
cd backend && uv run pytest tests/services/test_vm_request_expiry.py -v
```

Expected: 10 passed。

- [ ] **Step 5: 跑完整後端測試確認沒有回歸**

```bash
cd backend && uv run pytest tests/ -q
```

Expected: 無新增的 failure。（既有的 failure 若在動工前就存在，記錄下來但不在本 Task 處理。）

- [ ] **Step 6: Lint**

```bash
cd backend && uv run ruff check . && uv run mypy .
```

Expected: 兩者皆無錯誤。

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/jobs/jobs_service.py backend/tests/services/test_vm_request_expiry.py
git commit -m "fix(jobs): 過期申請不再靜默顯示成等待中"
```

---

### Task 6: 前端狀態標籤

沒有這一步，過期申請在兩個頁面都會顯示成原始英文字串 `expired`（兩處都有 `?? { label: status }` 的 fallback）。

**Files:**
- Modify: `frontend/src/pages/personal/requests/RequestsPage.jsx:11-16`
- Modify: `frontend/src/pages/resource/request-review/RequestReviewPage.jsx:20-25`

**Interfaces:**
- Consumes: 後端 `VMRequestPublic.status` 現在可能回傳 `"expired"`
- Produces: 無

- [ ] **Step 1: 個人申請頁加狀態標籤**

`frontend/src/pages/personal/requests/RequestsPage.jsx` 第 11 行的 `STATUS_MAP` 改成：

```js
const STATUS_MAP = {
  pending:   { label: "審核中", color: "info"    },
  approved:  { label: "已核准", color: "success" },
  rejected:  { label: "已拒絕", color: "danger"  },
  cancelled: { label: "已取消", color: "muted"   },
  expired:   { label: "已過期", color: "muted"   },
};
```

**不要**動 `showRejection`（第 176 行）的條件 —— 過期不寫 `review_comment`，維持只在 `rejected` 時顯示。

- [ ] **Step 2: 審核頁加狀態標籤**

`frontend/src/pages/resource/request-review/RequestReviewPage.jsx` 第 20 行的 `STATUS_META` 加一筆：

```js
const STATUS_META = {
  pending: { label: "待審核", tone: "info" },
  approved: { label: "已通過", tone: "success" },
  rejected: { label: "已拒絕", tone: "danger" },
  cancelled: { label: "已取消", tone: "muted" },
  expired: { label: "已過期", tone: "muted" },
```

**不要**把 `expired` 加進 `normalizeVmRequest` 第 114 行的 `["pending", "approved", "rejected"]` 白名單 —— 過期申請應該落入 `reviewStatus: "other"`，自動從三個審核分頁消失，與 `cancelled` 現行行為一致。

- [ ] **Step 3: 確認前端測試與建置通過**

```bash
cd frontend && bun run test
```

Expected: 全數通過（services 層測試不受本次改動影響）。

```bash
cd frontend && bun run build
```

Expected: build 成功，無錯誤。

- [ ] **Step 4: 人工驗證**

```bash
docker compose watch
```

挑一筆 pending 申請，把它的 `end_at` 改成過去時間：

```bash
docker compose exec db psql -U postgres -d app -c "UPDATE vm_requests SET end_at = now() - interval '1 hour' WHERE id = (SELECT id FROM vm_requests WHERE status = 'pending' LIMIT 1);"
```

> 資料庫名稱與帳號以專案 `.env` 的 `POSTGRES_DB` / `POSTGRES_USER` 為準。若不確定，可改用 Adminer（`http://localhost:8080`）手動修改。

等一個 scheduler tick（`SCHEDULER_POLL_SECONDS = 60`，最多一分鐘）後確認：

1. 「個人 → 我的申請」該筆顯示灰色「已過期」標籤，不顯示任何拒絕理由。
2. 「資源 → 申請審核」三個分頁都看不到它，待審核計數減一。
3. 「系統 → 工作」該筆顯示為已取消，不是「等待中」。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/personal/requests/RequestsPage.jsx frontend/src/pages/resource/request-review/RequestReviewPage.jsx
git commit -m "feat(frontend): 申請列表與審核頁顯示已過期狀態"
```

---

## 完成後檢查

- [ ] `cd backend && uv run pytest tests/ -q` 無新增 failure
- [ ] `cd backend && uv run ruff check . && uv run mypy .` 通過
- [ ] `cd frontend && bun run test && bun run build` 通過
- [ ] `docker compose exec backend alembic heads` 只有一個 head
- [ ] Task 6 Step 4 的三項人工驗證都符合預期
