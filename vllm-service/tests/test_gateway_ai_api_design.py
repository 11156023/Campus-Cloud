from __future__ import annotations

import asyncio

import pytest
from fastapi import HTTPException

from config.multi_model import GatewayRoute
from gateway import main as gateway_main


def _route(
    *,
    scheduling_policy: str = "priority",
    capabilities: dict | None = None,
) -> GatewayRoute:
    return GatewayRoute(
        alias="test-model",
        model_name="/models/test-model",
        base_url="http://127.0.0.1:8100/v1",
        api_key="test-key",
        max_inflight=2,
        queue_timeout=0.1,
        scheduling_policy=scheduling_policy,
        capabilities=capabilities or {
            "reasoning": True,
            "response_format_json_schema": True,
            "structured_outputs": True,
            "tool_use": True,
            "priority_scheduling": True,
        },
    )


def test_normalize_openai_payload_flattens_extra_body_without_overwriting_direct_fields() -> None:
    payload = {
        "model": "test-model",
        "temperature": 0.3,
        "extra_body": {
            "temperature": 1.0,
            "top_k": 20,
            "priority": 4,
        },
    }

    normalized = gateway_main._normalize_openai_payload(payload)

    assert normalized["temperature"] == 0.3
    assert normalized["top_k"] == 20
    assert normalized["priority"] == 4
    assert "extra_body" not in normalized


def test_text_chat_payload_passthrough_keeps_wrapper_owned_fields() -> None:
    request = gateway_main.ChatRequest(
        message="hello",
        messages=[{"role": "user", "content": "should not override"}],
        stream=False,
        priority=3,
        response_format={"type": "json_schema", "json_schema": {"name": "Answer", "schema": {}}},
        structured_outputs={"choice": "allowed"},
        extra_body={"top_k": 10, "priority": 9},
    )

    payload = gateway_main._build_text_chat_payload(request, stream=True)

    assert payload["stream"] is True
    assert payload["messages"][0]["role"] == "system"
    assert payload["messages"][1]["content"] == "hello"
    assert payload["priority"] == 3
    assert payload["top_k"] == request.top_k
    assert payload["response_format"]["type"] == "json_schema"
    assert payload["structured_outputs"] == {"choice": "allowed"}


def test_capability_validation_rejects_unsupported_json_schema_response_format() -> None:
    route = _route(capabilities={"response_format_json_schema": False})
    payload = {"response_format": {"type": "json_schema", "json_schema": {"name": "Answer", "schema": {}}}}

    response = gateway_main._validate_model_capabilities(route, payload)

    assert response is not None
    assert response.status_code == 400
    assert b"response_format=json_schema" in response.body


@pytest.mark.parametrize(
    ("route", "payload", "expected_code"),
    [
        (_route(scheduling_policy="fcfs"), {"priority": 1}, "unsupported_priority"),
        (_route(capabilities={"priority_scheduling": False}), {"priority": 1}, "unsupported_priority"),
        (_route(), {"priority": "high"}, "invalid_priority"),
    ],
)
def test_priority_validation_requires_integer_and_priority_scheduling(
    route: GatewayRoute,
    payload: dict,
    expected_code: str,
) -> None:
    response = gateway_main._validate_model_capabilities(route, payload)

    assert response is not None
    assert response.status_code == 400
    assert expected_code.encode("utf-8") in response.body


def test_queue_class_is_internal_and_removed_from_payload() -> None:
    payload = {"gateway_queue_class": "batch", "stream": False}

    queue_class = gateway_main._infer_queue_class(payload, stream_mode=False)

    assert queue_class == "batch"
    assert "gateway_queue_class" not in payload


def test_proxy_hides_queue_class_exception_details(monkeypatch: pytest.MonkeyPatch) -> None:
    route = _route()

    async def raise_internal_value_error(*args, **kwargs):
        raise ValueError("internal queue implementation detail")

    monkeypatch.setattr(gateway_main, "gateway_routes", {route.alias: route})
    monkeypatch.setattr(gateway_main, "_acquire_gateway_admission", raise_internal_value_error)

    response = asyncio.run(
        gateway_main._proxy_openai_post(
            "/chat/completions",
            {"model": route.alias},
        )
    )

    assert response.status_code == 400
    assert b"internal queue implementation detail" not in response.body
    assert b"gateway_queue_class must be one of" in response.body


def test_proxy_hides_unexpected_http_exception_details(monkeypatch: pytest.MonkeyPatch) -> None:
    route = _route()

    async def raise_internal_http_exception(*args, **kwargs):
        raise HTTPException(status_code=502, detail="internal upstream implementation detail")

    monkeypatch.setattr(gateway_main, "gateway_routes", {route.alias: route})
    monkeypatch.setattr(gateway_main, "_acquire_gateway_admission", raise_internal_http_exception)

    response = asyncio.run(
        gateway_main._proxy_openai_post(
            "/chat/completions",
            {"model": route.alias},
        )
    )

    assert response.status_code == 500
    assert b"internal upstream implementation detail" not in response.body
    assert b"gateway_admission_failed" in response.body


def test_gateway_admission_times_out_when_model_slots_are_full() -> None:
    async def run() -> None:
        route = _route()
        route = GatewayRoute(
            alias="timeout-model",
            model_name=route.model_name,
            base_url=route.base_url,
            api_key=route.api_key,
            max_inflight=1,
            queue_timeout=0.001,
            scheduling_policy=route.scheduling_policy,
            capabilities=route.capabilities,
        )
        model_semaphore = asyncio.Semaphore(1)
        await model_semaphore.acquire()
        gateway_main.gateway_model_semaphores[route.alias] = model_semaphore
        try:
            with pytest.raises(HTTPException) as exc_info:
                await gateway_main._acquire_gateway_admission(
                    route,
                    payload={},
                    stream_mode=False,
                    request=None,
                )
            assert exc_info.value.status_code == 429
            assert exc_info.value.detail["error"]["code"] == "gateway_queue_timeout"
        finally:
            model_semaphore.release()
            gateway_main.gateway_model_semaphores.pop(route.alias, None)

    asyncio.run(run())
