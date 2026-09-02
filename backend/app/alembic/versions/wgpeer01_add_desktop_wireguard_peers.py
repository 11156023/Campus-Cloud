"""Add desktop WireGuard peer registry.

Revision ID: wgpeer01
Revises: dbc02_drop_dead
Create Date: 2026-09-01
"""

import sqlalchemy as sa
from alembic import op

revision = "wgpeer01"
down_revision = "dbc02_drop_dead"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "wireguard_peers",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("device_id", sa.String(length=128), nullable=False),
        sa.Column("public_key", sa.String(length=64), nullable=False),
        sa.Column("tunnel_ip", sa.String(length=45), nullable=False),
        sa.Column("allowed_endpoints", sa.JSON(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_connected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id", "device_id", name="uq_wireguard_peers_user_device"
        ),
        sa.UniqueConstraint("public_key", name="uq_wireguard_peers_public_key"),
        sa.UniqueConstraint("tunnel_ip", name="uq_wireguard_peers_tunnel_ip"),
    )
    op.create_index(
        "ix_wireguard_peers_user_id",
        "wireguard_peers",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        "ix_wireguard_peers_active_expires",
        "wireguard_peers",
        ["active", "expires_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_wireguard_peers_active_expires", table_name="wireguard_peers")
    op.drop_index("ix_wireguard_peers_user_id", table_name="wireguard_peers")
    op.drop_table("wireguard_peers")
