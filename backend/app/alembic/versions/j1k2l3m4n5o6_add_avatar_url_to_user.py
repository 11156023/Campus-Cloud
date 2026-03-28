"""add avatar url to user

Revision ID: j1k2l3m4n5o6
Revises: i9j0k1l2m3n4
Create Date: 2026-03-28 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

revision = "j1k2l3m4n5o6"
down_revision = "i9j0k1l2m3n4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("user", sa.Column("avatar_url", sa.String(length=2048), nullable=True))


def downgrade() -> None:
    op.drop_column("user", "avatar_url")
