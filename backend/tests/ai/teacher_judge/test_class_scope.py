import uuid

import pytest
from fastapi import HTTPException
from sqlmodel import Session, SQLModel, create_engine

from app.ai.teacher_judge import file_service
from app.ai.teacher_judge.schemas import RubricAnalysis, RubricItem


def _analysis() -> RubricAnalysis:
    return RubricAnalysis(
        items=[
            RubricItem(
                id="item",
                title="Item",
                description="Description",
                checked=False,
                detectable="manual",
                detection_method=None,
                fallback=None,
                check_steps=[],
            )
        ],
        total_items=1,
        auto_count=0,
        summary="scope",
    )


def test_class_file_is_not_visible_from_group_scope(
    tmp_path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(file_service, "DATA_ROOT", tmp_path)
    engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(engine)
    session = Session(engine)
    class_id = uuid.uuid4()
    saved = file_service.save_analyzed_file(
        session=session,
        class_id=class_id,
        uploaded_by=None,
        original_filename="rubric.pdf",
        file_hash="a" * 64,
        template_key="linux",
        file_bytes=b"rubric",
        analysis=_analysis(),
        conflict_strategy=None,
    )

    assert saved.class_id == str(class_id)
    assert saved.group_id is None
    with pytest.raises(HTTPException) as exc_info:
        file_service.get_file(
            session=session,
            group_id=uuid.uuid4(),
            file_id=uuid.UUID(saved.id),
        )
    assert exc_info.value.status_code == 404
