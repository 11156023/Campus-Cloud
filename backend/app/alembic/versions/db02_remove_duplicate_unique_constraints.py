"""Remove unique constraints duplicated by unique indexes.

Revision ID: db02_remove_duplicate_uniques
Revises: db01_schema_reconcile
Create Date: 2026-07-29 22:05:00.000000

"""

import sqlalchemy as sa
from alembic import op

revision = "db02_remove_duplicate_uniques"
down_revision = "db01_schema_reconcile"
branch_labels = None
depends_on = None


def _drop_unique_constraint(table_name: str, columns: set[str]) -> None:
    inspector = sa.inspect(op.get_bind())
    for constraint in inspector.get_unique_constraints(table_name):
        if set(constraint.get("column_names") or []) != columns:
            continue
        name = constraint.get("name")
        if name:
            op.drop_constraint(name, table_name, type_="unique")


def _has_unique_constraint(table_name: str, columns: set[str]) -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(
        set(constraint.get("column_names") or []) == columns
        for constraint in inspector.get_unique_constraints(table_name)
    )


def upgrade() -> None:
    # Both columns already have unique indexes declared by the SQLModel
    # metadata.  Keeping an additional UNIQUE constraint is redundant and
    # makes `alembic check` report model drift.
    _drop_unique_constraint("class_capacity_reservations", {"class_id"})
    _drop_unique_constraint("ip_allocation", {"reservation_key"})


def downgrade() -> None:
    if not _has_unique_constraint(
        "class_capacity_reservations", {"class_id"}
    ):
        op.create_unique_constraint(
            "class_capacity_reservations_class_id_key",
            "class_capacity_reservations",
            ["class_id"],
        )
    if not _has_unique_constraint("ip_allocation", {"reservation_key"}):
        op.create_unique_constraint(
            "uq_ip_allocation_reservation_key",
            "ip_allocation",
            ["reservation_key"],
        )
