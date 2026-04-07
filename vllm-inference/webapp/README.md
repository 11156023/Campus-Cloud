# vLLM Inference — Web UI

`vllm-inference/` 的 Web 前端：FastAPI（後端代理）+ React 18（Vite + Tailwind），提供多模態對話介面，支援文字 / 圖片 / 影片 / 文件以及 SSE 串流輸出。

## 功能

- 對話介面（單次 / 不保留歷史，可另外擴充）
- SSE 串流輸出，逐 token 即時顯示
- 圖片辨識（vision model）
- 影片分析（含分段抽幀）
- 文件分析（PDF / DOCX / TXT）
- markdown / 程式碼高亮渲染
- 上傳檔案大小 / 類型驗證
- 自動偵測模型能力（vision / video）

## 架構

```
webapp/
├── backend/                    # FastAPI proxy + 串流
│   └── main.py
└── frontend/                   # React 18 + Vite
    ├── src/
    │   ├── App.jsx
    │   ├── components/
    │   │   ├── ChatBox.jsx
    │   │   ├── MessageBubble.jsx
    │   │   ├── ImageUpload.jsx
    │   │   └── VideoUpload.jsx
    │   └── index.css
    └── package.json
```

## 後端 API

| 端點 | 方法 | 說明 |
| --- | --- | --- |
| `/api/model-info` | GET | 模型名稱與能力（vision / image / …） |
| `/api/config` | GET | 推論預設值（max_tokens、temperature、video 設定） |
| `/api/chat` | POST | 文字對話（非串流） |
| `/api/chat/stream` | POST | 文字對話（SSE 串流） |
| `/api/chat/vision` | POST | 圖片對話（非串流） |
| `/api/chat/vision/stream` | POST | 圖片對話（SSE 串流） |
| `/api/chat/document` | POST | 文件分析 |
| `/api/chat/video` | POST | 影片分析（自動分段抽幀） |

後端會：

- 驗證上傳檔案大小（< 50 MB）與型別
- 將請求轉換為 OpenAI 相容格式並轉發到上游 vLLM
- 將上游回應以 SSE `data: {json}\n\n` 格式回傳給前端
- 請求結束後清理暫存檔

## 前端

- React 18 + Vite + Tailwind CSS
- markdown 渲染：`react-markdown` + `highlight.js`
- 圖示：`lucide-react`
- 響應式設計、可選深色 / 淺色主題

## 啟動

### 前置條件

1. **vLLM 伺服器已啟動**（於 `vllm-inference/` 根目錄執行）：

   ```bash
   python main.py
   ```

2. **Node.js 18+**：

   ```bash
   node --version
   ```

### 一鍵啟動

```bash
chmod +x ../start_webapp.sh
../start_webapp.sh
```

腳本會：

1. 檢查 vLLM 服務狀態
2. 安裝 Python 依賴（FastAPI、uvicorn）
3. 安裝 Node.js 依賴
4. 啟動前端 dev server（http://localhost:5173）
5. 啟動後端 API（http://localhost:3000）

### 手動啟動（開發模式）

**Terminal 1 — 後端**

```bash
cd webapp/backend
pip install fastapi "uvicorn[standard]" python-multipart
python main.py
```

**Terminal 2 — 前端**

```bash
cd webapp/frontend
npm install
npm run dev
```

開啟 http://localhost:5173

### 生產模式

```bash
cd webapp/frontend
npm install
npm run build               # 產出 dist/

cd ../backend
python main.py              # 自動提供前端靜態檔
```

開啟 http://localhost:3000

## 設定

### 後端 (`webapp/backend/main.py`)

```python
host = "0.0.0.0"
port = 3000
max_tokens = 512
temperature = 0.7
```

上游 vLLM 連線參數從根目錄 `vllm-inference/.env` 取得（`API_HOST`、`API_PORT`、`API_KEY`）。

### 前端 (`webapp/frontend/vite.config.js`)

```javascript
server: {
  port: 5173,
  proxy: {
    '/api': {
      target: 'http://localhost:3000',
      changeOrigin: true,
    }
  }
}
```

## 使用說明

### 文字對話

1. 輸入訊息 → Enter 或點擊送出
2. 即時看到串流回應
3. 點擊「開始新對話」清除目前會話

### 圖片辨識（需 vision 模型，例如 Qwen-VL）

1. 上傳圖片（JPG / PNG / GIF / WebP，<50 MB）
2. 預覽後輸入問題
3. 即時看到 AI 串流回應

### 影片 / 文件

- 影片：MP4 / WebM / MKV，自動依 `VIDEO_FPS` 抽幀並分段送入模型
- 文件：PDF / DOCX / TXT，後端解析為文字後送入模型

## 故障排除

### vLLM 服務未啟動

```
❌ vLLM 服務未運行
```

```bash
# 在 vllm-inference 根目錄
python main.py

# 檢查 health
curl http://localhost:8000/health
```

### 圖片上傳失敗

```
當前模型不支援視覺輸入
```

- 確認 `.env` 的 `MODEL_NAME` 為 vision 模型
- 檢查 `utils/model_utils.py` 的 `VISION_KEYWORDS`

### 串流中斷

- 確認網路與 vLLM 服務未過載
- 調整 `config/settings.py` 的 timeout

## 目前未實作

- 多輪對話記憶
- 語音輸入 / 輸出
- 對話匯出
- 多模型切換（請改用 [`vllm-API`](../../vllm-API/webapp/README.md)）
