"""merge_multiple_heads

Revision ID: 80a146f9ff77
Revises: f6b3542f1194, p7q8r9s0t1u2
Create Date: 2026-04-05 17:13:52.664354

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel.sql.sqltypes


# revision identifiers, used by Alembic.
revision = '80a146f9ff77'
down_revision = ('f6b3542f1194', 'p7q8r9s0t1u2')
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
