"""Desktop WireGuard control-plane schemas."""

from typing import Literal

from pydantic import BaseModel, Field


class WireGuardConnectRequest(BaseModel):
    device_id: str = Field(min_length=8, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$")
    public_key: str = Field(min_length=44, max_length=44)


class WireGuardDisconnectRequest(BaseModel):
    device_id: str = Field(min_length=8, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$")


class WireGuardRefreshRequest(BaseModel):
    device_id: str = Field(min_length=8, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$")


class WireGuardConnectionTarget(BaseModel):
    vmid: int
    name: str
    service: Literal["ssh", "rdp"]
    host: str
    port: int


class WireGuardConnectResponse(BaseModel):
    mode: Literal["wireguard"] = "wireguard"
    interface_name: str
    interface_address: str
    gateway_public_key: str
    endpoint: str
    allowed_ips: list[str]
    persistent_keepalive: int
    expires_in: int
    connections: list[WireGuardConnectionTarget]


class WireGuardDisconnectResponse(BaseModel):
    disconnected: bool


__all__ = [
    "WireGuardConnectRequest",
    "WireGuardConnectResponse",
    "WireGuardConnectionTarget",
    "WireGuardDisconnectRequest",
    "WireGuardDisconnectResponse",
    "WireGuardRefreshRequest",
]
