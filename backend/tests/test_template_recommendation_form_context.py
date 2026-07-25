from datetime import UTC, datetime, timedelta

from app.ai.template_recommendation.catalog_service import TemplateCatalog
from app.ai.template_recommendation.recommendation_service import normalize_ai_result
from app.ai.template_recommendation.schemas import (
    RecommendationFormContext,
    RecommendationRequest,
)


def test_form_context_accepts_complete_prefill_and_schedule_options() -> None:
    start = datetime(2026, 7, 20, 10, tzinfo=UTC)
    context = RecommendationFormContext(
        resource_type="vm",
        mode="scheduled",
        hostname="ai-lab",
        reason="課程模型推論",
        vm_template_id=9000,
        username="student",
        cores=4,
        memory_mb=8192,
        disk_gb=40,
        storage="local-lvm",
        selected_gpu_mapping_id="gpu-a",
        schedule_options=[
            {
                "start_at": start,
                "end_at": start + timedelta(hours=1),
                "status": "available",
                "recommended_nodes": ["pve-gpu-01"],
            }
        ],
    )

    assert context.hostname == "ai-lab"
    assert context.memory_mb == 8192
    assert context.schedule_options[0].recommended_nodes == ["pve-gpu-01"]


def test_normalizer_selects_only_available_gpu_and_valid_schedule() -> None:
    start = datetime(2026, 7, 20, 10, tzinfo=UTC)
    end = start + timedelta(hours=4)
    request = RecommendationRequest(
        goal="需要 GPU 執行模型推論",
        requires_gpu=True,
        form_context=RecommendationFormContext(
            resource_type="vm",
            mode="scheduled",
            schedule_options=[{"start_at": start, "end_at": end}],
        ),
    )
    result = normalize_ai_result(
        {
            "form_prefill": {
                "resource_type": "vm",
                "mode": "scheduled",
                "gpu_mapping_id": "gpu-full",
                "start_at": start.isoformat(),
                "end_at": end.isoformat(),
                "cores": 4,
                "memory_mb": 8192,
                "disk_gb": 40,
            }
        },
        request,
        [],
        TemplateCatalog(items=[], categories={}),
        resource_options={
            "lxc_os_images": [],
            "vm_operating_systems": [],
            "gpu_options": [
                {"mapping_id": "gpu-full", "available_count": 0, "total_vram_mb": 24576},
                {"mapping_id": "gpu-free", "available_count": 1, "total_vram_mb": 16384},
            ],
        },
    )

    prefill = result["final_plan"]["form_prefill"]
    assert prefill["gpu_mapping_id"] == "gpu-free"
    assert prefill["start_at"] == start.isoformat()
    assert prefill["end_at"] == end.isoformat()
    assert prefill["storage"] == "local-lvm"
