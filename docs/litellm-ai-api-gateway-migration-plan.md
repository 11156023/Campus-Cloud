# AI API Gateway 遷移至 LiteLLM 深入計劃

文件狀態：Phase 4 實作工件已補齊；Phase 5 尚未切流、尚未開始 24/72 小時觀察
最後更新：2026-07-16

## 1. 決策摘要

本計劃將移除 `vllm-service/gateway/main.py` 自製的多模型 AI API Gateway，改由 LiteLLM Proxy 負責 AI API 的模型轉發、路由控制、上游健康檢查與運行監控。

本次只調整對外 AI API 路徑。System AI 主模型維持目前的獨立直連方式，不接入 LiteLLM，也不作 fallback 或容量共用。

目標呼叫鏈如下：

```text
System AI（本次不變）
Campus backend
  └─ VLLM_BASE_URL
       └─ 主模型雲主機 / 單模型 vLLM

AI API（本次遷移）
外部使用者 ccai_* API Key
  └─ Campus backend /api/v1/ai-proxy/*
       ├─ 使用者驗證與申請生命週期
       ├─ Redis per-user rate limit
       ├─ Campus AIAPIUsage 業務用量紀錄
       └─ AI_API_BASE_URL
            └─ LiteLLM Proxy
                 ├─ gpt-oss-20B      → vLLM :8103
                 └─ Qwen3-14B-FP8    → vLLM :8104
```

核心原則：

- LiteLLM 是模型流量控制面，不取代 Campus 的使用者與審核系統。
- Campus backend 繼續是唯一公開 AI API 入口；LiteLLM 不直接暴露給一般使用者。
- 使用者既有 `ccai_*` key、呼叫 URL 與 Authorization 格式完全不變。
- 最終只保留 LiteLLM 一個模型 Gateway；舊自製 Gateway 僅在遷移觀察期暫時並行。
- 舊自製 Gateway 不負責 System AI；System AI 維持 Campus backend 直連另一台主模型。
- Campus DB 繼續是使用者用量、申請、憑證、撤銷與管理頁的業務資料來源。
- LiteLLM 提供模型層的 routing、retry、cooldown、health 與運行觀測訊號。
- `models.json` 管理模型如何啟動；LiteLLM config 管理流量如何路由，兩者責任不得混合。
- 切換必須可只靠還原 `AI_API_BASE_URL` 快速回滾。

## 2. 範圍與非目標

### 2.1 本次範圍

- 在多模型雲主機部署 LiteLLM Proxy。
- LiteLLM 直接轉發到同機的兩個 vLLM OpenAI-compatible instance。
- 保留現有公開模型 alias。
- 開放一般文字生成模型所需的 OpenAI-compatible APIs：`models`、`chat/completions`、`completions`、`responses`。
- 保留非串流與 streaming，並支援 OpenAI-compatible tools、reasoning、structured output 等 request fields。
- 保留 Campus `ccai_*` API Key、審核、到期、撤銷、旋轉與 per-user rate limit。
- 保留 Campus `AIAPIUsage` 與既有使用者／管理者 AI 監控頁。
- 將 LiteLLM health、上游部署狀態與錯誤訊號接入目前專案的監控邏輯。
- 讓 `vllm-service/main.py` 的多模型模式只負責 vLLM instance 生命週期。
- 移除自製 Gateway 程式、測試、文件與失效設定。

### 2.2 非目標

- 不更改 `VLLM_BASE_URL`、`VLLM_API_KEY`、`VLLM_MODEL_NAME`。
- 不將 System AI 主模型加入 LiteLLM model list。
- 不讓 AI API 流量 fallback 到 System AI 主模型。
- 不把 Campus 使用者 `ccai_*` key 搬成 LiteLLM Virtual Key。
- 不修改 Campus 現有 PostgreSQL tables 或既有 Alembic migration。
- 不在第一階段用 LiteLLM spend 資料取代 Campus token 用量資料。
- LiteLLM Admin UI 只供受管管理來源使用，不提供給一般使用者。
- 不公開 LiteLLM `/key/*`、`/team/*`、`/user/*`、`/config/*`、`/health/*`、`/metrics` 或 `/ui` 等管理與運行端點給一般 AI API 使用者。
- 不在本次提供 embeddings、images、audio、rerank、files、batches、vector stores 或其他非一般文字生成 API。
- 不在未驗證前啟用跨模型 fallback、response cache 或語義路由。

## 3. 現況盤點

### 3.1 System AI 路徑

Campus backend 透過下列設定直接呼叫另一台主模型服務：

```env
VLLM_BASE_URL=http://<main-model-host>:8000/v1
VLLM_API_KEY=<main-model-service-key>
VLLM_MODEL_NAME=<main-model-name>
```

這條路徑被 AI 導覽、模板推薦、Rubric、Teacher Judge、PVE log 等內部功能使用。本次完全不修改。

### 3.2 AI API 公開入口

使用者呼叫：

```text
POST /api/v1/ai-proxy/chat/completions
GET  /api/v1/ai-proxy/models
GET  /api/v1/ai-proxy/usage/my
GET  /api/v1/ai-proxy/rate-limit/status
```

Campus backend 目前負責：

- 驗證 `Authorization: Bearer ccai_*`。
- 檢查 credential 是否存在、過期、撤銷，以及使用者是否啟用。
- 使用 Redis sliding window 執行每個使用者或 credential 的 rate limit。
- 將公開 request schema 轉成上游 OpenAI-compatible payload。
- 代理非串流與 SSE streaming response。
- 擷取 usage、duration、status 與 error，寫入 `AIAPIUsage`。
- 提供個人用量、管理者彙總、呼叫明細與前端監控。

這些都是 Campus 產品層責任，遷移後繼續保留。

### 3.3 自製 Gateway 現有責任

`vllm-service/gateway/main.py` 現在提供：

- `/v1/models`
- `/v1/chat/completions`
- `/v1/completions`
- `/v1/responses`
- `/health`、`/ready`、`/metrics`
- model alias 到 vLLM port 的路由與實際 model path 改寫。
- global/per-model semaphore、queue timeout 與 429。
- capability、priority 與 queue class 檢查。
- request ID、streaming passthrough 與上游錯誤轉換。
- `/api/chat*`、圖片、文件與影片的相容 wrapper。

目前 repository 內沒有 backend 或 frontend runtime 程式直接呼叫 `/api/chat*`、`/api/model-info` 或 `/api/config`；找到的引用集中在 Gateway 自身測試與舊文件。正式刪除前仍需在實際部署的 access log 做一次確認，避免 repository 外部工具仍使用這些端點。

### 3.4 多模型啟動耦合

`vllm-service/main.py gateway` 目前同時執行：

1. 讀取 `.env.API` 與 `models.json`。
2. 依序啟動各 vLLM instance。
3. 等待每個模型 ready。
4. 另起 `uvicorn gateway.main:app`。
5. 收到信號時一起停止 Gateway 與模型。

現有 `--no-gateway` 已可只啟動模型，因此遷移初期可先使用該旗標，之後再清除 Gateway 專用程式碼。

## 4. 目標架構與責任邊界

### 4.1 元件責任矩陣

| 能力 | Campus backend | LiteLLM | vLLM | System AI 主模型 |
| --- | --- | --- | --- | --- |
| 公開 `ccai_*` 驗證 | 保留，唯一來源 | 不處理終端使用者 key | 不處理 | 不涉及 |
| 申請、核准、撤銷、期限 | 保留 | 不處理 | 不處理 | 不涉及 |
| per-user RPM | 保留 Redis sliding window | 只作模型／deployment 保護 | 不處理 | 不涉及 |
| 使用者 token 業務帳 | 保留 `AIAPIUsage` | 僅作運行觀測 | 回傳 usage | 不涉及 |
| 模型 alias | 只轉送／展示 | 唯一路由來源 | 使用 served model name | 維持原設定 |
| 上游路由 | 不處理 | 負責 | 被呼叫 | 不接入 |
| retry/cooldown/fallback | 只映射錯誤 | 負責；初期保守設定 | 不處理 | 不接入 |
| 模型排程與 batching | 不處理 | 不處理 GPU 排程 | 負責 | 自己負責 |
| 健康檢查 | 檢查 LiteLLM | 檢查各 vLLM | 提供 health/models | 維持原路徑 |
| 運行監控 | 保留 Campus DB、admin 頁、structured logs 與 Sentry | 提供 health、deployment 與 runtime 訊號 | 提供模型層訊號 | 不納入本次 |

### 4.2 Gateway 最終拓樸

正式切換完成後不保留兩個模型 Gateway 疊加：

```text
AI API data plane
使用者
  └─ Campus backend（產品 API facade，不做模型選路）
       └─ LiteLLM（唯一模型 Gateway）
            ├─ vLLM :8103
            └─ vLLM :8104

System AI（獨立且不經 LiteLLM）
Campus backend
  └─ 另一台主模型 vLLM
```

Campus backend 仍保留一層 HTTP proxy，是因為它負責 `ccai_*`、權限、限流與業務記帳；它不再維護模型 port、route、retry、cooldown 或 capability routing，因此不視為第二個模型 Gateway。

舊 `vllm-service/gateway/main.py` 只在切換觀察期保持可回滾狀態。穩定後從 runtime、啟動腳本與 repository 全部移除，不負責連接 System AI，也不作 LiteLLM 的下一層 proxy。

### 4.3 部署位置

LiteLLM 建議部署在多模型雲主機，原因如下：

- LiteLLM 到兩個 vLLM instance 走本機網路，減少額外跨主機延遲。
- vLLM 的 `8103/8104` 不需要公開到外網。
- 多模型主機故障時只影響 AI API，不會連帶中斷另一台 System AI 主模型。
- Campus backend 只需允許連線到 LiteLLM 的單一 private endpoint。

建議網路邊界：

```text
Internet
  └─ Campus nginx/backend :443
       └─ private network / TLS
            └─ LiteLLM :4000
                 ├─ loopback/private :8103
                 └─ loopback/private :8104
```

部署方式優先順序：

1. 使用 Docker Hub image `litellm/litellm:latest`，部署前執行 `docker pull litellm/litellm:latest`；每次 pull 後記錄實際 image ID/digest，供稽核與回滾。
2. LiteLLM 以 `vllm-service/litellm/docker-compose.yml` 作為獨立 Compose project；根目錄
   `docker-compose.yml` 不管理它。
3. 多模型 vLLM 保持 host Python process，不強制納入 Docker。
4. LiteLLM container 使用 host networking 存取只綁 `127.0.0.1` 的 vLLM。
5. host firewall 限制 `4000` 只能由 Campus backend、既有監控來源與管理網段存取。

不得把 `8103/8104` 直接公開至 Internet。

此設計下有兩種啟動情境：

```bash
# 不需要 AI API 的一般環境
docker compose up -d

# 需要 AI API 的環境（先產生 vllm-service/litellm/config.yaml）
cd vllm-service/litellm
docker compose up -d
```

vLLM GPU processes 仍由 host launcher 先行啟動：

```bash
cd vllm-service
./start_multi_model_cluster.sh
```

由於 LiteLLM 使用 host networking，Campus backend container 不可使用 `127.0.0.1:4000`；Linux Compose 必須加入 `host.docker.internal:host-gateway`，並設定：

```env
AI_API_BASE_URL=http://host.docker.internal:4000
```

若 Campus backend 本身直接運行在 host，則使用 `http://127.0.0.1:4000`。

### 4.4 身分與金鑰

production 呼叫鏈使用三段彼此獨立的金鑰：

```text
使用者 ccai_* key
  └─ 只由 Campus backend 驗證

Campus → LiteLLM service key
  └─ 只允許 Campus backend 使用

LiteLLM → vLLM upstream key
  └─ 每個 deployment 可獨立設定，不能回傳給 client
```

正式環境中，LiteLLM master key 只供管理操作，不應放入 Campus backend。Campus 必須使用權限較低、只允許兩個公開模型的 service Virtual Key。

整合測試階段先不建立 PostgreSQL，使用隔離測試專用 master key，並以 host firewall 限制只有測試 backend/管理來源可連線。此 key 不得沿用至 production。

一般文字模型 API、streaming、使用量與錯誤相容測試全部通過後，下一階段才在現有 PostgreSQL server 建立獨立 LiteLLM database/role，執行 migration 並建立 Campus service Virtual Key。Campus 的 `ccai_*` credential 不複製到 LiteLLM，LiteLLM 只看到一把 Campus service identity。

### 4.5 既有使用者 Key 相容性

Gateway 遷移不會與目前使用者建立 key、撤銷、旋轉或呼叫 API 的流程衝突。每一段 HTTP 連線使用不同的 Authorization header：

```text
使用者
  │ Authorization: Bearer ccai_xxx
  ▼
Campus backend
  │ 驗證 ccai_*、檢查期限與撤銷、執行 per-user rate limit
  │ 建立新的 Authorization: Bearer <LiteLLM Campus service key>
  ▼
LiteLLM
  │ 驗證 Campus service key、檢查模型權限與路由
  │ 建立新的 Authorization: Bearer <vLLM upstream key>
  ▼
vLLM instance
```

必要條件：

- Campus backend 不得 passthrough 使用者原始 Authorization header。
- `AI_API_API_KEY` 改存 LiteLLM Campus service Virtual Key，不能填入任何使用者 `ccai_*` key。
- LiteLLM 只建立 Campus service identity，不為每位 Campus 使用者建立副本。
- LiteLLM `:4000` 不直接提供給一般使用者，否則會繞過 Campus 的申請、撤銷與記帳。

現有 backend 已在驗證 `ccai_*` 後，以設定中的 `AI_API_API_KEY` 建立新的上游 Authorization header；遷移只替換該設定值及 upstream URL。

### 4.6 PostgreSQL 變更邊界

不需要修改：

- Campus `users`、`ai_api_credentials`、`ai_api_usage` 等現有 tables。
- Campus Alembic migration history。
- 現有使用者、credential ciphertext、key prefix 或 usage records。

下一階段需要建立：

```text
同一個 PostgreSQL server
├── <現有 Campus database>
│   └── 現有 tables，完全不變
└── litellm database
    └── LiteLLM 自行管理的 Virtual Key、model metadata、spend 與 migration tables
```

建議建立獨立 PostgreSQL role `litellm`，只授權 `litellm` database。這不是新增 Campus application user，而是 database least-privilege account。

現有 PostgreSQL volume 已初始化時，新增 `/docker-entrypoint-initdb.d` script 不會自動再次執行。因此 implementation 必須提供可重複執行的 one-shot DB init service 或管理指令，負責建立 `litellm` role/database；LiteLLM 自己的 schema migration 不得混入 Campus `prestart` 或 Alembic。

階段門檻：

```text
無 DB 的隔離 LiteLLM 整合測試完整通過
  ↓
建立獨立 litellm database/role
  ↓
執行 LiteLLM migration 與 restart test
  ↓
建立 Campus service Virtual Key
  ↓
才允許 production cutover
```

### 4.7 安裝方式決策

Production 不使用 `uv tool` 或將 LiteLLM 加入 backend/vLLM Python environment：

- Production：Docker image `litellm/litellm:latest`，由 Compose 啟動；每次部署先 pull，並保存該次實際 image ID/digest 與前一版 digest。
- Local smoke test：可使用 `uv tool install 'litellm[proxy]'`。
- 不使用 `uv add litellm`，因為 Campus backend 不 import LiteLLM SDK。
- 不把 LiteLLM 安裝進 vLLM `.venv`，避免 FastAPI、Pydantic、httpx 等依賴互相影響。

## 5. 模型與設定設計

### 5.1 設定的唯一來源

確定採用 `models.json → generator → LiteLLM config`。`vllm-service/models.json` 是模型部署與公開名稱的唯一來源，LiteLLM 不再另外維護每模型 URL/port 環境變數。

`models.json` 管理：

- canonical public alias。
- 過渡期 legacy aliases。
- 穩定的 vLLM served model name。
- 本機模型路徑。
- vLLM port。
- context、GPU memory、batch、sequence 數。
- dtype、quantization、KV cache。
- tool/reasoning parser。
- vLLM scheduling policy。
- 每模型 LiteLLM RPM/TPM 等必要 route metadata。

Git 內保留 LiteLLM base template，管理全域政策：

- routing strategy。
- request timeout。
- retry、cooldown 與 fallback。
- background health checks。
- health/runtime 訊號與 JSON logs。

新增 generator：

```text
vllm-service/tools/generate_litellm_config.py
```

輸入與輸出：

```text
models.json
  + litellm/config.template.yaml
  ↓
litellm/config.yaml
```

產生檔不得進 Git，也不得包含明文 secret；upstream key 只輸出 `os.environ/VLLM_UPSTREAM_API_KEY` reference。啟動 LiteLLM 前必須先產生並驗證 config。

每次修改 alias、port、模型或 route metadata 時：

```bash
python vllm-service/tools/generate_litellm_config.py
docker compose -f vllm-service/litellm/docker-compose.yml up -d --force-recreate litellm
```

CI/test 必須驗證：

- 每個啟用模型都有唯一 `alias`、`served_model_name` 與 `api_port`。
- canonical/legacy alias 不重複。
- 產出的每個 `api_base` 都來自對應 `api_port`。
- 產出的 YAML 可被當次 pull 並記錄 digest 的 LiteLLM image 載入。
- 產出結果不含實際 API key、master key、salt key 或 database password。

完成遷移後，從 `models.json` 移除或停止使用：

- `gateway_max_inflight`
- `gateway_queue_timeout`

`capabilities` 只有在 generator 將它轉成 LiteLLM `model_info`，或 Campus backend 用它控制 endpoint/model allowlist 時才保留；否則一併移除，不能留下無 runtime consumer 的欄位造成誤解。

### 5.2 Public alias 與 served model name

目前 vLLM 使用本機解析後的模型路徑作為實際 model ID，自製 Gateway 再把 alias 改寫成該路徑。移除 Gateway 後，不應讓 LiteLLM 或外部 client 依賴主機上的絕對路徑。

應擴充模型設定並在 vLLM 啟動時傳入：

```text
--served-model-name gpt-oss-20B
--served-model-name Qwen/Qwen3-14B-FP8
```

新增 `served_model_name` 欄位並傳給 vLLM。LiteLLM 的 `hosted_vllm/<served-model-name>` 與 vLLM `/v1/models` 使用該名稱。

Public alias 允許在換模型時修改，但它是對外 API contract。建議 `models.json` 格式：

```json
{
  "alias": "gpt-oss-20B",
  "legacy_aliases": [
    {
      "name": "old-gpt-alias",
      "remove_after": "2026-08-15"
    }
  ],
  "served_model_name": "gpt-oss-20B",
  "model_name": "./AImodels/gpt-oss-20B",
  "api_port": 8103,
  "litellm": {
    "rpm": 10
  }
}
```

換模型／改名時的規則：

1. `alias` 是新的 canonical public name，會出現在 `/v1/models`。
2. alias 變更時，舊名稱必須放入 `legacy_aliases`，由 generator 建立同一 deployment 的相容 alias。
3. 每個 legacy alias 必須記錄 `remove_after`；從新 alias 正式上線日起至少保留 30 個日曆日，並在 release note 公告確切移除日期。
4. generator/CI 必須拒絕 alias 重複、缺少移除日期，或相容期少於 30 天的設定；到期移除另開變更，不由 runtime 自動刪除。
5. `served_model_name` 是 LiteLLM 呼叫 vLLM 使用的 upstream ID，可與 public alias 不同。
6. 若模型替換但想保持 client 相容，可以保留原 `alias`，只更換 `served_model_name`、模型路徑與 deployment。

### 5.3 LiteLLM config 草案

以下是 generator 產物方向；正式欄位必須以當次 pull 的 `litellm/litellm:latest` 實際 image 驗證：

```yaml
model_list:
  - model_name: gpt-oss-20B
    litellm_params:
      model: hosted_vllm/gpt-oss-20B
      api_base: http://127.0.0.1:8103/v1
      api_key: os.environ/VLLM_UPSTREAM_API_KEY
      timeout: 300
      rpm: 10
    model_info:
      mode: chat

  - model_name: Qwen/Qwen3-14B-FP8
    litellm_params:
      model: hosted_vllm/Qwen/Qwen3-14B-FP8
      api_base: http://127.0.0.1:8104/v1
      api_key: os.environ/VLLM_UPSTREAM_API_KEY
      timeout: 300
      rpm: 10
    model_info:
      mode: chat

router_settings:
  routing_strategy: simple-shuffle
  num_retries: 1
  timeout: 300
  optional_pre_call_checks:
    - enforce_model_rate_limits

general_settings:
  master_key: os.environ/LITELLM_MASTER_KEY
  # 下一階段啟用 PostgreSQL/Virtual Key 後才加入：
  # database_url: os.environ/DATABASE_URL
  background_health_checks: true
  health_check_interval: 60
  health_check_details: false

litellm_settings:
  request_timeout: 300
  json_logs: true
  set_verbose: false
```

`api_base` 由 generator 使用 `api_port` 自動組成，不再定義 `GPT_OSS_VLLM_BASE_URL` 或 `QWEN_VLLM_BASE_URL`。目前部署 image 的 `hosted_vllm` provider 會直接在 `api_base` 後加 OpenAI endpoint path，因此 generator 輸出 vLLM 的 `/v1` service root；正式切換前仍必須用鎖定 image 實測確認，不可只依 YAML 靜態判讀。

Generator 必須支援兩種明確模式：

- `integration`：不輸出 `database_url`，只允許隔離測試 master key。
- `production`：輸出 `database_url: os.environ/DATABASE_URL`，要求 Campus service Virtual Key，缺少 DB/key 時拒絕啟動或切流量。

初期每個公開 alias 只對應一個 deployment，因此 routing strategy 不會跨模型亂選。只有相同 `model_name` 下配置多個 deployment 時才進行負載分配。

初始 deployment 保護值統一設為每模型 `rpm: 10`。Campus 既有 per-user Redis rate limit 繼續獨立生效；LiteLLM 的 10 RPM 是每個模型 deployment 的初始總量保護值，完成 Phase 3 壓力測試後才能依實測提高。

### 5.4 OpenAI-compatible API 開放範圍

確定移除自製 Gateway 的 `/api/chat*`、`/api/model-info`、`/api/config`、圖片／文件／影片 wrapper，統一使用 OpenAI-compatible request/response format。

Campus backend 對外提供的是 data-plane allowlist，不是把 LiteLLM 整站 unrestricted passthrough。本次完整範圍固定為：

```text
GET  /models
POST /chat/completions
POST /completions
POST /responses
```

不開放 embeddings、images、audio、rerank、files、batches、vector stores。未來若加入對應模型與產品需求，另立擴充計劃，不透過 generic catch-all 自動公開。

`tools`、`tool_choice`、reasoning、response format、structured output、priority 與 vLLM sampling extensions 屬於文字生成 request fields，納入 `chat/completions` 與 `responses` contract test；模型不支援時回傳標準 OpenAI-compatible error，不轉送到其他模型，也不 fallback 到 System AI。

Campus backend 需要從目前只接受固定 `ChatCompletionRequest` 的實作，擴充成 endpoint-aware OpenAI relay：

- 保留原始 JSON、query parameters 與 streaming body 語義。
- 接受 tools、tool_choice、reasoning、response_format、structured output 與 vLLM extra fields。
- 明確 allowlist HTTP method/path，不提供任意 catch-all 到 LiteLLM。
- 移除使用者 Authorization，改注入 Campus LiteLLM service key。
- 移除 Host、Content-Length 與 hop-by-hop headers，保留安全的 OpenAI request headers。
- 各 endpoint 分別處理 JSON 與 SSE response。
- 各 endpoint 建立 usage/error extractor；無 token usage 的 endpoint 仍記錄 request、duration、status 與 model。
- 保留 request body size、timeout、rate limit 與 model access 控制。

禁止透過公開 AI API relay 存取：

```text
/key/*
/team/*
/user/*
/config/*
/health/*
/metrics
/ui
以及任何 LiteLLM 管理、debug、internal endpoint
```

### 5.5 Retry 與 fallback 原則

初期設定：

- `num_retries` 最多 1 次，避免長生成請求造成重複成本與延遲放大。
- 不設定 `gpt-oss-20B → Qwen3-14B` 或反向 fallback。
- 不設定到 System AI 主模型的 fallback。
- 只對連線失敗、明確 timeout 或 retryable upstream 錯誤重試。
- streaming 已開始回傳 body 後不得由外層重新提交完整請求。
- 429 的 retry 行為需透過測試確認，避免 LiteLLM retry 與 Campus client retry 疊加。

跨模型 fallback 必須等產品確認模型語義、tool calling、reasoning 與輸出格式相容後另案啟用。

### 5.6 Timeout 順序

建議由內到外逐層增加：

```text
vLLM request budget       300s
LiteLLM upstream timeout  310s
Campus upstream timeout   320s
nginx/client idle timeout 330s 以上
```

實際值可以調整，但外層不得比內層更早 timeout，否則會出現 client 已斷線、上游仍持續生成的幽靈請求。

## 6. 控制與監控方案

### 6.1 控制面

第一階段採 Git-managed static config：

- model list 與 routing policy 進版控。
- secret 只透過環境變數或 secret manager 注入。
- production 不自動讀取未知 `.env`；明確啟用 production mode。
- LiteLLM 使用 `litellm/litellm:latest`；每次部署前先在 staging 完成 contract test，並記錄實際 image ID/digest，禁止未測試直接更新 production。
- config 變更先在 staging 驗證，再 rolling restart。
- `/health/readiness` 作服務 readiness；`/health/liveliness` 作 restart probe。
- `/health` 用於模型探測，不應被高頻輪詢，因為會對每個模型發出實際推論請求。

LiteLLM PostgreSQL 用於建立 Campus service Virtual Key、管理身分與 Admin UI。Admin UI 只允許 VPN、管理網段或受保護的反向代理存取。Production model routing 仍由 Git config 管理，避免 UI 與 repository 形成雙重來源。

### 6.2 沿用目前專案監控邏輯

Campus 現有 DB 與管理頁繼續作為主要監控入口，不在本次新增獨立 Prometheus/Grafana stack。`AIAPIUsage` 與既有 monitoring service 繼續記錄：

- 哪個 Campus 使用者呼叫。
- 使用哪把 `ccai_*` credential。
- 申請與 credential 狀態。
- 每個使用者的 token 與成功／失敗紀錄。
- request type（models/chat/completions/completions/responses）。
- model、input/output tokens、duration、status 與 error。
- 管理頁與個人用量頁。

LiteLLM 提供上游運行訊號：

- 哪個 model/deployment 健康。
- Gateway 成功率與錯誤率。
- upstream latency、total latency、LiteLLM overhead。
- streaming time-to-first-token。
- in-flight requests 與 backlog。
- deployment cooldown、fallback、429 與 timeout。
- 各模型 input/output/total tokens。

整合方式：

- Campus backend 在每次 API relay 完成後維持現有 `AIAPIUsage` 寫入。
- streaming 仍從最後 usage chunk 記錄 token；client disconnect/error 也寫入狀態。
- Campus admin AI monitoring 頁維持使用 Campus DB，不直接依賴 LiteLLM DB schema。
- 新增 admin-only LiteLLM runtime snapshot，由 backend 使用管理用 internal credential 查詢 LiteLLM health/model info；一般使用者不可存取。
- LiteLLM `/metrics` 可保持啟用供未來或既有 scraper 使用，但本階段不以新建 Prometheus/Grafana 為完成條件。
- 服務異常沿用目前 backend structured logs、Sentry（若已設定）與管理頁錯誤紀錄。

兩個模型都是 self-hosted vLLM，LiteLLM 的 token metrics 可直接用於運行觀測，但 spend 不代表實際 GPU 成本。若未建立 GPU 時數、電力與折舊的內部計價模型，LiteLLM spend/budget 只能視為零成本或參考值，不得拿來取代 Campus 配額與帳務判斷。

### 6.3 既有頁面調整

既有 Campus AI 管理頁新增或確認以下資訊：

1. Proxy 使用量
   - request count、input/output token。
   - model 與 request type 分布。
   - success/error、duration。

2. LiteLLM runtime
   - readiness/liveliness。
   - 每模型 deployment health。
   - 429、timeout、upstream unavailable。

3. 使用者與 credential
   - 沿用現有申請、active/expired/revoked、rate limit 與個人用量。

4. 資料一致性
   - Campus DB request/token 日彙總。
   - 與 LiteLLM runtime token 指標抽樣比對，不直接相加。

### 6.4 現有監控流程需新增的事件

- LiteLLM readiness 連續 2 分鐘失敗。
- 任一 deployment state 進入 complete outage。
- 5 分鐘 error rate 超過 5%。
- 5 分鐘 429 rate 超過基準值。
- request duration 持續超過服務目標。
- Campus `AIAPIUsage` 與 LiteLLM token 日彙總差異超過 3%。
- LiteLLM DB migration、Virtual Key 驗證或 config generation 失敗。

不得將 prompt、completion、API key 或敏感內容寫入一般錯誤紀錄、Sentry context 或 metrics label。

## 7. Repository 預計變更

### 7.1 新增

建議新增：

```text
vllm-service/litellm/
├── config.template.yaml
├── docker-compose.yml
├── .env.example
└── README.md

vllm-service/start_multi_model_cluster.sh
vllm-service/tools/generate_litellm_config.py
vllm-service/tests/test_litellm_config.py
scripts/init-litellm-db.sh
```

LiteLLM service 使用 `vllm-service/litellm/docker-compose.yml` 獨立部署；該目錄的 `.env`
保存 LiteLLM deployment secret，根目錄 `.env` 只保存 Campus backend 的連線設定。
`scripts/init-litellm-db.sh` 必須可重複執行，且不能修改 Campus application database。

本次不新增 Prometheus/Grafana Compose。若部署環境已有 scraper，可以讀取受保護的 LiteLLM `/metrics`；主要產品監控仍由 Campus DB、既有 admin 頁、structured logs 與 Sentry 負責。

### 7.2 修改

- `vllm-service/main.py`
  - `cluster` 成為多模型啟動的 canonical mode。
  - 遷移期保留 `gateway` alias，但輸出 deprecation warning。
  - 最終移除 Gateway subprocess、health wait 與 shutdown 管理。
- `vllm-service/core/engine.py`
  - 支援穩定 `--served-model-name`。
- `vllm-service/config/settings.py`
  - 新增 `served_model_name`。
- `vllm-service/config/multi_model.py`
  - 保留模型 instance 載入與資源檢查。
  - 最終移除 `GatewayConfig`、`GatewayRoute`、`build_gateway_routes` 與 route lookup。
- `vllm-service/models.json.example`
  - 加入 `served_model_name`、`legacy_aliases` 與 per-model LiteLLM metadata。
  - 移除自製 Gateway 專用欄位。
- `vllm-service/.env.example`
  - 移除 `GATEWAY_*`。
  - 增加 LiteLLM deployment 所需環境變數範例。
- `docker-compose.yml`
  - 新增 `litellm` service 與 `ai-api` profile。
  - 使用 `litellm/litellm:latest`，啟動前 pull，並在 deployment record 保存實際 image ID/digest。
  - 加入 config mount、healthcheck、restart policy 與 secret env。
  - backend 加入 Linux `host.docker.internal:host-gateway` 對應。
- `backend/app/api/routes/ai_proxy.py`
  - 擴充為明確 allowlist 的 OpenAI-compatible data-plane relay。
  - 支援 JSON、SSE 與 endpoint-specific usage logging。
  - 明確阻擋 LiteLLM management/internal endpoints。
- `backend/app/schemas/ai_proxy.py`
  - 移除只允許少量 Chat Completions fields 的公開限制，改為 endpoint-aware validation/passthrough。
- `backend/app/features/ai/config.py`
  - 保留 `AI_API_BASE_URL`，文件改稱 LiteLLM internal endpoint。
  - `AI_API_API_KEY` 改為 LiteLLM service key。
- `.env.example`
  - 更新 AI API upstream 說明與 timeout。
- `backend/tests/test_ai_api_usage.py`
  - 將 gateway 文案改為 LiteLLM。
  - 擴充所有開放 OpenAI-compatible endpoint 的 end-to-end 測試。
- `vllm-service/README.md` 與 AI API 文件
  - 更新多模型啟動與 LiteLLM 架構。

### 7.3 最終刪除

穩定期與外部 access log 確認完成後刪除：

```text
vllm-service/gateway/
vllm-service/tests/test_gateway_ai_api_design.py
vllm-service/start_multi_model_gateway.sh
```

並清除：

- `gateway.main:app`
- `GATEWAY_*`
- `GatewayRuntime`
- Gateway semaphore/queue/capability metrics。
- 舊 `/api/chat*` wrapper 文件與測試。
- 只服務自製 Gateway 的圖片、文件、影片 helper；但刪除前需確認沒有其他工具 import。

## 8. 分階段執行計劃

### Phase 0：建立基準與凍結 API contract

實作產物：`vllm-service/tools/capture_ai_api_contract.py` 與
`vllm-service/tools/compare_ai_api_contract.py`。fixture 請放在受保護的部署作業目錄，
不可提交 API key、Authorization header、含真實使用者 prompt 的 request body 或 production response。

在舊 Gateway 仍運作時，以隔離測試 key 執行：

```bash
cd vllm-service
python tools/capture_ai_api_contract.py \
  --base-url http://127.0.0.1:3000 \
  --api-key "$AI_API_API_KEY" \
  --model gpt-oss-20B \
  --model Qwen/Qwen3-14B-FP8 \
  --output .runtime/contracts/gateway-baseline.json
```

Phase 3 對 LiteLLM 重複擷取，並比較穩定 contract shape（model ID、各 endpoint status、
non-stream body keys、stream 最後 usage 是否存在、feature probes status）：

```bash
python tools/compare_ai_api_contract.py \
  .runtime/contracts/gateway-baseline.json \
  .runtime/contracts/litellm-candidate.json
```

除非有明確核准，Phase 3 的接受門檻如下：成功率不得低於基準 1 個百分點以上；p95
end-to-end latency 與 TTFT 均不得同時超過基準的 20% 且增加 1 秒；429 與 timeout rate
不得高於基準 1 個百分點。測試作業須另保存原始計時序列、LiteLLM image digest、vLLM
版本與 access-log 的 `/api/chat*` 搜尋結果，以便稽核。

工作：

1. 匯出目前 `/v1/models` 結果。
2. 保存兩模型的非串流與 streaming response 樣本。
3. 記錄 usage 最後 chunk、error body、request ID 與 headers。
4. 測試 reasoning、tool calls、JSON schema、priority 與 vLLM extra parameters。
5. 搜尋 repository 與 production access log 的 `/api/chat*` 使用者。
6. 盤點當次 `litellm/litellm:latest` image 與目前兩個 vLLM deployment 實際支援的 OpenAI-compatible endpoints。
7. 記錄現有吞吐、TTFT、p95 latency、429 與 timeout 基準。

完成條件：

- 有可自動比較的 contract fixture。
- 已確認特殊 wrapper 是否可刪。
- 已定義可接受的延遲與錯誤率退化範圍。

### Phase 1：解耦模型啟動與 Gateway

實作產物：`served_model_name` 已成為每個 `models.json` entry 的必填欄位，並傳入
vLLM `--served-model-name`；`start_multi_model_cluster.sh` 執行
`main.py cluster --no-gateway`，不啟動或讀取舊 Gateway runtime 設定。LiteLLM config
一律由 `tools/generate_litellm_config.py` 從 `models.json` 與
`litellm/config.template.yaml` 產生到 ignored 的 `litellm/config.yaml`。

產生器會拒絕重複的 public/legacy alias、served model name、port、無效 legacy expiry、
不合法 RPM 與明文 secret；`integration` 不輸出 database URL，`production` 要求部署注入
service key 並只輸出 `DATABASE_URL` reference。此階段仍保留
`start_multi_model_gateway.sh` 作為回滾入口。

工作：

1. 新增 `served_model_name` 並傳給 vLLM。
2. 新增 `start_multi_model_cluster.sh`，使用 `main.py cluster --no-gateway`。
3. 新增 `models.json → LiteLLM config` generator 與 drift/secret tests。
4. 確認兩模型可獨立啟動、ready 與停止。
5. 保留舊 Gateway 流程作回滾，不立即刪除。

完成條件：

- `GET :8103/v1/models` 與 `GET :8104/v1/models` 回傳穩定 alias。
- generator 產物的 alias、served model name 與 port 和 `models.json` 完全一致。
- 不啟動自製 Gateway 時，兩模型仍可正常運行與優雅關閉。

### Phase 2：部署 LiteLLM staging

工作：

1. 執行 `docker pull litellm/litellm:latest`，記錄實際 image ID/digest，並先在 staging 驗證後才允許使用同一 image 進入後續階段。
2. 設定兩個 `hosted_vllm` deployment。
3. 使用隔離測試專用 master key 與 upstream key；不建立 service Virtual Key，且測試 key 不得沿用至 production。
4. 建立獨立的 `vllm-service/litellm` Compose project，確認根 Compose 一般啟動完全不受影響。
5. 以 generator 的 `integration` 模式產生不含 `database_url` 的設定。
6. 啟用 JSON log 與 health/runtime 訊號，接入既有 structured logs、Sentry 與管理監控邏輯。
7. 初期不啟用跨模型 fallback、cache 或複雜 router plugin。
8. 限制 network，只允許測試 backend、既有監控來源與管理來源。
9. 驗證 backend container 可經 `host.docker.internal:4000` 呼叫 LiteLLM。

完成條件：

- `/health/liveliness`、`/health/readiness` 正常。
- `/health` 顯示兩個 deployment healthy。
- `/v1/models` 只顯示允許的兩個 AI API 模型。
- 測試 backend 可使用隔離 key 呼叫模型，非允許來源無法連入 `:4000`。
- 未建立 LiteLLM database/role，Campus database/schema 完全不變。
- 根目錄既有 `docker compose up -d` 行為不變，且 `docker compose config` 不含 `litellm` service。

### Phase 3：相容性與壓力驗證

測試矩陣：

| 類別 | 必測項目 |
| --- | --- |
| Models | alias、created 欄位補齊、不可見模型過濾 |
| Non-stream | content、finish_reason、usage、duration_ms |
| Stream | SSE 格式、`[DONE]`、最後 usage、client disconnect |
| Reasoning | reasoning_content、reasoning effort/flags |
| Tools | tools、tool_choice、tool_calls |
| Structured | response_format、json_schema、structured_outputs |
| vLLM extra | top_k、min_p、repetition_penalty、priority、extra_body |
| Completions | `/completions` 非串流與串流 |
| Responses | `/responses` input、reasoning、streaming |
| Relay security | management endpoint 阻擋、header sanitization、JSON body limit |
| Errors | 400、401、404、429、500、503、504 格式 |
| Resilience | vLLM restart、connection refused、timeout、LiteLLM restart |
| Load | 1/5/10/20 concurrency、長 prompt、長 streaming |
| Accounting | Campus usage 與 LiteLLM metrics token 差異 |

特別注意：只測試並開放本計劃定義的四個一般文字 API。LiteLLM 支援其他 endpoint 不代表本專案對外開放；Campus relay、當次 pull 的 LiteLLM image 與 upstream deployment 三層都通過 contract test，才可進入建庫階段。

完成條件：

- 既有 `backend/tests/test_ai_api.py` 通過。
- `backend/tests/test_ai_api_usage.py` 對 LiteLLM 完整通過。
- contract fixture 無阻斷性差異。
- p95 latency 與 TTFT 不超過既定容忍值。
- token accounting 差異在容忍範圍內。
- `/models`、`/chat/completions`、`/completions`、`/responses` 的非串流／串流、錯誤、記帳與重啟測試全部完成。
- 此階段仍未建立 LiteLLM PostgreSQL；完整無 DB 整合測試通過是下一階段的必要門檻。

### Phase 4：建立 LiteLLM PostgreSQL 與 production identity

前置門檻：Phase 3 全部完成；若一般文字 API、streaming、usage、error 或 restart contract 尚未通過，不得建庫或建立 production key。

工作：

1. 在現有 PostgreSQL server 以可重複執行的 one-shot 指令建立獨立 `litellm` database/role；不修改 Campus database、tables 或 Alembic history。實作為 `scripts/init-litellm-db.sh`：它使用 Compose `db` container 的 PostgreSQL administrator 建立 `NOINHERIT`、非 superuser `litellm` role 與同名 database；若既有 database owner 不符會拒絕繼續，並可用 `--verify-only` 重跑驗證（包括 role 對 Campus `public` schema 沒有 `CREATE` 權限）。role password 必須由 secret manager 以 `LITELLM_DB_PASSWORD` 的 stdin 注入，不能放在 command argument 或 Git。
2. 使用 Phase 2 已記錄 digest 的同一個 LiteLLM image，對現有 PostgreSQL 版本執行 migration、schema 驗證、restart 與 connection recovery test。
3. 設定固定且不可任意更換的 `LITELLM_SALT_KEY`，納入 secret backup 與復原測試。
4. 建立只允許兩個公開模型的 Campus service Virtual Key；四個一般文字 API 的 path allowlist 仍由 Campus backend 強制執行，master key 僅供管理。
5. 以 generator 的 `production` 模式產生含 `database_url` 的設定，驗證缺少 DB/key 時拒絕啟動或切流量。
6. 驗證 DB unavailable、migration failure 與 Virtual Key failure 都會 fail closed，並由現有監控邏輯告警。

完成條件：

- LiteLLM database/role 與 Campus database 完全隔離，權限測試證明 `litellm` role 不能修改 Campus schema。
- migration、重啟、備份／復原與 DB 失效測試通過。
- Campus service Virtual Key 可呼叫允許模型；經 Campus backend 只能使用四個文字 API，不能轉送管理端點或未允許模型。
- production secrets 不進 Git、generated config 或 logs。

### Phase 5：Campus backend 切換

#### Repository 實作與操作界線

本階段的可版控實作如下；它們不會從 `.env` 自行取得或輸出 production secret，也不會自行
restart production service。需要 key 的命令一律由 operator/secret manager 顯式注入：

- `backend/app/api/routes/ai_proxy.py` 已改為明確 data-plane allowlist：`GET /models` 與
  `POST /chat/completions`、`/completions`、`/responses`。它驗證 `ccai_*`、套用 Campus
  Redis rate limit、移除 client Authorization/Host/hop-by-hop headers，然後只注入
  `AI_API_API_KEY` 的 LiteLLM service key。
- Relay 保留 JSON、query string、SSE body 與安全的 OpenAI headers；streaming 在 response
  完成、失敗或 client disconnect 後以獨立 DB session 寫入 `AIAPIUsage`。它不記錄 prompt、
  completion、client key 或 upstream error body。
- 可用模型由 `vllm-service/models.json` 生成的 LiteLLM `model_list` 決定。Campus relay
  不另設環境變數 allowlist，並將 LiteLLM `/v1/models` 的可見模型原樣轉交給已驗證使用者。
- `scripts/prepare-litellm-ai-api-cutover.py` 預設只做 no-write preflight；加上 `--apply`
  才會備份並原子更新 `.env` 的 upstream URL、restricted service key、320 秒 timeout、
  以及 admin-only LiteLLM runtime snapshot 的 internal endpoint/identity；不會寫入 master key。
- `scripts/verify-ai-api-cutover.sh` 僅透過 Campus public API 做 post-cutover smoke test；它會
  驗證四個文字 API 與 chat SSE，且不存取 LiteLLM 管理 endpoint。

production 切換仍是受權限保護的 operator action，原因是 repository 無法判斷 private CIDR、
VPN/host firewall、LiteLLM Virtual Key 值或既有 production access log。沒有這些輸入時，
不得將範例 `.env` 改成 `:4000` 或重啟服務。

切換前：

1. 備份現有 `.env` 與服務設定。
2. 確認舊 Gateway 仍在 `:3000` 可用。
3. 確認 LiteLLM production endpoint 與 service key。
4. 確認 readiness、現有監控頁／logs／Sentry 與告警。
5. 暫停非必要 LiteLLM config 變更。

切換 gate（全部通過才可進入下一步）：

1. Phase 0 contract baseline、Phase 3 candidate contract/負載資料與 image digest 均已保存於
   受保護部署作業目錄；不存在 blocker 差異。
2. LiteLLM database/role 以 `scripts/init-litellm-db.sh --verify-only` 驗證；migration、
   restart、backup/restore、DB unavailable fail-closed 都已有本次 production image 的紀錄。
3. 受限 Campus service Virtual Key（不是 master key、不是 `ccai_*`）直接呼叫 LiteLLM
   `/v1/models` 時只看到兩個 public alias，且兩個 deployment health 正常。
4. 舊 Gateway `:3000` 的 `/v1/models`、chat 非串流與 chat SSE smoke test 仍通過，以確保
   回滾入口可用。
5. LiteLLM `:4000` 僅可由 Campus backend、監控與管理來源連入；從一般網段測試連線被拒。
6. LiteLLM `/v1/models` 的 aliases 與 `models.json` 產生的 `model_list` 一致；不得暴露
   `served_model_name` 或主機模型路徑。

建議操作順序（在 deployment host、由有權限的 operator 執行）：

```bash
# 0. 先以 production image 產生且檢閱 secret-free config；這一步不會輸出 secret。
cd vllm-service
LITELLM_SERVICE_API_KEY="$LITELLM_SERVICE_API_KEY" \
  ./.venv/bin/python tools/generate_litellm_config.py --mode production
cd ..

# 1. 不寫檔的 P5 dotenv preflight。service key 只能從環境/secret manager 注入。
export LITELLM_SERVICE_API_KEY='<restricted-campus-service-key>'
python scripts/prepare-litellm-ai-api-cutover.py \
  --endpoint http://host.docker.internal:4000

# 若 LiteLLM 不與 backend 同機，確認 private/TLS hostname 的網路邊界後才允許它：
# python scripts/prepare-litellm-ai-api-cutover.py \
#   --endpoint https://litellm.private.example --allow-hostname

# 2. 建立 timestamped .env backup 並原子套用。此指令不會 restart service。
python scripts/prepare-litellm-ai-api-cutover.py \
  --endpoint http://host.docker.internal:4000 --apply

# 3. 用既有部署程序只重建讀取 AI_API_* 的 Campus runtime；不要重建 LiteLLM 或 vLLM。
docker compose up -d --no-deps --force-recreate backend worker

# 4. 透過 Campus public endpoint 驗證，禁止以 LiteLLM /health 或 /key/* 取代此測試。
export AI_API_SMOKE_KEY='<isolated-approved-ccai-smoke-key>'
export AI_API_PUBLIC_BASE_URL='https://<campus-public-host>/api/v1'
./scripts/verify-ai-api-cutover.sh
```

切換命令執行後，保留 `*.env.pre-litellm-*.bak` 至少到 72 小時觀察完成。切換前與每次
rollback/switch 都必須記錄 `.env` backup 名稱、LiteLLM image digest、config SHA-256、操作者
與 UTC 時間；這些紀錄不得包含任何 key 或 request body。

切換：

```env
# backend 運行於目前的 Docker Compose
AI_API_BASE_URL=http://host.docker.internal:4000
AI_API_API_KEY=<litellm-campus-service-key>
AI_API_TIMEOUT=320
```

若 backend 不在同一台 host，`AI_API_BASE_URL` 改用 LiteLLM 的 private IP/TLS endpoint；不得使用公開且未限制來源的 `:4000`。

切換後觀察：

- 先執行管理者 smoke test。
- 再開放少量正式流量。
- 觀察 401、404、429、5xx、TTFT、stream completion 與 usage。
- 比對 Campus 與 LiteLLM 每 15 分鐘 request/token 彙總。

在第一小時採 15 分鐘頻率記錄：Campus `AIAPIUsage` 的 request/success/error、每個
model/request type token、p95 duration；LiteLLM runtime snapshot 的 readiness、deployment
health、429、timeout 與 upstream error。每筆差異調查都以相同 UTC window 比對，且只比較
token/request，不能把 Campus 業務帳與 LiteLLM runtime counter 相加。24 小時前不增加流量、
不更新 LiteLLM image/config，也不停止 `:3000` rollback path。

完成條件：

- 24 小時無阻斷性錯誤。
- 72 小時成功率、延遲、429 與 token 記帳穩定。
- 無使用者仍依賴舊 Gateway 特殊端點。

### Phase 6：停用與移除自製 Gateway

工作：

1. 停止 `gateway.main:app`，但先保留程式碼與設定一個短回滾窗口。
2. 將多模型正式啟動方式改為 cluster-only。
3. 再觀察至少一個完整高峰週期。
4. 刪除 Gateway package、測試、script、設定與文件。
5. 更新 runbook、服務拓樸與值班告警。

完成條件：

- production 不存在對 port `3000` 的流量。
- `rg "gateway\.main|GATEWAY_|/api/chat"` 只剩明確允許的歷史文件或完全無結果。
- 模型啟動、LiteLLM 與 Campus backend 可分別部署／重啟。

## 9. 回滾計劃

### 9.1 切換期回滾

若 LiteLLM 出現相容性、穩定性或性能問題：

1. 將 `AI_API_BASE_URL` 還原為舊 Gateway `http://<multi-model-host>:3000`。
2. 將 `AI_API_API_KEY` 還原為舊 Gateway/upstream key。
3. restart Campus backend workers。
4. 執行 `/models`、非串流與 streaming smoke test。
5. 保留 LiteLLM logs、metrics 與錯誤樣本供分析。

因第一階段不修改 Campus DB schema、不搬使用者 credential，回滾不需要資料轉換。

### 9.2 自製 Gateway 已刪除後

刪除程式碼前必須建立 release tag。若需要緊急復原：

- 以前一 release artifact 啟動舊 Gateway。
- 不 rollback vLLM model process。
- 將 Campus upstream URL 指回舊 Gateway。

不得以 `git reset --hard` 作 production 回滾流程；應使用已驗證的 release image/artifact。

## 10. 主要風險與處理

### 10.1 LiteLLM 成為 AI API 單點

影響：所有公開 AI API 失效，但 System AI 不受影響。

處理：restart policy、readiness、固定版本、資源限制、監控與快速環境變數回滾。未來若流量需要，再用兩個 LiteLLM instance 加 Redis shared state；不是本次首要範圍。

### 10.2 雙重 retry

影響：Campus client、LiteLLM 與 vLLM timeout 疊加，造成延遲與重複生成。

處理：Campus backend 不主動 retry generation；LiteLLM 初期最多一次，stream 開始後禁止重送；timeout 由內到外遞增。

### 10.3 模型名稱不一致

影響：LiteLLM alias 與 vLLM 本機模型 path 不一致，出現 model not found。

處理：導入 `--served-model-name`，不使用絕對模型路徑作公開或路由 ID。

### 10.4 原 Gateway admission control 消失

影響：流量可能更快灌入 vLLM，造成 queue、OOM、TTFT 或 429 行為改變。

處理：用 deployment RPM/TPM、vLLM `max_num_seqs`、壓力測試與 LiteLLM backlog metrics 重新定標。不得直接照搬原 `gateway_max_inflight=6`，需用實測決定。

### 10.5 特殊參數被轉換或丟棄

影響：reasoning、tools、priority、structured output 行為不同。

處理：以 `hosted_vllm` provider 做 contract test；逐欄驗證，不在未測試時開啟 drop-unknown-params 類設定。

### 10.6 監控雙重計數

影響：Campus 與 LiteLLM 數字不同，管理者誤判。

處理：Campus 是使用者業務帳；LiteLLM 是運行帳。Dashboard 明確標示資料來源，並建立差異面板，不把兩者直接相加。

### 10.7 LiteLLM DB 影響流量

影響：若啟用 Virtual Key/Admin UI，DB 故障可能影響驗證與 readiness。

處理：使用獨立 database/user、連線池限制、備份、migration runbook 與 readiness 告警。是否允許 private network 下的 DB graceful degradation 必須另行做失效模式測試；不可直接啟用，因為它可能改變驗證失敗時應 fail-open 或 fail-closed 的安全語義。

## 11. 驗收標準

功能：

- AI API `/models` 可用，三個文字生成 endpoint 的非串流與 streaming 可用。
- `/models`、`/chat/completions`、`/completions`、`/responses` 都能正確 relay；模型不支援欄位時回傳標準錯誤。
- 兩個公開 alias 正確路由到各自 vLLM。
- canonical alias 可由 `models.json` 修改；legacy alias 從新 alias 上線日起至少保留 30 個日曆日，且依公告日期下線。
- `ccai_*` 申請、核准、到期、撤銷與旋轉行為不變。
- 個人用量與 admin monitoring 仍可使用。
- System AI 所有功能與設定完全不變。

安全：

- 一般使用者不能直連 LiteLLM 管理 API。
- vLLM ports 不對 Internet 公開。
- master key、service key、upstream key 不進 Git 或 logs。
- LiteLLM health/runtime 端點不得對一般使用者公開；若既有 scraper 使用 `/metrics`，必須使用專用 credential。

可靠性：

- LiteLLM restart 後能自動恢復。
- 單一 vLLM down 時正確回傳可辨識的 5xx，不誤送另一模型。
- rollback 可在 10 分鐘內完成。
- 72 小時觀察期無阻斷性問題。

性能：

- LiteLLM overhead p95 在事前定義的容忍值內。
- TTFT、total latency 與 error rate 不顯著劣於舊 Gateway。
- 高峰流量不造成 vLLM OOM 或無界 queue。

可觀測性：

- 能區分 Campus backend、LiteLLM 與 vLLM 三層錯誤。
- 能查詢每模型 request、token、latency、error、in-flight 與 deployment state。
- 有 readiness、deployment outage、error rate 與 latency 告警。

## 12. 實作前仍需確認的決策

以下項目不阻礙撰寫計劃，但在開始實作前需定案：

1. `litellm/litellm:latest` 當次 pull 的 image 對現有 PostgreSQL server 版本之 migration/restart 相容性；Phase 4 實測不通過時停止切換，不改動 Campus database。
2. TPM 與 vLLM `max_num_seqs` 的初始值；RPM 已確定先採每模型 10。
3. 原 `/api/chat*` 是否有 repository 外部使用者。

已定案的預設：`docker pull litellm/litellm:latest` 並記錄實際 image ID/digest、每模型初始 RPM 10、`vllm-service/litellm` 獨立 Compose project、LiteLLM 與 vLLM 同機、host networking、`models.json` 產生 LiteLLM config、只開放四個一般文字 API、先完成無 DB 的完整 LiteLLM 整合測試、下一階段才在既有 PostgreSQL server 建立獨立 LiteLLM database/role、沿用 Campus 現有監控邏輯、legacy alias 至少保留 30 天、受限 Admin UI、無跨模型 fallback、System AI 完全隔離。

## 13. 官方參考資料

- [LiteLLM vLLM provider](https://docs.litellm.ai/docs/providers/vllm)
- [LiteLLM Proxy load balancing](https://docs.litellm.ai/docs/proxy/load_balancing)
- [LiteLLM fallback / provider failover](https://docs.litellm.ai/docs/proxy/reliability)
- [LiteLLM health checks](https://docs.litellm.ai/docs/proxy/health)
- [LiteLLM Prometheus metrics](https://docs.litellm.ai/docs/proxy/prometheus)
- [LiteLLM production best practices](https://docs.litellm.ai/docs/proxy/prod)
- [LiteLLM Virtual Keys](https://docs.litellm.ai/docs/proxy/virtual_keys)
- [LiteLLM release cycle and versioned stable images](https://github.com/BerriAI/litellm)
