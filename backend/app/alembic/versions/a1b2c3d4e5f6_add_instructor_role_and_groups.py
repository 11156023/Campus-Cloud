"""add instructor role and groups tables

Revision ID: a1b2c3d4e5f6
Revises: e48bab2b8407
Create Date: 2026-03-20 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel.sql.sqltypes

# revision identifiers, used by Alembic.
revision = "a1b2c3d4e5f6"
down_revision = "e48bab2b8407"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "user",
        sa.Column("is_instructor", sa.Boolean(), nullable=False, server_default="false"),
    )

    ctx = op.get_context()
    with ctx.autocommit_block():
        op.execute("ALTER TYPE auditaction ADD VALUE IF NOT EXISTS 'group_create'")
        op.execute("ALTER TYPE auditaction ADD VALUE IF NOT EXISTS 'group_delete'")
        op.execute("ALTER TYPE auditaction ADD VALUE IF NOT EXISTS 'group_member_add'")
        op.execute("ALTER TYPE auditaction ADD VALUE IF NOT EXISTS 'group_member_remove'")
        op.execute("ALTER TYPE auditaction ADD VALUE IF NOT EXISTS 'batch_provision_vm'")
        op.execute("ALTER TYPE auditaction ADD VALUE IF NOT EXISTS 'batch_provision_lxc'")

    op.create_table(
        "group",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sqlmodel.sql.sqltypes.AutoString(length=255), nullable=False),
        sa.Column("description", sqlmodel.sql.sqltypes.AutoString(length=1000), nullable=True),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_group_owner_id", "group", ["owner_id"], unique=False)

    op.create_table(
        "group_member",
        sa.Column("group_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("added_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["group_id"], ["group.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("group_id", "user_id"),
    )


def downgrade():
    op.drop_table("group_member")
    op.drop_index("ix_group_owner_id", table_name="group")
    op.drop_table("group")
    op.drop_column("user", "is_instructor")
