"""add migration_pinned and resource_warning to vm_requests

Revision ID: b2c3d4e5f6a9
Revises: a1b2c3d4e5f8
Create Date: 2026-04-06 14:00:00.000000

"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "b2c3d4e5f6a9"
down_revision = "a1b2c3d4e5f8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "vm_requests",
        sa.Column(
            "migration_pinned",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
    )
    op.add_column(
        "vm_requests",
        sa.Column("resource_warning", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("vm_requests", "resource_warning")
    op.drop_column("vm_requests", "migration_pinned")
