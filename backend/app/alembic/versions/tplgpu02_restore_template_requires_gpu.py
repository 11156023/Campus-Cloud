"""Restore VMTemplate.requires_gpu.

tplgpu01 dropped the column when upstream moved GPU selection off the
template; this fork keeps the「範本需要 GPU」policy (clone 時強制選 GPU），
so the column comes back with the same definition it had before.

The upgrade is idempotent: shared dev databases may already carry the
column (added by hand while their alembic head lived on another branch),
so we only add it when it is really missing.

Revision ID: tplgpu02_restore_requires_gpu
Revises: wgpeer01
Create Date: 2026-09-02
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "tplgpu02_restore_requires_gpu"
down_revision = "wgpeer01"
branch_labels = None
depends_on = None

_TABLE = "vm_templates"
_COLUMN = "requires_gpu"


def _has_column() -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(col["name"] == _COLUMN for col in inspector.get_columns(_TABLE))


def upgrade() -> None:
    if _has_column():
        return
    op.add_column(
        _TABLE,
        sa.Column(
            _COLUMN,
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    if not _has_column():
        return
    op.drop_column(_TABLE, _COLUMN)
