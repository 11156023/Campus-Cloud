"""Drop the quick-practice vm_request unique constraint duplicated by its index.

Revision ID: qpfix01
Revises: qpmrg01
Create Date: 2026-08-27
"""

import sqlalchemy as sa
from alembic import op

revision = "qpfix01"
down_revision = "qpmrg01"
branch_labels = None
depends_on = None


TABLE_NAME = "quick_practice_session_machines"
COLUMNS = {"vm_request_id"}


def _matching_unique_constraint() -> str | None:
    inspector = sa.inspect(op.get_bind())
    for constraint in inspector.get_unique_constraints(TABLE_NAME):
        if set(constraint.get("column_names") or []) == COLUMNS:
            return constraint.get("name")
    return None


def upgrade() -> None:
    # SQLModel 的 unique=True + index=True 會建立唯一索引；qp01 額外建立的
    # UNIQUE constraint 不僅重複，也會被 alembic check 判定為 schema drift。
    constraint_name = _matching_unique_constraint()
    if constraint_name:
        op.drop_constraint(constraint_name, TABLE_NAME, type_="unique")


def downgrade() -> None:
    if _matching_unique_constraint() is None:
        op.create_unique_constraint(
            "quick_practice_session_machines_vm_request_id_key",
            TABLE_NAME,
            ["vm_request_id"],
        )
