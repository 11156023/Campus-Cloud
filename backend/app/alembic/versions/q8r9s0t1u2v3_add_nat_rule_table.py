"""add nat_rule table

Revision ID: q8r9s0t1u2v3
Revises: p7q8r9s0t1u2
Create Date: 2026-04-05

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "q8r9s0t1u2v3"
down_revision = "80a146f9ff77"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "nat_rule",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("ssh_host", sa.String(length=255), nullable=False),
        sa.Column("vmid", sa.Integer(), nullable=False),
        sa.Column("vm_ip", sa.String(length=64), nullable=False),
        sa.Column("external_port", sa.Integer(), nullable=False),
        sa.Column("internal_port", sa.Integer(), nullable=False),
        sa.Column("protocol", sa.String(length=16), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_nat_rule_vmid", "nat_rule", ["vmid"])


def downgrade():
    op.drop_index("ix_nat_rule_vmid", table_name="nat_rule")
    op.drop_table("nat_rule")
