import logging
import secrets
import uuid

from sqlmodel import Session, select

from app.ai_api.config import settings as ai_api_settings
from app.core.security import decrypt_value, encrypt_value
from app.exceptions import BadRequestError, NotFoundError, PermissionDeniedError
from app.models import AIAPICredential, AIAPIRequest, AIAPIRequestStatus, get_datetime_utc
from app.schemas import (
    AIAPICredentialPublic,
    AIAPICredentialsPublic,
    AIAPIRequestCreate,
    AIAPIRequestPublic,
    AIAPIRequestReview,
    AIAPIRequestsPublic,
    Message,
)
from app.services import audit_service

logger = logging.getLogger(__name__)


def _generate_user_api_key() -> str:
    return f"ccai_{secrets.token_urlsafe(24)}"


def _credential_prefix(api_key: str) -> str:
    api_key = api_key.strip()
    return api_key[: min(8, len(api_key))]


def _get_owned_credential(
    *, session: Session, credential_id: uuid.UUID, current_user
) -> AIAPICredential:
    credential = session.get(AIAPICredential, credential_id)
    if not credential:
        raise NotFoundError("AI API credential not found")
    if not current_user.is_superuser and credential.user_id != current_user.id:
        raise PermissionDeniedError("Not enough privileges")
    return credential


def _to_request_public(req: AIAPIRequest) -> AIAPIRequestPublic:
    return AIAPIRequestPublic(
        id=req.id,
        user_id=req.user_id,
        user_email=req.user.email if req.user else None,
        user_full_name=req.user.full_name if req.user else None,
        purpose=req.purpose,
        status=req.status,
        reviewer_id=req.reviewer_id,
        reviewer_email=req.reviewer.email if req.reviewer else None,
        review_comment=req.review_comment,
        reviewed_at=req.reviewed_at,
        created_at=req.created_at,
    )


def _to_credential_public(credential: AIAPICredential) -> AIAPICredentialPublic:
    return AIAPICredentialPublic(
        id=credential.id,
        request_id=credential.request_id,
        base_url=credential.base_url,
        api_key=decrypt_value(credential.api_key_encrypted),
        api_key_prefix=credential.api_key_prefix,
        expires_at=credential.expires_at,
        revoked_at=credential.revoked_at,
        created_at=credential.created_at,
    )


def create_request(
    *, session: Session, request_in: AIAPIRequestCreate, user
) -> AIAPIRequestPublic:
    db_request = AIAPIRequest(user_id=user.id, purpose=request_in.purpose.strip())
    session.add(db_request)
    audit_service.log_action(
        session=session,
        user_id=user.id,
        action="ai_api_request_submit",
        details=f"Submitted AI API request. Purpose: {db_request.purpose}",
        commit=False,
    )
    session.commit()
    session.refresh(db_request)
    logger.info("User %s submitted AI API request %s", user.email, db_request.id)
    return _to_request_public(db_request)


def list_requests_by_user(
    *, session: Session, user_id: uuid.UUID, skip: int = 0, limit: int = 100
) -> AIAPIRequestsPublic:
    count_query = select(AIAPIRequest.id).where(AIAPIRequest.user_id == user_id)
    data_query = (
        select(AIAPIRequest)
        .where(AIAPIRequest.user_id == user_id)
        .order_by(AIAPIRequest.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    return AIAPIRequestsPublic(
        data=[_to_request_public(item) for item in session.exec(data_query).all()],
        count=len(session.exec(count_query).all()),
    )


def list_all_requests(
    *,
    session: Session,
    status: AIAPIRequestStatus | None = None,
    skip: int = 0,
    limit: int = 100,
) -> AIAPIRequestsPublic:
    count_query = select(AIAPIRequest.id)
    data_query = select(AIAPIRequest)
    if status is not None:
        count_query = count_query.where(AIAPIRequest.status == status)
        data_query = data_query.where(AIAPIRequest.status == status)
    data_query = (
        data_query.order_by(AIAPIRequest.created_at.desc()).offset(skip).limit(limit)
    )
    return AIAPIRequestsPublic(
        data=[_to_request_public(item) for item in session.exec(data_query).all()],
        count=len(session.exec(count_query).all()),
    )


def get_request(
    *, session: Session, request_id: uuid.UUID, current_user
) -> AIAPIRequestPublic:
    db_request = session.get(AIAPIRequest, request_id)
    if not db_request:
        raise NotFoundError("AI API request not found")
    if not current_user.is_superuser and db_request.user_id != current_user.id:
        raise PermissionDeniedError("Not enough privileges")
    return _to_request_public(db_request)


def review_request(
    *,
    session: Session,
    request_id: uuid.UUID,
    review_data: AIAPIRequestReview,
    reviewer,
) -> AIAPIRequestPublic:
    db_request = session.get(AIAPIRequest, request_id)
    if not db_request:
        raise NotFoundError("AI API request not found")
    if db_request.status != AIAPIRequestStatus.pending:
        raise BadRequestError("This AI API request has already been reviewed")

    db_request.status = review_data.status
    db_request.reviewer_id = reviewer.id
    db_request.review_comment = (
        review_data.review_comment.strip() if review_data.review_comment else None
    )
    db_request.reviewed_at = get_datetime_utc()
    session.add(db_request)

    if review_data.status == AIAPIRequestStatus.approved:
        base_url = ai_api_settings.resolved_public_base_url
        api_key = _generate_user_api_key()
        if not base_url:
            raise BadRequestError("AI API connection settings are incomplete")
        session.add(
            AIAPICredential(
                user_id=db_request.user_id,
                request_id=db_request.id,
                base_url=base_url,
                api_key_encrypted=encrypt_value(api_key),
                api_key_prefix=_credential_prefix(api_key),
            )
        )

    action = (
        "approved" if review_data.status == AIAPIRequestStatus.approved else "rejected"
    )
    details = f"Reviewed AI API request {request_id}: {action}"
    if db_request.review_comment:
        details += f". Comment: {db_request.review_comment}"
    audit_service.log_action(
        session=session,
        user_id=reviewer.id,
        action="ai_api_request_review",
        details=details,
        commit=False,
    )

    session.commit()
    session.refresh(db_request)
    logger.info("Admin %s %s AI API request %s", reviewer.email, action, request_id)
    return _to_request_public(db_request)


def list_credentials_by_user(
    *, session: Session, user_id: uuid.UUID, skip: int = 0, limit: int = 100
) -> AIAPICredentialsPublic:
    count_query = select(AIAPICredential.id).where(AIAPICredential.user_id == user_id)
    data_query = (
        select(AIAPICredential)
        .where(AIAPICredential.user_id == user_id)
        .order_by(AIAPICredential.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    return AIAPICredentialsPublic(
        data=[_to_credential_public(item) for item in session.exec(data_query).all()],
        count=len(session.exec(count_query).all()),
    )


def rotate_credential(
    *, session: Session, credential_id: uuid.UUID, current_user
) -> AIAPICredentialPublic:
    credential = _get_owned_credential(
        session=session, credential_id=credential_id, current_user=current_user
    )

    if credential.revoked_at is not None:
        raise BadRequestError("This AI API credential has already been revoked")

    credential.revoked_at = get_datetime_utc()
    session.add(credential)

    new_api_key = _generate_user_api_key()
    new_credential = AIAPICredential(
        user_id=credential.user_id,
        request_id=credential.request_id,
        base_url=credential.base_url,
        api_key_encrypted=encrypt_value(new_api_key),
        api_key_prefix=_credential_prefix(new_api_key),
    )
    session.add(new_credential)

    audit_service.log_action(
        session=session,
        user_id=current_user.id,
        action="ai_api_request_review",
        details=f"Rotated AI API credential {credential_id}",
        commit=False,
    )

    session.commit()
    session.refresh(new_credential)
    return _to_credential_public(new_credential)


def delete_credential(
    *, session: Session, credential_id: uuid.UUID, current_user
) -> Message:
    credential = _get_owned_credential(
        session=session, credential_id=credential_id, current_user=current_user
    )

    session.delete(credential)
    audit_service.log_action(
        session=session,
        user_id=current_user.id,
        action="ai_api_request_review",
        details=f"Deleted AI API credential {credential_id}",
        commit=False,
    )
    session.commit()
    return Message(message="AI API credential deleted successfully")
