"""Proxmox 連線（多入口）模型

每筆代表一組獨立的 PVE 入口：可能是單台主機，也可能是一個叢集的
入口節點。連線層帳密與 SSL 設定各自獨立；全域行為設定（pool、
placement、scheduler 等）仍在 proxmox_config singleton。
"""

from datetime import datetime

import sqlalchemy as sa
from sqlmodel import Field, SQLModel, UniqueConstraint

from .base import get_datetime_utc


class ProxmoxConnection(SQLModel, table=True):
    __tablename__ = "proxmox_connections"
    __table_args__ = (
        UniqueConstraint("name", name="uq_proxmox_connections_name"),
    )

    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(max_length=255)               # 顯示名稱，例如 "機房A"、"lab-cluster"
    host: str = Field(max_length=255)               # 入口 IP 或 hostname
    port: int = Field(default=8006, ge=1, le=65535)
    user: str = Field(max_length=255)               # 例如 root@pam
    encrypted_password: str = Field(max_length=2048)
    verify_ssl: bool = Field(default=False)
    ca_cert: str | None = Field(default=None, sa_type=sa.Text())
    api_timeout: int = Field(default=30, ge=1, le=300)
    enabled: bool = Field(default=True)             # 停用後不參與彙總與放置
    is_default: bool = Field(default=False)         # 未指定連線時的預設入口
    created_at: datetime = Field(
        default_factory=get_datetime_utc,
        sa_type=sa.DateTime(timezone=True),
    )
    updated_at: datetime = Field(
        default_factory=get_datetime_utc,
        sa_type=sa.DateTime(timezone=True),
    )


__all__ = ["ProxmoxConnection"]
