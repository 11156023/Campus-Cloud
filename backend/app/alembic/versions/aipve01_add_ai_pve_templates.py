"""Add AI PVE machine-role templates and default seed rows.

Revision ID: aipve01_ai_pve_templates
Revises: tjcs01
Create Date: 2026-07-30 00:00:00.000000
"""

from __future__ import annotations

import uuid

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "aipve01_ai_pve_templates"
down_revision = "tjcs01"
branch_labels = None
depends_on = None


TEMPLATES = (
    {
        "template_key": "n8n",
        "display_name": "N8N",
        "description": "N8N 自動化工作流程機器的診斷與受控操作。",
        "system_prompt": (
            "這是一台 N8N 自動化工作流程機器。預設先確認 n8n 程序、Docker container、"
            "5678 連接埠、localhost HTTP 回應、服務日誌與磁碟空間。先診斷再修改；"
            "修改設定前先讀取目前狀態，執行後以 exit code、stdout、stderr 驗證結果。"
            "不要假設一定使用 Docker、systemd 或 npm，必須先探測實際安裝方式。"
        ),
    },
    {
        "template_key": "python",
        "display_name": "Python",
        "description": "Python 應用機器的執行環境與服務診斷。",
        "system_prompt": (
            "這是一台 Python 應用機器。預設先確認 Python 版本、虛擬環境、套件管理方式、"
            "執行中的 Python/Uvicorn/Gunicorn 程序、監聽連接埠與應用日誌。不要直接修改"
            "system Python；先辨識 venv、uv、Poetry 或容器邊界，再執行對應指令。"
        ),
    },
    {
        "template_key": "postgresql",
        "display_name": "PostgreSQL",
        "description": "PostgreSQL 資料庫機器的唯讀健康檢查與受控診斷。",
        "system_prompt": (
            "這是一台 PostgreSQL 資料庫機器。預設先確認 PostgreSQL 版本、服務狀態、"
            "監聽位址與連接埠、磁碟空間、連線數及近期錯誤。禁止把密碼、連線字串或查詢"
            "結果中的敏感資料帶回對話。任何 schema/data 變更、重啟、restore、drop、"
            "truncate 或大量 update 都必須先清楚說明影響並取得確認。"
        ),
    },
)


def _table_exists(bind: sa.Connection, table_name: str) -> bool:
    return sa.inspect(bind).has_table(table_name)


def upgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, "ai_pve_templates"):
        op.create_table(
            "ai_pve_templates",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("template_key", sa.String(length=50), nullable=False),
            sa.Column("display_name", sa.String(length=100), nullable=False),
            sa.Column("description", sa.Text(), nullable=False),
            sa.Column("system_prompt", sa.Text(), nullable=False),
            sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "template_key",
                name="uq_ai_pve_templates_template_key",
            ),
        )

    existing_indexes = {
        index["name"] for index in sa.inspect(bind).get_indexes("ai_pve_templates")
    }
    for name, column in (
        (op.f("ix_ai_pve_templates_template_key"), "template_key"),
        (op.f("ix_ai_pve_templates_enabled"), "enabled"),
    ):
        if name not in existing_indexes:
            op.create_index(name, "ai_pve_templates", [column])

    template_table = sa.table(
        "ai_pve_templates",
        sa.column("id", sa.Uuid()),
        sa.column("template_key", sa.String()),
        sa.column("display_name", sa.String()),
        sa.column("description", sa.Text()),
        sa.column("system_prompt", sa.Text()),
        sa.column("enabled", sa.Boolean()),
    )
    rows = [
        {
            "id": uuid.uuid4(),
            **template,
            "enabled": True,
        }
        for template in TEMPLATES
    ]
    op.execute(
        postgresql.insert(template_table)
        .values(rows)
        .on_conflict_do_nothing(index_elements=["template_key"])
    )


def downgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, "ai_pve_templates"):
        return
    op.drop_index(op.f("ix_ai_pve_templates_enabled"), table_name="ai_pve_templates")
    op.drop_index(
        op.f("ix_ai_pve_templates_template_key"), table_name="ai_pve_templates"
    )
    op.drop_table("ai_pve_templates")
