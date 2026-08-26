"""範本擴充：密碼/GPU 政策欄位、icon、附件表

Revision ID: tplext01
Revises: gpumdev01
Create Date: 2026-08-26
"""
import sqlalchemy as sa
from alembic import op

revision = "tplext01"
down_revision = "gpumdev01"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "vm_templates",
        sa.Column(
            "allow_password_change",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )
    op.add_column(
        "vm_templates",
        sa.Column(
            "requires_gpu",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column(
        "vm_templates",
        sa.Column("icon_url", sa.String(length=512), nullable=True),
    )
    op.create_table(
        "template_attachments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("template_id", sa.Uuid(), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("content_type", sa.String(length=100), nullable=True),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["template_id"], ["vm_templates.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_template_attachments_template_id",
        "template_attachments",
        ["template_id"],
    )


def downgrade():
    op.drop_index(
        "ix_template_attachments_template_id", table_name="template_attachments"
    )
    op.drop_table("template_attachments")
    op.drop_column("vm_templates", "icon_url")
    op.drop_column("vm_templates", "requires_gpu")
    op.drop_column("vm_templates", "allow_password_change")
