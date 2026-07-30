# AI_PVE_template

這是 Campus-Cloud 的隔離測試 harness。它只呼叫 backend 的
`/api/v1/ai/pve-template/*` API，不保存資料庫、SSH key、AI key、token 或 raw
輸出；token 只存在目前瀏覽器頁面的記憶體中。

## 啟動

1. 先啟動 Campus backend，並確認資料庫已套用 `aipve01_ai_pve_templates`。
2. 用瀏覽器開啟 `index.html`，或在此資料夾執行：

   ```powershell
   python -m http.server 8088
   ```

3. 填入 backend API base（預設 `http://localhost:8000/api/v1`）與目前 access token。
4. 載入模板，VMID 預設固定為測試機 `102`；後端仍會重新驗證使用者與 VMID scope。

流程是「選模板 → 輸入任務 → 觀察 tool call → 若為未知／自訂 SSH 指令則確認 →
顯示 exit code/stdout/stderr → 由 AI 產生下一步」。頁面不使用 `localStorage` 或
`sessionStorage`。
