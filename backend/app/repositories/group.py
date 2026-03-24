"""群組相關資料庫操作"""

import uuid
from datetime import datetime, timezone

from sqlmodel import Session, select

from app.models.group import Group
from app.models.group_member import GroupMember
from app.models.user import User


def create_group(
    *,
    session: Session,
    name: str,
    description: str | None,
    owner_id: uuid.UUID,
) -> Group:
    db_group = Group(
        name=name,
        description=description,
        owner_id=owner_id,
        created_at=datetime.now(timezone.utc),
    )
    session.add(db_group)
    session.commit()
    session.refresh(db_group)
    return db_group


def get_group_by_id(*, session: Session, group_id: uuid.UUID) -> Group | None:
    return session.exec(select(Group).where(Group.id == group_id)).first()


def get_groups_by_owner(*, session: Session, owner_id: uuid.UUID) -> list[Group]:
    return list(session.exec(select(Group).where(Group.owner_id == owner_id)).all())


def get_all_groups(*, session: Session) -> list[Group]:
    return list(session.exec(select(Group)).all())


def delete_group(*, session: Session, group_id: uuid.UUID) -> None:
    db_group = get_group_by_id(session=session, group_id=group_id)
    if db_group:
        session.delete(db_group)
        session.commit()


def get_group_members(*, session: Session, group_id: uuid.UUID) -> list[User]:
    """回傳群組內所有 User 物件"""
    members = list(
        session.exec(
            select(GroupMember).where(GroupMember.group_id == group_id)
        ).all()
    )
    user_ids = [m.user_id for m in members]
    if not user_ids:
        return []
    return list(session.exec(select(User).where(User.id.in_(user_ids))).all())


def get_member_rows(*, session: Session, group_id: uuid.UUID) -> list[GroupMember]:
    """回傳群組成員的 GroupMember rows（含 added_at）"""
    return list(
        session.exec(
            select(GroupMember).where(GroupMember.group_id == group_id)
        ).all()
    )


def add_members_by_emails(
    *, session: Session, group_id: uuid.UUID, emails: list[str]
) -> tuple[list[GroupMember], list[str]]:
    added: list[GroupMember] = []
    not_found: list[str] = []

    existing_members = set(
        m.user_id
        for m in session.exec(
            select(GroupMember).where(GroupMember.group_id == group_id)
        ).all()
    )

    # Use a single query to fetch all users whose emails are in the list,
    # then do in-memory lookups to avoid N+1 queries.
    users = list(session.exec(select(User).where(User.email.in_(emails))).all())
    users_by_email = {u.email: u for u in users}

    for email in emails:
        user = users_by_email.get(email)
        if not user:
            not_found.append(email)
            continue
        if user.id in existing_members:
            continue
        gm = GroupMember(
            group_id=group_id,
            user_id=user.id,
            added_at=datetime.now(timezone.utc),
        )
        session.add(gm)
        added.append(gm)
        existing_members.add(user.id)

    session.commit()
    return added, not_found


def remove_member(
    *, session: Session, group_id: uuid.UUID, user_id: uuid.UUID
) -> bool:
    """移除成員，回傳是否成功找到並刪除"""
    gm = session.exec(
        select(GroupMember).where(
            GroupMember.group_id == group_id,
            GroupMember.user_id == user_id,
        )
    ).first()
    if not gm:
        return False
    session.delete(gm)
    session.commit()
    return True


def get_group_member_user_ids_for_instructor(
    *, session: Session, instructor_id: uuid.UUID
) -> list[uuid.UUID]:
    """取得老師所有群組中，學生的 user_id 清單（老師防火牆可見範圍）"""
    # 取得老師管理的群組
    groups = list(
        session.exec(select(Group).where(Group.owner_id == instructor_id)).all()
    )
    if not groups:
        return []
    group_ids = [g.id for g in groups]

    # 取得這些群組中的所有成員 user_id（排除老師本人）
    members = list(
        session.exec(
            select(GroupMember).where(GroupMember.group_id.in_(group_ids))
        ).all()
    )
    user_ids = [m.user_id for m in members if m.user_id != instructor_id]
    return list(set(user_ids))


def is_user_in_any_owned_group(
    *,
    session: Session,
    instructor_id: uuid.UUID,
    member_user_id: uuid.UUID,
) -> bool:
    """檢查 member_user_id 是否在 instructor_id 管理的任意群組中"""
    groups = list(
        session.exec(select(Group).where(Group.owner_id == instructor_id)).all()
    )
    if not groups:
        return False
    group_ids = [g.id for g in groups]
    gm = session.exec(
        select(GroupMember).where(
            GroupMember.group_id.in_(group_ids),
            GroupMember.user_id == member_user_id,
        )
    ).first()
    return gm is not None


def count_members(*, session: Session, group_id: uuid.UUID) -> int:
    return len(
        session.exec(
            select(GroupMember).where(GroupMember.group_id == group_id)
        ).all()
    )
