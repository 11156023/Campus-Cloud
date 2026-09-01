"""Add quick-practice topology and reclaim lifecycle state.

Revision ID: qp02_lifecycle
Revises: wkcp01
Create Date: 2026-08-31
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "qp02_lifecycle"
down_revision = "wkcp01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "quick_practice_sessions",
        sa.Column(
            "status",
            sa.String(length=24),
            nullable=False,
            server_default="creating",
        ),
    )
    op.add_column(
        "quick_practice_sessions",
        sa.Column("topology_applied_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "quick_practice_sessions",
        sa.Column("reclaim_started_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "quick_practice_sessions",
        sa.Column("reclaimed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "quick_practice_sessions",
        sa.Column("last_error", sa.String(length=2000), nullable=True),
    )
    op.create_index(
        "ix_quick_practice_sessions_status",
        "quick_practice_sessions",
        ["status"],
    )
    op.create_index(
        "ix_quick_practice_sessions_reclaimed_at",
        "quick_practice_sessions",
        ["reclaimed_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_quick_practice_sessions_reclaimed_at",
        table_name="quick_practice_sessions",
    )
    op.drop_index(
        "ix_quick_practice_sessions_status",
        table_name="quick_practice_sessions",
    )
    op.drop_column("quick_practice_sessions", "last_error")
    op.drop_column("quick_practice_sessions", "reclaimed_at")
    op.drop_column("quick_practice_sessions", "reclaim_started_at")
    op.drop_column("quick_practice_sessions", "topology_applied_at")
    op.drop_column("quick_practice_sessions", "status")
