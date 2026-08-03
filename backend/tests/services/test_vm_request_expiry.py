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
