#!/usr/bin/env bash
# Minimal post-cutover smoke test. It exercises only the four public
# data-plane endpoints through Campus, never LiteLLM administration endpoints.
set -euo pipefail

: "${AI_API_SMOKE_KEY:?set an isolated, approved ccai_* smoke credential}"

base_url="${AI_API_PUBLIC_BASE_URL:-http://127.0.0.1:8000/api/v1}"
model="${AI_API_SMOKE_MODEL:-gpt-oss-20B}"
base_url="${base_url%/}"
workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

curl_api() {
  # Keep the user credential out of curl's command arguments and output.
  curl --silent --show-error --fail-with-body \
    --config <(printf 'header = "Authorization: Bearer %s"\n' "$AI_API_SMOKE_KEY") \
    "$@"
}

printf 'Checking public model list...\n'
curl_api "$base_url/ai-proxy/models" >"$workdir/models.json"
jq -e --arg model "$model" '.data | any(.id == $model)' "$workdir/models.json" >/dev/null

printf 'Checking chat/completions (non-stream)...\n'
curl_api -H 'Content-Type: application/json' \
  --data "{\"model\":\"$model\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply with OK.\"}],\"max_tokens\":8}" \
  "$base_url/ai-proxy/chat/completions" >"$workdir/chat.json"
jq -e '.choices and .usage' "$workdir/chat.json" >/dev/null

printf 'Checking chat/completions (stream)...\n'
curl_api --no-buffer -H 'Content-Type: application/json' \
  --data "{\"model\":\"$model\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply with OK.\"}],\"max_tokens\":8,\"stream\":true}" \
  "$base_url/ai-proxy/chat/completions" >"$workdir/chat.sse"
grep -Fqx 'data: [DONE]' "$workdir/chat.sse"

printf 'Checking completions...\n'
curl_api -H 'Content-Type: application/json' \
  --data "{\"model\":\"$model\",\"prompt\":\"Reply with OK.\",\"max_tokens\":8}" \
  "$base_url/ai-proxy/completions" >"$workdir/completions.json"
jq -e '.choices and .usage' "$workdir/completions.json" >/dev/null

printf 'Checking Responses API...\n'
curl_api -H 'Content-Type: application/json' \
  --data "{\"model\":\"$model\",\"input\":\"Reply with OK.\",\"max_output_tokens\":8}" \
  "$base_url/ai-proxy/responses" >"$workdir/responses.json"
jq -e '.object and .usage' "$workdir/responses.json" >/dev/null

printf 'AI API LiteLLM cutover smoke test passed.\n'
