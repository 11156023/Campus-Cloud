# vLLM Gateway AI API Parameters 對照表

更新日期：2026-06-13

本文整理 `vllm-service` 目前 Gateway 對外可使用的 AI API 參數，格式對照 vLLM/OpenAI-compatible API 的 Parameters 表格。

## 適用端點

| Layer | Endpoint | 說明 |
| --- | --- | --- |
| Transparent Proxy | `POST /v1/chat/completions` | OpenAI-compatible Chat Completions proxy，依 `model` alias 轉發到對應 vLLM instance。 |
| Transparent Proxy | `POST /v1/completions` | OpenAI-compatible Completions proxy。 |
| Transparent Proxy | `POST /v1/responses` | OpenAI-compatible Responses proxy，建議優先用於 reasoning / structured output 類能力驗證。 |
| Compatibility Wrapper | `POST /api/chat` | 既有工具相容文字聊天，使用 `message` 組成 `messages`。 |
| Compatibility Wrapper | `POST /api/chat/stream` | 既有工具相容文字串流，使用 SSE 回傳。 |

## 傳遞規則

- `/v1/*`：以透明代理為主；Gateway 只會解析 `model` 做路由、攤平 `extra_body`、檢查 capabilities / priority / queue class，其他欄位原樣轉送上游 vLLM。
- `/api/chat*`：由 wrapper 建立 `messages` 與 `stream`，因此外部不可覆寫這些 wrapper 核心欄位；其他 OpenAI-compatible / vLLM extra 欄位會 passthrough。
- SDK 風格的 `extra_body` 可接受；Gateway 會攤平成 direct HTTP payload。例如 `extra_body: {"top_k": 20}` 會轉成上游 payload 的 `top_k: 20`。
- 若 direct payload 與 `extra_body` 同時提供同名欄位，以 direct payload 為準。
- `gateway_queue_class` 是 Gateway 自用欄位，送到 upstream 前會移除。

## Parameters

### OpenAI-compatible 主要參數

| Name | Type | Default | Description |
| --- | --- | --- | --- |
| `model` | string | Gateway default model | 模型 alias。Gateway 會依此欄位查找 `models.json` 中的 alias，並轉換成對應上游 vLLM 的實際 model path。 |
| `messages` | array | - | Chat Completions 使用的訊息陣列，格式遵循 OpenAI chat messages。`/api/chat*` 會由 `message` 自動組出此欄位。 |
| `prompt` | string or array | - | Completions API 使用的 prompt。主要用於 `/v1/completions`。 |
| `max_tokens` | integer | `/api/chat`: `settings.default_max_tokens` | 限制模型最多生成的 token 數。`/v1/*` 未指定時交由上游 vLLM 處理。 |
| `temperature` | float | `/api/chat`: `settings.default_temperature` | 控制輸出隨機性；值越高越發散，值越低越穩定。 |
| `top_p` | float | `/api/chat`: `settings.default_top_p` | nucleus sampling；只從累積機率達到 `top_p` 的候選 token 中取樣。 |
| `stream` | boolean | `false` | 是否使用串流回傳。`/api/chat/stream` 固定為 `true`，`/api/chat` 固定為 `false`。 |
| `stream_options` | map | - | 串流選項，例如 `{"include_usage": true}`。`/api/chat/stream` 會預設加入 usage 統計。 |
| `stop` | string or array | - | 模型遇到指定 stop sequence 時停止生成。 |
| `frequency_penalty` | float | - | 根據 token 在已生成文字中出現頻率調整重複傾向；由上游 vLLM 處理。 |
| `presence_penalty` | float | `/api/chat`: `settings.default_presence_penalty` | 根據 token 是否已出現調整模型重複既有主題的傾向。 |
| `seed` | integer | - | 指定後可讓取樣更可重現；實際可重現程度仍取決於上游 vLLM 與模型行為。 |
| `logit_bias` | map | - | 對指定 token id 加上 bias，影響其被選中的機率。 |
| `response_format` | map | - | 要求模型輸出特定格式，例如 `{"type": "json_schema", ...}`。若模型 `capabilities.response_format_json_schema=false`，Gateway 會回 400。 |
| `tools` | array | - | Tool calling 定義，格式遵循 OpenAI tool calling request shape。若模型 `capabilities.tool_use=false`，Gateway 會回 400。 |
| `tool_choice` | string or object | - | 控制模型是否或如何呼叫 tool。若模型 `capabilities.tool_use=false`，Gateway 會回 400。 |
| `reasoning_effort` | string | - | 控制支援 reasoning 模型的推理強度。若模型 `capabilities.reasoning=false`，Gateway 會回 400。 |
| `metadata` | map | - | Client 自訂 metadata。Gateway 也可從 `metadata.gateway_queue_class` 讀取 queue class。 |
| `modalities` | array | - | 指定輸入/輸出 modality；主要保留給支援多模態或 Responses API 的模型。 |

### vLLM 擴充與模型特定參數

| Name | Type | Default | Description |
| --- | --- | --- | --- |
| `top_k` | integer | `/api/chat`: `settings.default_top_k` | vLLM 擴充取樣參數；限制每步只從 top-k token 中選擇。 |
| `min_p` | float | `/api/chat`: `settings.default_min_p` | vLLM 擴充取樣參數；以最高機率 token 為基準，過低機率 token 不納入候選。 |
| `repetition_penalty` | float | `/api/chat`: `settings.default_repetition_penalty` | vLLM 擴充參數；降低輸入或輸出中重複 token 的傾向。 |
| `priority` | integer | `0` | vLLM priority scheduling 參數。只有模型 `scheduling_policy=priority` 且 `capabilities.priority_scheduling=true` 時 Gateway 才接受，否則回 400。 |
| `structured_outputs` | map | - | vLLM structured output 擴充參數。若模型 `capabilities.structured_outputs=false`，Gateway 會回 400。 |
| `chat_template_kwargs` | map | - | 傳給 chat template 的額外參數，由上游 vLLM/template 決定實際支援項目。 |
| `extra_body` | map | - | SDK 風格額外參數容器。Gateway 會攤平成 direct payload；不會把 `extra_body` 巢狀物件原封不動送到 upstream。 |

### Gateway 自用參數

| Name | Type | Default | Description |
| --- | --- | --- | --- |
| `gateway_queue_class` | string | `stream` if `stream=true`, otherwise `interactive` | Gateway admission 分類，可為 `interactive`、`stream`、`batch`。此欄位送 upstream 前會移除。 |
| `metadata.gateway_queue_class` | string | - | 等同 `gateway_queue_class`，適合不想把 Gateway 自用欄位放在 top-level payload 的 client。 |
| `X-Request-Id` | header | auto generated if missing | Gateway 會將 request id 轉送 upstream，並在 downstream response header 回傳。若 client 未提供，Gateway 會自動產生。 |

## `/api/chat*` Wrapper Parameters

`/api/chat` 與 `/api/chat/stream` 主要服務既有工具，request body 以簡化欄位為主。

| Name | Type | Default | Description |
| --- | --- | --- | --- |
| `message` | string | required | 使用者輸入文字。Wrapper 會與內建 system prompt 組成 OpenAI `messages`。 |
| `model` | string | Gateway default model | 模型 alias。若省略則使用 Gateway default model。 |
| `max_tokens` | integer | `settings.default_max_tokens` | 最大生成 token 數。 |
| `temperature` | float | `settings.default_temperature` | 取樣溫度。 |
| `top_p` | float | `settings.default_top_p` | nucleus sampling。 |
| `top_k` | integer | `settings.default_top_k` | vLLM top-k sampling。 |
| `min_p` | float | `settings.default_min_p` | vLLM min-p sampling。 |
| `presence_penalty` | float | `settings.default_presence_penalty` | presence penalty。 |
| `repetition_penalty` | float | `settings.default_repetition_penalty` | repetition penalty。 |
| `extra_body` | map | - | 額外 OpenAI-compatible 或 vLLM 參數。會攤平成 direct payload。 |
| 其他欄位 | any | - | 除 `message`、`messages`、`model`、`stream` 等 wrapper 保留欄位外，其他欄位會 passthrough。 |

Wrapper 保留欄位：

| Name | Reason |
| --- | --- |
| `message` | wrapper 的簡化輸入來源。 |
| `messages` | 由 wrapper 根據 system prompt 與 `message` 建立，不允許外部覆寫。 |
| `stream` | 由 endpoint 決定：`/api/chat=false`、`/api/chat/stream=true`。 |
| `model` | 用於 Gateway route selection，會被轉換成 upstream model path。 |
| `max_tokens` / `temperature` / `top_p` / `top_k` / `min_p` / `presence_penalty` / `repetition_penalty` | wrapper 有明確預設值與欄位位置。 |

## 模型能力宣告

`models.json` 可用 `capabilities` 宣告模型能力。Gateway 只在能力明確宣告為不支援時擋下請求；未宣告時偏向透明代理。

| Name | Type | Default | Description |
| --- | --- | --- | --- |
| `chat` | boolean | - | 模型是否支援 chat completions。主要供文件與 client 判斷。 |
| `stream` | boolean | - | 模型是否支援 stream。主要供文件與 client 判斷。 |
| `reasoning` | boolean | - | 是否支援 `reasoning_effort` 或 reasoning 類能力。 |
| `response_format_json_schema` | boolean | - | 是否支援 `response_format.type=json_schema`。 |
| `structured_outputs` | boolean | - | 是否支援 `structured_outputs`。 |
| `tool_use` | boolean | - | 是否支援 `tools` / `tool_choice`。 |
| `vision` | boolean | - | 是否支援圖片/影片等視覺輸入。 |
| `priority_scheduling` | boolean | - | 是否允許 request payload 使用 `priority`。仍需搭配模型設定 `scheduling_policy=priority`。 |

## 範例

### `/v1/chat/completions`

```json
{
  "model": "Qwen/Qwen3-14B-FP8",
  "messages": [
    {"role": "user", "content": "請用三點說明 vLLM Gateway 的用途"}
  ],
  "max_tokens": 512,
  "temperature": 0.7,
  "top_p": 0.95,
  "top_k": 20,
  "min_p": 0,
  "priority": 1,
  "response_format": {
    "type": "json_schema",
    "json_schema": {
      "name": "Answer",
      "schema": {
        "type": "object",
        "properties": {
          "points": {
            "type": "array",
            "items": {"type": "string"}
          }
        },
        "required": ["points"]
      }
    }
  }
}
```

### SDK `extra_body` 對照 direct payload

SDK 送入：

```json
{
  "model": "Qwen/Qwen3-14B-FP8",
  "messages": [{"role": "user", "content": "你好"}],
  "extra_body": {
    "top_k": 20,
    "min_p": 0,
    "priority": 1
  }
}
```

Gateway 轉送 upstream 前等價於：

```json
{
  "model": "<resolved-upstream-model-path>",
  "messages": [{"role": "user", "content": "你好"}],
  "top_k": 20,
  "min_p": 0,
  "priority": 1
}
```

### `/api/chat`

```json
{
  "model": "Qwen/Qwen3-14B-FP8",
  "message": "請用繁體中文回答：什麼是 chunked prefill？",
  "max_tokens": 512,
  "temperature": 0.7,
  "extra_body": {
    "priority": 1,
    "gateway_queue_class": "interactive"
  }
}
```

