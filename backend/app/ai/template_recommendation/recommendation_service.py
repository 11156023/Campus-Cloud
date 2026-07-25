from __future__ import annotations

import json
from datetime import datetime
from time import perf_counter
from typing import Any

from fastapi import HTTPException

from app.ai.template_recommendation.capability_catalog import SUPPORTED_TEMPLATE_SLUGS
from app.ai.template_recommendation.catalog_service import (
    TemplateCatalog,
    build_catalog_prompt_bundle,
    catalog_lookup,
)
from app.ai.template_recommendation.config import settings
from app.ai.template_recommendation.node_service import summarize_device_nodes
from app.ai.template_recommendation.prompt import (
    build_fast_ai_plan_prompt,
    build_intent_extraction_prompt,
)
from app.ai.template_recommendation.schemas import (
    ChatMessage,
    ChatRequest,
    DeviceNode,
    ExtractedIntent,
    RecommendationRequest,
)
from app.ai.utils import apply_thinking_control, safe_int
from app.infrastructure.ai.template_recommendation import client

MIN_VM_DISK_GB = 20
MIN_LXC_DISK_GB = 8

WINDOWS_KEYWORDS = (
    "windows",
    "window",
    "win11",
    "win10",
    "rdp",
    "remote desktop",
    "gui",
    "遠端桌面",
    "圖形介面",
    "桌面環境",
    "視窗",
    "windows 遠端",
    "windows遠端",
)

GPU_KEYWORDS = (
    "gpu",
    "cuda",
    "nvidia",
    "pytorch",
    "tensorflow",
    "llm",
    "stable diffusion",
    "comfyui",
    "yolo",
    "ai training",
    "inference",
    "模型訓練",
    "模型推論",
    "深度學習",
    "機器學習",
    "顯卡",
    "加速卡",
    "訓練模型",
    "跑模型",
)

DATABASE_KEYWORDS = (
    "database",
    "db",
    "mysql",
    "postgres",
    "postgresql",
    "mariadb",
    "mongodb",
    "redis",
    "sql",
    "資料庫",
    "關聯式資料庫",
    "資料庫伺服器",
    "儲存資料",
    "存資料",
)

PUBLIC_WEB_KEYWORDS = (
    "public",
    "internet",
    "external",
    "domain",
    "webhook",
    "public ip",
    "public-ip",
    "外網",
    "公開網路",
    "網際網路",
    "網域",
    "域名",
    "公開存取",
    "對外服務",
    "外部連線",
    "公網",
)


def _extract_user_signal_flags(messages: list[ChatMessage]) -> dict[str, bool]:
    user_text = "\n".join(
        str(message.content)
        for message in messages
        if str(message.role).strip().lower() == "user"
    )

    normalized_text = _normalize_user_text_for_intent(user_text)

    def _contains_any(keywords: tuple[str, ...]) -> bool:
        return any(keyword.casefold() in normalized_text for keyword in keywords)

    return {
        "needs_windows": _contains_any(WINDOWS_KEYWORDS),
        "requires_gpu": _contains_any(GPU_KEYWORDS),
        "needs_database": _contains_any(DATABASE_KEYWORDS),
        "needs_public_web": _contains_any(PUBLIC_WEB_KEYWORDS),
    }


def infer_intent_from_chat(request: ChatRequest) -> ExtractedIntent:
    """Build a fast intent seed locally; the planner still interprets full chat context."""
    recent = request.messages[-12:]
    user_texts = [
        str(message.content).strip()
        for message in recent
        if str(message.role).strip().lower() == "user" and str(message.content).strip()
    ]
    goal_summary = "\n".join(user_texts)[-4000:] or "請依目前表單內容提供完整配置建議"
    flags = _extract_user_signal_flags(recent)
    normalized = _normalize_user_text_for_intent(goal_summary)
    latest_user_text = _normalize_user_text_for_intent(user_texts[-1] if user_texts else "")
    negations = ("不需要", "不要", "不用", "不必", "無需", "取消", "no", "without")

    def _latest_explicitly_negates(keywords: tuple[str, ...]) -> bool:
        for keyword in keywords:
            index = latest_user_text.find(keyword)
            if index < 0:
                continue
            prefix = latest_user_text[max(0, index - 12):index].strip()
            if any(prefix.endswith(word) for word in negations):
                return True
        return False

    if _latest_explicitly_negates(GPU_KEYWORDS):
        flags["requires_gpu"] = False
    if _latest_explicitly_negates(WINDOWS_KEYWORDS):
        flags["needs_windows"] = False
    if _latest_explicitly_negates(DATABASE_KEYWORDS):
        flags["needs_database"] = False
    if _latest_explicitly_negates(PUBLIC_WEB_KEYWORDS):
        flags["needs_public_web"] = False
    role = "teacher" if any(word in normalized for word in ("teacher", "教授", "老師", "教學")) else "student"
    course_context = "teaching" if role == "teacher" else ("research" if any(word in normalized for word in ("research", "研究", "實驗")) else "coursework")
    budget_mode = "performance" if any(word in normalized for word in ("performance", "效能", "速度優先")) else ("resource-saving" if any(word in normalized for word in ("省資源", "低成本", "節省")) else "balanced")
    return ExtractedIntent(
        goal_summary=goal_summary,
        role=role,
        course_context=course_context,
        budget_mode=budget_mode,
        **flags,
    )


def _normalize_user_text_for_intent(text: str) -> str:
    return str(text or "").casefold().replace("　", " ")


def _minimum_disk_gb(resource_type: str) -> int:
    return MIN_VM_DISK_GB if resource_type == "vm" else MIN_LXC_DISK_GB


def _gpu_option_label(option: dict[str, Any]) -> str:
    description = str(option.get("description") or "").strip()
    mapping_id = str(option.get("mapping_id") or "").strip()
    node = str(option.get("node") or "").strip()
    if description:
        return description
    if mapping_id and node:
        return f"{mapping_id} ({node})"
    return mapping_id or node or "GPU"


def _best_gpu_option(options: list[dict[str, Any]]) -> dict[str, Any] | None:
    available = [option for option in options if int(option.get("available_count") or 0) > 0]
    if not available:
        return None
    return sorted(
        available,
        key=lambda option: (
            -int(option.get("available_count") or 0),
            -int(option.get("total_vram_mb") or 0),
            str(option.get("mapping_id") or ""),
        ),
    )[0]


def _build_submission_reason(
    *,
    request: RecommendationRequest,
    resource_type: str,
    service_name: str,
    cores: int,
    memory_mb: int,
    disk_gb: int,
) -> str:
    usage_label = {
        "coursework": "課程作業",
        "teaching": "教學服務",
        "research": "研究用途",
    }.get(request.course_context, "一般用途")
    scope_label = "個人使用" if request.sharing_scope == "personal" else "共享使用"
    env_label = "LXC" if resource_type == "lxc" else "VM"
    return (
        f"申請 {env_label} 執行 {service_name}，供{scope_label}的{usage_label}使用，"
        f"配置 {cores} vCPU、{memory_mb} MB RAM、{disk_gb} GB Disk，"
        "以符合目前功能需求並避免資源浪費。"
    )


async def extract_intent_from_chat(request: ChatRequest) -> ExtractedIntent:
    model_name = settings.VLLM_MODEL_NAME
    if not model_name:
        raise HTTPException(
            status_code=503,
            detail="AI model binding is missing in config/system-ai.json.",
        )

    recent_messages = request.messages[-10:]
    user_messages: list[str] = []
    full_chat_history: list[str] = []

    for message in recent_messages:
        normalized_role = str(message.role).strip().lower()
        if normalized_role == "user":
            user_messages.append(f"User: {message.content}")
            full_chat_history.append(f"User: {message.content}")
        elif normalized_role == "assistant":
            full_chat_history.append(f"Assistant: {message.content}")

    prompt = build_intent_extraction_prompt(
        formatted_user_history="\n\n".join(user_messages) if user_messages else "(No user messages)",
        formatted_history="\n\n".join(full_chat_history) if full_chat_history else "(No conversation history)",
        user_signal_flags=_extract_user_signal_flags(recent_messages),
    )
    payload = apply_thinking_control(
        {
            "model": model_name,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": 1024,
            "temperature": 0.1,
            "response_format": {"type": "json_object"},
        },
        settings.VLLM_ENABLE_THINKING,
    )

    try:
        data = await client.create_chat_completion(payload)
        return ExtractedIntent(**json.loads(data["choices"][0]["message"]["content"]))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AI extraction failed: {exc}") from exc


async def generate_ai_plan(
    request: RecommendationRequest,
    template_catalog: TemplateCatalog,
    chat_history: list[ChatMessage],
    *,
    resource_options: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    model_name = settings.VLLM_MODEL_NAME
    if not model_name:
        raise HTTPException(
            status_code=503,
            detail="AI model binding is missing in config/system-ai.json.",
        )

    prompt_bundle = build_catalog_prompt_bundle(
        template_catalog,
        request.goal,
        request.top_k,
        needs_public_web=request.needs_public_web,
        needs_database=request.needs_database,
    )
    user_context = {
        "goal": request.goal,
        "role": request.role,
        "preset": request.preset,
        "course_context": request.course_context,
        "sharing_scope": request.sharing_scope,
        "expected_users": request.expected_users,
        "budget_mode": request.budget_mode,
        "resource_baseline": request.resource_baseline,
        "needs_public_web": request.needs_public_web,
        "needs_database": request.needs_database,
        "requires_gpu": request.requires_gpu,
        "needs_windows": request.needs_windows,
        "form_context": (
            request.form_context.model_dump(
                mode="json",
                exclude={
                    "gpu_options",
                    "lxc_os_options",
                    "vm_os_options",
                    "resource_options_from_client",
                },
            )
            if request.form_context
            else None
        ),
    }
    resource_options = resource_options or {
        "lxc_os_images": [],
        "vm_operating_systems": [],
        "gpu_options": [],
    }
    gpu_options = list(resource_options.get("gpu_options") or [])
    plan_schema = {
        "summary": "Traditional Chinese summary",
        "application_target": {
            "service_name": "string",
            "service_slug": "template-slug-or-empty",
            "execution_environment": "lxc|vm",
            "environment_reason": "Traditional Chinese short reason",
        },
        "form_prefill": {
            "resource_type": "lxc|vm",
            "mode": "immediate|scheduled",
            "hostname": "string",
            "service_template_slug": "lxc-service-template-slug-or-empty",
            "lxc_os_image": "real-lxc-os-image-or-empty",
            "vm_template_id": "integer-or-0",
            "gpu_mapping_id": "gpu-mapping-id-or-empty",
            "start_at": "ISO-8601-datetime-or-empty",
            "end_at": "ISO-8601-datetime-or-empty",
            "immediate_no_end": "boolean",
            "cores": "integer",
            "memory_mb": "integer",
            "disk_gb": "integer",
        },
    }
    payload = apply_thinking_control(
        {
            "model": model_name,
            "messages": [
                {
                    "role": "user",
                    "content": build_fast_ai_plan_prompt(
                        user_context=user_context,
                        prompt_bundle=prompt_bundle,
                        resource_options={
                            **resource_options,
                            "gpu_options": gpu_options,
                        },
                        plan_schema=plan_schema,
                        conversation_history=[
                            {"role": str(item.role), "content": str(item.content)}
                            for item in chat_history[-12:]
                            if str(item.role).strip().lower() in {"user", "assistant"}
                        ],
                    ),
                }
            ],
            "max_tokens": settings.VLLM_MAX_TOKENS,
            "temperature": settings.VLLM_TEMPERATURE,
            "top_p": settings.VLLM_TOP_P,
            "top_k": settings.VLLM_TOP_K,
            "min_p": settings.VLLM_MIN_P,
            "presence_penalty": settings.VLLM_PRESENCE_PENALTY,
            "repetition_penalty": settings.VLLM_REPETITION_PENALTY,
            "response_format": {"type": "json_object"},
        },
        settings.VLLM_ENABLE_THINKING,
    )

    try:
        started_at = perf_counter()
        data = await client.create_chat_completion(payload)
        elapsed_seconds = max(perf_counter() - started_at, 0.0)
        usage = data.get("usage") or {}
        completion_tokens = int(usage.get("completion_tokens") or 0)
        metrics = {
            "prompt_tokens": int(usage.get("prompt_tokens") or 0),
            "completion_tokens": completion_tokens,
            "total_tokens": int(usage.get("total_tokens") or 0),
            "elapsed_seconds": round(elapsed_seconds, 3),
            "tokens_per_second": round((completion_tokens / elapsed_seconds) if elapsed_seconds > 0 else 0.0, 2),
        }
        return json.loads(data["choices"][0]["message"]["content"]), metrics
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"AI planning failed: {exc}") from exc


def normalize_ai_result(
    ai_result: dict[str, Any],
    request: RecommendationRequest,
    nodes: list[DeviceNode],
    template_catalog: TemplateCatalog,
    *,
    resource_options: dict[str, Any] | None = None,
) -> dict[str, Any]:
    lookup = catalog_lookup(template_catalog)
    resource_options = resource_options or {
        "lxc_os_images": [],
        "vm_operating_systems": [],
        "gpu_options": [],
    }
    lxc_os_images = list(resource_options.get("lxc_os_images") or [])
    vm_operating_systems = list(resource_options.get("vm_operating_systems") or [])
    gpu_options = list(resource_options.get("gpu_options") or [])
    form_context = request.form_context
    raw_prefill = dict(ai_result.get("form_prefill") or {})

    recommended_templates: list[dict[str, Any]] = []
    for item in list(ai_result.get("recommended_templates") or []):
        slug = str(item.get("slug") or "").strip().lower()
        if slug not in SUPPORTED_TEMPLATE_SLUGS:
            continue
        template = lookup.get(slug)
        if not template:
            continue
        recommended_templates.append(
            {
                "slug": template.slug,
                "name": template.name,
                "why": str(item.get("why") or "AI 依需求推薦此模板。").strip(),
            }
        )

    possible_needed_templates: list[dict[str, Any]] = []
    for item in list(ai_result.get("possible_needed_templates") or []):
        slug = str(item.get("slug") or "").strip().lower()
        if slug not in SUPPORTED_TEMPLATE_SLUGS:
            continue
        template = lookup.get(slug)
        if not template or any(existing["slug"] == template.slug for existing in recommended_templates):
            continue
        possible_needed_templates.append(
            {
                "slug": template.slug,
                "name": template.name,
                "why": str(item.get("why") or "AI 判斷可能需要此輔助模板。").strip(),
            }
        )

    machines: list[dict[str, Any]] = []
    for machine in list(ai_result.get("machines") or []):
        slug = str(machine.get("template_slug") or "").strip().lower()
        if slug not in SUPPORTED_TEMPLATE_SLUGS:
            continue
        template = lookup.get(slug)
        if not template:
            continue

        install_methods = template.raw.get("install_methods") or []
        default_resources = dict(install_methods[0].get("resources") or {}) if install_methods else {}
        cpu = safe_int(machine.get("cpu"), int(default_resources.get("cpu") or 2), minimum=1, extract_digits=True)
        memory_mb = safe_int(machine.get("memory_mb"), int(default_resources.get("ram") or 2048), minimum=256, extract_digits=True)
        gpu = safe_int(machine.get("gpu"), 1 if request.requires_gpu else 0, minimum=0, extract_digits=True)
        deployment_type = str(machine.get("deployment_type") or "").strip().lower()
        if deployment_type not in {"lxc", "vm"}:
            deployment_type = "vm" if (request.needs_windows or gpu > 0) else "lxc"
        default_disk_gb = int(default_resources.get("hdd") or _minimum_disk_gb(deployment_type))
        disk_gb = safe_int(
            machine.get("disk_gb"),
            default_disk_gb,
            minimum=_minimum_disk_gb(deployment_type),
            extract_digits=True,
        )

        machines.append(
            {
                "name": str(machine.get("name") or f"{template.slug}-node").strip(),
                "purpose": str(machine.get("purpose") or "主要服務").strip(),
                "template_slug": template.slug,
                "deployment_type": deployment_type,
                "cpu": cpu,
                "memory_mb": memory_mb,
                "disk_gb": disk_gb,
                "gpu": gpu,
                "assigned_node": machine.get("assigned_node"),
                "why": str(machine.get("why") or "AI 依需求與目前節點容量安排此部署單位。").strip(),
            }
        )

    primary_machine = machines[0] if machines else {}
    primary_template = recommended_templates[0] if recommended_templates else {}
    resource_type = str(
        raw_prefill.get("resource_type")
        or primary_machine.get("deployment_type")
        or ("vm" if request.needs_windows else "lxc")
    ).lower()
    if resource_type not in {"lxc", "vm"}:
        resource_type = "vm" if request.needs_windows else "lxc"

    hostname_seed = str(
        raw_prefill.get("hostname")
        or (form_context.hostname if form_context else "")
        or primary_machine.get("name")
        or primary_template.get("slug")
        or "ai-generated-host"
    ).lower()
    hostname = "".join(char if (char.isalnum() or char == "-") else "-" for char in hostname_seed.replace("_", "-")).strip("-")[:63]
    if not hostname:
        hostname = "ai-generated-host"

    service_template_slug = str(
        raw_prefill.get("service_template_slug")
        or (form_context.service_template_slug if form_context else "")
        or primary_template.get("slug")
        or primary_machine.get("template_slug")
        or ""
    ).strip().lower()
    if service_template_slug not in lookup:
        service_template_slug = ""

    selected_lxc_image = ""
    if resource_type == "lxc" and lxc_os_images:
        requested_image = str(raw_prefill.get("lxc_os_image") or (form_context.lxc_os_image if form_context else "") or "").strip()
        selected_lxc_image = next(
            (item["value"] for item in lxc_os_images if item["value"] == requested_image),
            lxc_os_images[0]["value"],
        )

    selected_vm_template_id = 0
    selected_vm_os = ""
    if resource_type == "vm" and vm_operating_systems:
        requested_vm_template_id = safe_int(raw_prefill.get("vm_template_id") or (form_context.vm_template_id if form_context else 0), 0, minimum=0, extract_digits=True)
        selected_vm = next(
            (item for item in vm_operating_systems if int(item.get("template_id") or 0) == requested_vm_template_id),
            vm_operating_systems[0],
        )
        selected_vm_template_id = int(selected_vm.get("template_id") or 0)
        selected_vm_os = str(selected_vm.get("label") or "").strip()

    requested_gpu_mapping_id = str(
        raw_prefill.get("gpu_mapping_id")
        or (form_context.selected_gpu_mapping_id if form_context else "")
        or ""
    ).strip()
    selected_gpu: dict[str, Any] | None = None
    if resource_type == "vm" and gpu_options:
        if requested_gpu_mapping_id:
            selected_gpu = next(
                (
                    option
                    for option in gpu_options
                    if str(option.get("mapping_id") or "").strip() == requested_gpu_mapping_id
                    and int(option.get("available_count") or 0) > 0
                ),
                None,
            )
        if not selected_gpu and (request.requires_gpu or requested_gpu_mapping_id):
            selected_gpu = _best_gpu_option(gpu_options)

    gpu_reason = ""
    gpu_candidates: list[dict[str, Any]] = []
    if resource_type == "vm" and gpu_options:
        for option in gpu_options[:3]:
            if int(option.get("available_count") or 0) <= 0:
                continue
            gpu_candidates.append(
                {
                    "mapping_id": str(option.get("mapping_id") or "").strip(),
                    "label": _gpu_option_label(option),
                    "reason": "此 GPU 目前有可用額度，適合作為預設推薦。",
                }
            )
        if selected_gpu:
            gpu_reason = "AI 依目前可用 GPU 與節點狀況挑選最適合的映射。"
        elif request.requires_gpu:
            gpu_reason = "使用者明確需要 GPU，但目前可用 GPU 不足。"

    selected_gpu_mapping_id = ""
    selected_gpu_label = ""
    if selected_gpu:
        selected_gpu_mapping_id = str(selected_gpu.get("mapping_id") or "").strip()
        selected_gpu_label = _gpu_option_label(selected_gpu)

    cores = safe_int(raw_prefill.get("cores") or (form_context.cores if form_context else None) or primary_machine.get("cpu"), 2, minimum=1, extract_digits=True)
    memory_mb = safe_int(raw_prefill.get("memory_mb") or (form_context.memory_mb if form_context else None) or primary_machine.get("memory_mb"), 2048, minimum=512, extract_digits=True)
    disk_gb = safe_int(
        raw_prefill.get("disk_gb") or (form_context.disk_gb if form_context else None) or primary_machine.get("disk_gb"),
        _minimum_disk_gb(resource_type),
        minimum=_minimum_disk_gb(resource_type),
        extract_digits=True,
    )
    username = ""
    if resource_type == "vm":
        username = str(raw_prefill.get("username") or (form_context.username if form_context else "") or "student").strip() or "student"

    mode = str(raw_prefill.get("mode") or (form_context.mode if form_context else "") or "scheduled").strip().lower()
    if mode not in {"immediate", "scheduled"}:
        mode = "scheduled"

    def _parse_datetime(value: Any) -> datetime | None:
        if isinstance(value, datetime):
            return value
        text = str(value or "").strip()
        if not text:
            return None
        try:
            return datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            return None

    start_at = form_context.start_at if form_context and form_context.start_at else None
    end_at = form_context.end_at if form_context and form_context.end_at else None
    if mode == "scheduled" and not (start_at and end_at):
        requested_start = _parse_datetime(raw_prefill.get("start_at"))
        requested_end = _parse_datetime(raw_prefill.get("end_at"))
        schedule_options = list(form_context.schedule_options) if form_context else []
        selected_schedule = next(
            (
                option for option in schedule_options
                if option.start_at == requested_start and option.end_at == requested_end
            ),
            schedule_options[0] if schedule_options else None,
        )
        if selected_schedule:
            start_at, end_at = selected_schedule.start_at, selected_schedule.end_at
    if mode == "immediate":
        start_at = None
        if bool(raw_prefill.get("immediate_no_end", form_context.immediate_no_end if form_context else True)):
            end_at = None

    immediate_no_end = mode == "immediate" and end_at is None
    storage = str(raw_prefill.get("storage") or (form_context.storage if form_context else "") or "local-lvm").strip() or "local-lvm"

    service_name = str(
        ai_result.get("application_target", {}).get("service_name")
        or primary_template.get("name")
        or request.goal[:40]
    ).strip()

    form_prefill = {
        "resource_type": resource_type,
        "mode": mode,
        "hostname": hostname,
        "service_template_slug": service_template_slug if resource_type == "lxc" else "",
        "lxc_os_image": selected_lxc_image if resource_type == "lxc" else "",
        "vm_os_choice": selected_vm_os if resource_type == "vm" else "",
        "vm_template_id": selected_vm_template_id if resource_type == "vm" else 0,
        "gpu_mapping_id": selected_gpu_mapping_id if resource_type == "vm" else "",
        "start_at": start_at.isoformat() if start_at else "",
        "end_at": end_at.isoformat() if end_at else "",
        "immediate_no_end": immediate_no_end,
        "cores": cores,
        "memory_mb": memory_mb,
        "disk_gb": disk_gb,
        "storage": storage,
        "username": username,
        "reason": _build_submission_reason(
            request=request,
            resource_type=resource_type,
            service_name=service_name,
            cores=cores,
            memory_mb=memory_mb,
            disk_gb=disk_gb,
        ),
    }

    return {
        "persona": {
            "role": request.role,
            "preset": request.preset,
            "course_context": request.course_context,
            "sharing_scope": request.sharing_scope,
            "budget_mode": request.budget_mode,
            "resource_baseline": request.resource_baseline,
        },
        "device_profile": summarize_device_nodes(nodes),
        "summary": str(ai_result.get("summary") or "").strip(),
        "workload_profile": str(ai_result.get("workload_profile") or "ai-planned").strip(),
        "rule_basis": {
            "reasons": [str(item).strip() for item in list(ai_result.get("decision_factors") or []) if str(item).strip()],
            "capacity_checks": [
                {
                    "machine": machine.get("name"),
                    "assigned_node": machine.get("assigned_node"),
                    "status": "ai-assigned",
                }
                for machine in machines
            ],
        },
        "recommended_path": {
            "fit": "ai-generated plan",
            "why": [item["why"] for item in recommended_templates] or ["AI 依需求與可用設備規劃推薦路徑。"],
            "upgrade_when": str(ai_result.get("upgrade_when") or "").strip(),
        },
        "final_plan": {
            "summary": str(ai_result.get("summary") or "").strip(),
            "application_target": {
                "service_name": service_name,
                "service_slug": service_template_slug,
                "execution_environment": resource_type,
                "environment_reason": str(
                    ai_result.get("application_target", {}).get("environment_reason")
                    or ("使用 VM 以符合作業系統或環境需求。" if resource_type == "vm" else "使用 LXC 以提供較精簡的服務部署方式。")
                ).strip(),
            },
            "form_prefill": form_prefill,
            "gpu_recommendation": {
                "should_use_gpu": bool(selected_gpu_mapping_id),
                "selected_gpu_mapping_id": selected_gpu_mapping_id,
                "selected_gpu_label": selected_gpu_label,
                "reason": gpu_reason,
                "candidates": gpu_candidates,
            },
            "machines": machines,
            "recommended_templates": recommended_templates,
            "possible_needed_templates": possible_needed_templates[:3],
            "overall_config": {
                "deployment_strategy": str(ai_result.get("overall_config", {}).get("deployment_strategy") or "AI 依需求、模板與目前節點容量整理部署策略。").strip(),
                "machine_count": len(machines),
                "total_cpu": sum(int(machine.get("cpu") or 0) for machine in machines),
                "total_memory_mb": sum(int(machine.get("memory_mb") or 0) for machine in machines),
                "total_disk_gb": sum(int(machine.get("disk_gb") or 0) for machine in machines),
            },
        },
    }
