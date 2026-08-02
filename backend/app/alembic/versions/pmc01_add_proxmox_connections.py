"""Add proxmox_connections table and proxmox_nodes.connection_id.

既有的 proxmox_config（單列 singleton）若已設定，會播種為第一筆
預設連線，並把既有節點回填到該連線底下。

Revision ID: pmc01_proxmox_connections
Revises: aipve01_ai_pve_templates
Create Date: 2026-08-02 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "pmc01_proxmox_connections"
down_revision = "aipve01_ai_pve_templates"
branch_labels = None
depends_on = None


def _table_exists(bind: sa.Connection, table_name: str) -> bool:
    return sa.inspect(bind).has_table(table_name)


def upgrade() -> None:
    bind = op.get_bind()

    if not _table_exists(bind, "proxmox_connections"):
        op.create_table(
            "proxmox_connections",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("name", sa.String(length=255), nullable=False),
            sa.Column("host", sa.String(length=255), nullable=False),
            sa.Column("port", sa.Integer(), nullable=False, server_default="8006"),
            sa.Column("user", sa.String(length=255), nullable=False),
            sa.Column("encrypted_password", sa.String(length=2048), nullable=False),
            sa.Column(
                "verify_ssl", sa.Boolean(), nullable=False, server_default=sa.false()
            ),
            sa.Column("ca_cert", sa.Text(), nullable=True),
            sa.Column("api_timeout", sa.Integer(), nullable=False, server_default="30"),
            sa.Column(
                "enabled", sa.Boolean(), nullable=False, server_default=sa.true()
            ),
            sa.Column(
                "is_default", sa.Boolean(), nullable=False, server_default=sa.false()
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("name", name="uq_proxmox_connections_name"),
        )

    node_columns = {
        column["name"] for column in sa.inspect(bind).get_columns("proxmox_nodes")
    }
    if "connection_id" not in node_columns:
        op.add_column(
            "proxmox_nodes",
            sa.Column("connection_id", sa.Integer(), nullable=True),
        )
        op.create_index(
            op.f("ix_proxmox_nodes_connection_id"),
            "proxmox_nodes",
            ["connection_id"],
        )
        op.create_foreign_key(
            "fk_proxmox_nodes_connection_id",
            "proxmox_nodes",
            "proxmox_connections",
            ["connection_id"],
            ["id"],
            ondelete="CASCADE",
        )

    # 播種：把既有 proxmox_config 轉為預設連線，並回填節點歸屬
    if _table_exists(bind, "proxmox_config"):
        config = bind.execute(
            sa.text(
                "SELECT host, \"user\", encrypted_password, verify_ssl, ca_cert, "
                "api_timeout FROM proxmox_config WHERE id = 1"
            )
        ).fetchone()
        has_connection = bind.execute(
            sa.text("SELECT 1 FROM proxmox_connections LIMIT 1")
        ).fetchone()
        if config is not None and has_connection is None:
            result = bind.execute(
                sa.text(
                    "INSERT INTO proxmox_connections "
                    "(name, host, port, \"user\", encrypted_password, verify_ssl, "
                    " ca_cert, api_timeout, enabled, is_default) "
                    "VALUES (:name, :host, 8006, :user, :encrypted_password, "
                    " :verify_ssl, :ca_cert, :api_timeout, true, true) "
                    "RETURNING id"
                ),
                {
                    "name": config.host,
                    "host": config.host,
                    "user": config.user,
                    "encrypted_password": config.encrypted_password,
                    "verify_ssl": config.verify_ssl,
                    "ca_cert": config.ca_cert,
                    "api_timeout": config.api_timeout,
                },
            ).fetchone()
            if result is not None:
                bind.execute(
                    sa.text(
                        "UPDATE proxmox_nodes SET connection_id = :cid "
                        "WHERE connection_id IS NULL"
                    ),
                    {"cid": result.id},
                )


def downgrade() -> None:
    bind = op.get_bind()
    node_columns = {
        column["name"] for column in sa.inspect(bind).get_columns("proxmox_nodes")
    }
    if "connection_id" in node_columns:
        op.drop_constraint(
            "fk_proxmox_nodes_connection_id", "proxmox_nodes", type_="foreignkey"
        )
        op.drop_index(
            op.f("ix_proxmox_nodes_connection_id"), table_name="proxmox_nodes"
        )
        op.drop_column("proxmox_nodes", "connection_id")
    if _table_exists(bind, "proxmox_connections"):
        op.drop_table("proxmox_connections")
