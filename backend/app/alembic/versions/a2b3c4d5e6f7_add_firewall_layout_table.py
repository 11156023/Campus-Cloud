"""add firewall_layout table

Revision ID: a2b3c4d5e6f7
Revises: f6a1b2c3d4e5
Create Date: 2026-03-22 10:00:00.000000

"""
import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "a2b3c4d5e6f7"
down_revision = "f6a1b2c3d4e5"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "firewall_layout",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("vmid", sa.Integer(), nullable=True),
        sa.Column("node_type", sa.String(), nullable=False),
        sa.Column("position_x", sa.Float(), nullable=False, server_default="100.0"),
        sa.Column("position_y", sa.Float(), nullable=False, server_default="100.0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id", "vmid", "node_type",
            name="uq_firewall_layout_user_node",
        ),
    )
    op.create_index(
        op.f("ix_firewall_layout_user_id"),
        "firewall_layout",
        ["user_id"],
        unique=False,
    )


def downgrade():
    op.drop_index(op.f("ix_firewall_layout_user_id"), table_name="firewall_layout")
    op.drop_table("firewall_layout")
