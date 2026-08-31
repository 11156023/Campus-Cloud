"""Scope quick-practice environments to an audience.

Existing environments keep today's behaviour (visible to every signed-in
user) so no published practice disappears on deploy; new ones default to
the linked classes only.

Revision ID: ce03_env_audience
Revises: tplgpu01_drop_requires_gpu
Create Date: 2026-08-31
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "ce03_env_audience"
down_revision = "tplgpu01_drop_requires_gpu"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "course_environments",
        sa.Column(
            "audience",
            sa.String(length=24),
            nullable=False,
            server_default="campus",
        ),
    )
    op.create_table(
        "course_environment_audiences",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "environment_id",
            sa.Uuid(),
            sa.ForeignKey("course_environments.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "class_id",
            sa.Uuid(),
            sa.ForeignKey("teaching_classes.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False
        ),
        sa.UniqueConstraint(
            "environment_id", "class_id", name="uq_course_environment_audience"
        ),
    )


def downgrade() -> None:
    op.drop_table("course_environment_audiences")
    op.drop_column("course_environments", "audience")
