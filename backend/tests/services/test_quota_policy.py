"""配額解析與執法純函式測試。"""

from __future__ import annotations

from types import SimpleNamespace

from app.services.resource.quota_policy import (
    DEFAULT_QUOTA,
    EffectiveQuota,
    QuotaUsage,
    check_quota_delta,
    resolve_effective_quota,
)


def _quota_row(**overrides: object) -> SimpleNamespace:
    values: dict = {
        "max_cpu_cores": 8,
        "max_memory_mb": 16384,
        "max_disk_gb": 100,
        "max_instances": 5,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


class TestResolveEffectiveQuota:
    def test_no_rows_returns_default(self) -> None:
        assert resolve_effective_quota(None) == DEFAULT_QUOTA

    def test_user_override_wins(self) -> None:
        user_q = _quota_row(max_cpu_cores=2, max_instances=1)
        result = resolve_effective_quota(user_q)
        assert result.max_cpu_cores == 2
        assert result.max_instances == 1

    def test_global_used_when_no_user_override(self) -> None:
        global_q = _quota_row(max_cpu_cores=16, max_memory_mb=32768)
        result = resolve_effective_quota(None, global_q)
        assert result.max_cpu_cores == 16
        assert result.max_memory_mb == 32768

    def test_user_override_beats_global(self) -> None:
        user_q = _quota_row(max_cpu_cores=2)
        global_q = _quota_row(max_cpu_cores=16)
        assert resolve_effective_quota(user_q, global_q).max_cpu_cores == 2

    def test_user_override_wins_whole_row_even_when_lower(self) -> None:
        """個人覆寫整列全勝：低於全域的欄位不會被全域補回去。"""
        user_q = _quota_row(max_cpu_cores=2, max_memory_mb=1024, max_instances=1)
        global_q = _quota_row(
            max_cpu_cores=16, max_memory_mb=32768, max_instances=20
        )
        assert resolve_effective_quota(user_q, global_q) == EffectiveQuota(
            max_cpu_cores=2, max_memory_mb=1024, max_disk_gb=100, max_instances=1
        )

    def test_falls_back_to_default_when_both_missing(self) -> None:
        assert resolve_effective_quota(None, None) == DEFAULT_QUOTA


class TestCheckQuotaDelta:
    def _quota(self) -> EffectiveQuota:
        return EffectiveQuota(
            max_cpu_cores=8, max_memory_mb=16384, max_disk_gb=100, max_instances=5
        )

    def test_within_quota_passes(self) -> None:
        usage = QuotaUsage(cpu_cores=4, memory_mb=8192, disk_gb=40, instances=2)
        assert check_quota_delta(usage, self._quota(), delta_cores=4) == []

    def test_cpu_over_quota_reports(self) -> None:
        usage = QuotaUsage(cpu_cores=6, memory_mb=0, disk_gb=0, instances=0)
        violations = check_quota_delta(usage, self._quota(), delta_cores=4)
        assert len(violations) == 1
        assert "CPU" in violations[0]

    def test_multiple_violations_all_reported(self) -> None:
        usage = QuotaUsage(cpu_cores=8, memory_mb=16384, disk_gb=100, instances=5)
        violations = check_quota_delta(
            usage,
            self._quota(),
            delta_cores=1,
            delta_memory_mb=1,
            delta_disk_gb=1,
            delta_instances=1,
        )
        assert len(violations) == 4

    def test_negative_delta_always_passes(self) -> None:
        usage = QuotaUsage(cpu_cores=8, memory_mb=16384, disk_gb=100, instances=5)
        assert check_quota_delta(usage, self._quota(), delta_cores=-2) == []

    def test_unlimited_field_skips_check(self) -> None:
        """上限 0 = 無限制：該欄位不執法，其他欄位照常。"""
        quota = EffectiveQuota(
            max_cpu_cores=0, max_memory_mb=16384, max_disk_gb=100, max_instances=5
        )
        usage = QuotaUsage(cpu_cores=999, memory_mb=16384, disk_gb=0, instances=0)
        assert check_quota_delta(usage, quota, delta_cores=1000) == []
        violations = check_quota_delta(
            usage, quota, delta_cores=1000, delta_memory_mb=1
        )
        assert len(violations) == 1
        assert "記憶體" in violations[0]

    def test_all_unlimited_passes_everything(self) -> None:
        quota = EffectiveQuota(
            max_cpu_cores=0, max_memory_mb=0, max_disk_gb=0, max_instances=0
        )
        usage = QuotaUsage(
            cpu_cores=10_000, memory_mb=10_000_000, disk_gb=100_000, instances=999
        )
        violations = check_quota_delta(
            usage,
            quota,
            delta_cores=1,
            delta_memory_mb=1,
            delta_disk_gb=1,
            delta_instances=1,
        )
        assert violations == []
