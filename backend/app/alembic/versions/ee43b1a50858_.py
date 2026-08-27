"""drop stray unique index on teacher_judge_sessions.selected_file_id

此索引（uq_teacher_judge_sessions_selected_file）不存在於任何 migration 歷史，
僅殘留於部分開發資料庫，故以 IF EXISTS 冪等清除；全新資料庫為 no-op。

Revision ID: ee43b1a50858
Revises: mrgtpl01
Create Date: 2026-08-27 16:05:28.929179

"""
from alembic import op


# revision identifiers, used by Alembic.
revision = 'ee43b1a50858'
down_revision = 'mrgtpl01'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("DROP INDEX IF EXISTS uq_teacher_judge_sessions_selected_file")


def downgrade():
    # 該索引本就不屬於 migration 定義的 schema 狀態，downgrade 不重建
    pass
