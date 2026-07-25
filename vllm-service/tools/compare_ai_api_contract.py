#!/usr/bin/env python3
"""Compare the stable shape of two Phase 0/3 contract fixtures."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


def _load(path: str) -> dict[str, Any]:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _keys(value: Any) -> set[str]:
    return set(value) if isinstance(value, dict) else set()


_REQUIRED_BODY_KEYS = {
    "chat_completion": {"id", "object", "created", "model", "choices", "usage"},
    "completion": {"id", "object", "created", "model", "choices", "usage"},
    "responses": {"id", "object", "created_at", "model", "output", "usage"},
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("baseline")
    parser.add_argument("candidate")
    args = parser.parse_args()
    baseline, candidate = _load(args.baseline), _load(args.candidate)
    errors: list[str] = []

    baseline_models = {item.get("id") for item in baseline["models"]["body"].get("data", [])}
    candidate_models = {item.get("id") for item in candidate["models"]["body"].get("data", [])}
    if baseline_models != candidate_models:
        errors.append(f"model IDs differ: baseline={sorted(baseline_models)}, candidate={sorted(candidate_models)}")

    for model, baseline_cases in baseline.get("cases", {}).items():
        candidate_cases = candidate.get("cases", {}).get(model)
        if candidate_cases is None:
            errors.append(f"missing model cases: {model}")
            continue
        for name, baseline_case in baseline_cases.items():
            candidate_case = candidate_cases.get(name)
            if candidate_case is None:
                errors.append(f"missing {model}/{name}")
                continue
            if name == "feature_probes":
                for probe, baseline_probe in baseline_case.items():
                    candidate_probe = candidate_case.get(probe, {})
                    if baseline_probe["status_code"] != candidate_probe.get("status_code"):
                        errors.append(f"status differs for {model}/{name}/{probe}")
                continue
            if baseline_case["status_code"] != candidate_case["status_code"]:
                errors.append(f"status differs for {model}/{name}")
            if name == "chat_completion_stream" and bool(baseline_case.get("last_usage")) != bool(candidate_case.get("last_usage")):
                errors.append(f"final stream usage presence differs for {model}")
            if name in _REQUIRED_BODY_KEYS and not _REQUIRED_BODY_KEYS[name] <= _keys(candidate_case.get("body")):
                errors.append(f"required response keys missing for {model}/{name}")

    if errors:
        print("Contract comparison failed:", *[f"- {error}" for error in errors], sep="\n", file=sys.stderr)
        return 1
    print("Contract comparison passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
