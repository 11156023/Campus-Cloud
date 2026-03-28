from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[3]
ENV_FILE = PROJECT_ROOT / ".env"


class AIAPIEnvSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(ENV_FILE),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    ai_api_base_url: str = "http://localhost:8000/v1"
    ai_api_api_key: str = "ai-api-secret-key-change-me"
    ai_api_timeout: int = 30

    @property
    def resolved_public_base_url(self) -> str:
        return self.ai_api_base_url.strip()


settings = AIAPIEnvSettings()
