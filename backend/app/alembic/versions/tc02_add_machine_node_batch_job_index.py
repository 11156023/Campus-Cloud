"""Add the teaching-class machine-node batch-job index.

Revision ID: tc02_machine_job_idx
Revises: tc01_teaching_class
"""

from alembic import op

revision = "tc02_machine_job_idx"
down_revision = "tc01_teaching_class"
branch_labels = None
depends_on = None


def upgrade():
    op.create_index(
        "ix_teaching_class_machine_nodes_batch_job_id",
        "teaching_class_machine_nodes",
        ["batch_job_id"],
    )


def downgrade():
    op.drop_index(
        "ix_teaching_class_machine_nodes_batch_job_id",
        table_name="teaching_class_machine_nodes",
    )
