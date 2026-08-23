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


def upgrade():
    op.add_column(
        "resources",
        sa.Column("login_password_encrypted", sa.String(), nullable=True),
    )


def downgrade():
    op.drop_column("resources", "login_password_encrypted")
