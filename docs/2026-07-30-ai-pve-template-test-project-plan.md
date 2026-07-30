# AI_PVE_template 測試子專案分析與實作計畫

## 1. 目標與本次邊界

建立一個名為 `AI_PVE_template` 的隔離測試子專案，用來驗證：

1. 使用者選定機器模板後，AI 能取得正確的機器角色提示。
2. AI 能沿用現有 AI PVE Log tools 查詢 PVE 資訊。
3. AI 能透過現有 SSH 執行能力，以目標機器允許的最高 Linux 帳號權限執行指令。
4. 執行結果能回到 AI，讓 AI 判斷成功、失敗與下一步。
5. 新增模板只需新增一筆模板資料，不需要修改 SSH transport 或 PVE collector。

本階段只做測試入口與模板能力，不連結正式 VM template、Resource、群組、課程、
Teacher Judge 或部署流程。`Postsql` 先按 `PostgreSQL` 模板理解。

## 2. 現況分析

### 2.1 可直接重用的現有能力

- `backend/app/ai/pve_log/chat.py`
  - 已有 OpenAI-compatible tool calling loop。
  - 已有 PVE tools：資源、節點、儲存、VM/LXC 詳情與 cluster。
  - 已有 `ssh_exec` tool，並能把 stdout、stderr、exit code 回填給 AI。
- `backend/app/ai/pve_log/ssh_exec.py`
  - 主後端路徑會由 DB 解析 VM IP 與加密 SSH private key。
  - 使用共用 SSH client，含 host-key trust-on-first-use 與 key-change rejection。
  - SSH 是阻塞操作，但已用 `asyncio.to_thread` 隔離。
- `backend/app/ai/pve_log/ssh_guard.py`
  - 現有 hard deny 規則會阻擋格式化磁碟、`rm -rf`、關機、清空防火牆等指令。
- `backend/app/api/routes/ai_pve_log.py`
  - 現有正式聊天入口以 Instructor 身分驗證，並以群組 VMID 做 scope。

### 2.2 不應直接重用為新模板表的現有資料

`teacher_judge_template_commands` 是 Teacher Judge 的受控 command catalog，欄位與
生命週期都是為 rubric/check step 設計。雖然目前已有 `linux`、`python`、`n8n`
command rows，但它不是「機器 AI 身分模板」。 這是之前概念但先不管

先前曾規劃的 `execution_profiles` 與 `execution_profile_commands` 已經退役，不能為
本功能復活。新功能應建立一張用途單純的新表。

### 2.3 目前必須修正的契約不一致

`chat.py` 的頂端註解仍寫 AI tool 會直接執行，但目前 `_execute_ssh_tool()` 實際建立
`require_confirm=True` 的請求。因此現行 runtime 是「AI 提出指令、等待確認、確認後
執行」，不是無條件直接執行。
我是想說，用預設tools 時可以直接執行 使用到自創指令或是涉及N8N指令未知時 等待確認、確認後
執行

實作本子專案時應同步修正文案與測試，避免測試結果被錯誤解讀。

## 3. 建議架構

```text
AI_PVE_template 測試 UI / CLI
  -> backend /api/v1/ai/pve-template/*
  -> 讀取 ai_pve_templates
  -> 組合 base safety prompt + template system_prompt
  -> 共用 AI PVE Log tool definitions / execution loop
  -> 共用 ssh_exec
  -> DB Resource 解析 IP 與 SSH key
  -> 目標 VM/LXC
```

### 3.1 子專案定位

建議新增根目錄 `AI_PVE_template/`，它只作為測試 harness：

- 簡單頁面或 CLI：選模板、輸入 VMID、輸入自然語言任務、顯示 tool calls 與結果。 固定VMID102 單純看AI產出指令 和call
- 不自行連 PostgreSQL。
- 不自行持有 SSH key、AI key 或管理員密碼。
- 不複製 Paramiko、Proxmox client 或 vLLM client。
- 所有敏感與授權操作仍由 Campus backend 處理。

這樣能保留「獨立子專案」的操作體驗，同時避免出現第二套安全與基礎設施實作。

### 3.2 Backend feature 邊界

新增 `backend/app/ai/pve_template/`：

- `schemas.py`：template/chat/confirm request-response。
- `service.py`：模板讀取、prompt 組合與 chat orchestration。
- `prompts.py`：不可由 DB 覆寫的共用安全與工具規則。
- `repository.py`：只查 `ai_pve_templates`。

新增 `backend/app/api/routes/ai_pve_template.py`，並註冊到 AI router。不要把測試邏輯
塞回 `pve_log/chat.py`；共用部分應抽成小型 helper，既有 PVE Log 行為保持不變。

## 4. 獨立模板表

表名建議：`ai_pve_templates`

| 欄位 | 型別 | 用途 |
| --- | --- | --- |
| `id` | UUID PK | 內部識別 |
| `template_key` | varchar(50), unique | 穩定選擇鍵，例如 `n8n` |
| `display_name` | varchar(100) | UI 顯示名稱 |
| `description` | text | 給管理者看的用途摘要 |
| `system_prompt` | text | 告知 AI 目標機器的角色、常見服務與診斷順序 |
| `enabled` | boolean | 是否可供測試入口選擇 |
| `created_at` | timestamptz | 建立時間 |
| `updated_at` | timestamptz | 更新時間 |

約束：

- 不建立任何 foreign key。
- 不保存 VMID、IP、SSH user、SSH key、密碼或 Proxmox node。
- 不保存可繞過安全規則的欄位，例如 `disable_guard`、`unrestricted`。
- `template_key` 是 API 的穩定識別；修改顯示名稱不影響呼叫端。
- migration 只建立表與三筆預設資料，不修改或搬移既有表資料。

## 5. 三個預設模板

### 5.1 N8N

```text
這是一台 N8N 自動化工作流程機器。預設先確認 n8n 程序、Docker container、
5678 連接埠、localhost HTTP 回應、服務日誌與磁碟空間。先診斷再修改；
修改設定前先讀取目前狀態，執行後以 exit code、stdout、stderr 驗證結果。
不要假設一定使用 Docker、systemd 或 npm，必須先探測實際安裝方式。
```

### 5.2 Python

```text
這是一台 Python 應用機器。預設先確認 Python 版本、虛擬環境、套件管理方式、
執行中的 Python/Uvicorn/Gunicorn 程序、監聽連接埠與應用日誌。不要直接修改
system Python；先辨識 venv、uv、Poetry 或容器邊界，再執行對應指令。
```

### 5.3 PostgreSQL

```text
這是一台 PostgreSQL 資料庫機器。預設先確認 PostgreSQL 版本、服務狀態、
監聽位址與連接埠、磁碟空間、連線數及近期錯誤。禁止把密碼、連線字串或查詢
結果中的敏感資料帶回對話。任何 schema/data 變更、重啟、restore、drop、
truncate 或大量 update 都必須先清楚說明影響並取得確認。
```

模板 prompt 只提供環境語意，不代表授權，也不能覆蓋共用 safety prompt。

## 6. API 與執行流程

建議最小 API：

- `GET /api/v1/ai/pve-template/templates`
  - 回傳 enabled templates，不回傳任何機器或 secret。
- `POST /api/v1/ai/pve-template/chat`
  - request：`template_key`、`vmid`、`message`、可選 `messages`。
  - 後端驗證使用者、模板存在且 enabled、VMID 在允許範圍。
  - 注入共用 prompt 與模板 prompt，再啟動 tool loop。
- `POST /api/v1/ai/pve-template/ssh/confirm`
  - 重用既有 pending token 與 requester/scope 驗證。

第一版不要提供模板 CRUD UI。預設模板由 migration seed，新增/修改可先走 DB
管理流程；確認整體實驗有效後，再決定是否加入管理 API。

### 執行狀態

```text
使用者任務
  -> AI 選擇 PVE tool 或 ssh_exec
  -> PVE read tool：直接回傳結果
  -> ssh_exec：guard 檢查
      -> hard deny：blocked
      -> 可執行：pending + confirm token
  -> 同一位使用者確認
  -> 以 root（或 Resource 現有最高授權帳號）SSH 執行
  -> stdout/stderr/exit code 回到 AI
  -> AI 說明結果，不以「有輸出」代替成功
```

## 7. 「最高權限」的精確定義

本計畫把「使用權限最高」定義為：

- Linux 端可使用 `root` SSH 帳號，讓測試涵蓋安裝套件、修改服務與管理應用。
- Campus 端仍只允許已驗證的管理/Instructor 使用者。
- VMID 必須在請求者被授權的測試 scope；不能因 root SSH 而跨 VM 存取。
- 現有 hard deny 規則不能由 prompt、template 或 request 關閉。
- 第一版所有 SSH command 都要求人工確認；尤其寫入型指令不可 auto-run。
- 不自動把 root 密碼或 private key交給 AI，AI 只看見 command result。

若測試目標真的是「完全不攔截的 root shell」，應另建一次性隔離 VM，並由人直接
SSH 測試；不應把此能力做成可由 LLM 呼叫的 Campus API。

## 8. 分階段實作計畫

### 階段 1：資料契約與 migration

1. 新增 `AIPVETemplate` SQLModel 並在 models registry 註冊。
2. 從目前 Alembic head 建立 forward migration。
3. 建立 `ai_pve_templates` 與三筆 idempotent seed。
4. 檢查 ORM metadata、migration revision、實際 DB target 與欄位完全一致。

完成條件：clean DB upgrade 可建立表；既有 DB upgrade 不改動其他表；三個
`template_key` 唯一且可重跑。

### 階段 2：Backend template service

1. 建立 repository、schemas、固定 base prompt 與 prompt composer。
2. 讓 chat request 顯式攜帶 `template_key` 與單一 `vmid`。
3. 從現有 PVE Log 抽取最小可重用 tool definition/executor，不複製 SSH 實作。
4. 修正現有 `chat.py` 對 SSH confirmation 的過期註解。

完成條件：選 N8N 時 AI context 明確知道是 N8N；不存在或 disabled template 回
4xx；模板 prompt 無法覆蓋 VMID scope、guard 或 confirmation。

### 階段 3：SSH 與授權測試入口

1. 新增 admin/instructor-only routes。
2. pending token 必須綁 requester、template test scope 與 VMID。
3. confirm 時再次驗證使用者、scope 與 VMID，不信任前端回傳的 host/key。
4. 設定 command timeout 與 stdout/stderr 最大長度，避免卡住或撐爆 LLM context。

完成條件：root 指令可在授權測試機執行；越權 VMID、不同使用者 token、過期 token、
hard-deny 指令都不能執行。

### 階段 4：`AI_PVE_template` 測試 harness

1. 建立模板選擇、VMID、自然語言任務輸入。
2. 顯示 AI 回答、tool name、command、pending/blocked、exit code、stdout/stderr。
3. pending 時顯示完整 command 與 reason，再提供允許/拒絕。
4. 不在瀏覽器 local storage 保存 token、SSH key 或敏感輸出。

完成條件：可從同一畫面完成「選模板 → AI 提議指令 → 確認 → 遠端執行 →
AI 解讀結果」。

### 階段 5：真機 smoke 與回歸

依序驗證，不把 HTTP 200 視為功能成功：

1. DB template row 正確。
2. LLM 收到正確 template context。
3. AI 產生有效 tool call。
4. VMID authorization 正確。
5. SSH host/IP/key 解析正確。
6. remote exit code 為 0，且 stdout 語意符合目標。
7. AI 最終回答正確引用執行結果。

## 9. 測試矩陣

### Unit / API

- 模板列表只回 enabled rows。
- `template_key=n8n/python/postgresql` 分別組合正確 prompt。
- unknown/disabled template 被拒絕。
- template prompt 中即使寫「忽略規則」也不能停用 guard。
- chat 只能操作 request 中指定且授權的 VMID。
- `root` user 能傳到 SSH client，但 private key 不出現在 response/log。
- read command、write command、hard-deny command 分別為 pending、pending、blocked。
- confirm token 的 owner、scope、VMID、TTL 驗證。
- timeout、非零 exit code、stderr、連線失敗都回傳結構化結果。
- stdout/stderr 截斷時明確標記 truncated。

### 真機 smoke

- N8N：探測安裝方式，再檢查 process、5678、HTTP 與 log。
- Python：`python3 --version`、環境辨識、程序與 port。
- PostgreSQL：版本、service/listener、只讀 health query；不輸出 credential。
- 一個需要 root 的可回復操作，例如在 `/tmp` 建立測試檔、驗證後刪除。
- 一個 hard-deny 指令確認永遠不抵達 SSH client。

## 10. 風險與回退

- **任意命令風險**：root + LLM 是高風險組合；以 admin auth、VMID scope、
  hard deny、人工確認、timeout 與輸出限制分層控制。
- **Prompt injection**：DB prompt 只描述機器；固定 safety prompt 必須由程式碼附加，
  且 server-side policy 才是最終權限來源。
- **記憶體 pending store**：目前 token 存於 process memory；單 instance 測試可用，
  多 worker/重啟會失效。MVP 不先擴充 Redis，但測試文件需說明限制。
- **敏感輸出**：PostgreSQL、環境變數與 process command line 可能含 secret；
  第一版應加基本 redact，且 UI 不持久化 raw output。
- **DB 回退**：migration downgrade 只移除新表；因表無 FK，不影響既有資料。
- **程式回退**：移除新 router/feature/harness 即可；既有 PVE Log 與 Teacher Judge
  不需回退。

## 11. 建議的第一個可驗證切片

先只完成 N8N：

1. 建表並 seed 三筆模板，但 API 先用 N8N。
2. 建立 template list 與 chat/confirm routes。
3. 重用現有 `ssh_exec`，所有命令皆確認。
4. 用隔離 N8N VM 驗證 `ps`、`ss`、`curl localhost:5678` 與一個 `/tmp` root 操作。
5. 確認完整 tool-result-to-final-answer loop 後，再開放 Python 與 PostgreSQL smoke。

這是最短且能回答核心問題的路徑：AI 是否真的能辨識模板環境、正確選擇工具、
以 root 執行遠端指令，並根據真實結果繼續回答。
