"""Teacher-managed, versioned per-student course environments."""

import hashlib
import json
import uuid
from typing import Any, Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field, model_validator
from sqlmodel import col, delete, func, select

from app.api.deps import InstructorUser, SessionDep
from app.core.authorizers import require_group_access
from app.exceptions import BadRequestError, NotFoundError
from app.models import (
    CourseEnvironment,
    CourseEnvironmentEdge,
    CourseEnvironmentNode,
    CourseEnvironmentVersion,
    CourseEnvironmentVersionStatus,
    TeachingClass,
    User,
    VMTemplate,
    VMTemplateStatus,
)
from app.models.base import get_datetime_utc

router = APIRouter(prefix="/course-environments", tags=["course-environments"])


class EnvironmentNodeIn(BaseModel):
    node_key: str = Field(min_length=1, max_length=80)
    source_type: Literal["template", "custom"] = "template"
    source_template_id: uuid.UUID | None = None
    custom_image_ref: str | None = Field(default=None, max_length=500)
    custom_storage: str | None = Field(default=None, max_length=120)
    custom_username: str | None = Field(default=None, max_length=32)
    custom_unprivileged: bool = True
    name: str = Field(min_length=1, max_length=255)
    role: str = Field(min_length=1, max_length=120)
    resource_type: str = Field(pattern="^(qemu|lxc)$")
    cpu: int = Field(ge=1, le=64)
    memory_mb: int = Field(ge=128, le=131072)
    disk_gb: int = Field(ge=1, le=2000)
    network: str = Field(default="lab-net", min_length=1, max_length=255)

    @model_validator(mode="after")
    def validate_source(self) -> "EnvironmentNodeIn":
        if self.source_type == "template":
            if self.source_template_id is None:
                raise ValueError("既有範本節點必須選擇來源範本")
            self.custom_image_ref = None
        else:
            if not (self.custom_image_ref or "").strip():
                raise ValueError("自訂 VM/LXC 節點必須選擇基礎映像")
            self.source_template_id = None
            if self.resource_type == "qemu":
                try:
                    if int(self.custom_image_ref or "0") <= 0:
                        raise ValueError
                except ValueError as exc:
                    raise ValueError("自訂 VM 的基礎映像必須是有效 VMID") from exc
        return self


class EnvironmentEdgeIn(BaseModel):
    source_node_key: str = Field(min_length=1, max_length=80)
    target_node_key: str = Field(min_length=1, max_length=80)
    direction: Literal["one_way", "bidirectional"] = "one_way"
    protocol: Literal["any", "tcp", "udp", "icmp", "icmpv6", "sctp"] = "tcp"
    port: int | None = Field(default=22, ge=1, le=65535)

    @model_validator(mode="after")
    def validate_edge(self) -> "EnvironmentEdgeIn":
        if self.source_node_key == self.target_node_key:
            raise ValueError("連線的來源與目標不可相同")
        if self.protocol == "any":
            self.port = None
        elif self.port is None:
            raise ValueError("防火牆連線必須指定 Port")
        return self


class EnvironmentCreate(BaseModel):
    code: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    nodes: list[EnvironmentNodeIn] = Field(min_length=1, max_length=3)
    edges: list[EnvironmentEdgeIn] = Field(default_factory=list, max_length=6)


class EnvironmentUpdate(EnvironmentCreate):
    pass


def _get_environment(
    session: SessionDep, current_user: User, environment_id: uuid.UUID
) -> CourseEnvironment:
    item = session.get(CourseEnvironment, environment_id)
    if item is None:
        raise NotFoundError("Course environment not found")
    require_group_access(current_user, item.owner_id)
    return item


def _versions(
    session: SessionDep, environment_id: uuid.UUID
) -> list[CourseEnvironmentVersion]:
    return list(
        session.exec(
            select(CourseEnvironmentVersion)
            .where(CourseEnvironmentVersion.environment_id == environment_id)
            .order_by(col(CourseEnvironmentVersion.version).desc())
        ).all()
    )


def _nodes(session: SessionDep, version_id: uuid.UUID) -> list[CourseEnvironmentNode]:
    return list(
        session.exec(
            select(CourseEnvironmentNode)
            .where(CourseEnvironmentNode.version_id == version_id)
            .order_by(col(CourseEnvironmentNode.sort_order))
        ).all()
    )


def _edges(session: SessionDep, version_id: uuid.UUID) -> list[CourseEnvironmentEdge]:
    return list(
        session.exec(
            select(CourseEnvironmentEdge).where(
                CourseEnvironmentEdge.version_id == version_id
            )
        ).all()
    )


def _validate_configuration(
    session: SessionDep,
    nodes: list[EnvironmentNodeIn],
    edges: list[EnvironmentEdgeIn],
) -> None:
    if len({node.node_key for node in nodes}) != len(nodes):
        raise BadRequestError("同一課程版本的機器代碼不可重複")
    for node in nodes:
        if node.source_type == "custom":
            continue
        template = session.get(VMTemplate, node.source_template_id)
        if template is None or template.status != VMTemplateStatus.ready:
            raise BadRequestError(f"機器「{node.name}」綁定的 PVE 範本不存在或尚未就緒")
        expected = "lxc" if template.resource_type.lower() == "lxc" else "qemu"
        if node.resource_type != expected:
            raise BadRequestError(f"機器「{node.name}」類型與 PVE 範本不一致")
    node_keys = {node.node_key for node in nodes}
    signatures: set[tuple[object, ...]] = set()
    for edge in edges:
        if (
            edge.source_node_key not in node_keys
            or edge.target_node_key not in node_keys
        ):
            raise BadRequestError("拓撲連線包含不存在的機器節點")
        signature = (
            edge.source_node_key,
            edge.target_node_key,
            edge.direction,
            edge.protocol,
            edge.port,
        )
        if signature in signatures:
            raise BadRequestError("同一條拓撲連線不可重複")
        signatures.add(signature)


def _replace_nodes(
    session: SessionDep,
    version: CourseEnvironmentVersion,
    nodes: list[EnvironmentNodeIn],
    edges: list[EnvironmentEdgeIn],
) -> None:
    _validate_configuration(session, nodes, edges)
    session.exec(
        delete(CourseEnvironmentEdge).where(
            col(CourseEnvironmentEdge.version_id) == version.id
        )
    )
    session.exec(
        delete(CourseEnvironmentNode).where(
            col(CourseEnvironmentNode.version_id) == version.id
        )
    )
    for index, node in enumerate(nodes):
        session.add(
            CourseEnvironmentNode(
                version_id=version.id,
                sort_order=index,
                **node.model_dump(),
            )
        )
    for edge in edges:
        session.add(CourseEnvironmentEdge(version_id=version.id, **edge.model_dump()))


def _serialize_version(
    session: SessionDep,
    environment: CourseEnvironment,
    version: CourseEnvironmentVersion,
) -> dict[str, Any]:
    nodes = _nodes(session, version.id)
    edges = _edges(session, version.id)
    class_count = session.exec(
        select(func.count(col(TeachingClass.id))).where(
            col(TeachingClass.course_version_id) == version.id
        )
    ).one()
    return {
        "id": environment.id,
        "version_id": version.id,
        "owner_id": environment.owner_id,
        "code": environment.code,
        "name": environment.name,
        "description": environment.description,
        "version": version.version,
        "status": version.status,
        "configuration_hash": version.configuration_hash,
        "created_at": environment.created_at,
        "updated_at": environment.updated_at,
        "published_at": version.published_at,
        "classes": int(class_count or 0),
        "nodes": [node.model_dump() for node in nodes],
        "edges": [edge.model_dump() for edge in edges],
        "per_student": {
            "machines": len(nodes),
            "cpu_cores": sum(node.cpu for node in nodes),
            "memory_mb": sum(node.memory_mb for node in nodes),
            "disk_gb": sum(node.disk_gb for node in nodes),
            "ip_count": len(nodes),
            "network_count": len(
                {
                    name.strip()
                    for node in nodes
                    for name in node.network.split(",")
                    if name.strip()
                }
            ),
        },
    }


def _latest(
    session: SessionDep, environment: CourseEnvironment
) -> CourseEnvironmentVersion:
    versions = _versions(session, environment.id)
    if not versions:
        raise NotFoundError("Course environment version not found")
    return versions[0]


@router.get("")
def list_environments(
    session: SessionDep, current_user: InstructorUser
) -> list[dict[str, Any]]:
    query = select(CourseEnvironment).order_by(col(CourseEnvironment.updated_at).desc())
    if not current_user.is_superuser and current_user.role != "admin":
        query = query.where(CourseEnvironment.owner_id == current_user.id)
    result = []
    for environment in session.exec(query).all():
        result.append(
            _serialize_version(session, environment, _latest(session, environment))
        )
    return result


@router.get("/published")
def list_published_environments(
    session: SessionDep, current_user: InstructorUser
) -> list[dict[str, Any]]:
    result = []
    query = select(CourseEnvironment).order_by(col(CourseEnvironment.updated_at).desc())
    if not current_user.is_superuser and current_user.role != "admin":
        query = query.where(CourseEnvironment.owner_id == current_user.id)
    for environment in session.exec(query).all():
        versions = _versions(session, environment.id)
        published = next(
            (
                version
                for version in versions
                if version.status == CourseEnvironmentVersionStatus.published
            ),
            None,
        )
        if published:
            result.append(_serialize_version(session, environment, published))
    return result


@router.get("/{environment_id}")
def get_environment(
    environment_id: uuid.UUID,
    session: SessionDep,
    current_user: InstructorUser,
) -> dict[str, Any]:
    environment = _get_environment(session, current_user, environment_id)
    return _serialize_version(session, environment, _latest(session, environment))


@router.post("", status_code=201)
def create_environment(
    body: EnvironmentCreate,
    session: SessionDep,
    current_user: InstructorUser,
) -> dict[str, Any]:
    environment = CourseEnvironment(
        owner_id=current_user.id,
        code=body.code.strip(),
        name=body.name.strip(),
        description=body.description,
    )
    version = CourseEnvironmentVersion(environment_id=environment.id, version=1)
    session.add(environment)
    session.add(version)
    session.flush()
    _replace_nodes(session, version, body.nodes, body.edges)
    session.commit()
    return _serialize_version(session, environment, version)


@router.put("/{environment_id}")
def update_environment(
    environment_id: uuid.UUID,
    body: EnvironmentUpdate,
    session: SessionDep,
    current_user: InstructorUser,
) -> dict[str, Any]:
    environment = _get_environment(session, current_user, environment_id)
    version = _latest(session, environment)
    if version.status != CourseEnvironmentVersionStatus.draft:
        raise BadRequestError("已發布的課程版本不可修改，請建立新版本")
    environment.code = body.code.strip()
    environment.name = body.name.strip()
    environment.description = body.description
    environment.updated_at = get_datetime_utc()
    _replace_nodes(session, version, body.nodes, body.edges)
    session.add(environment)
    session.commit()
    return _serialize_version(session, environment, version)


@router.post("/{environment_id}/publish")
def publish_environment(
    environment_id: uuid.UUID,
    session: SessionDep,
    current_user: InstructorUser,
) -> dict[str, Any]:
    environment = _get_environment(session, current_user, environment_id)
    version = _latest(session, environment)
    if version.status != CourseEnvironmentVersionStatus.draft:
        raise BadRequestError("只有草稿版本可以發布")
    nodes = _nodes(session, version.id)
    edges = _edges(session, version.id)
    _validate_configuration(
        session,
        [EnvironmentNodeIn.model_validate(node.model_dump()) for node in nodes],
        [EnvironmentEdgeIn.model_validate(edge.model_dump()) for edge in edges],
    )
    payload: dict[str, Any] = {
        "nodes": [
            {
                key: value
                for key, value in node.model_dump().items()
                if key not in {"id", "version_id"}
            }
            for node in nodes
        ],
        "edges": [
            {
                key: value
                for key, value in edge.model_dump().items()
                if key not in {"id", "version_id"}
            }
            for edge in edges
        ],
    }
    version.configuration_hash = hashlib.sha256(
        json.dumps(payload, sort_keys=True, default=str).encode()
    ).hexdigest()
    version.status = CourseEnvironmentVersionStatus.published
    version.published_at = get_datetime_utc()
    environment.updated_at = get_datetime_utc()
    session.add(version)
    session.add(environment)
    session.commit()
    return _serialize_version(session, environment, version)


@router.post("/{environment_id}/versions", status_code=201)
def create_environment_version(
    environment_id: uuid.UUID,
    session: SessionDep,
    current_user: InstructorUser,
) -> dict[str, Any]:
    environment = _get_environment(session, current_user, environment_id)
    latest = _latest(session, environment)
    if latest.status == CourseEnvironmentVersionStatus.draft:
        raise BadRequestError("目前已有可編輯的草稿版本")
    version = CourseEnvironmentVersion(
        environment_id=environment.id,
        version=latest.version + 1,
    )
    session.add(version)
    session.flush()
    for node in _nodes(session, latest.id):
        values = node.model_dump(
            exclude={"id", "version_id"},
        )
        session.add(CourseEnvironmentNode(version_id=version.id, **values))
    for edge in _edges(session, latest.id):
        values = edge.model_dump(exclude={"id", "version_id"})
        session.add(CourseEnvironmentEdge(version_id=version.id, **values))
    environment.updated_at = get_datetime_utc()
    session.add(environment)
    session.commit()
    return _serialize_version(session, environment, version)
