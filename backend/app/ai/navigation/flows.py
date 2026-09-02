"""Curated multi-step journeys the navigation assistant can walk a user through.

A single page is often not the answer: "我要申請一台機器" ends at the request
form, but the user still has to wait for review and then find the machine.  The
model's job is only to pick which flow matches -- never to invent the steps --
so the guidance stays correct even when the model is weak or offline.

Every ``path`` must exist in :mod:`app.ai.navigation.catalog`; the catalog test
checks both against the real router table.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any

from app.ai.navigation.catalog import RouteAccess, can_access, resolve_user_role
from app.ai.navigation.schemas import NavigationStepPublic
from app.models import User

# 配置模式問完之後要接回這條流程：規劃配置本來就是「申請一台機器」的其中一步。
INTAKE_FLOW_ID = "request_machine"


@dataclass(frozen=True)
class NavigationStep:
    title: str
    path: str
    detail: str
    # 傳給 react-router 的 location state，讓落地頁直接進到正確的視圖，
    # 例如 {"create": True} 會讓 /my-requests 直接開啟申請表單。
    state: dict[str, Any] | None = None
    # 這一步不是「去某一頁」，而是就地讓助手做一件事。
    # "recommend" = 依對話規劃一份配置，產出可直接填進申請單的內容。
    action: str | None = None


@dataclass(frozen=True)
class NavigationFlow:
    flow_id: str
    title: str
    summary: str
    keywords: tuple[str, ...]
    steps: tuple[NavigationStep, ...]
    access: RouteAccess = "all"
    entities: tuple[str, ...] = field(default=())


_FLOWS: tuple[NavigationFlow, ...] = (
    NavigationFlow(
        flow_id="request_machine",
        title="申請一台機器",
        summary="從填申請單到機器可以使用的完整流程。",
        keywords=(
            "申請機器", "申請一台", "我要一台", "借一台", "要機器", "開機器",
            "申請 vm", "申請 lxc", "申請容器", "申請虛擬機", "要 gpu", "申請 gpu",
        ),
        steps=(
            NavigationStep(
                title="讓 AI 依用途規劃配置",
                path="/my-requests",
                detail="我會先問幾個問題（用途、要不要 GPU、要不要圖形桌面、用多久），再挑規格並把申請單填好；不需要的話可以跳過這步。",
                action="recommend",
            ),
            NavigationStep(
                title="確認並填寫申請單",
                path="/my-requests",
                detail="選作業系統或老師提供的範本，調整規格；需要 GPU 就選標示 GPU 的項目並挑時段。",
                state={"create": True},
            ),
            NavigationStep(
                title="等待審核",
                path="/my-requests",
                detail="送出後在這裡看得到審核狀態，被退回時會附上原因。",
            ),
            NavigationStep(
                title="開始使用",
                path="/my-resources",
                detail="核准並建立完成後，機器會出現在這裡，可以開機與連線。",
            ),
        ),
    ),
    NavigationFlow(
        flow_id="publish_service",
        title="把機器上的服務對外公開",
        summary="讓別人用網址連到你機器上跑的服務。",
        keywords=(
            "對外公開", "公開網站", "網站公開", "公開服務", "服務對外", "對外服務",
            "外部連線", "外面連", "別人連", "網址", "網站上線",
            "reverse proxy", "反向代理", "開埠", "https",
        ),
        steps=(
            NavigationStep(
                title="確認服務在機器上跑起來",
                path="/my-resources",
                detail="先連進機器，確認服務在某個埠上正常回應。",
            ),
            NavigationStep(
                title="建立對外網址",
                path="/reverse-proxy",
                detail="新增一條反向代理規則，把網址指到機器的那個埠。",
            ),
            NavigationStep(
                title="放行需要的埠",
                path="/firewall",
                detail="確認防火牆允許該埠的流量，否則網址會連不上。",
            ),
        ),
    ),
    NavigationFlow(
        flow_id="open_class",
        title="開一個新班級",
        summary="建立班級、加入學生、安排每週內容。",
        keywords=("開班", "開一個班", "新班級", "建立班級", "帶班", "開課"),
        access="staff",
        steps=(
            NavigationStep(
                title="建立班級",
                path="/class-setup",
                detail="填班級基本資料，並挑一個課程環境範本當作上課環境。",
            ),
            NavigationStep(
                title="加入學生名單",
                path="/class-management",
                detail="進入該班級的「加入學生」，建立正式名單後才能開通機器。",
            ),
            NavigationStep(
                title="安排每週內容",
                path="/class-management",
                detail="在「每週內容」填主題並上傳任務檔案，之後每週的檢查都掛在這裡。",
            ),
        ),
    ),
    NavigationFlow(
        flow_id="share_template",
        title="把機器做成範本給別人用",
        summary="裝好一台機器後轉成範本，並決定開放給誰。",
        keywords=("做範本", "轉範本", "變成範本", "範本給學生", "共用環境", "母範本"),
        access="staff",
        steps=(
            NavigationStep(
                title="先把機器裝到可以用",
                path="/my-resources",
                detail="在來源機器上裝好軟體與設定；轉換後這台機器會變成範本本身。",
            ),
            NavigationStep(
                title="轉換成範本",
                path="/templates",
                detail="選擇來源機器建立範本，填名稱與建議規格。",
            ),
            NavigationStep(
                title="開放給學生申請",
                path="/templates",
                detail="編輯範本並勾選「開放學生申請」，學生就能在申請表單裡選到它（仍需審核）。",
            ),
        ),
    ),
    NavigationFlow(
        flow_id="review_requests",
        title="處理待審的機器申請",
        summary="審核申請並確認機器真的開出來了。",
        keywords=("審核申請", "處理申請", "待審", "核准", "批准申請"),
        access="admin",
        steps=(
            NavigationStep(
                title="逐筆審核",
                path="/request-review",
                detail="看申請理由與規格，核准或退回並寫下原因。",
            ),
            NavigationStep(
                title="確認建立進度",
                path="/jobs",
                detail="核准後由背景任務建立，失敗的任務會在這裡顯示錯誤。",
            ),
            NavigationStep(
                title="確認機器已開通",
                path="/resource-mgmt",
                detail="建立完成的機器會出現在資源管理，可以在這裡確認狀態。",
            ),
        ),
    ),
)


def get_flows_for_user(user: User) -> tuple[NavigationFlow, ...]:
    role = resolve_user_role(user)
    return tuple(flow for flow in _FLOWS if can_access(flow.access, role))


def all_flows() -> tuple[NavigationFlow, ...]:
    return _FLOWS


def public_steps(flow: NavigationFlow, active: int = 0) -> list[NavigationStepPublic]:
    """把流程步驟轉成回給前端的形狀，並標出走到哪一步。"""
    return [
        NavigationStepPublic(
            index=index,
            title=step.title,
            path=step.path,
            detail=step.detail,
            status=(
                "done" if index < active else "current" if index == active else "todo"
            ),
            state=step.state,
            action=step.action,
        )
        for index, step in enumerate(flow.steps)
    ]


def find_flow_by_id(
    flow_id: str, flows: Iterable[NavigationFlow]
) -> NavigationFlow | None:
    target = flow_id.strip()
    if not target:
        return None
    for flow in flows:
        if flow.flow_id == target:
            return flow
    return None
