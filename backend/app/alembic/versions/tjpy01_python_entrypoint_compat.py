"""Restore the historical Python-entrypoint revision marker.

Revision ID: tjpy01_python_entrypoint
Revises: qpfix01
Create Date: 2026-08-29

The deployed development database already records this revision.  Its change
was application-only, so this compatibility node restores the migration graph
without introducing schema drift for fresh databases.
"""

revision = "tjpy01_python_entrypoint"
down_revision = "qpfix01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
