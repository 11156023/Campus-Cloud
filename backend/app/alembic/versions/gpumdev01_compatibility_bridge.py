"""Restore the legacy gpumdev01 revision marker.

Revision ID: gpumdev01
Revises: rmsd01_remove_script_deploy
Create Date: 2026-08-25

Some existing deployments were stamped with ``gpumdev01`` by a migration
that is no longer present in the repository.  The current model and migration
chain do not depend on schema objects from that removed migration, so this
no-op bridge makes those databases reachable without rewriting their
``alembic_version`` row by hand.
"""

revision = "gpumdev01"
down_revision = "rmsd01_remove_script_deploy"
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
