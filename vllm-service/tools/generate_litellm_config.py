#!/usr/bin/env python3
"""Generate a secret-free LiteLLM Proxy config from ``models.json``.

The generated config is intentionally a runtime artifact.  It must not be
committed because the deployment mode may contain infrastructure details.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import yaml


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_MODELS = PROJECT_ROOT / "models.json"
DEFAULT_TEMPLATE = PROJECT_ROOT / "litellm" / "config.template.yaml"
DEFAULT_OUTPUT = PROJECT_ROOT / "litellm" / "config.yaml"
SECRET_ENV_REFS = {
    "os.environ/LITELLM_MASTER_KEY",
    "os.environ/VLLM_UPSTREAM_API_KEY",
    "os.environ/DATABASE_URL",
}


def _path(value: str) -> Path:
    path = Path(value)
    return path if path.is_absolute() else Path.cwd() / path


def _require_str(model: dict[str, Any], field: str, index: int) -> str:
    value = model.get(field)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"模型配置 #{index} 的 '{field}' 必須是非空字串")
    return value.strip()


def _validate_legacy_aliases(
    legacy_aliases: Any,
    all_aliases: set[str],
    index: int,
) -> list[str]:
    if legacy_aliases is None:
        return []
    if not isinstance(legacy_aliases, list):
        raise ValueError(f"模型配置 #{index} 的 legacy_aliases 必須為陣列")

    names: list[str] = []
    minimum_remove_after = date.today() + timedelta(days=30)
    for legacy_index, legacy in enumerate(legacy_aliases):
        if not isinstance(legacy, dict):
            raise ValueError(
                f"模型配置 #{index} 的 legacy_aliases #{legacy_index} 必須為物件"
            )
        name = legacy.get("name")
        remove_after = legacy.get("remove_after")
        if not isinstance(name, str) or not name.strip():
            raise ValueError(
                f"模型配置 #{index} 的 legacy_aliases #{legacy_index} 缺少 name"
            )
        if not isinstance(remove_after, str):
            raise ValueError(
                f"模型配置 #{index} 的 legacy alias {name!r} 缺少 remove_after"
            )
        try:
            remove_date = date.fromisoformat(remove_after)
        except ValueError as exc:
            raise ValueError(
                f"模型配置 #{index} 的 legacy alias {name!r} remove_after 必須為 YYYY-MM-DD"
            ) from exc
        if remove_date < minimum_remove_after:
            raise ValueError(
                f"模型配置 #{index} 的 legacy alias {name!r} 必須至少保留 30 天"
            )
        normalized = name.strip()
        if normalized in all_aliases:
            raise ValueError(f"公開 alias 重複: {normalized}")
        all_aliases.add(normalized)
        names.append(normalized)
    return names


def load_models(path: Path) -> list[dict[str, Any]]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"models.json 不是有效 JSON: {path}") from exc
    if not isinstance(raw, list) or not raw:
        raise ValueError("models.json 必須是非空陣列")

    aliases: set[str] = set()
    served_names: set[str] = set()
    ports: set[int] = set()
    models: list[dict[str, Any]] = []
    for index, item in enumerate(raw):
        if not isinstance(item, dict):
            raise ValueError(f"模型配置 #{index} 必須為物件")
        alias = _require_str(item, "alias", index)
        served_model_name = _require_str(item, "served_model_name", index)
        _require_str(item, "model_name", index)
        port = item.get("api_port")
        if isinstance(port, bool) or not isinstance(port, int) or not 1 <= port <= 65535:
            raise ValueError(f"模型配置 #{index} 的 api_port 必須介於 1 和 65535")
        if alias in aliases:
            raise ValueError(f"公開 alias 重複: {alias}")
        if served_model_name in served_names:
            raise ValueError(f"served_model_name 重複: {served_model_name}")
        if port in ports:
            raise ValueError(f"api_port 重複: {port}")
        aliases.add(alias)
        served_names.add(served_model_name)
        ports.add(port)

        metadata = item.get("litellm", {})
        if not isinstance(metadata, dict):
            raise ValueError(f"模型 {alias} 的 litellm 必須為物件")
        rpm = metadata.get("rpm", 10)
        if isinstance(rpm, bool) or not isinstance(rpm, int) or rpm < 1:
            raise ValueError(f"模型 {alias} 的 litellm.rpm 必須為正整數")
        capabilities = item.get("capabilities", {})
        if not isinstance(capabilities, dict):
            raise ValueError(f"模型 {alias} 的 capabilities 必須為物件")

        model = dict(item)
        model["alias"] = alias
        model["served_model_name"] = served_model_name
        model["api_port"] = port
        model["litellm"] = {"rpm": rpm}
        model["capabilities"] = capabilities
        model["_legacy_alias_names"] = _validate_legacy_aliases(
            item.get("legacy_aliases"), aliases, index
        )
        models.append(model)
    return models


def load_template(path: Path) -> dict[str, Any]:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("LiteLLM template 必須為 YAML object")
    if "model_list" in data or "database_url" in data.get("general_settings", {}):
        raise ValueError("template 不得定義 model_list 或 database_url")
    return data


def _deployment(model: dict[str, Any], public_name: str) -> dict[str, Any]:
    return {
        "model_name": public_name,
        "litellm_params": {
            "model": f"hosted_vllm/{model['served_model_name']}",
            # The current hosted_vllm provider appends its OpenAI endpoint
            # path directly to api_base. vLLM itself serves those routes below
            # /v1, so the version prefix must be part of the generated base.
            "api_base": f"http://127.0.0.1:{model['api_port']}/v1",
            "api_key": "os.environ/VLLM_UPSTREAM_API_KEY",
            "timeout": 300,
            "rpm": model["litellm"]["rpm"],
        },
        "model_info": {
            "mode": "chat",
            "capabilities": model["capabilities"],
        },
    }


def render_config(
    models: list[dict[str, Any]], template: dict[str, Any], mode: str
) -> dict[str, Any]:
    config = dict(template)
    general_settings = dict(config.get("general_settings", {}))
    general_settings["master_key"] = "os.environ/LITELLM_MASTER_KEY"
    if mode == "production":
        general_settings["database_url"] = "os.environ/DATABASE_URL"
    config["general_settings"] = general_settings
    config["model_list"] = [
        _deployment(model, public_name)
        for model in models
        for public_name in [model["alias"], *model["_legacy_alias_names"]]
    ]
    return config


def assert_secret_free(config: dict[str, Any]) -> None:
    serialized = yaml.safe_dump(config, sort_keys=True)
    if "api_key:" not in serialized or "master_key:" not in serialized:
        raise ValueError("產生設定缺少必要的環境變數 reference")
    for line in serialized.splitlines():
        if any(key in line for key in ("api_key:", "master_key:", "database_url:")):
            if not any(reference in line for reference in SECRET_ENV_REFS):
                raise ValueError("產生設定不得包含明文 secret")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--models", default=str(DEFAULT_MODELS))
    parser.add_argument("--template", default=str(DEFAULT_TEMPLATE))
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--mode", choices=("integration", "production"), default="integration")
    args = parser.parse_args()

    if args.mode == "production" and not os.getenv("LITELLM_SERVICE_API_KEY"):
        parser.error("production mode requires LITELLM_SERVICE_API_KEY to be injected")

    try:
        models = load_models(_path(args.models))
        template = load_template(_path(args.template))
        config = render_config(models, template, args.mode)
        assert_secret_free(config)
    except (OSError, ValueError) as exc:
        parser.error(str(exc))

    output = _path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(yaml.safe_dump(config, sort_keys=False), encoding="utf-8")
    print(f"Generated LiteLLM {args.mode} config: {output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
