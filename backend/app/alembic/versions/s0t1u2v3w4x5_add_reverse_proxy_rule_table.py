"""add reverse_proxy_rule table

Revision ID: s0t1u2v3w4x5
Revises: r9s0t1u2v3w4
Create Date: 2026-04-05

"""
import sqlalchemy as sa
from alembic import op

revision = "s0t1u2v3w4x5"
down_revision = "r9s0t1u2v3w4"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "reverse_proxy_rule",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("vmid", sa.Integer(), nullable=False),
        sa.Column("vm_ip", sa.String(length=64), nullable=False),
        sa.Column("domain", sa.String(length=255), nullable=False),
        sa.Column("internal_port", sa.Integer(), nullable=False),
        sa.Column("enable_https", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("dns_provider", sa.String(length=32), nullable=False, server_default="manual"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("domain"),
    )
    op.create_index(op.f("ix_reverse_proxy_rule_vmid"), "reverse_proxy_rule", ["vmid"])


def downgrade():
    op.drop_index(op.f("ix_reverse_proxy_rule_vmid"), table_name="reverse_proxy_rule")
    op.drop_table("reverse_proxy_rule")
