"""Add student_clusters to class_capacity_reservations.

整班學生對叢集的分配結果（{user_id: connection_id}）。一位學生的所有機器
必須落在同一個叢集，但不同學生可以分屬不同叢集 —— 例如 25 位在 A、10 位
在 B。分配在容量預留時定案並存下來，建機時直接查表，避免兩個時間點各自
重算而讓同一位學生的機器散到不同叢集。

空字典 = 未分配（舊資料），建機端沿用既有的單一叢集行為。

Revision ID: clsalloc01_student_clusters
Revises: pgrp01_placement_group
Create Date: 2026-09-03 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

revision = "clsalloc01_student_clusters"
down_revision = "pgrp01_placement_group"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "class_capacity_reservations",
        sa.Column(
            "student_clusters",
            sa.Text(),
            nullable=False,
            server_default="{}",
        ),
    )


def downgrade():
    op.drop_column("class_capacity_reservations", "student_clusters")
