"""服務模板腳本部署日誌 schemas（手動部署入口已移除，只剩日誌查詢）"""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class ScriptDeployLogListItem(BaseModel):
    """部署日誌列表項"""

    id: UUID
    task_id: str
    user_id: UUID | None = None
    vmid: int | None = None
    template_slug: str
    template_name: str | None = None
    hostname: str | None = None
    status: str
    progress: str | None = None
    message: str | None = None
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None = None


class ScriptDeployLogDetail(ScriptDeployLogListItem):
    """部署日誌詳細內容（含完整 output 與 error）"""

    script_path: str | None = None
    error: str | None = None
    output: str | None = None


class ScriptDeployLogList(BaseModel):
    """部署日誌列表回應"""

    items: list[ScriptDeployLogListItem]
    total: int
    limit: int
    offset: int

