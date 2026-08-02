"""Proxmox 設定載入。

多連線架構：連線層欄位（host/user/password/SSL）來自 proxmox_connections
表（每筆＝一個獨立 PVE 入口，單台或叢集皆可）；全域行為設定（pool、
storage、timeout、placement 等）仍來自 proxmox_config singleton。

尚未建立任何連線資料時，退回 proxmox_config 既有的 host/user 欄位
（舊版單連線資料相容）。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

logger = logging.getLogger(__name__)

DEFAULT_PROXMOX_POOL_NAME = "SkyLab"


@dataclass
class ProxmoxSettings:
    host: str
    user: str
    password: str
    verify_ssl: bool
    iso_storage: str
    data_storage: str
    api_timeout: int
    task_check_interval: int
    pool_name: str
    ca_cert: str | None = None
    local_subnet: str | None = None
    default_node: str | None = None
    connection_id: int | None = None
    connection_name: str | None = None
    port: int = 8006


def get_proxmox_settings(connection_id: int | None = None) -> ProxmoxSettings:
    """Load Proxmox settings from DB. Raises RuntimeError if not configured.

    ``connection_id`` 為 None 時使用預設連線。
    """
    from cryptography.fernet import InvalidToken
    from sqlmodel import Session

    from app.core.db import engine
    from app.repositories import proxmox_connection as connection_repo
    from app.repositories.proxmox_config import (
        get_decrypted_password,
        get_proxmox_config,
    )

    with Session(engine) as session:
        config = get_proxmox_config(session)
        if connection_id is not None:
            connection = connection_repo.get_connection(session, connection_id)
            if connection is None:
                raise RuntimeError(f"Proxmox 連線 {connection_id} 不存在。")
        else:
            connection = connection_repo.get_default_connection(session)

        if connection is not None:
            try:
                conn_password = connection_repo.get_decrypted_password(connection)
            except Exception as exc:
                raise RuntimeError(
                    f"Proxmox 連線「{connection.name}」密碼解密失敗，"
                    "SECRET_KEY 可能已變更。請至管理員介面重新儲存該連線設定。"
                ) from exc

    if config is None and connection is None:
        raise RuntimeError(
            "Proxmox 尚未設定，請至管理員介面完成 Proxmox 連線設定。"
        )

    # 全域行為設定：無 proxmox_config 時採用預設值
    iso_storage = config.iso_storage if config else "local"
    data_storage = config.data_storage if config else "local-lvm"
    task_check_interval = config.task_check_interval if config else 2
    pool_name = config.pool_name if config else DEFAULT_PROXMOX_POOL_NAME
    local_subnet = config.local_subnet if config else None
    default_node = config.default_node if config else None

    if connection is not None:
        return ProxmoxSettings(
            host=connection.host,
            user=connection.user,
            password=conn_password,
            verify_ssl=connection.verify_ssl,
            iso_storage=iso_storage,
            data_storage=data_storage,
            api_timeout=connection.api_timeout,
            task_check_interval=task_check_interval,
            pool_name=pool_name,
            ca_cert=connection.ca_cert,
            local_subnet=local_subnet,
            default_node=default_node,
            connection_id=connection.id,
            connection_name=connection.name,
            port=connection.port,
        )

    # 舊版相容：尚未建立連線資料，使用 proxmox_config 的連線欄位
    assert config is not None
    try:
        password = get_decrypted_password(config)
    except InvalidToken as exc:
        raise RuntimeError(
            "Proxmox 密碼解密失敗，SECRET_KEY 可能已變更。"
            " 請至管理員介面重新儲存 Proxmox 連線設定以更新加密密碼。"
        ) from exc

    return ProxmoxSettings(
        host=config.host,
        user=config.user,
        password=password,
        verify_ssl=config.verify_ssl,
        iso_storage=iso_storage,
        data_storage=data_storage,
        api_timeout=config.api_timeout,
        task_check_interval=task_check_interval,
        pool_name=pool_name,
        ca_cert=config.ca_cert,
        local_subnet=local_subnet,
        default_node=default_node,
        connection_id=None,
        connection_name=None,
    )


def list_enabled_connection_ids() -> list[int]:
    """回傳所有啟用連線的 id（依預設優先排序）。

    尚未建立連線資料時回傳空清單（呼叫端應退回單連線行為）。
    """
    from sqlmodel import Session

    from app.core.db import engine
    from app.repositories import proxmox_connection as connection_repo

    try:
        with Session(engine) as session:
            connections = connection_repo.get_all_connections(
                session, enabled_only=True
            )
            return [conn.id for conn in connections if conn.id is not None]
    except Exception as exc:
        logger.warning("Unable to list Proxmox connections: %s", exc)
        return []
