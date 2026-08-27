"""Add resources.login_password_encrypted for per-clone login passwords.

Revision ID: clonepw01_login_password
Revises: rmsd01_remove_script_deploy
Create Date: 2026-08-09
"""

import sqlalchemy as sa
from alembic import op

revision = "clonepw01_login_password"
down_revision = "rmsd01_remove_script_deploy"
branch_labels = None
depends_on = None


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column in {c["name"] for c in inspector.get_columns(table)}


def upgrade():
    # 冪等：fork 舊部署的 alembic stamp 可能落在上游 gpumdev01 橋接位，
    # 重播本 migration 時欄位已存在
    if _has_column("resources", "login_password_encrypted"):
        return
    op.add_column(
        "resources",
        sa.Column("login_password_encrypted", sa.String(), nullable=True),
    )


def downgrade():
    op.drop_column("resources", "login_password_encrypted")
