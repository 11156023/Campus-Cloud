"""Proxmox 節點資料庫操作"""

from datetime import datetime, timezone

from sqlmodel import Session, select

from app.models.proxmox_node import ProxmoxNode


def get_all_nodes(session: Session) -> list[ProxmoxNode]:
    """取得所有節點，主節點優先，其餘按名稱排序。"""
    stmt = select(ProxmoxNode).order_by(
        ProxmoxNode.is_primary.desc(),  # type: ignore[attr-defined]
        ProxmoxNode.name,
    )
    return list(session.exec(stmt).all())


def upsert_nodes(
    session: Session,
    nodes: list[dict],  # [{"name": str, "host": str, "port": int, "is_primary": bool}]
) -> list[ProxmoxNode]:
    """
    同步節點清單到資料庫。
    先清除舊有節點，再寫入新節點。
    """
    # 清除舊節點
    existing = session.exec(select(ProxmoxNode)).all()
    for node in existing:
        session.delete(node)
    session.flush()

    # 寫入新節點
    result = []
    for node_data in nodes:
        node = ProxmoxNode(
            name=node_data["name"],
            host=node_data["host"],
            port=node_data.get("port", 8006),
            is_primary=node_data.get("is_primary", False),
            is_online=True,
            last_checked=datetime.now(timezone.utc),
        )
        session.add(node)
        result.append(node)

    session.commit()
    for node in result:
        session.refresh(node)
    return result


def update_node_status(session: Session, node_id: int, is_online: bool) -> None:
    """更新節點的連線狀態。"""
    node = session.get(ProxmoxNode, node_id)
    if node:
        node.is_online = is_online
        node.last_checked = datetime.now(timezone.utc)
        session.add(node)
        session.commit()


__all__ = [
    "get_all_nodes",
    "upsert_nodes",
    "update_node_status",
]
