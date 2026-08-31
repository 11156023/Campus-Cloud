from __future__ import annotations

import pytest

from app.ai.pve_log import ssh_exec as ssh_exec_module
from app.ai.pve_log.schemas import (
    ChatRequest,
    ChatResponse,
    SSHConfirmRequest,
    SSHExecResult,
)
from app.api.routes import ai_pve_log as route


@pytest.mark.asyncio
async def test_chat_forwards_session_to_service(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, object] = {}

    async def _fake_chat(
        *,
        message: str | None = None,
        history: list[dict] | None = None,
        session=None,
        allowed_vmids=None,
    ) -> ChatResponse:
        captured["message"] = message
        captured["history"] = history
        captured["session"] = session
        captured["allowed_vmids"] = allowed_vmids
        return ChatResponse(reply="ok")

    monkeypatch.setattr(route, "pve_chat", _fake_chat)
    fake_session = object()
    result = await route.chat(
        ChatRequest(message="ping"),
        object(),
        fake_session,
    )
    assert result.reply == "ok"
    assert captured["session"] is fake_session
    assert captured["allowed_vmids"] is None


@pytest.mark.asyncio
async def test_post_ssh_confirm_forwards_session(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, object] = {}

    async def _fake_confirm_exec(
        req: SSHConfirmRequest,
        *,
        session=None,
    ) -> SSHExecResult:
        captured["session"] = session
        return SSHExecResult(
            vmid=157,
            command=req.command or "python3 --version",
        )

    monkeypatch.setattr(ssh_exec_module, "confirm_exec", _fake_confirm_exec)

    fake_session = object()
    req = SSHConfirmRequest(
        token="abc",
        approved=True,
        command="python3 --version",
    )
    result = await route.post_ssh_confirm(req, object(), fake_session)
    assert result.vmid == 157
    assert captured["session"] is fake_session
