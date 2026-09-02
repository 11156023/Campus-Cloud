"""Persistence helpers for desktop WireGuard peers."""

import uuid
from datetime import datetime

from sqlmodel import Session, select

from app.models.wireguard_peer import WireGuardPeer


def get_by_user_device(
    *, session: Session, user_id: uuid.UUID, device_id: str
) -> WireGuardPeer | None:
    return session.exec(
        select(WireGuardPeer).where(
            WireGuardPeer.user_id == user_id,
            WireGuardPeer.device_id == device_id,
        )
    ).first()


def get_by_public_key(*, session: Session, public_key: str) -> WireGuardPeer | None:
    return session.exec(
        select(WireGuardPeer).where(WireGuardPeer.public_key == public_key)
    ).first()


def list_tunnel_ips(*, session: Session) -> set[str]:
    return set(session.exec(select(WireGuardPeer.tunnel_ip)).all())


def list_active_unexpired(*, session: Session, now: datetime) -> list[WireGuardPeer]:
    return list(
        session.exec(
            select(WireGuardPeer).where(
                WireGuardPeer.active.is_(True),
                WireGuardPeer.expires_at.is_not(None),
                WireGuardPeer.expires_at > now,
            )
        ).all()
    )


def list_expired_active(*, session: Session, now: datetime) -> list[WireGuardPeer]:
    return list(
        session.exec(
            select(WireGuardPeer).where(
                WireGuardPeer.active.is_(True),
                (
                    WireGuardPeer.expires_at.is_(None)
                    | (WireGuardPeer.expires_at <= now)
                ),
            )
        ).all()
    )


def list_revoked_before(*, session: Session, cutoff: datetime) -> list[WireGuardPeer]:
    return list(
        session.exec(
            select(WireGuardPeer).where(
                WireGuardPeer.active.is_(False),
                WireGuardPeer.revoked_at.is_not(None),
                WireGuardPeer.revoked_at < cutoff,
            )
        ).all()
    )


def save(*, session: Session, peer: WireGuardPeer) -> WireGuardPeer:
    session.add(peer)
    session.commit()
    session.refresh(peer)
    return peer


__all__ = [
    "get_by_public_key",
    "get_by_user_device",
    "list_active_unexpired",
    "list_expired_active",
    "list_revoked_before",
    "list_tunnel_ips",
    "save",
]
