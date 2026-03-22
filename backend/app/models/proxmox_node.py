"""Proxmox 叢集節點模型"""

from datetime import datetime

from sqlalchemy import DateTime
from sqlmodel import Field, SQLModel


class ProxmoxNode(SQLModel, table=True):
    """Proxmox 叢集中每個節點的連線資訊"""

    __tablename__ = "proxmox_nodes"

    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(max_length=255)           # PVE 節點名稱，例如 "pve", "pve2"
    host: str = Field(max_length=255)           # IP 或 hostname
    port: int = Field(default=8006)
    is_primary: bool = Field(default=False)     # 主節點（使用者最初設定的那台）
    is_online: bool = Field(default=True)       # 最近一次連線結果
    last_checked: datetime | None = Field(
        default=None,
        sa_type=DateTime(timezone=True),
    )


__all__ = ["ProxmoxNode"]
