from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

# navigate: 直接帶去某頁；suggest: 給候選；clarify: 反問；
# guide: 這是一段多步驟流程，回傳 steps 讓前端逐步帶著走。
NavigationAction = Literal["navigate", "suggest", "clarify", "guide"]

StepStatus = Literal["done", "current", "todo"]

# 一次對話最多帶幾則歷史進 prompt；再多對導覽沒有幫助，只會拉高 token。
MAX_HISTORY_MESSAGES = 12


class NavigationMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(default="", max_length=2000)


class NavigationResolveRequest(BaseModel):
    query: str = Field(..., min_length=2, max_length=2000)
    # 同一次對話的前文，由前端保存並回傳（導覽沒有伺服器端會話表）。
    history: list[NavigationMessage] = Field(
        default_factory=list, max_length=MAX_HISTORY_MESSAGES
    )
    # 使用者目前所在的頁面路徑，用來判斷流程走到哪一步。
    current_path: str | None = Field(default=None, max_length=200)
    # 只用於把同一段對話的用量記錄串起來，不影響回覆內容。
    session_id: str | None = Field(default=None, max_length=64)


class NavigationTarget(BaseModel):
    title: str
    path: str
    reason: str = ""
    # 交給 react-router 的 location state，例如 {"create": true} 會讓
    # /my-requests 直接開啟申請表單，而不是只停在列表。
    state: dict[str, Any] | None = None


class NavigationStepPublic(BaseModel):
    index: int
    title: str
    path: str
    detail: str = ""
    status: StepStatus = "todo"
    state: dict[str, Any] | None = None
    # "recommend" 代表這一步由助手就地完成（規劃配置），而不是導到某一頁
    action: str | None = None


class NavigationResolveResponse(BaseModel):
    intent: str
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    action: NavigationAction
    primary: NavigationTarget | None = None
    suggestions: list[NavigationTarget] = Field(default_factory=list)
    clarification_question: str | None = None
    # action == "guide" 時才有值
    flow_id: str | None = None
    flow_title: str | None = None
    steps: list[NavigationStepPublic] = Field(default_factory=list)
    active_step: int | None = None
