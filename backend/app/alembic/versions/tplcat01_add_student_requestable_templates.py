"""Open selected templates for student self-service requests.

Revision ID: tplcat01_student_catalog
Revises: ce03_env_audience
Create Date: 2026-08-31
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "tplcat01_student_catalog"
down_revision = "ce03_env_audience"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "vm_templates",
        sa.Column(
            "student_requestable",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("vm_templates", "student_requestable")
