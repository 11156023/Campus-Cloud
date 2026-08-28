"""Add the controlled Python entrypoint execution capability.

Revision ID: tjpy01_python_entrypoint
Revises: tjmerge02_all_heads
Create Date: 2026-08-27
"""

from __future__ import annotations

import uuid

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "tjpy01_python_entrypoint"
down_revision = "tjmerge02_all_heads"
branch_labels = None
depends_on = None


def upgrade() -> None:
    command_table = sa.table(
        "teacher_judge_template_commands",
        sa.column("id", sa.Uuid()),
        sa.column("template_key", sa.String()),
        sa.column("command_key", sa.String()),
        sa.column("command_label", sa.String()),
        sa.column("category", sa.String()),
        sa.column("command_template", sa.Text()),
        sa.column("description", sa.Text()),
        sa.column("risk_level", sa.String()),
        sa.column("requires_confirmation", sa.Boolean()),
        sa.column("enabled", sa.Boolean()),
    )
    insert_stmt = postgresql.insert(command_table).values(
        id=uuid.uuid4(),
        template_key="python",
        command_key="python.run_entrypoint",
        command_label="執行 Python 程式入口",
        category="execution",
        command_template="python3 main.py",
        description=(
            "在老師明確提供的工作目錄，以指定 Python 直譯器與參數執行程式入口，"
            "使用有限 timeout 收集 exit code、stdout、stderr 與未捕捉例外。"
            "若工作目錄、實際命令或正常結束／常駐判準不完整，必須先向老師詢問，"
            "不得猜測路徑或改成其他檢查目標。"
        ),
        risk_level="executes_code",
        requires_confirmation=True,
        enabled=True,
    )
    op.execute(
        insert_stmt.on_conflict_do_update(
            index_elements=["template_key", "command_key"],
            set_={
                "command_label": insert_stmt.excluded.command_label,
                "category": insert_stmt.excluded.category,
                "command_template": insert_stmt.excluded.command_template,
                "description": insert_stmt.excluded.description,
                "risk_level": insert_stmt.excluded.risk_level,
                "requires_confirmation": insert_stmt.excluded.requires_confirmation,
                "enabled": insert_stmt.excluded.enabled,
            },
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            "DELETE FROM teacher_judge_template_commands "
            "WHERE template_key = 'python' "
            "AND command_key = 'python.run_entrypoint'"
        )
    )
