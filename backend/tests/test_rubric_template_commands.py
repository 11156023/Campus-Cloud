from __future__ import annotations

import json
import uuid
from io import BytesIO
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, UploadFile
from sqlmodel import Session, SQLModel, create_engine

from app.ai.teacher_judge import service as teacher_judge_service
from app.ai.teacher_judge.schemas import RubricItem
from app.ai.teacher_judge.template_command_service import (
    format_template_commands_for_prompt,
    get_enabled_template_commands,
    validate_check_steps,
)
from app.api.routes import rubric as rubric_route
from app.models.teacher_judge_template_command import TeacherJudgeTemplateCommand


def _patch_teacher_judge_vllm_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        teacher_judge_service,
        "settings",
        SimpleNamespace(
            VLLM_MODEL_NAME="test-model",
            VLLM_ENABLE_THINKING=False,
            VLLM_TIMEOUT=60,
            VLLM_MAX_TOKENS=4096,
            VLLM_CHAT_MAX_TOKENS=4096,
            VLLM_CHAT_TEMPERATURE=0.2,
            VLLM_TOP_P=1.0,
            VLLM_TOP_K=20,
            VLLM_REPETITION_PENALTY=1.0,
        ),
    )


def _session_with_commands() -> Session:
    engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(engine)
    session = Session(engine)
    session.add(
        TeacherJudgeTemplateCommand(
            template_key="n8n",
            command_key="n8n.port_check",
            command_label="n8n 連接埠檢查",
            category="port",
            command_template="ss -lntp | grep ':5678'",
            description="檢查 n8n 預設 5678 連接埠是否正在監聽。",
        )
    )
    session.add(
        TeacherJudgeTemplateCommand(
            template_key="python",
            command_key="python.version",
            command_label="Python 版本",
            category="runtime",
            command_template="python3 --version",
            description="查看 Python 直譯器版本。",
            enabled=False,
        )
    )
    session.commit()
    return session


def test_get_enabled_template_commands_filters_template_and_enabled() -> None:
    session = _session_with_commands()

    commands = get_enabled_template_commands(session, "n8n")

    assert [command.command_key for command in commands] == ["n8n.port_check"]


def test_get_enabled_template_commands_can_include_cross_template_catalog() -> None:
    session = _session_with_commands()
    session.add(
        TeacherJudgeTemplateCommand(
            template_key="python",
            command_key="python.run_entrypoint",
            command_label="執行 Python 程式入口",
            category="execution",
            command_template="python3 main.py",
            description="受控執行 Python 程式入口。",
        )
    )
    session.commit()

    commands = get_enabled_template_commands(
        session, "n8n", include_cross_template=True
    )

    assert [(command.template_key, command.command_key) for command in commands] == [
        ("n8n", "n8n.port_check"),
        ("python", "python.run_entrypoint"),
    ]


def test_validate_check_steps_allows_catalog_backed_cross_template_step() -> None:
    python_command = _python_entrypoint_command()

    items = validate_check_steps(
        "n8n",
        [
            {
                "check_steps": [
                    {
                        "template_key": "python",
                        "command_key": "python.run_entrypoint",
                    },
                    {
                        "template_key": "postgresql",
                        "command_key": "python.run_entrypoint",
                    },
                ]
            }
        ],
        [python_command],
    )

    assert items[0]["check_steps"] == [
        {
            "template_key": "python",
            "command_key": "python.run_entrypoint",
            "command_label": "執行 Python 程式入口",
        }
    ]


@pytest.mark.asyncio
async def test_analyze_rubric_injects_catalog_and_normalizes_check_steps(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    command = TeacherJudgeTemplateCommand(
        template_key="n8n",
        command_key="n8n.port_check",
        command_label="n8n 連接埠檢查",
        category="port",
        command_template="ss -lntp | grep ':5678'",
        description="檢查 n8n 預設 5678 連接埠是否正在監聽。",
    )
    captured_payload = {}

    async def fake_call_vllm(payload, timeout=60.0):
        captured_payload.update(payload)
        return (
            json.dumps(
                {
                    "items": [
                        {
                            "id": "item-1",
                            "title": "n8n 服務可啟動",
                            "checked": True,
                            "detectable": "auto",
                            "detection_method": "檢查 n8n port",
                            "check_steps": [
                                {
                                    "template_key": "n8n",
                                    "command_key": "n8n.port_check",
                                },
                                {
                                    "template_key": "n8n",
                                    "command_key": "n8n.missing",
                                },
                            ],
                        }
                    ],
                    "summary": "ok",
                }
            ),
            {"total_tokens": 1},
        )

    monkeypatch.setattr(teacher_judge_service, "_call_vllm", fake_call_vllm)
    _patch_teacher_judge_vllm_settings(monkeypatch)

    analysis, _metrics = await teacher_judge_service.analyze_rubric(
        "rubric text",
        template_key="n8n",
        template_commands=[command],
    )

    system_prompt = captured_payload["messages"][0]["content"]
    assert "目前主要 template：n8n" in system_prompt
    assert "n8n.port_check" in system_prompt
    assert "ss -lntp" not in system_prompt
    assert "不得自行發明" in system_prompt
    assert analysis.items[0].check_steps[0].command_key == "n8n.port_check"
    assert analysis.items[0].check_steps[0].command_label == "n8n 連接埠檢查"
    assert len(analysis.items[0].check_steps) == 1
    assert analysis.items[0].checked is False


@pytest.mark.asyncio
async def test_chat_with_rubric_validates_returned_check_steps(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    command = TeacherJudgeTemplateCommand(
        template_key="n8n",
        command_key="n8n.http_check",
        command_label="n8n HTTP 檢查",
        category="service",
        command_template="curl -I --max-time 5 http://127.0.0.1:5678",
        description="檢查本機 n8n Web 服務是否有 HTTP 回應。",
    )
    captured_payload = {}

    async def fake_call_vllm(payload, timeout=60.0):
        captured_payload.update(payload)
        return (
            json.dumps(
                {
                    "reply": "已更新",
                    "updated_items": [
                        {
                            "id": "item-1",
                            "title": "n8n Web UI",
                            "detectable": "auto",
                            "check_steps": [
                                {
                                    "template_key": "n8n",
                                    "command_key": "n8n.http_check",
                                },
                                {
                                    "template_key": "n8n",
                                    "command_key": "n8n.missing",
                                },
                            ],
                        }
                    ],
                }
            ),
            {"total_tokens": 1},
        )

    monkeypatch.setattr(teacher_judge_service, "_call_vllm", fake_call_vllm)
    _patch_teacher_judge_vllm_settings(monkeypatch)

    _reply, updated_items, _metrics = await teacher_judge_service.chat_with_rubric(
        messages=[SimpleNamespace(role="user", content="照這樣改")],
        rubric_context=json.dumps({"items": [{"id": "item-1"}]}),
        template_key="n8n",
        template_commands=[command],
    )

    assert updated_items is not None
    system_prompt = captured_payload["messages"][0]["content"]
    assert "目前主要 template：n8n" in system_prompt
    assert "n8n.http_check" in system_prompt
    assert "curl -I" not in system_prompt
    assert updated_items[0]["check_steps"] == [
        {
            "template_key": "n8n",
            "command_key": "n8n.http_check",
            "command_label": "n8n HTTP 檢查",
        }
    ]


@pytest.mark.asyncio
async def test_refine_prompt_treats_main_py_as_execution_observation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    command = TeacherJudgeTemplateCommand(
        template_key="python",
        command_key="python.run_entrypoint",
        command_label="執行 Python 程式入口",
        category="execution",
        command_template="python3 main.py",
        description=(
            "在老師提供的工作目錄執行 Python 程式入口，收集 exit code、stdout、stderr；"
            "缺少工作目錄或成功條件時先向老師詢問。"
        ),
        risk_level="executes_code",
        requires_confirmation=True,
    )
    captured_payload = {}

    async def fake_call_vllm(payload, timeout=60.0):
        captured_payload.update(payload)
        return (
            json.dumps(
                {
                    "reply": "還需要 main.py 的工作目錄與正常結束條件。",
                    "updated_items": [
                        {
                            "id": "item-1",
                            "title": "main.py 執行時沒有錯誤",
                            "description": "執行 main.py 並觀察未捕捉例外。",
                            "detectable": "partial",
                            "detection_method": "待確認工作目錄與啟動命令後執行。",
                            "fallback": "請老師提供工作目錄、Python 命令與結束判準。",
                            "check_steps": [
                                {
                                    "template_key": "python",
                                    "command_key": "python.run_entrypoint",
                                }
                            ],
                        }
                    ],
                }
            ),
            {"total_tokens": 1},
        )

    monkeypatch.setattr(teacher_judge_service, "_call_vllm", fake_call_vllm)
    _patch_teacher_judge_vllm_settings(monkeypatch)

    _reply, updated_items, _metrics = await teacher_judge_service.chat_with_rubric(
        messages=[SimpleNamespace(role="user", content="請潤飾評分表")],
        rubric_context=json.dumps(
            {
                "items": [
                    {
                        "id": "item-1",
                        "title": "判斷main.py有沒有報錯",
                        "detectable": "manual",
                    }
                ]
            }
        ),
        is_refine=True,
        template_key="python",
        template_commands=[command],
    )

    system_prompt = captured_payload["messages"][0]["content"]
    assert "無法閱讀完整原始碼，不等於無法執行程式觀察錯誤" in system_prompt
    assert "判斷 main.py 有沒有報錯" in system_prompt
    assert "不得建議改成檢查 n8n 服務" in system_prompt
    assert "工作目錄、直譯器／命令、參數" in system_prompt
    assert "python.run_entrypoint" in system_prompt
    assert updated_items is not None
    assert updated_items[0]["detectable"] == "partial"
    assert updated_items[0]["check_steps"][0]["command_key"] == (
        "python.run_entrypoint"
    )


def test_normalize_downgrades_auto_without_valid_check_steps() -> None:
    items = teacher_judge_service._normalize_rubric_items(
        [
            {
                "title": "未知檢查",
                "detectable": "auto",
                "check_steps": [{"template_key": "n8n", "command_key": "missing"}],
            }
        ],
        template_key="n8n",
        template_commands=[],
    )

    assert items == [
        RubricItem(
            id="item-1",
            title="未知檢查",
            description="",
            checked=False,
            detectable="partial",
            detection_method="目前沒有可引用的有效 command_key，需人工或後續檢查輔助判斷",
            fallback=None,
            check_steps=[],
        )
    ]


def _python_entrypoint_command() -> TeacherJudgeTemplateCommand:
    return TeacherJudgeTemplateCommand(
        template_key="python",
        command_key="python.run_entrypoint",
        command_label="執行 Python 程式入口",
        category="execution",
        command_template="python3 main.py",
        description="受控執行 Python 程式並收集結果。",
        risk_level="executes_code",
        requires_confirmation=True,
    )


def test_normalize_main_py_requires_execution_details() -> None:
    items = teacher_judge_service._normalize_rubric_items(
        [{"title": "判斷 main.py 有沒有報錯", "detectable": "manual"}],
        template_key="python",
        template_commands=[_python_entrypoint_command()],
    )

    assert items[0].detectable == "partial"
    assert items[0].check_steps[0].command_key == "python.run_entrypoint"
    assert "exit code" in (items[0].detection_method or "")
    assert "工作目錄" in (items[0].fallback or "")


def test_normalize_main_py_does_not_substitute_n8n_command() -> None:
    n8n_command = TeacherJudgeTemplateCommand(
        template_key="n8n",
        command_key="n8n.port_check",
        command_label="n8n 連接埠檢查",
        category="port",
        command_template="ss -lntp | grep ':5678'",
        description="檢查 n8n 連接埠。",
    )

    items = teacher_judge_service._normalize_rubric_items(
        [
            {
                "title": "判斷 main.py 有沒有報錯",
                "detectable": "auto",
                "check_steps": [
                    {"template_key": "n8n", "command_key": "n8n.port_check"}
                ],
            }
        ],
        template_key="n8n",
        template_commands=[n8n_command, _python_entrypoint_command()],
    )

    assert items[0].detectable == "partial"
    assert items[0].check_steps[0].template_key == "python"
    assert items[0].check_steps[0].command_key == "python.run_entrypoint"
    assert "不受主要評分環境限制" in (items[0].detection_method or "")
    assert "切換" not in (items[0].fallback or "")
    assert "n8n 服務" not in (items[0].fallback or "")


def test_normalize_main_py_is_auto_with_explicit_contract() -> None:
    items = teacher_judge_service._normalize_rubric_items(
        [
            {
                "title": "判斷 main.py 有沒有報錯",
                "description": (
                    "工作目錄：/srv/submission；執行 python3 main.py；"
                    "程式正常結束且 exit code 0，沒有未捕捉例外。"
                ),
                "detectable": "manual",
            }
        ],
        template_key="python",
        template_commands=[_python_entrypoint_command()],
    )

    assert items[0].detectable == "auto"
    assert items[0].check_steps[0].command_key == "python.run_entrypoint"
    assert "stdout" in (items[0].detection_method or "")


def test_normalize_python_code_quality_stays_manual() -> None:
    items = teacher_judge_service._normalize_rubric_items(
        [{"title": "評估 main.py 的架構品質", "detectable": "manual"}],
        template_key="python",
        template_commands=[_python_entrypoint_command()],
    )

    assert items[0].detectable == "manual"
    assert items[0].check_steps == []


@pytest.mark.asyncio
async def test_upload_rubric_defaults_linux_template(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = _session_with_commands()

    async def fake_analyze_rubric(raw_text, template_key, template_commands):
        assert raw_text == "parsed text"
        assert template_key == "linux"
        assert [command.command_key for command in template_commands] == [
            "n8n.port_check"
        ]
        return (
            SimpleNamespace(model_dump=lambda: {"items": []}),
            {"total_tokens": 0},
        )

    monkeypatch.setattr(rubric_route, "parse_document", lambda *_args: "parsed text")
    monkeypatch.setattr(rubric_route, "analyze_rubric", fake_analyze_rubric)

    response = await rubric_route.upload_rubric(
        current_user=SimpleNamespace(id=uuid.uuid4(), email="teacher@example.com"),
        session=session,
        file=UploadFile(filename="rubric.pdf", file=BytesIO(b"pdf")),
        template_key="linux",
    )

    assert response["template_key"] == "linux"


@pytest.mark.asyncio
async def test_upload_rubric_rejects_unknown_template() -> None:
    session = _session_with_commands()

    with pytest.raises(HTTPException) as exc_info:
        await rubric_route.upload_rubric(
            current_user=SimpleNamespace(email="teacher@example.com"),
            session=session,
            file=UploadFile(filename="rubric.pdf", file=BytesIO(b"pdf")),
            template_key="unknown",
        )

    assert exc_info.value.status_code == 400


def test_prompt_formatter_handles_empty_catalog() -> None:
    assert "沒有 template command catalog" in format_template_commands_for_prompt([])


def test_prompt_formatter_does_not_expose_raw_shell_command() -> None:
    formatted = format_template_commands_for_prompt(
        [
            TeacherJudgeTemplateCommand(
                template_key="n8n",
                command_key="n8n.http_check",
                command_label="n8n HTTP 檢查",
                category="service",
                command_template="curl -I --max-time 5 http://127.0.0.1:5678",
                description="檢查本機 n8n Web 服務是否有 HTTP 回應。",
            )
        ]
    )

    assert "n8n.http_check" in formatted
    assert "template_key: n8n" in formatted
    assert "curl -I" not in formatted
