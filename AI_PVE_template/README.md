# AI_PVE_template

這是 Campus-Cloud 的隔離測試 harness。它只呼叫 backend 的
`/api/v1/ai/pve-template/*` API，不保存資料庫、SSH key、AI key、token 或 raw
輸出；token 只存在目前瀏覽器頁面的記憶體中。

## 啟動

1. 先啟動 Campus backend，並確認資料庫已套用 `aipve01_ai_pve_templates`。
2. 在此資料夾啟動本機 HTTP server（ES module 需要 HTTP origin）：

   ```powershell
   python -m http.server 8088
   ```

3. 填入 backend API base（預設 `http://localhost:8000/api/v1`）與目前 access token。
4. 載入模板，VMID 預設固定為測試機 `102`；後端仍會重新驗證使用者與 VMID scope。

流程是「選模板 → 輸入任務 → 觀察 tool call → 若為未知／自訂 SSH 指令則確認 →
顯示 exit code/stdout/stderr → 由 AI 產生下一步」。頁面不使用 `localStorage` 或
`sessionStorage`。

## 前端驗證要件

- AI 請求期間顯示 `AI 正在分析…` loading spinner，並鎖定重複送出。
- 後端回傳 `needs_confirmation` 或 pending tool 時，顯示 AI 確認訊息、VMID、原因與完整 command。
- 只有確認 token 存在時才可按「允許執行／拒絕」；token 不會顯示在 tool transcript。
- AI 需要 guest 內部資料時應直接呼叫 `ssh_exec`，不先用文字詢問是否同意；後端是唯一確認攔截點。
- 若模型仍輸出明確的「請確認」與反引號指令，單一 VM template 請求會在同一回應轉成 pending tool，避免雙重確認。
- 已知唯讀 smoke command 可由 agent 連續檢查並總結；需要確認時暫停，允許或拒絕後都會從原 messages 接續。
- 同意後的 `exit_code/stdout/stderr`、拒絕或安全攔截狀態，以及 AI 接續回覆都保留在結果區。
- 前端純邏輯回歸測試（不需要真實 backend）：

  ```powershell
  npm --prefix ..\frontend test -- --run src/services/aiPveTemplateUi.test.js
  npm --prefix ..\frontend run build
  ```
