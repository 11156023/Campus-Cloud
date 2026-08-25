# VM 申請逾時自動過期 — 設計

日期：2026-08-03
分支：`feature/multi-pve-connections`

## 背景

`backend/app/services/vm/vm_request_service.py` 的 `review()` 在核准路徑上擋掉了「使用時段已結束」的申請：

```python
if end_at <= _utc_now():
    raise BadRequestError(
        "This request window has already ended and can no longer be approved."
    )
```

但沒有任何機制去清理這些申請。結果是一筆 `end_at` 已過的 `pending` 申請會**永遠停在 pending**：

- 管理員在「申請審核」頁的「待審核」分頁看到它，點進去卻只能拒絕，核准必定失敗。
- 使用者在「我的申請」頁看到「審核中」，但這個狀態已經是假的 —— 它不可能再被核准。
- 待審核計數持續灌水。

## 目標

排程器自動把這些申請標為 `expired`，讓 UI 狀態說實話。

非目標：不改核准/拒絕流程、不寄信通知、不加治理設定開關、不動 `approved` 申請的生命週期。

## 設計

### 一、過期規則

一筆申請同時滿足以下條件時過期：

```
status == pending  AND  end_at IS NOT NULL  AND  end_at <= now
```

**只動 `pending`**：

- `approved` 的申請由 `coordinator.process_due_request_stops()` 負責到期關機。改它的狀態會讓已開通的機器脫離排程管理，變成孤兒。
- `rejected` / `cancelled` 已是終態。

**`end_at IS NULL` 永不過期**：immediate 模式（`require_immediate_vm_request_access`，admin/teacher 專用）允許建立無限期申請，這是刻意設計。

**實際受影響的範圍**：只有 scheduled 模式的一般申請。`quick_template` 與 `course` 兩種 `request_kind` 都在建立時 auto-approve，不會停在 pending。

### 二、過期時寫入的欄位

只改 `status = expired`。

`reviewer_id`、`reviewed_at`、`review_comment` **全部保持不動（維持 null）** —— 沒有人審核過它，不該偽造審核紀錄，也不需要對使用者解釋原因。狀態標籤「已過期」本身已足夠。

### 三、元件

#### 1. Model — 兩個 enum

`backend/app/models/vm_request.py` 的 `VMRequestStatus` 新增 `expired = "expired"`。

`backend/app/models/audit_log.py` 的 `AuditAction` 新增 `vm_request_expired = "vm_request_expired"`，並在 `audit_service.ACTION_CATEGORY` 補 `"request"` 分類（漏掉的話後台稽核頁的下拉分組會落到 "other"）。

`AuditLog.action` 同樣是 PostgreSQL enum 欄位（`Column(Enum(AuditAction))`），所以新增 audit action 也要 migration —— 這點與 `c3d4e5f6a7b0_add_vm_request_submit_auto_approved_audit_action` 的先例一致。

#### 2. Migration — `backend/app/alembic/versions/vmexp01_add_expired_status_and_audit_action.py`

兩個 enum 一次改完，沿用 `cc01_cancelled_enum` 的寫法：

```python
revision = "vmexp01_expired"
down_revision = "qc01_quota_config"   # 目前 head

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
    # PostgreSQL 無法移除 enum 值；映回 rejected。
    op.execute("UPDATE vm_requests SET status = 'rejected' WHERE status = 'expired'")
```

**不做 backfill**：migration 不去掃歷史卡住的 pending 申請。排程器第一個 tick 就會處理完，migration 保持單純可回滾。

#### 3. Repository — `backend/app/repositories/vm_request.py`

新增兩個函式：

```python
def list_expired_pending_vm_requests(
    *, session: Session, at_time: datetime, limit: int = 100,
) -> list[VMRequest]:
    """已過使用時段但仍停在 pending 的申請（FOR UPDATE SKIP LOCKED）。"""
```

查詢條件即上述過期規則，`with_for_update(skip_locked=True)` 讓多個 worker 併發跑同一個 tick 時不互相阻塞。`limit` 避免單一 tick 處理過久。

```python
def mark_vm_request_expired(
    *, session: Session, db_request: VMRequest, commit: bool = True,
) -> VMRequest:
    """只改 status，不碰審核欄位。"""
```

**不重用 `update_vm_request_status`**：該函式強制要求 `reviewer_id` 且無條件覆寫 `reviewed_at` / `review_comment`，與「系統過期不留審核痕跡」的規則相衝。

#### 4. Service — 新檔 `backend/app/services/vm/vm_request_expiry_service.py`

```python
def process_expired_requests() -> int:
    """把已過使用時段的 pending 申請標為 expired，回傳處理筆數。"""
```

純協調流程：開 session → 查 → 逐筆標記 + audit log → **單次 commit** → 回傳筆數。

整批一次 commit 而非逐筆 commit：這裡沒有任何外部 I/O（不碰 Proxmox），只是純 UPDATE，失敗機率極低；而逐筆 commit 會在第一次 commit 後釋放 `FOR UPDATE` 鎖，讓批次剩下的列失去 SKIP LOCKED 的併發保護。整批失敗則 rollback 並記 log，下個 tick 重試。

audit log 以系統身分寫入（`user_id=None`，比照 coordinator 既有的自動關機紀錄）：

```python
audit_service.log_action(
    session=session,
    user_id=None,
    action=AuditAction.vm_request_expired,
    details=f"Auto-expired VM request {req.id}: usage window ended at {req.end_at}",
    commit=False,
)
```

**獨立模組而非塞進 coordinator**：`coordinator.py` 已 1057 行，CLAUDE.md 維護原則第 4 條明訂不讓單一 service 再次長成上帝物件。

#### 5. Scheduler — `backend/app/services/scheduling/coordinator.py`

比照既有 governance task 的寫法加 wrapper（函式內 import 避免循環）：

```python
def process_expired_requests_task() -> int:
    """Scheduler tick：已過使用時段仍未審核的申請自動過期。"""
    from app.services.vm import vm_request_expiry_service  # noqa: PLC0415

    return vm_request_expiry_service.process_expired_requests()
```

在 `run_scheduler` 的 `tasks=[...]` 註冊 `ScheduledTask(name="process_expired_requests", handler=process_expired_requests_task)`。

#### 6. Jobs 聚合 — `backend/app/services/jobs/jobs_service.py`

`_VM_REQUEST_STATUS_MAP`（第 51 行）補上：

```python
VMRequestStatus.expired: JobStatus.cancelled,
```

**這是最容易漏的一處**。查表寫法是 `.get(req.status, JobStatus.pending)`，缺鍵不會拋錯，而是**靜默 fallback 成「等待中」** —— 過期申請會在「工作」頁面顯示成還在排隊，比拋錯更難發現。

選 `cancelled` 而非 `failed`：什麼都沒失敗，申請只是失效了，語意上貼近既有的 `VMRequestStatus.cancelled → JobStatus.cancelled`。

#### 7. 前端 — 個人申請頁

`frontend/src/pages/personal/requests/RequestsPage.jsx` 的 `STATUS_MAP` 加：

```js
expired: { label: "已過期", color: "muted" },
```

不動 `review_comment` 的顯示條件（過期不寫原因，維持只在 `rejected` 時顯示）。

#### 8. 前端 — 審核頁

`frontend/src/pages/resource/request-review/RequestReviewPage.jsx` 的 `STATUS_META` 加同款條目。

過期申請在 `normalizeVmRequest()` 會落入 `reviewStatus: "other"`（第 114 行的白名單只含 pending/approved/rejected），自動從三個審核分頁消失 —— 與 `cancelled` 現行行為一致，不需額外處理。

## 測試

測試檔：`backend/tests/services/test_vm_request_expiry.py`（比照既有的 `test_vm_request_cancel_provisioned.py`）。

**Repository 查詢邊界** — 用 conftest 的 `db` fixture 打真實 PostgreSQL（WHERE 條件是唯一真相，不在 Python 端複製一份謂詞造成漂移）。四種組合：

| status | end_at | 是否入選 |
|---|---|---|
| pending | 已過 | ✓ |
| pending | null | ✗ |
| pending | 未到 | ✗ |
| approved | 已過 | ✗ |

測試資料只 `flush()` 不 commit，結尾 `rollback()`，不污染共用的 session-scoped DB。

**Repository 標記行為**：`mark_vm_request_expired` 後驗證 `reviewer_id` / `reviewed_at` / `review_comment` 仍為 null。

**Service 層**（純單元，monkeypatch repo 與 audit_service，不需 DB）：驗證每筆都被標記、audit log 以 `user_id=None` 寫入且 action 正確、單次 commit、回傳筆數正確；查無資料時不 commit 並回 0。

**Jobs 對應完整性**：斷言 `VMRequestStatus` 每個成員都在 `_VM_REQUEST_STATUS_MAP` 裡有鍵，防止日後再新增狀態時又靜默 fallback。

## 風險

`ALTER TYPE ... ADD VALUE` 在 PostgreSQL 12 之前不能在交易區塊內執行。`cc01_cancelled_enum` 與 `r7s8t9u0v1w2` 已用相同寫法且已上線，代表本專案的 PG 版本沒有這個限制。
