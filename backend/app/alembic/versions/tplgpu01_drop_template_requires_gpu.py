"""Templates can no longer require a GPU.

Revision ID: tplgpu01_drop_requires_gpu
Revises: ce02_drop_env_code
Create Date: 2026-08-31
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "tplgpu01_drop_requires_gpu"
down_revision = "ce02_drop_env_code"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("vm_templates", "requires_gpu")


def downgrade() -> None:
    op.add_column(
        "vm_templates",
        sa.Column(
            "requires_gpu",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
