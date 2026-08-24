"""Merge the PVE connection and teacher-judge migration branches.

兩條分支都從 aipve01_ai_pve_templates 分出，形成兩個 head，
`alembic upgrade head`（單數）會因此失敗。此節點只合併版本鏈，
不做任何 schema 變更。

Revision ID: mrg01_merge_heads
Revises: pconn02_conn_settings, tjs01_teacher_judge_sessions
Create Date: 2026-08-02 00:00:00.000000
"""

from __future__ import annotations

revision = "mrg01_merge_heads"
down_revision = ("pconn02_conn_settings", "tjs01_teacher_judge_sessions")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
