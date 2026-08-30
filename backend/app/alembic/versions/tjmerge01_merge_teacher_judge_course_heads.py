"""Merge the Course Lab and Teacher Judge migration branches.

Revision ID: tjmerge01_teacher_judge_heads
Revises: cpath01_link_class, tjsrc01_session_rubric_isolate
Create Date: 2026-08-27
"""

from __future__ import annotations

revision = "tjmerge01_teacher_judge_heads"
down_revision = (
    "cpath01_link_class",
    "tjsrc01_session_rubric_isolate",
)
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
