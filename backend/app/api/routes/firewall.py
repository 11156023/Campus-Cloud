"""防火牆管理 API 路由"""

import logging

from fastapi import APIRouter, HTTPException

from app.api.deps import (
    CurrentUser,
    SessionDep,
    check_firewall_access,
)
from app.exceptions import BadRequestError, NotFoundError, ProxmoxError
from app.repositories import firewall_layout as layout_repo
from app.schemas import Message
from app.schemas.firewall import (
    ConnectionCreate,
    ConnectionDelete,
    FirewallOptionsPublic,
    FirewallRuleCreate,
    FirewallRulePublic,
    FirewallRuleUpdate,
    LayoutUpdate,
    TopologyResponse,
)
from app.services import firewall_service, proxmox_service
from app.services.firewall_service import _BLOCK_LOCAL_COMMENT

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/firewall", tags=["firewall"])


# ─── 拓撲 ─────────────────────────────────────────────────────────────────────


@router.get("/topology", response_model=TopologyResponse)
def get_topology(session: SessionDep, current_user: CurrentUser):
    """取得當前使用者有權限的 VM 防火牆拓撲（節點 + 連線）"""
    try:
        return firewall_service.get_topology(user=current_user, session=session)
    except Exception:
        logger.exception("取得拓撲失敗")
        raise HTTPException(status_code=500, detail="取得拓撲失敗")


# ─── 佈局管理 ──────────────────────────────────────────────────────────────────


@router.get("/layout")
def get_layout(session: SessionDep, current_user: CurrentUser):
    """取得使用者儲存的圖形佈局節點位置"""
    records = layout_repo.get_layout(session=session, user_id=current_user.id)
    return [
        {
            "vmid": r.vmid,
            "node_type": r.node_type,
            "position_x": r.position_x,
            "position_y": r.position_y,
        }
        for r in records
    ]


@router.put("/layout", response_model=Message)
def save_layout(
    layout_update: LayoutUpdate,
    session: SessionDep,
    current_user: CurrentUser,
):
    """批次儲存圖形佈局節點位置"""
    nodes = [
        {
            "vmid": node.vmid,
            "node_type": node.node_type,
            "position_x": node.position_x,
            "position_y": node.position_y,
        }
        for node in layout_update.nodes
    ]
    layout_repo.upsert_layout_batch(
        session=session, user_id=current_user.id, nodes=nodes
    )
    return Message(message="佈局已儲存")


# ─── 連線管理（高階）─────────────────────────────────────────────────────────


@router.post("/connections", response_model=Message)
def create_connection(
    conn: ConnectionCreate,
    session: SessionDep,
    current_user: CurrentUser,
):
    """建立 VM 間連線（或 VM 到網關）

    - 來源 VM 必須為當前使用者有權限的機器
    - 目標 VM（如果有）也必須在當前使用者的可見範圍內
    """
    try:
        # 權限檢查：來源 VM（若有）
        if conn.source_vmid is not None:
            check_firewall_access(
                vmid=conn.source_vmid,
                current_user=current_user,
                session=session,
            )
        # 權限檢查：目標 VM（若有）
        if conn.target_vmid is not None:
            check_firewall_access(
                vmid=conn.target_vmid,
                current_user=current_user,
                session=session,
            )

        firewall_service.create_connection(
            source_vmid=conn.source_vmid,
            target_vmid=conn.target_vmid,
            ports=conn.ports,
            direction=conn.direction,
        )
        return Message(message="連線已建立")
    except (BadRequestError, NotFoundError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ProxmoxError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/connections", response_model=Message)
def delete_connection(
    conn: ConnectionDelete,
    session: SessionDep,
    current_user: CurrentUser,
):
    """刪除 VM 間連線"""
    try:
        # 權限檢查：
        # - 若 source_vmid 為 None（例如 Internet -> VM 入站），
        #   則以 target_vmid 作為被變更規則的 VM 進行檢查
        # - 否則先檢查 source_vmid，再檢查（若有的）target_vmid
        if conn.source_vmid is None:
            if conn.target_vmid is not None:
                check_firewall_access(
                    vmid=conn.target_vmid,
                    current_user=current_user,
                    session=session,
                )
        else:
            check_firewall_access(
                vmid=conn.source_vmid,
                current_user=current_user,
                session=session,
            )
            if conn.target_vmid is not None:
                check_firewall_access(
                    vmid=conn.target_vmid,
                    current_user=current_user,
                    session=session,
                )

        firewall_service.delete_connection(
            source_vmid=conn.source_vmid,
            target_vmid=conn.target_vmid,
            ports=conn.ports,
        )
        return Message(message="連線已刪除")
    except (BadRequestError, NotFoundError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ProxmoxError as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── 單一 VM 防火牆規則（原始 CRUD）─────────────────────────────────────────


@router.get("/{vmid}/rules", response_model=list[FirewallRulePublic])
def list_rules(
    vmid: int,
    session: SessionDep,
    current_user: CurrentUser,
):
    """列出 VM 防火牆規則（包含 campus-cloud 管理的規則）"""
    check_firewall_access(vmid=vmid, current_user=current_user, session=session)
    try:
        resource = proxmox_service.find_resource(vmid)
        rules = firewall_service.get_vm_firewall_rules(
            resource["node"], vmid, resource["type"]
        )
        return [
            FirewallRulePublic(
                pos=r.get("pos", i),
                type=r.get("type", "in"),
                action=r.get("action", "DROP"),
                source=r.get("source"),
                dest=r.get("dest"),
                proto=r.get("proto"),
                dport=r.get("dport"),
                sport=r.get("sport"),
                enable=r.get("enable", 1),
                comment=r.get("comment"),
                is_managed=bool(
                    r.get("comment", "").startswith("campus-cloud:")
                    if r.get("comment")
                    else False
                ),
            )
            for i, r in enumerate(rules)
            if r.get("comment") != _BLOCK_LOCAL_COMMENT
        ]
    except NotFoundError:
        raise HTTPException(status_code=404, detail=f"VM {vmid} 不存在")
    except ProxmoxError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{vmid}/rules", response_model=Message)
def create_rule(
    vmid: int,
    rule: FirewallRuleCreate,
    session: SessionDep,
    current_user: CurrentUser,
):
    """在 VM 上建立防火牆規則"""
    check_firewall_access(vmid=vmid, current_user=current_user, session=session)
    try:
        resource = proxmox_service.find_resource(vmid)
        rule_dict = {k: v for k, v in rule.model_dump().items() if v is not None}
        firewall_service.create_rule(resource["node"], vmid, resource["type"], rule_dict)
        return Message(message="規則已建立")
    except NotFoundError:
        raise HTTPException(status_code=404, detail=f"VM {vmid} 不存在")
    except ProxmoxError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{vmid}/rules/{pos}", response_model=Message)
def update_rule(
    vmid: int,
    pos: int,
    rule: FirewallRuleUpdate,
    session: SessionDep,
    current_user: CurrentUser,
):
    """更新 VM 防火牆規則（不可修改 campus-cloud 管理的規則）"""
    check_firewall_access(vmid=vmid, current_user=current_user, session=session)
    try:
        resource = proxmox_service.find_resource(vmid)
        rules = firewall_service.get_vm_firewall_rules(
            resource["node"], vmid, resource["type"]
        )
        target_rule = next((r for r in rules if r.get("pos") == pos), None)
        if target_rule and str(target_rule.get("comment", "")).startswith("campus-cloud:"):
            raise HTTPException(
                status_code=400,
                detail="此規則由 Campus Cloud 管理，不可修改",
            )
        rule_dict = {k: v for k, v in rule.model_dump().items() if v is not None}
        firewall_service.update_rule(
            resource["node"], vmid, resource["type"], pos, rule_dict
        )
        return Message(message="規則已更新")
    except NotFoundError:
        raise HTTPException(status_code=404, detail=f"VM {vmid} 不存在")
    except ProxmoxError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{vmid}/rules/{pos}", response_model=Message)
def delete_rule(
    vmid: int,
    pos: int,
    session: SessionDep,
    current_user: CurrentUser,
):
    """刪除 VM 防火牆規則（不可刪除 campus-cloud 管理的規則，請使用連線刪除 API）"""
    check_firewall_access(vmid=vmid, current_user=current_user, session=session)
    try:
        resource = proxmox_service.find_resource(vmid)
        # 先取得規則確認不是 campus-cloud 管理的規則
        rules = firewall_service.get_vm_firewall_rules(
            resource["node"], vmid, resource["type"]
        )
        target_rule = next((r for r in rules if r.get("pos") == pos), None)
        if target_rule and str(target_rule.get("comment", "")).startswith("campus-cloud:"):
            raise HTTPException(
                status_code=400,
                detail="此規則由 Campus Cloud 管理，請使用連線管理介面進行操作",
            )
        firewall_service.delete_rule_by_pos(resource["node"], vmid, resource["type"], pos)
        return Message(message="規則已刪除")
    except HTTPException:
        raise
    except NotFoundError:
        raise HTTPException(status_code=404, detail=f"VM {vmid} 不存在")
    except ProxmoxError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{vmid}/options", response_model=FirewallOptionsPublic)
def get_options(
    vmid: int,
    session: SessionDep,
    current_user: CurrentUser,
):
    """取得 VM 防火牆選項（是否啟用、預設策略）"""
    check_firewall_access(vmid=vmid, current_user=current_user, session=session)
    try:
        resource = proxmox_service.find_resource(vmid)
        opts = firewall_service.get_firewall_options(
            resource["node"], vmid, resource["type"]
        )
        return FirewallOptionsPublic(
            enable=bool(opts.get("enable", False)),
            policy_in=opts.get("policy_in", "DROP"),
            policy_out=opts.get("policy_out", "ACCEPT"),
        )
    except NotFoundError:
        raise HTTPException(status_code=404, detail=f"VM {vmid} 不存在")
    except ProxmoxError as e:
        raise HTTPException(status_code=500, detail=str(e))
