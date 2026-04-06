"""NAT 端口轉發規則模型"""

import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlmodel import Field, SQLModel

from .base import get_datetime_utc


class NatRule(SQLModel, table=True):
    """儲存 nftables DNAT 規則記錄。
    Campus Cloud 作為唯一 source of truth：啟動時從此表重放規則到 PVE 主機。
    """

    __tablename__ = "nat_rule"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)

    # 套用規則的 PVE 節點（SSH 目標 host）
    ssh_host: str = Field(max_length=255, description="PVE 主機 IP，規則套用目標")

    # VM 資訊
    vmid: int = Field(index=True, description="目標 VM ID")
    vm_ip: str = Field(max_length=64, description="目標 VM 內網 IP")

    # Port mapping
    external_port: int = Field(ge=1, le=65535, description="外網入站 port（公網）")
    internal_port: int = Field(ge=1, le=65535, description="VM 內部 port")
    protocol: str = Field(default="tcp", max_length=16, description="協定 tcp/udp")

    created_at: datetime = Field(
        default_factory=get_datetime_utc,
        sa_type=sa.DateTime(timezone=True),
    )


__all__ = ["NatRule"]
