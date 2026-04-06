import sentry_sdk
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, WebSocket
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from starlette.middleware.cors import CORSMiddleware
from starlette.types import ASGIApp, Receive, Scope, Send

from app.api.main import api_router
from app.api.websocket import vnc_proxy
from app.api.websocket.terminal import terminal_proxy
from app.core.config import settings
from app.core.redis import close_redis, init_redis
from app.exceptions import AppError


_SECURITY_HEADERS: list[tuple[str, str]] = [
    ("X-Content-Type-Options", "nosniff"),
    ("X-Frame-Options", "DENY"),
    ("X-XSS-Protection", "1; mode=block"),
    ("Referrer-Policy", "strict-origin-when-cross-origin"),
    ("Permissions-Policy", "geolocation=(), microphone=(), camera=()"),
    (
        "Content-Security-Policy",
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: https:; "
        "connect-src 'self' wss: https:; "
        "frame-ancestors 'none'",
    ),
]


class SecurityHeadersMiddleware:
    """Pure ASGI middleware — adds security headers to HTTP responses only.

    Unlike BaseHTTPMiddleware this does NOT interfere with WebSocket connections.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        # Only inject headers for HTTP; let WebSocket pass through untouched.
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                for name, value in _SECURITY_HEADERS:
                    headers.append((name.lower().encode(), value.encode()))
                if settings.ENVIRONMENT == "production":
                    headers.append((
                        b"strict-transport-security",
                        b"max-age=31536000; includeSubDomains",
                    ))
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_with_headers)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """應用生命週期管理"""
    # Startup: 初始化 Redis
    await init_redis()
    yield
    # Shutdown: 關閉 Redis
    await close_redis()


def custom_generate_unique_id(route: APIRoute) -> str:
    return f"{route.tags[0]}-{route.name}"


if settings.SENTRY_DSN:
    sentry_sdk.init(
        dsn=str(settings.SENTRY_DSN), traces_sample_rate=1.0, send_default_pii=False
    )

app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    generate_unique_id_function=custom_generate_unique_id,
    lifespan=lifespan,
)

app.add_middleware(SecurityHeadersMiddleware)

if settings.all_cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.all_cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization"],
    )

app.include_router(api_router, prefix=settings.API_V1_STR)


@app.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError):
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.message},
    )


@app.websocket("/ws/vnc/{vmid}")
async def websocket_vnc_proxy(
    websocket: WebSocket,
    vmid: int,
    token: str = "",
    vnc_ticket: str = "",
    vnc_port: str = "",
):
    await vnc_proxy(websocket, vmid, token=token, vnc_ticket=vnc_ticket, vnc_port=vnc_port)


@app.websocket("/ws/terminal/{vmid}")
async def websocket_terminal_proxy(websocket: WebSocket, vmid: int, token: str = ""):
    await terminal_proxy(websocket, vmid, token=token)
