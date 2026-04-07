# vLLM API — Multi-Model Gateway Web UI

`vllm-API/` 的 Web 前端與 Gateway：FastAPI 統一閘道（將請求轉發到多個 vLLM 模型實例）+ React 18（Vite + Tailwind）。與 [`vllm-inference/webapp`](../../vllm-inference/webapp/README.md) 的差異是：本服務面對的是**多模型叢集**，前端可在送出請求前選擇要使用哪一個模型 alias。

## 功能

- 多模型路由：依 `model` 參數轉發到對應上游 vLLM 實例
- SSE 串流輸出
- 圖片 / 影片 / 文件多模態
- inflight semaphore 保護（避免 Gateway 被打爆）
- 模型列表 60 秒快取
- 上傳檔案大小 / 類型驗證
- 上游連線池與非同步轉發

## 架構

```
vllm-API/
├── main.py                       # 叢集 orchestrator：啟動所有模型 + Gateway
├── models.json                   # 多模型實例設定
├── models.json.example
├── config/
│   ├── settings.py               # 共用設定
│   └── multi_model.py            # 載入 models.json + Gateway 設定
├── core/
│   ├── engine.py                 # 單一 vLLM 實例啟停
│   └── cluster.py                # MultiModelEngineManager
├── api/                          # 上游 client
├── benchmark/, utils/            # 與 vllm-inference 相同
├── webapp/
│   ├── backend/main.py           # FastAPI Gateway（路由到對應模型）
│   └── frontend/                 # React 18 + Vite
└── start_webapp.sh
```

## Gateway API

Gateway 預設位於 port 3000，會接收前端請求並依 `model` 參數轉發到對應上游模型 endpoint。

| 端點 | 方法 | 說明 |
| --- | --- | --- |
| `/api/models` | GET | 列出所有可用模型與 alias（60 秒 cache） |
| `/api/chat` | POST | 文字對話；以 `model` 指定 alias，未指定則使用 `GATEWAY_DEFAULT_MODEL` |
| `/api/chat/stream` | POST | 串流對話 |
| `/api/chat/vision` | POST | 圖片對話 |
| `/api/chat/vision/stream` | POST | 圖片對話（串流） |
| `/api/chat/video` | POST | 影片分析 |
| `/api/chat/document` | POST | 文件分析 |

> 上游 vLLM 實例本身仍對外提供原生 OpenAI 相容 `/v1/...` API，但**通常只在 Gateway 內部呼叫**。

## models.json 範例

```json
[
  {
    "alias": "qwen-9b",
    "model_name": "./AImodels/Qwen3.5-9B",
    "api_port": 8101,
    "max_model_len": 32768,
    "gpu_memory_utilization": 0.15,
    "max_num_seqs": 48,
    "max_num_batched_tokens": 65536
  },
  {
    "alias": "qwen-235b",
    "model_name": "nvidia/Qwen3-235B-A22B-NVFP4",
    "api_port": 8102,
    "max_model_len": 4096,
    "gpu_memory_utilization": 0.95,
    "max_num_seqs": 64
  }
]
```

每個項目都會獨立啟動一個 vLLM 實例（在自己的 `api_port` 上），並覆寫 `.env` 中的對應預設值。

## 共用 .env

```env
# Gateway
GATEWAY_HOST=0.0.0.0
GATEWAY_PORT=3000
GATEWAY_REQUEST_TIMEOUT=120
GATEWAY_MAX_INFLIGHT=48
GATEWAY_DEFAULT_MODEL=qwen-9b

# 共用引擎預設值（會被 models.json 覆寫）
HF_CACHE_DIR=/raid/hf-cache/hub
TRUST_REMOTE_CODE=true
DTYPE=auto
ENABLE_PREFIX_CACHING=true
GPU_MEMORY_UTILIZATION=0.9
```

## 啟動

### 完整叢集

```bash
source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env             # 編輯 GATEWAY_*、HF_CACHE_DIR、…
cp models.json.example models.json
# 編輯 models.json：加入你的模型路徑、port、GPU 配額

python main.py
```

`main.py` 會：

1. 執行 pre-flight system check
2. 載入 `models.json` 與共用 `.env`
3. 透過 `MultiModelEngineManager` 依序啟動每個 vLLM 實例（5 秒間隔，任一失敗即中止）
4. 啟動 Gateway（`uvicorn webapp.backend.main:app`）
5. 等待所有引擎與 Gateway `/health` OK 後才宣告就緒

### 透過 Gateway 呼叫

```bash
curl http://localhost:3000/api/chat \
  -H "Authorization: Bearer Rushia_Secret_Key_Change_Me" \
  -H "Content-Type: application/json" \
  -d '{"message": "你好", "model": "qwen-9b"}'
```

### 前端開發模式

```bash
cd webapp/frontend
npm install
npm run dev          # http://localhost:5173
```

前端 dev server 會將 `/api` proxy 到 `http://localhost:3000`。

### 前端 production

```bash
cd webapp/frontend
npm install
npm run build

# Gateway 會直接提供 dist/ 靜態檔
# 開啟 http://localhost:3000
```

## 設計重點

- **Sequential startup**：`MultiModelEngineManager._start_sequential()` 一次起一個引擎，避免 GPU 同時搶資源
- **Gateway semaphore**：`GATEWAY_MAX_INFLIGHT` 限制同時轉發的請求數
- **模型快取**：`/api/models` 會快取上游 `/v1/models` 60 秒
- **檔案上傳**：使用 `aiofiles` 異步處理，<50 MB 限制，圖片 / 影片 / 文件型別檢查
- **串流轉發**：Gateway 直接把上游 SSE chunk 透傳到前端

## 與 `vllm-inference` 的差別

| | `vllm-inference` | `vllm-API` |
| --- | --- | --- |
| 範疇 | 單一模型 | 多模型 |
| 設定 | `.env` | `.env` + `models.json` |
| 啟動 | 單一 vLLM engine | 多個 engine + Gateway |
| 路由 | 直接到 vLLM | Gateway 依 `model` 轉發 |
| Port | API port = 8000 | 多個 model port + Gateway = 3000 |
| 適用 | 單模型實驗 / MVP | 校園叢集 / 成本最佳化 |

## 故障排除

- Gateway 無法啟動：確認 `models.json` 中所有 `api_port` 都已被對應的 vLLM 引擎成功啟動
- `/api/models` 為空：上游引擎尚未 ready，等待 health check 通過
- 上傳檔案被拒：檢查大小（< 50 MB）與型別
- 串流中斷：調整 `GATEWAY_REQUEST_TIMEOUT`
