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

    logger.info("Auto-expired %d VM request(s): %s", len(expired_ids), expired_ids)
    return len(expired_ids)
