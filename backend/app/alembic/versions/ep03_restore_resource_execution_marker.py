"""Restore the retired resource-execution revision marker.

Revision ID: ep03_resource_execution
Revises: ce01_course_environments
Create Date: 2026-07-29 20:45:00.000000

Some existing installations were stamped with this revision before the
resource-execution feature was retired.  Keeping the marker allows those
databases to rejoin the maintained migration chain.  The retired schema is
not required by the current application, so this bridge intentionally makes
no schema changes.
"""

revision = "ep03_resource_execution"
down_revision = "ce01_course_environments"
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
