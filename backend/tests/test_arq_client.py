from unittest.mock import AsyncMock

import pytest

from app.infrastructure.queue import arq_client


@pytest.fixture(scope="session")
def _seed_first_superuser() -> None:
    """This unit-test module does not require the external test database."""


@pytest.fixture(autouse=True)
def reset_arq_pool(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(arq_client, "_pool", None)


async def test_init_arq_pool_skips_connection_when_redis_disabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    create_pool = AsyncMock()
    monkeypatch.setattr(arq_client.settings, "redis_enabled", False)
    monkeypatch.setattr(arq_client, "create_pool", create_pool)

    await arq_client.init_arq_pool()

    create_pool.assert_not_awaited()
    assert arq_client._pool is None


async def test_get_arq_pool_does_not_connect_when_redis_disabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    create_pool = AsyncMock()
    monkeypatch.setattr(arq_client.settings, "redis_enabled", False)
    monkeypatch.setattr(arq_client, "create_pool", create_pool)

    with pytest.raises(RuntimeError, match="REDIS_ENABLED=false"):
        await arq_client.get_arq_pool()

    create_pool.assert_not_awaited()


async def test_init_arq_pool_connects_when_redis_enabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pool = AsyncMock()
    create_pool = AsyncMock(return_value=pool)
    monkeypatch.setattr(arq_client.settings, "redis_enabled", True)
    monkeypatch.setattr(arq_client, "create_pool", create_pool)

    await arq_client.init_arq_pool()

    create_pool.assert_awaited_once()
    assert arq_client._pool is pool
