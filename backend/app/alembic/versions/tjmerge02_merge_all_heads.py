"""Merge the upstream template cleanup and Teacher Judge migration heads.

The SkyLab upstream branch added ``ee43b1a50858`` after the template/course
merge, while the local Teacher Judge work already ended at
``tjmerge01_teacher_judge_heads``.  Both branches share ``cpath01_link_class``;
this revision joins them so ``alembic upgrade head`` has one deterministic head.

Revision ID: tjmerge02_all_heads
Revises: ee43b1a50858, tjmerge01_teacher_judge_heads
Create Date: 2026-08-27
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "tjmerge02_all_heads"
down_revision = ("ee43b1a50858", "tjmerge01_teacher_judge_heads")
branch_labels = None
depends_on = None


def _index_exists(table_name: str, index_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(index["name"] == index_name for index in inspector.get_indexes(table_name))


def upgrade() -> None:
    # ``ee43b1a50858`` removes an index that is stray on upstream-only
    # checkouts.  The local Teacher Judge branch deliberately makes the same
    # name a model-backed ownership constraint, so restore it after both
    # branches have been applied.
    if not _index_exists(
        "teacher_judge_sessions", "uq_teacher_judge_sessions_selected_file"
    ):
        op.create_index(
            "uq_teacher_judge_sessions_selected_file",
            "teacher_judge_sessions",
            ["selected_file_id"],
            unique=True,
            postgresql_where=sa.text("selected_file_id IS NOT NULL"),
            sqlite_where=sa.text("selected_file_id IS NOT NULL"),
        )


def downgrade() -> None:
    pass
