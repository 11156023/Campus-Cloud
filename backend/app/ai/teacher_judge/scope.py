"""Explicit Teacher Judge ownership scope."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any, Literal


@dataclass(frozen=True)
class JudgeScope:
    kind: Literal["group", "teaching_class"]
    id: uuid.UUID

    @classmethod
    def group(cls, group_id: uuid.UUID) -> JudgeScope:
        return cls("group", group_id)

    @classmethod
    def teaching_class(cls, class_id: uuid.UUID) -> JudgeScope:
        return cls("teaching_class", class_id)

    @property
    def group_id(self) -> uuid.UUID | None:
        return self.id if self.kind == "group" else None

    @property
    def class_id(self) -> uuid.UUID | None:
        return self.id if self.kind == "teaching_class" else None

    def matches(self, record: Any) -> bool:
        return (
            record.group_id == self.group_id
            and getattr(record, "class_id", None) == self.class_id
        )

    def clause(self, model: Any) -> tuple[Any, Any]:
        return (
            model.group_id == self.group_id,
            model.class_id == self.class_id,
        )
