"""Merge the quick-practice and Teacher Judge migration heads.

Revision ID: tjmerge03_all_heads
Revises: qpfix01, tjpy01_python_entrypoint
Create Date: 2026-08-30

Both branches already contain their schema changes.  This revision only joins
the version graph so ``alembic upgrade head`` has one deterministic target.
"""

from __future__ import annotations

revision = "tjmerge03_all_heads"
down_revision = ("qpfix01", "tjpy01_python_entrypoint")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
