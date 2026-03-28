from fastapi.testclient import TestClient
from sqlmodel import Session

from app.ai_api.config import settings as ai_api_settings
from app.core.config import settings
from app.repositories import user as user_repo
from app.schemas import UserCreate
from tests.utils.user import user_authentication_headers
from tests.utils.utils import random_lower_string


def _create_test_user_headers(client: TestClient, db: Session, email: str) -> dict[str, str]:
    password = random_lower_string()
    user_repo.create_user(
        session=db,
        user_create=UserCreate(email=email, password=password),
    )
    db.commit()
    return user_authentication_headers(client=client, email=email, password=password)


def test_ai_api_request_review_flow(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
) -> None:
    user_headers = _create_test_user_headers(client, db, "ai-api-user@example.com")
    create_response = client.post(
        f"{settings.API_V1_STR}/ai-api/requests",
        headers=user_headers,
        json={"purpose": "Use AI API for course project integration testing."},
    )
    assert create_response.status_code == 200
    created = create_response.json()
    assert created["status"] == "pending"
    assert created["purpose"] == "Use AI API for course project integration testing."

    my_requests_response = client.get(
        f"{settings.API_V1_STR}/ai-api/requests/my",
        headers=user_headers,
    )
    assert my_requests_response.status_code == 200
    assert my_requests_response.json()["count"] >= 1

    review_response = client.post(
        f"{settings.API_V1_STR}/ai-api/requests/{created['id']}/review",
        headers=superuser_token_headers,
        json={"status": "approved", "review_comment": "Approved for MVP testing."},
    )
    assert review_response.status_code == 200
    reviewed = review_response.json()
    assert reviewed["status"] == "approved"
    assert reviewed["review_comment"] == "Approved for MVP testing."

    credentials_response = client.get(
        f"{settings.API_V1_STR}/ai-api/credentials/my",
        headers=user_headers,
    )
    assert credentials_response.status_code == 200
    payload = credentials_response.json()
    assert payload["count"] >= 1
    latest = payload["data"][0]
    assert latest["request_id"] == created["id"]
    assert latest["base_url"] == ai_api_settings.resolved_public_base_url
    assert latest["api_key"] == ai_api_settings.ai_api_upstream_api_key
    assert latest["api_key_prefix"] == ai_api_settings.ai_api_upstream_api_key[:8]


def test_ai_api_requests_require_admin_for_review(
    client: TestClient,
    db: Session,
) -> None:
    user_headers = _create_test_user_headers(
        client,
        db,
        "ai-api-reviewer-check@example.com",
    )
    create_response = client.post(
        f"{settings.API_V1_STR}/ai-api/requests",
        headers=user_headers,
        json={"purpose": "Use AI API for another classroom workflow."},
    )
    request_id = create_response.json()["id"]

    review_response = client.post(
        f"{settings.API_V1_STR}/ai-api/requests/{request_id}/review",
        headers=user_headers,
        json={"status": "approved"},
    )
    assert review_response.status_code == 403
