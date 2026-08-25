"""Add per-connection resource settings to proxmox_connections.

pool / storage / gateway / 預設節點等原本放在 proxmox_config singleton 的
欄位改為每個 PVE 連線（叢集）各自設定。既有連線一律從 proxmox_config
回填目前的值，升級後行為不變。

Revision ID: pconn02_conn_settings
Revises: pnode01_node_enabled
Create Date: 2026-08-02 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "pconn02_conn_settings"
down_revision = "pnode01_node_enabled"
branch_labels = None
depends_on = None

NEW_COLUMNS: tuple[tuple[str, sa.types.TypeEngine, str | None], ...] = (
    ("pool_name", sa.String(length=255), "SkyLab"),
    ("iso_storage", sa.String(length=255), "local"),
    ("data_storage", sa.String(length=255), "local-lvm"),
    ("task_check_interval", sa.Integer(), "2"),
    ("gateway_ip", sa.String(length=255), None),
    ("local_subnet", sa.String(length=50), None),
    ("default_node", sa.String(length=255), None),
)


def upgrade() -> None:
    bind = op.get_bind()
    columns = {
        column["name"] for column in sa.inspect(bind).get_columns("proxmox_connections")
    }

    for name, column_type, server_default in NEW_COLUMNS:
        if name in columns:
            continue
        # 有 server_default 的欄位在 model 端是必填，既有列會被填上預設值，
        # 可直接 NOT NULL；沒有預設值的欄位在 model 端是 Optional，必須允許
        # NULL，否則既有連線列會違反約束。
        op.add_column(
            "proxmox_connections",
            sa.Column(
                name,
                column_type,
                nullable=server_default is None,
                server_default=server_default,
            ),
        )

    # 回填：既有連線沿用 proxmox_config 目前的設定，避免升級後行為改變
    if sa.inspect(bind).has_table("proxmox_config"):
        config = bind.execute(
            sa.text(
                "SELECT pool_name, iso_storage, data_storage, task_check_interval, "
                "gateway_ip, local_subnet, default_node "
                "FROM proxmox_config WHERE id = 1"
            )
        ).fetchone()
        if config is not None:
            bind.execute(
                sa.text(
                    "UPDATE proxmox_connections SET "
                    "pool_name = :pool_name, "
                    "iso_storage = :iso_storage, "
                    "data_storage = :data_storage, "
                    "task_check_interval = :task_check_interval, "
                    "gateway_ip = :gateway_ip, "
                    "local_subnet = :local_subnet, "
                    "default_node = :default_node"
                ),
                {
                    "pool_name": config.pool_name,
                    "iso_storage": config.iso_storage,
                    "data_storage": config.data_storage,
                    "task_check_interval": config.task_check_interval,
                    "gateway_ip": config.gateway_ip,
                    "local_subnet": config.local_subnet,
                    "default_node": config.default_node,
                },
            )


def downgrade() -> None:
    bind = op.get_bind()
    columns = {
        column["name"] for column in sa.inspect(bind).get_columns("proxmox_connections")
    }
    for name, _column_type, _server_default in NEW_COLUMNS:
        if name in columns:
            op.drop_column("proxmox_connections", name)
