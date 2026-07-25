#!/usr/bin/env bash
set -euo pipefail

base_url="${LITELLM_BASE_URL:-http://127.0.0.1:4000}"
: "${LITELLM_MASTER_KEY:?export the isolated staging LITELLM_MASTER_KEY before running this check}"

curl_json() {
  curl --fail --silent --show-error "$@"
}

printf 'Checking LiteLLM liveliness and readiness...\n'
curl_json "$base_url/health/liveliness" | jq -e '. == "I\u0027m alive!"' >/dev/null
curl_json "$base_url/health/readiness" | jq -e '.status == "healthy"' >/dev/null

printf 'Checking the public model allowlist...\n'
curl_json -H "Authorization: Bearer $LITELLM_MASTER_KEY" "$base_url/v1/models" \
  | jq -e '
      [.data[].id] | sort == ["Qwen/Qwen3-14B-FP8", "gpt-oss-20B"]
    ' >/dev/null

printf 'Checking both hosted vLLM deployments...\n'
curl_json -H "Authorization: Bearer $LITELLM_MASTER_KEY" "$base_url/health" \
  | jq -e '.healthy_count == 2 and .unhealthy_count == 0' >/dev/null

printf 'Checking backend-to-host gateway reachability...\n'
docker compose exec -T backend python -c '
import urllib.request
urllib.request.urlopen("http://host.docker.internal:4000/health/liveliness", timeout=5).read()
' >/dev/null

printf 'LiteLLM staging verification passed.\n'
