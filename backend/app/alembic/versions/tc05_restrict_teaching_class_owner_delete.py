"""Prevent teacher deletion from orphaning teaching-class resources.

Revision ID: tc05_class_owner_restrict
Revises: tc04_class_resource_governance
Create Date: 2026-08-25
"""

from alembic import op

revision = "tc05_class_owner_restrict"
down_revision = "tc04_class_resource_governance"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint(
        "teaching_classes_owner_id_fkey",
        "teaching_classes",
        type_="foreignkey",
    )
    op.create_foreign_key(
        "teaching_classes_owner_id_fkey",
        "teaching_classes",
        "user",
        ["owner_id"],
        ["id"],
        ondelete="RESTRICT",
    )


def downgrade() -> None:
    op.drop_constraint(
        "teaching_classes_owner_id_fkey",
        "teaching_classes",
        type_="foreignkey",
    )
    op.create_foreign_key(
        "teaching_classes_owner_id_fkey",
        "teaching_classes",
        "user",
        ["owner_id"],
        ["id"],
        ondelete="CASCADE",
    )
