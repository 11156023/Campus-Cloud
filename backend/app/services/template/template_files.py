"""範本 icon 與附件（使用手冊等）的實體檔案存取。

存放位置沿用 avatar 慣例（repo 根 data/ 目錄）：
- icon：data/template_icons/{template_id}.{ext}
- 附件：data/template_files/{template_id}/{attachment_id}
DB 只存 metadata（TemplateAttachment / VMTemplate.icon_url）。
"""

from __future__ import annotations

import logging
import uuid
from pathlib import Path

logger = logging.getLogger(__name__)

_DATA_ROOT = Path(__file__).resolve().parents[4] / "data"
ICON_DIR = _DATA_ROOT / "template_icons"
ATTACHMENT_DIR = _DATA_ROOT / "template_files"

ICON_MAX_BYTES = 2 * 1024 * 1024
ICON_CONTENT_TYPES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
    "image/gif": ".gif",
}

ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024
ATTACHMENT_MAX_COUNT = 10
# 使用手冊常見格式；封鎖可執行檔類型
ATTACHMENT_ALLOWED_EXTENSIONS = {
    ".pdf", ".md", ".txt", ".doc", ".docx", ".ppt", ".pptx",
    ".xls", ".xlsx", ".odt", ".odp", ".zip",
    ".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4",
}


def save_icon(template_id: uuid.UUID, ext: str, data: bytes) -> Path:
    """寫入 icon 檔（覆蓋舊檔，含不同副檔名的殘檔）。"""
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    delete_icon(template_id)
    path = ICON_DIR / f"{template_id}{ext}"
    path.write_bytes(data)
    return path


def find_icon(template_id: uuid.UUID) -> Path | None:
    matches = sorted(ICON_DIR.glob(f"{template_id}.*"))
    return matches[0] if matches else None


def delete_icon(template_id: uuid.UUID) -> None:
    for old in ICON_DIR.glob(f"{template_id}.*"):
        old.unlink(missing_ok=True)


def save_attachment(
    template_id: uuid.UUID, attachment_id: uuid.UUID, data: bytes
) -> Path:
    directory = ATTACHMENT_DIR / str(template_id)
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / str(attachment_id)
    path.write_bytes(data)
    return path


def attachment_path(
    template_id: uuid.UUID, attachment_id: uuid.UUID
) -> Path | None:
    path = ATTACHMENT_DIR / str(template_id) / str(attachment_id)
    return path if path.is_file() else None


def delete_attachment(template_id: uuid.UUID, attachment_id: uuid.UUID) -> None:
    path = ATTACHMENT_DIR / str(template_id) / str(attachment_id)
    path.unlink(missing_ok=True)


def delete_all_for_template(template_id: uuid.UUID) -> None:
    """範本刪除時清掉 icon 與整個附件目錄（best-effort）。"""
    try:
        delete_icon(template_id)
        directory = ATTACHMENT_DIR / str(template_id)
        if directory.is_dir():
            for child in directory.iterdir():
                child.unlink(missing_ok=True)
            directory.rmdir()
    except Exception as exc:
        logger.warning(
            "Failed to remove files for template %s: %s", template_id, exc
        )
