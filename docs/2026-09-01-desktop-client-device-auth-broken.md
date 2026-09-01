# 桌面客戶端裝置授權流程斷鏈

**建立日期**：2026-09-01
**狀態**：未修復（已確認問題，尚未決定修復或退役）
**影響**：桌面客戶端 100% 無法登入
**發現方式**：後端路由使用情況稽核（比對 362 個端點與所有 client 程式碼）

---

## 摘要

桌面客戶端（`desktop-client/`，Electron）採用 **device authorization flow** 登入，
流程共四步，其中**第三步在前端從未實作**，導致桌面端永遠等不到核准。

即使補上第三步，流程仍會因為第二個問題（device code 存在 process 記憶體，
但後端跑 4 個 worker）而只有約 1/16 的成功率。

---

## 這個流程是什麼

桌面端不處理帳密、LDAP 或 MFA，而是把登入推到瀏覽器完成，自己只等結果——
與 Apple TV、各種 CLI 工具同一套模式。核心價值是**桌面端全程拿不到使用者密碼**，
只在最後拿到一張 token。

設計上的四步：

```
桌面端                          瀏覽器                        後端
  │                                                            │
  ├─ POST /desktop-client/auth/device-code ──────────────────> │  產生亂數 code
  │<─ {device_code, login_url} ─────────────────────────────── │  存進記憶體 dict
  │                                                            │
  ├─ shell.openExternal(login_url)  ──> 開瀏覽器                │
  │        └─ https://前端/login?device_code=xxxx               │
  │                                │                           │
  │                                ├─ 使用者輸入帳密登入 ─────> │
  │                                │                           │
  │                                └─ ✗ 應該接著自動打          │
  │                                   POST /auth/approve       │
  │                                   {device_code: "xxxx"}    │
  │                                        ↓                   │
  │                                   後端將該 code 的          │
  │                                   entry["token"] 填上       │
  │                                   一張 8 小時 token         │
  │                                                            │
  ├─ GET /auth/poll?code=xxxx （每 2 秒） ───────────────────> │
  │<─ {"status":"approved", "access_token":"..."} ──────────── │
```

後端三支端點都已完整實作，位於 `backend/app/api/routes/desktop_client.py`，
檔頭註解也把四步寫得很清楚：

```
1. Client calls POST /auth/device-code  -> gets a device_code
2. Client opens browser to {frontend}/login?device_code={code}
3. User logs in on the web, frontend auto-calls POST /auth/approve
4. Client polls GET /auth/poll?code={code} -> gets access_token
```

---

## 問題一：第三步沒有實作

`frontend/src/pages/login/LoginPage.jsx:41` 確實有讀 query string：

```javascript
const params = new URLSearchParams(window.location.search);
```

但只取 `token`。全前端搜尋 `device_code` / `deviceCode` **零結果**。

### 實際行為

1. 使用者照著 `login_url` 開啟瀏覽器，登入成功，畫面一切正常
2. 沒有任何程式碼呼叫 `POST /auth/approve`
3. `entry["token"]` 永遠是 `None`
4. 桌面端每 2 秒 poll 一次，一直收到 `{"status": "pending"}`
5. 撐到 `_DEVICE_CODE_TTL = 300` 秒後 code 被清除，poll 收到 404
6. 桌面端拋出 `LOGIN_TIMEOUT`

使用者視角：網頁登入明明成功了，桌面端卻一直轉圈然後逾時，且沒有任何錯誤訊息
指出真正原因。

---

## 問題二：device code 存在 process 記憶體，但後端有 4 個 worker

這個問題較隱蔽，**即使修好問題一也不會消失**。

`backend/app/api/routes/desktop_client.py`：

```python
_device_codes: dict[str, dict] = {}   # 純 Python 記憶體，per-process
```

`backend/Dockerfile:46`：

```dockerfile
CMD ["fastapi", "run", "--workers", "4", "app/main.py"]
```

4 個 worker process 各自持有一份獨立的 dict，三個 HTTP 請求會被隨機分配：

| 請求 | 落在哪個 worker | 結果 |
|---|---|---|
| `POST /auth/device-code` | A | code 存進 A 的 dict |
| `POST /auth/approve` | 隨機 | 3/4 機率落在 B/C/D → 查不到 → **404 Device code not found** |
| `GET /auth/poll` | 隨機 | 即使 approve 命中 A，poll 還要再命中一次 A |

整體成功率約 **1/16**。另外此設計也代表後端重啟即遺失所有進行中的登入。

---

## 問題三：沒有下載入口

`GET /desktop-client/download` 已實作（支援 `DESKTOP_CLIENT_DOWNLOAD_URL` 轉址、
或從 `static/downloads/`、`desktop-client/release/` 提供檔案），但**前端沒有任何
連結指向它**。

即使登入修好，使用者也沒有地方取得這個桌面端。這是這個功能可能從未真正上線的
側面證據。

---

## 桌面客戶端實際提供什麼功能

判斷「修復或退役」需要先釐清它的定位。它呼叫的後端 API 只有六支：

| 端點 | 用途 |
|---|---|
| `POST /desktop-client/auth/device-code` | 登入 |
| `GET /desktop-client/auth/poll` | 登入 |
| `GET /resources/my` | 列出我的機器 |
| `GET /resources/{vmid}/session-status` | 查練習時段剩餘時間 |
| `POST /resources/{vmid}/extend-session` | 延長時段 |
| `GET /tunnel/my-config` | 取得 frpc visitor 設定 |

核心是最後一支。`backend/app/api/routes/tunnel.py` 的註解說明其角色：

> The desktop client calls this after login to know which STCP visitors to create
> (one per VM per service).

拿到設定後，`desktop-client/electron/service/FrpcProcessService.ts` 以 `spawn()`
在使用者電腦上執行 **frpc** 子行程，建立 STCP 隧道。

**結論：它不是遠端桌面軟體，而是「自動幫學生配置好 frpc 隧道」的啟動器。**
省去學生自行安裝 frpc、撰寫 `frpc.toml`、記憶 visitor port 的麻煩。連上之後
實際的遠端操作（SSH / RDP / VNC）仍由其他工具負責。

---

## 兩個處理方向

專案目前已有外部軟體支援遠端連線，因此需先確認該軟體是否自帶網路穿透：

- **若學生機器本來就連得到**（校內網路直通，或外部軟體自帶穿透如
  Tailscale / ZeroTier / TeamViewer）→ 這個桌面端是多餘的，應整包退役
- **若外部軟體只負責畫面、穿透仍靠 frp** → 這個桌面端在解一個真實問題，應修復

### 方向 A：修復

| 工作 | 位置 | 規模 |
|---|---|---|
| 登入頁處理 `device_code`，登入成功後呼叫 `/auth/approve` | `frontend/src/pages/login/LoginPage.jsx` | 約 15 行 |
| device code store 由記憶體改為 Redis（專案已有 Redis，rate limit 正在用） | `backend/app/api/routes/desktop_client.py` | 約 30 行 |
| 前端加上桌面端下載入口 | 前端（位置待定） | 小 |
| 補上流程測試 | `backend/tests/`、`frontend/src/` | 中 |

### 方向 B：退役

需移除的範圍：

- `desktop-client/`（整個目錄）
- `backend/app/api/routes/desktop_client.py`（4 個端點）
- `backend/app/api/routes/tunnel.py`（1 個端點）
- `tunnel_proxies` 資料表與 `TunnelProxy` model
- `backend/app/services/network/tunnel_proxy_service.py`
- Gateway 的 frpc 同步邏輯

注意 `tunnel_proxies` 目前有 2 筆資料，退役前需確認不影響現有使用者。

---

## 相關檔案

| 檔案 | 說明 |
|---|---|
| `backend/app/api/routes/desktop_client.py` | 三支 auth 端點 + download，後端側完整 |
| `backend/app/api/routes/tunnel.py` | frpc visitor 設定 |
| `frontend/src/pages/login/LoginPage.jsx` | 缺少第三步的地方 |
| `desktop-client/electron/service/AuthService.ts` | 桌面端登入與輪詢 |
| `desktop-client/electron/service/SkyLabService.ts` | 桌面端 HTTP client |
| `desktop-client/electron/service/FrpcProcessService.ts` | frpc 子行程管理 |
| `backend/Dockerfile` | `--workers 4`，問題二的成因 |

---

## 待決事項

1. 現有外部遠端連線軟體是哪一套？是否自帶網路穿透？
2. 依上述答案選擇方向 A 或 B。
3. 若選 B，需確認 `tunnel_proxies` 現有 2 筆資料的歸屬與影響。
