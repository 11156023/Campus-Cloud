"""VMTemplate CRUD 與可見範圍查詢。"""

import uuid
from datetime import datetime, timezone

from sqlmodel import Session, col, or_, select

from app.models import (
    VMTemplate,
    VMTemplateStatus,
    VMTemplateVisibility,
)


def create_template(
    *,
    session: Session,
    pve_vmid: int,
    name: str,
    owner_id: uuid.UUID,
    node: str,
    resource_type: str,
    description: str | None = None,
    storage: str | None = None,
    visibility: VMTemplateVisibility = VMTemplateVisibility.private,
    default_cores: int | None = None,
    default_memory: int | None = None,
    allow_password_change: bool = True,
    source_vmid: int | None = None,
    commit: bool = True,
) -> VMTemplate:
    template = VMTemplate(
        pve_vmid=pve_vmid,
        name=name,
        description=description,
        owner_id=owner_id,
        node=node,
        storage=storage,
        resource_type=resource_type,
        visibility=visibility,
        default_cores=default_cores,
        default_memory=default_memory,
        allow_password_change=allow_password_change,
        source_vmid=source_vmid,
    )
    session.add(template)
    if commit:
        session.commit()
    else:
        session.flush()
    session.refresh(template)
    return template


def get_template(
    *, session: Session, template_id: uuid.UUID
) -> VMTemplate | None:
    return session.get(VMTemplate, template_id)


def get_template_by_pve_vmid(
    *, session: Session, pve_vmid: int, include_deleted: bool = False
) -> VMTemplate | None:
    stmt = select(VMTemplate).where(VMTemplate.pve_vmid == pve_vmid)
    if not include_deleted:
        stmt = stmt.where(VMTemplate.status != VMTemplateStatus.deleted)
    return session.exec(stmt).first()


def revive_deleted_template(
    *,
    session: Session,
    template: VMTemplate,
    name: str,
    owner_id: uuid.UUID,
    node: str,
    resource_type: str,
    description: str | None = None,
    visibility: VMTemplateVisibility = VMTemplateVisibility.private,
    default_cores: int | None = None,
    default_memory: int | None = None,
    allow_password_change: bool = True,
    source_vmid: int | None = None,
    commit: bool = True,
) -> VMTemplate:
    """復用軟刪除紀錄重新開始範本生命週期。

    pve_vmid 有 unique 約束、刪除又是軟刪除，PVE 回收重用 VMID 後
    只能覆寫原紀錄，否則該 VMID 永遠無法再註冊成範本。
    """
    now = datetime.now(timezone.utc)
    template.name = name
    template.description = description
    template.owner_id = owner_id
    template.node = node
    template.storage = None
    template.resource_type = resource_type
    template.status = VMTemplateStatus.creating
    template.visibility = visibility
    template.default_cores = default_cores
    template.default_memory = default_memory
    template.default_disk = None
    template.allow_password_change = allow_password_change
    template.icon_url = None
    template.source_vmid = source_vmid
    template.version = 1
    template.error_message = None
    template.created_at = now
    template.updated_at = now
    session.add(template)
    if commit:
        session.commit()
    else:
        session.flush()
    session.refresh(template)
    return template


def list_all_templates(
    *, session: Session, include_deleted: bool = False
) -> list[VMTemplate]:
    stmt = select(VMTemplate)
    if not include_deleted:
        stmt = stmt.where(VMTemplate.status != VMTemplateStatus.deleted)
    stmt = stmt.order_by(col(VMTemplate.created_at).desc())
    return list(session.exec(stmt).all())


def list_visible_templates(
    *,
    session: Session,
    user_id: uuid.UUID,
    only_ready: bool = False,
) -> list[VMTemplate]:
    """非 admin 只看自己擁有的範本，或所有人可見的範本。"""
    stmt = (
        select(VMTemplate)
        .where(VMTemplate.status != VMTemplateStatus.deleted)
        .where(
            or_(
                VMTemplate.owner_id == user_id,
                VMTemplate.visibility == VMTemplateVisibility.global_,
            )
        )
    )
    if only_ready:
        stmt = stmt.where(VMTemplate.status == VMTemplateStatus.ready)
    stmt = stmt.order_by(col(VMTemplate.created_at).desc())
    return list(session.exec(stmt).all())

def touch(*, session: Session, template: VMTemplate, commit: bool = True) -> None:
    template.updated_at = datetime.now(timezone.utc)
    session.add(template)
    if commit:
        session.commit()
        session.refresh(template)

def is_template_visible_to_user(
    *, template: VMTemplate, user_id: uuid.UUID
) -> bool:
    return (
        template.owner_id == user_id
        or template.visibility == VMTemplateVisibility.global_
    )
