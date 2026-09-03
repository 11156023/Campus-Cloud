"""Drop VMTemplate.icon_url.

The template icon feature was removed (2026-09-02): templates no longer
carry a custom image, so the column and its files go away. Idempotent in
both directions because shared dev databases may drift from this chain.

Revision ID: tplicon01_drop_icon_url
Revises: tplgpu02_restore_requires_gpu
Create Date: 2026-09-02
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "tplicon01_drop_icon_url"
down_revision = "tplgpu02_restore_requires_gpu"
branch_labels = None
depends_on = None

_TABLE = "vm_templates"
_COLUMN = "icon_url"


def _has_column() -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(col["name"] == _COLUMN for col in inspector.get_columns(_TABLE))


def upgrade() -> None:
    if not _has_column():
        return
    op.drop_column(_TABLE, _COLUMN)


def downgrade() -> None:
    if _has_column():
        return
    op.add_column(
        _TABLE, sa.Column(_COLUMN, sa.String(length=512), nullable=True)
    )
