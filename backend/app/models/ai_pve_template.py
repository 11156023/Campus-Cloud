"""Database-backed AI PVE machine-role templates."""

import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlmodel import Field, SQLModel

from .base import get_datetime_utc


class AIPVETemplate(SQLModel, table=True):
    """A small, non-authorizing description of a machine's role.

    The template intentionally contains no VM identity, connection details, or
    command authorization.  Those remain server-side concerns owned by the
    resource and SSH policy layers.
    """

    __tablename__ = "ai_pve_templates"
    __table_args__ = (
        sa.UniqueConstraint(
            "template_key",
            name="uq_ai_pve_templates_template_key",
        ),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    template_key: str = Field(max_length=50, index=True)
    display_name: str = Field(max_length=100)
    description: str = Field(sa_column=sa.Column(sa.Text(), nullable=False))
    system_prompt: str = Field(sa_column=sa.Column(sa.Text(), nullable=False))
    enabled: bool = Field(default=True, index=True)
    created_at: datetime = Field(
        default_factory=get_datetime_utc,
        sa_column=sa.Column(sa.DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=get_datetime_utc,
        sa_column=sa.Column(sa.DateTime(timezone=True), nullable=False),
    )


__all__ = ["AIPVETemplate"]
