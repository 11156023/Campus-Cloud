"""服務模板腳本部署日誌 API

手動部署入口已移除（部署改由 VM 請求排程流程觸發，見
``services/scheduling/coordinator.py`` → ``deploy_for_vm_request_sync``），
此路由僅保留歷史部署日誌查詢：
- GET /logs: 列出歷史部署日誌
- GET /logs/{task_id}: 查詢單筆部署日誌詳細內容（含完整 output）
"""

import logging

from fastapi import APIRouter, HTTPException, Query
from sqlmodel import func, select

from app.api.deps import AdminUser, SessionDep
from app.models.script_deploy_log import ScriptDeployLog
from app.schemas.script_deploy import (
    ScriptDeployLogDetail,
    ScriptDeployLogList,
    ScriptDeployLogListItem,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/script-deploy", tags=["script-deploy"])


@router.get("/logs", response_model=ScriptDeployLogList)
def list_deploy_logs(
    session: SessionDep,
    current_user: AdminUser,  # noqa: ARG001 — required for AdminUser auth
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    status: str | None = Query(None, description="running | completed | failed"),
    template_slug: str | None = None,
    vmid: int | None = None,
) -> ScriptDeployLogList:
    """列出歷史部署日誌（Admin 可見全部）。"""
    stmt = select(ScriptDeployLog)
    count_stmt = select(func.count()).select_from(ScriptDeployLog)

    if status:
        stmt = stmt.where(ScriptDeployLog.status == status)
        count_stmt = count_stmt.where(ScriptDeployLog.status == status)
    if template_slug:
        stmt = stmt.where(ScriptDeployLog.template_slug == template_slug)
        count_stmt = count_stmt.where(ScriptDeployLog.template_slug == template_slug)
    if vmid is not None:
        stmt = stmt.where(ScriptDeployLog.vmid == vmid)
        count_stmt = count_stmt.where(ScriptDeployLog.vmid == vmid)

    total = session.exec(count_stmt).one()
    stmt = stmt.order_by(ScriptDeployLog.created_at.desc()).offset(offset).limit(limit)
    rows = session.exec(stmt).all()

    items = [ScriptDeployLogListItem.model_validate(r, from_attributes=True) for r in rows]
    return ScriptDeployLogList(items=items, total=int(total), limit=limit, offset=offset)


@router.get("/logs/{task_id}", response_model=ScriptDeployLogDetail)
def get_deploy_log(
    task_id: str,
    session: SessionDep,
    current_user: AdminUser,  # noqa: ARG001 — required for AdminUser auth
) -> ScriptDeployLogDetail:
    """查詢單筆部署日誌詳細內容（含完整 output 與 error）。"""
    row = session.exec(
        select(ScriptDeployLog).where(ScriptDeployLog.task_id == task_id)
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="找不到該部署日誌")
    return ScriptDeployLogDetail.model_validate(row, from_attributes=True)
