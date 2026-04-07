# AI Teacher Judge — Rubric 助理

獨立的 FastAPI 服務，讓教師上傳評分量表（rubric）文件，由 vLLM 解析、分析每個評分項目的「可偵測度」（auto / partial / manual），並以對話方式精煉內容、最後輸出 Excel 檔。

## 功能總覽

- 接受 `.docx` / `.pdf` rubric 上傳並解析（含表格 → Markdown）
- 由 vLLM 將每個評分項目分類為 auto / partial / manual，產生偵測方式與後備建議
- 對話式精煉：使用者可與 AI 來回討論、調整 rubric
- 將精煉後的 rubric 匯出為 `.xlsx`
- 內建 slowapi 流量限制，避免單一 IP 濫用
- 內附 `static/index.html` 作為操作介面

## 目錄結構

```
ai-teacher-judge/
├── main.py                                # uvicorn 入口
├── app/
│   ├── main.py                            # FastAPI app + lifespan + CORS + slowapi
│   ├── core/config.py                     # Pydantic Settings
│   ├── api/routes/                        # upload-rubric / chat / download-excel / health
│   ├── services/
│   │   ├── rubric_parser.py               # python-docx + pdfplumber 解析
│   │   └── rubric_service.py              # 呼叫 vLLM 分析 / 精煉 / 匯出
│   └── schemas/rubric.py
├── static/index.html                      # 前端 UI
├── requirements.txt
└── test_vllm_output.txt
```

## API

預設前綴 `/api/v1`，亦保留無前綴版本。

| Method | Path | 流量限制 | 說明 |
| --- | --- | --- | --- |
| POST | `/api/v1/upload-rubric` | 10 / min | 上傳 `.docx` / `.pdf`，解析後回傳 `RubricAnalysis` |
| POST | `/api/v1/chat` | 30 / min | 對話精煉；可附帶 `rubric_context` 與 `is_refine` flag |
| POST | `/api/v1/download-excel` | 20 / min | 將精煉後 rubric 匯出 `.xlsx` |
| GET | `/health` | — | 健康檢查 |
| GET | `/` | — | 前端 UI |

### Schema 重點（`app/schemas/rubric.py`）

- **`RubricItem`**：`id` / `title` / `description` / `max_score` / `detectability`（auto / partial / manual）/ `detection_method` / `fallback`
- **`RubricAnalysis`**：`items` 列表 + 總分 + 三類計數 + AI summary + 原始文字
- **`ChatMessage`**：`role`（`user` / `assistant`）+ `content`
- **`RubricChatRequest`**：`messages` + `rubric_context`（JSON 字串）+ `is_refine`

## 主要環境變數

完整見 `app/core/config.py`：

```env
HOST=127.0.0.1
PORT=8010

# Upload / CORS
MAX_UPLOAD_SIZE_MB=10
CORS_ORIGINS=http://localhost:5173,http://localhost:3000

# vLLM
VLLM_BASE_URL=http://localhost:8000/v1
VLLM_API_KEY=
VLLM_MODEL_NAME=
VLLM_ENABLE_THINKING=false
VLLM_TIMEOUT=60

VLLM_TEMPERATURE=0.2
VLLM_CHAT_TEMPERATURE=0.7
VLLM_TOP_P=0.95
VLLM_TOP_K=20
VLLM_MIN_P=0.0
VLLM_MAX_TOKENS=8192
VLLM_CHAT_MAX_TOKENS=4096
VLLM_REPETITION_PENALTY=1.0
```

## 啟動

```bash
cd ai-teacher-judge
cp .env.example .env             # 若不存在請手動建立
pip install -r requirements.txt
python main.py
```

預設位址：

- 服務：http://127.0.0.1:8010
- Swagger：http://127.0.0.1:8010/docs
- 前端 UI：http://127.0.0.1:8010/

## 主要依賴

```
fastapi
uvicorn
httpx
pydantic
pydantic-settings
pdfplumber          # PDF 解析
python-docx         # DOCX 解析
openpyxl            # XLSX 匯出
python-multipart    # 檔案上傳
slowapi             # 流量限制
```

## 整合說明

- **vLLM**：所有分析與對話皆透過 OpenAI 相容 `/v1/chat/completions` 介面送至 `VLLM_BASE_URL`。請先啟動 `vllm-inference/` 或其他相容服務。
- **檔案大小**：超過 `MAX_UPLOAD_SIZE_MB` 會回傳 413。
- **CORS**：預設允許 `http://localhost:5173` 與 `http://localhost:3000`，可依需求調整。

## 工作流程

1. 教師於 `/` 上傳 rubric 文件
2. `rubric_parser` 將 DOCX / PDF 轉成純文字（表格轉 Markdown）
3. `rubric_service` 將內文送往 vLLM，請其輸出 JSON 格式的 `RubricAnalysis`
4. 前端顯示分析結果，使用者可在對話框與 AI 討論調整
5. 對話含 `is_refine=true` 時觸發整份 rubric 重寫
6. 點擊下載即輸出 `.xlsx`

## 注意事項

- 預設綁定 `127.0.0.1`，若要對外提供請改 `HOST=0.0.0.0` 並評估 CORS / 認證
- 此服務本身不做使用者認證，建議部署在內部網路或反向代理後方
