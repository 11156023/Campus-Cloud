# 班級管理 AI 檢查 Session 與 Library 實作計畫

## 1. 結論

在班級管理的「AI 評分管理」中新增持久化 AI 檢查工作區，讓老師能像 ChatGPT
一樣：

1. 建立、命名、切換及封存不同檢查 session。
2. 回到 session 後繼續先前對話，而不是由瀏覽器暫存完整 messages。
3. 從班級 library 選擇評分表，透過對話整理檢查項目並產生受管腳本。
4. 在同一 session 查看腳本版本、核准狀態、歷次 run、每台機器結果與 AI 評語。
5. 保留「哪次對話使用哪份評分表、產出哪個腳本、執行哪個 run」的可追溯關係。

建議 MVP 使用兩張新表：

- `teacher_judge_sessions`：session 身分、範圍、目前選定項目與壓縮摘要。
- `teacher_judge_session_messages`：逐則保存 user/assistant 對話。

既有 `teacher_judge_files`、`teacher_judge_script_artifacts`、
`teacher_judge_script_runs` 繼續作為 library 與正式執行產物。不要建立另一份通用
library JSON，也不要復活已退役的 `execution_profiles`。

## 2. 現況與缺口

### 2.1 已有的正式資料

目前已持久化：

- `teacher_judge_files`
  - 班級評分表原始檔、hash、AI 分析、環境 template 與 active/replaced 狀態。
- `teacher_judge_script_artifacts`
  - 評分表快照、完整 Python 腳本、版本、policy/quality 結果、AI review 與核准狀態。
- `teacher_judge_script_runs`
  - 執行目標快照、pending/running/completed/failed 狀態、每台機器結果與 AI judgement。
- `teacher_judge_template_commands`
  - 各環境可供 rubric/check step 引用的受控 command catalog。

這些表的責任已清楚，不應搬到 session 表或重新複製成 library item。

### 2.2 對話目前沒有持久化

現行 `/api/v1/rubric/chat`：

- request 由前端送出完整 `messages`。
- request 由前端送出完整 `rubric_context`。
- backend 組 prompt、呼叫模型並回傳 reply/updated items。
- backend 不保存 user message、assistant reply 或使用的 context。

`AiJudgePanel.jsx` 的 messages 只存在 React state。重新整理、切換班級或重新登入後，
先前對話無法恢復，也無法可靠回答某支腳本是由哪段討論產生。

### 2.3 執行資料存在，但歷史入口不完整

每次執行都已新增 `teacher_judge_script_runs`，但目前只有：

- 建立 run。
- 已知 `script_id + run_id` 時取得單一 run。

缺少：

- 列出 session 的 run 歷史。
- 列出腳本的所有 run。
- 前端 reload 後找回最近執行。
- 從對話或腳本回到相關 run。

## 3. 產品與資料邊界

### 3.1 Session 是什麼

一個 session 代表班級內一個持續進行的 AI 檢查工作，例如：

- 「期中 Python 環境檢查」
- 「N8N 工作流程部署驗收」
- 「第三週 Linux 基礎設定評分」

session 負責組織工作，不直接保存腳本執行 stdout、完整評分表或完整腳本副本。

### 3.2 Library 是什麼

MVP 的 library 是現有正式資料的班級範圍檢視：

- 評分表 library：`teacher_judge_files`
- 腳本 library：`teacher_judge_script_artifacts`
- 執行歷史：`teacher_judge_script_runs`
- 系統 command library：`teacher_judge_template_commands`

Library 不是新的萬用資料表。session 只引用 library item，正式內容仍由原表管理。

### 3.3 Source of truth

| 資料 | Source of truth |
| --- | --- |
| Session 名稱、狀態、選定評分表 | `teacher_judge_sessions` |
| 對話內容 | `teacher_judge_session_messages` |
| 評分表與 AI 分析 | `teacher_judge_files` |
| 腳本內容、版本、審查與核准 | `teacher_judge_script_artifacts` |
| 機器執行結果與 AI 評語 | `teacher_judge_script_runs` |
| 允許引用的檢查命令 | `teacher_judge_template_commands` |
| VMID 授權與目前可執行狀態 | 現有 Teaching Class resolver、Resource 與 PVE runtime |

## 4. 建議資料模型

### 4.1 `teacher_judge_sessions`

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `id` | UUID PK | Session ID |
| `teaching_class_id` | UUID FK, index | 正式班級 scope |
| `title` | varchar(255) | 側欄顯示名稱 |
| `status` | enum | `active`、`archived` |
| `selected_file_id` | UUID FK nullable | 目前選定的評分表 library item |
| `summary` | text | 對話壓縮上下文與列表摘要；不是完整 chat memory |
| `created_by` | UUID FK nullable | 建立者 |
| `created_at` | timestamptz | 建立時間 |
| `updated_at` | timestamptz | 設定或內容更新時間 |
| `last_activity_at` | timestamptz, index | 對話、腳本或 run 最近活動時間 |

約束與行為：

- session 必須隸屬一個 Teaching Class。
- `selected_file_id` 必須屬於同一班級；只靠 FK 不足，service 必須驗證 scope。
- 不在 session 表保存 `template_key`。有效模板由 server 依 `selected_file_id` 對應的評分表環境欄位、目前 rubric context 與對話內容推導，並在使用 command catalog 或產生腳本前重新驗證；推導結果只存在 request/context，不作為 session 身分欄位。
- 第一版不提供硬刪除，只提供 archive，避免對話與產物失去歷史入口。
- 每完成 10 輪 user/assistant 對話（20 則訊息）觸發一次摘要整理，將既有 `summary` 與這 10 輪壓縮成新的上下文；完整訊息仍保留在 `teacher_judge_session_messages`。
- 摘要整理失敗時保留上一版 `summary`，不可阻擋本次對話寫入；MVP 不另建 summary history 表。
- 不保存 VMID、SSH key、IP、密碼、完整 prompt 或整份 library snapshot。

### 4.2 `teacher_judge_session_messages`

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `id` | UUID PK | Message ID |
| `session_id` | UUID FK, index | 所屬 session，session 移除時 cascade |
| `role` | enum | `user`、`assistant` |
| `content` | text | 顯示給老師的訊息 |
| `message_type` | enum | `chat`、`rubric_proposal`、`system_notice` |
| `metadata_json` | JSON | metrics、proposal 摘要及相關 artifact/run ID |
| `created_by` | UUID FK nullable | user message 的建立者；AI message 為 null |
| `created_at` | timestamptz, index | 穩定排序 |

規則：

- 每次 chat API 只接受一則新的 user message。
- server 依 `created_at, id` 載入 bounded history，不信任 client 回傳舊訊息。
- `metadata_json` 只放小型、穩定的關聯與 metrics，不放完整 script/run result。
- AI 提出的 rubric 修改以 proposal 保存；沿用現有明確更新流程，未經前端確認不直接
  改寫 `teacher_judge_files.analysis_json`。
- 以已完成的 user/assistant 成對訊息計算對話輪數；第 10、20、30… 輪完成後觸發一次
  summary 壓縮，模型輸入由上一版 summary 加上最近 10 輪組成，不把完整歷史重新送入。
- 不保存模型 chain-of-thought；只保存使用者可見 reply 與必要的結構化 proposal。

### 4.3 既有表的最小關聯變更

在 `teacher_judge_script_artifacts` 新增：

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `session_id` | UUID FK nullable, index | 哪個 session 產生此腳本 |

選擇 nullable 是為了相容現有腳本，也允許未來從班級 library 直接產生腳本。新 session
流程建立腳本時必須填入；舊 API 暫時維持可用。

`teacher_judge_script_runs` 不新增重複的 `session_id`。run 已有 `artifact_id`，可沿
`run -> artifact -> session` 查詢，避免兩個 session ID 發生不一致。執行時仍使用
既有 `target_snapshot_json` 保存當下機器與腳本版本。

`teacher_judge_files` 不新增 `session_id`，因同一份評分表可以被多個 session 重用；
由 `teacher_judge_sessions.selected_file_id` 表達目前選擇即可。

## 5. 主要資料流

### 5.1 建立與恢復 Session

```text
老師開啟班級 AI 檢查
  -> GET sessions?status=active
  -> 依 last_activity_at 顯示側欄
  -> POST sessions 建立新工作
  -> 選 session
  -> GET session + messages + library summary + derived template context
  -> 恢復對話、選定評分表、推導出的模板 context、腳本與歷史 run
```

### 5.2 Session Chat

```text
POST sessions/{session_id}/messages {content}
  -> 驗證 instructor 與 teaching_class scope
  -> 讀 session.selected_file_id 對應 analysis
  -> 由 selected file、rubric context 與對話推導 effective template context
  -> 讀 enabled template commands
  -> 讀 summary 加最近 bounded messages
  -> 保存 user message
  -> 呼叫現有 Teacher Judge chat service
  -> 保存 assistant reply / rubric proposal / metrics
  -> 若剛完成第 10、20、30… 輪，整理並更新 summary 壓縮上下文
  -> 更新 last_activity_at
  -> 回傳新增的兩則 message 與 proposal
```

建議 history 預設只取最近 20 則，並限制總字元數；完整歷史仍保存在 DB，模型 context
不必每次無上限增長。

### 5.3 從 Library 產生腳本

```text
Session 選定評分表
  -> 老師與 AI 討論／確認 rubric
  -> POST sessions/{session_id}/scripts
  -> backend 從 DB 讀 selected file analysis
  -> 加入 template command catalog
  -> 沿用 script generation + hard policy + quality + AI review
  -> 建立 artifact(session_id=...)
  -> 老師查看並核准
```

新 endpoint 不接受前端任意傳入整份 `rubric_snapshot` 作為事實來源；應由 backend
從 session 所選 library item 讀取。這可避免 UI state 與 DB library 分岔。若老師接受
AI proposal，先 PATCH 評分表分析，再生成腳本。

### 5.4 執行與歷史

```text
POST sessions/{session_id}/scripts/{artifact_id}/runs
  -> 驗證 artifact.session_id
  -> 沿用 approved gate
  -> 沿用 Teaching Class machine resolver
  -> 建立既有 script run
  -> 背景 SSH 執行與 AI judgement
  -> session.last_activity_at 更新

GET sessions/{session_id}/runs
  -> join artifact
  -> 依 created_at desc 回傳歷史摘要
```

run detail 繼續使用現有完整 contract；列表只回傳摘要，避免一次載入所有
`target_results_json`。

## 6. API 契約

建議 route prefix：

```text
/api/v1/teaching-classes/{class_id}/judge/sessions
```

### 6.1 Session

- `GET /sessions?status=active&skip=0&limit=50`
  - 回傳 id、title、status、derived template context、selected file summary、
    script/run counts、last activity。
- `POST /sessions`
  - request：`title`、可選 `selected_file_id`；不得傳入或保存 `template_key`。
- `GET /sessions/{session_id}`
  - 回傳 session detail 與小型 counts，不內嵌完整 messages/results。
- `PATCH /sessions/{session_id}`
  - 允許改 title、selected file、status；模板隨選定評分表與對話 context 重新推導。
- `POST /sessions/{session_id}/archive`
  - 明確封存；第一版不做 delete。

### 6.2 Messages

- `GET /sessions/{session_id}/messages?before=<cursor>&limit=50`
  - cursor pagination，穩定依 `created_at + id`。
- `POST /sessions/{session_id}/messages`
  - request 只帶 `content`。
  - response 回 user message、assistant message 與可選 rubric proposal。

不要讓新 API 繼續接受完整 `messages` 或 client-provided `rubric_context`。

### 6.3 Library 與產物

- 沿用 `GET /judge/files/` 作為評分表 library。
- 沿用 `GET /judge/scripts/` 作為班級腳本 library，新增可選 `session_id` filter。
- `POST /sessions/{session_id}/scripts`
  - 從 session 的選定評分表建立受管腳本。
- 沿用 approve/regenerate/archive；service 增加 session scope 驗證。
- `GET /sessions/{session_id}/runs?skip=0&limit=20`
  - 回傳歷史摘要。
- `GET /sessions/{session_id}/runs/{run_id}`
  - 回傳完整 run detail。

### 6.4 舊 API 相容

第一階段保留現有 `/rubric/chat`、`/judge/scripts` 與既有 run detail，避免一次改壞
現行 UI。新 UI 切換完成、focused regression 通過後，再評估移除 stateless chat
入口；不要永久維護兩套前端主流程。

## 7. 前端工作區

將目前三個獨立 tab 收斂成一個 session workspace，但不需要模仿 ChatGPT 的所有功能。

```text
+----------------+---------------------------+----------------------+
| Sessions       | AI 對話 / 工作紀錄       | Library / Inspector  |
|                |                           |                      |
| + 新增檢查     | user / assistant messages | 評分表               |
| 期中 Python    | rubric proposal           | 腳本版本與狀態       |
| N8N 驗收       | script/run activity link  | 執行歷史             |
| 已封存         |                           | 每台機器結果         |
+----------------+---------------------------+----------------------+
```

### Session 側欄

- title、derived template context、最近活動時間。
- active/archived filter。
- 建立、重新命名、封存、切換。
- 切換 class 時清除 session detail，拒絕舊 request 回填。

### 中央對話區

- reload 後由 API 恢復。
- message 發送中防止重複提交。
- AI 提出 rubric 修改時顯示 diff/摘要與「套用」動作。
- 腳本建立、核准、run 完成以可點擊 activity card 顯示，不複製完整 result。

### Library / Inspector

- 評分表：選擇 session 使用的 active file。
- 腳本：只顯示本 session 或切換至全班 library。
- 執行歷史：預設 newest first，可打開完整 per-target result。
- reload 後從歷史 API 恢復最近 run，不再依賴 `activeRunRef` React state。

## 8. 權限、安全與資料保留

- 所有 session API 經現有 Teaching Class access helper；不能只用 session UUID 查詢。
- 選 file、artifact、run 時都驗證與 session 同班級，且 artifact 的 session 關聯一致。
- executor 保持最後一道授權邊界；不能因 session 已驗證而省略 live machine revalidation。
- message、AI reply、stdout/stderr 可能含個資或 secret；沿用輸出截斷並在進 DB 前套用
  現有或新增的 redact helper。
- `summary` 是可重建的壓縮上下文，不是逐則訊息的替代品；只在每 10 輪完成後更新，並以
  上一版 summary 加最近 10 輪作為整理輸入。
- session archive 不會停止正在執行的 run；archived session 禁止新增 message/script/run。
- 第一版不提供 message 編輯或單則刪除，避免歷史與衍生產物失去可追溯性。
- DB 只保存使用者可見 AI reply，不保存隱藏 reasoning。
- 遠端 `/tmp/campus-cloud/teacher-judge/...` retention 是既有獨立缺口，應在 production
  rollout 前加入 cleanup policy，但不要塞入 session 表處理。

## 9. Migration 計畫

目前 repository Alembic head 為 `aipve01_ai_pve_templates`。實作時：

1. 從當下重新確認的唯一 head 建立 forward migration。
2. 建立 session status、message role/type enum。
3. 建立 `teacher_judge_sessions`。
4. 建立 `teacher_judge_session_messages`。
5. 在 `teacher_judge_script_artifacts` 新增 nullable `session_id`、FK 與 index。
6. 不回填虛構 session；既有 artifact 保持 `session_id = NULL`，仍出現在全班 library。
7. 不修改既有 run JSON、rubric files 或 command catalog。

執行 migration 前必須從 `backend/` 確認 `.env` 指向隔離測試 DB。至少驗證：

- clean DB upgrade 到 head。
- 既有 schema upgrade。
- `alembic check`。
- downgrade 僅在 disposable DB 驗證。
- FK、enum、index 與 SQLModel metadata 一致。

## 10. 分階段實作

### 階段 1：Session 與 Message 持久化

- 新增兩個 model、schemas、migration、repository/service。
- 新增 session CRUD/archive 與 message list/create。
- 將現有 chat service 改成接受 server 組合的 bounded history/context。
- 每完成 10 輪對話觸發 summary 壓縮；summary 失敗不覆蓋既有內容。
- 保留舊 stateless route，不先改 script/run。

完成條件：建立 session、對話、reload、切換 session 後內容正確恢復；第 10 輪觸發
summary 壓縮且第 1～9 輪不觸發；不同班級無法互相存取。

### 階段 2：Library 與腳本 lineage

- artifact 新增 nullable `session_id`。
- 新增 session script generation endpoint。
- 從 DB selected file 產生 rubric snapshot。
- scripts list 支援 session filter，核准與 regenerated version 保留 session 關聯。

完成條件：可從 session library 選評分表、對話整理、產生腳本、核准；每個新 artifact
能追溯至 session 與 source file snapshot。

### 階段 3：Run 歷史與恢復

- 新增 session run list/detail。
- 執行入口驗證 session/artifact/class 一致。
- 前端 reload 後恢復最近 run，顯示歷史摘要與 per-target detail。
- run 建立/完成時更新 session `last_activity_at`。

完成條件：同一 session 可查看所有歷次執行，重新整理後不遺失；executor scope
regression 維持 fail-closed。

### 階段 4：前端工作區收斂

- 加入 session sidebar、persistent chat、library inspector。
- 重用現有 Rubrics/Scripts/Execution 元件邏輯，逐步拆出可測元件。
- 新 session 主流程穩定後，移除舊的 local-only message/run state 主路徑。

完成條件：老師可在單一畫面完成 session 建立、對話、選 library、產生／核准腳本、
執行與回看歷史。

### 階段 5：保留政策與正式驗收

- 為 remote Teacher Judge temp directory 加入可驗證 cleanup/retention。
- 確認 message/result redact。
- 在隔離 PostgreSQL、測試班級與可回復 VM/LXC 做 E2E。

## 11. 測試矩陣

### Backend

- session 建立、更新、封存、排序與 pagination。
- session 不接受或保存 `template_key`；selected file／rubric context 變更後，derived
  template context 會重新計算且不跨班級外洩。
- instructor、class owner、跨班級與不存在 session 的授權結果。
- selected file 必須屬於相同 Teaching Class。
- message 穩定排序、cursor pagination、bounded prompt history。
- 第 10、20、30… 輪才觸發 summary 壓縮；未達門檻不改 summary，整理失敗保留舊 summary。
- client 無法偽造舊 messages 或 rubric context。
- AI 失敗時 user message 保留，並以可辨識狀態／system notice 記錄失敗。
- archived session 禁止新 message、script、run。
- script artifact 正確填入 session ID，approved regeneration 保留 lineage。
- session run list 不回傳其他 session 或 legacy unscoped run。
- executor 仍拒絕 scope mismatch、owner mismatch 與 class scope changed。
- response/schema 不洩漏 SSH key、完整 hidden prompt 或未截斷敏感輸出。

### Frontend

- class/session 切換會清理舊 state，延遲 response 不會污染新 session。
- reload 恢復 messages、selected file、scripts 與最近 run。
- optimistic message 發送失敗時有可重試狀態，不重複建立。
- rubric proposal 必須明確套用才會更新 library。
- session archive 後 UI 變 read-only。
- run polling terminal 後停止；頁面 reload 改由 history API 恢復。

### Focused commands

實作時新增對應測試檔後，從 `backend/` 執行：

```powershell
uv run python -m pytest tests/test_teacher_judge_sessions.py -q
uv run python -m pytest tests/test_teacher_judge_script_artifacts.py -q
uv run python -m pytest tests/test_teacher_judge_boundaries.py -q
uv run ruff check app tests
uv run alembic check
```

前端依既有 test runner 執行 session workspace 與 `AiJudgeService` focused tests，再跑
production build。不得把沒有 isolated PostgreSQL/PVE/vLLM 證據的結果稱為完整 E2E。

## 12. 不納入 MVP

- Session 分享、多人同時編輯、branch/fork。
- 向量資料庫或語意檢索。
- 通用檔案 library、任意 attachment 類型。
- 自動合併不同 session 記憶。
- 新的 machine execution profile。
- 直接由 AI 自動核准腳本。
- 跨班級 session 或 library。
- 任意刪除 message、run 或歷史產物。

## 13. 第一個可驗證切片

最短可行切片只完成：

1. `teacher_judge_sessions` 與 `teacher_judge_session_messages`。
2. session list/create/archive。
3. session message list/create。
4. server-side bounded history 與 selected rubric context。
5. 每 10 輪觸發的 summary 壓縮上下文。
6. 前端 session sidebar、persistent chat、reload 恢復。

這一片先解決真正的缺口：對話與工作上下文不再只存在瀏覽器，且模板只由 server 從
可驗證的上下文推導，不把 `template_key` 變成 session schema。摘要先依每 10 輪壓縮
規則實作。確認 session 邊界、
權限與恢復正確後，再把既有 script artifact 與 run history 接入，避免第一次 migration
就同時重寫整個 Teacher Judge 流程。
