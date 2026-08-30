# AI_PVE_template

這是 Campus-Cloud 的隔離測試 harness。它只呼叫 backend 的
`/api/v1/ai/pve-template/*` API，不保存資料庫、SSH key、AI key、token 或 raw
輸出；token 只存在目前瀏覽器頁面的記憶體中。

目前測試頁最多同時測試三台機器。填入 VMID 的槽位才會啟用；空白槽位會被忽略，因此
可以只測單台或雙台。每個已填入的 VMID 都要選擇一個 AI 機器模板；模板會直接
帶入 AI 的角色與診斷方向。這裡的模板不是 Proxmox 建機映像，也不代表已驗證 CPU、RAM、
Disk、OS 或服務狀態。

## 啟動

1. 先啟動 Campus backend，並確認資料庫已套用 `aipve01_ai_pve_templates`。
2. 在此資料夾啟動支援熱重載的本機 HTTP server（ES module 需要 HTTP origin）：

   ```powershell
   # 若 18088 已被舊 server 使用，先在舊 server 視窗按 Ctrl+C
   python dev_server.py --port 18088
   ```

   修改 `index.html`、`app.js`、`ui.js` 或其他測試頁檔案後，瀏覽器會自動重新載入。
   若只需要純靜態服務，仍可使用 `python -m http.server 18088`，但不會自動刷新頁面。

3. 填入 backend API base（預設 `http://localhost:18200/api/v1`）與目前 access token。
4. 載入模板，填入一至三個測試 VMID，並為每台已填入的機器選擇模板；後端仍會重新驗證使用者與完整 VMID scope。

流程是「填一至三個 VMID／選對應模板 → 輸入任務 → 觀察 tool call → 若為未知／自訂 SSH 指令則確認 →
顯示 exit code/stdout/stderr → 由 AI 產生下一步」。頁面不使用 `localStorage` 或
`sessionStorage`。

初始請求只把已填入機器所選的模板帶入 prompt，不會額外抓取 PVE 或 SSH 規格。使用者明確要求
guest 內資料時，AI 才能對本次一至三個 VMID 使用受控 `ssh_exec`；每台會依自己的模板套用
唯讀 command policy。

## 從網頁 F12 取得 Access token

建議從已登入的 Campus-Cloud 網頁請求取得，不要把帳號密碼或 token 貼到聊天、Issue、截圖或 log。

1. 開啟 Campus-Cloud 網頁並登入，按 `F12`（或 `Ctrl+Shift+I`）開啟開發者工具。
2. 切換到 **Network**，勾選 **Fetch/XHR**；若清單是空的，重新整理頁面或執行一次需要登入的操作。
3. 找一筆已登入的 API 請求，例如 `/api/v1/users/me` 或 `/api/v1/resources`，點開後查看 **Headers → Request Headers**。
4. 找到 `Authorization`，其格式會類似：

   ```text
   Authorization: Bearer <access-token>
   ```

5. 只複製 `Bearer ` 後面的完整字串（不要包含 `Bearer `），貼到本 harness 的 **Access token** 欄位。

若看不到 `Authorization`，請確認挑選的是登入後的請求，而不是 `/login/*` 登入請求；也可以回到網頁重新登入後再擷取。收到 `401` 時通常代表 token 已過期，請重新登入並取得新的 token。

> 備用方式：在 **Application → Local Storage** 選取 Campus-Cloud 網頁 origin，尋找以 `auth_session_tokens:` 開頭的項目；其 JSON 的 `accessToken` 值就是 Access token。請勿複製或分享同一筆資料中的 `refreshToken`。

## 前端驗證要件

- AI 請求期間顯示 `AI 正在分析…` loading spinner，並鎖定重複送出。
- 後端回傳 `needs_confirmation` 或 pending tool 時，顯示 AI 確認訊息、目標 VMID、原因與完整 command。
- 只有確認 token 存在時才可按「允許執行／拒絕」；token 不會顯示在 tool transcript。
- AI 需要 guest 內部資料時應直接呼叫 `ssh_exec`，不先用文字詢問是否同意；後端是唯一確認攔截點。
- 若模型仍輸出明確的「請確認」與反引號指令，單一 VM template 請求會在同一回應轉成 pending tool，避免雙重確認。
- 已知唯讀 smoke command 可由 agent 對三個目標檢查並總結；需要確認時一次暫停一筆，允許或拒絕後都會從原 messages 接續。
- 同意後的 `exit_code/stdout/stderr`、拒絕或安全攔截狀態，以及 AI 接續回覆都保留在結果區。
- 前端純邏輯回歸測試（不需要真實 backend）：

  ```powershell
  npm --prefix ..\frontend test -- --run src/services/aiPveTemplateUi.test.js
  npm --prefix ..\frontend run build
  ```
