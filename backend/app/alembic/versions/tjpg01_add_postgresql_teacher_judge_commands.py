"""Add PostgreSQL Teacher Judge template commands.

Revision ID: tjpg01_postgresql_commands
Revises: tjux01_teacher_judge_workspace
Create Date: 2026-08-26
"""

from __future__ import annotations

import uuid

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "tjpg01_postgresql_commands"
down_revision = "tjux01_teacher_judge_workspace"
branch_labels = None
depends_on = None


COMMANDS = [
    (
        "postgresql.version",
        "PostgreSQL 用戶端版本",
        "runtime",
        "psql --version",
        "查看已安裝的 PostgreSQL 用戶端版本。",
    ),
    (
        "postgresql.readiness",
        "PostgreSQL 連線就緒狀態",
        "service",
        "pg_isready",
        "檢查本機 PostgreSQL 服務是否接受連線。",
    ),
    (
        "postgresql.service_status",
        "PostgreSQL 服務狀態",
        "service",
        "systemctl status postgresql",
        "讀取 PostgreSQL systemd 服務狀態。",
    ),
]


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
        [
            {
                "id": uuid.uuid4(),
                "template_key": "postgresql",
                "command_key": command_key,
                "command_label": command_label,
                "category": category,
                "command_template": command_template,
                "description": description,
                "risk_level": "read_only",
                "requires_confirmation": True,
                "enabled": True,
            }
            for command_key, command_label, category, command_template, description in COMMANDS
        ]
    )
    op.execute(
        insert_stmt.on_conflict_do_nothing(
            index_elements=["template_key", "command_key"],
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            "DELETE FROM teacher_judge_template_commands "
            "WHERE template_key = 'postgresql' AND command_key IN "
            "('postgresql.version', 'postgresql.readiness', "
            "'postgresql.service_status')"
        )
    )
