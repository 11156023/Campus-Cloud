# 班級管理設定整合群組 AI 功能計畫

- 日期：2026-07-30
- 狀態：實作完成；待隔離 DB migration 與 live PVE 手動驗收
- 範圍：班級管理設定的「學生機器」與「AI 檢查」

## 1. 結論

建議採用「共用畫面與 AI 核心能力，班級維持自己的授權與資料範圍」。

不能直接把 `groupId` 傳給現有群組畫面或 API：

- 群組資源大廳每位成員只取一台最新機器；班級可替同一位學生配置多個 machine node。
- 群組 AI 評分與 AI PVE 都以群組擁有者、群組成員及群組 VMID 為授權來源。
- 班級已有獨立的學生、machine node、學生機器 mapping 與生命週期，不應反向依賴 Group。

「後端群組暫時不動保留」在本計畫中的落地定義如下：

- 保留現有群組資料、路由、request/response 契約與前端行為。
- 不把群組轉換成班級、不刪除群組資料表、不改變群組授權來源。
- 班級新增自己的 API 與 scope resolver。
- AI 核心 service 可做向後相容的內部泛化，避免複製一套 Teacher Judge 與 AI PVE 邏輯；所有既有群組入口仍照常運作。

如果要求連群組後端內部檔案也完全不可修改，則只能複製 Teacher Judge 的資料表與 service。這會形成兩套幾乎相同的評分系統，不建議採用。

## 2. 目前實作盤點

| 功能 | 現況 | 班級管理缺口 |
| --- | --- | --- |
| 群組資源大廳 | 顯示群組成員、單一最新 VMID、執行狀態與 CPU／RAM／磁碟使用率 | 班級「學生機器」只顯示配置結果，缺少即時 PVE 狀態與用量；一位學生可能有多台機器 |
| AI 評分管理 | 包含評分表上傳分析、收集腳本、AI／政策審核、核准、執行、輪詢與結果 | 所有 route、model、target resolver 都綁定 `group_id` |
| AI PVE 訊息 | 群組範圍聊天、工具呼叫及 SSH 二次確認，VMID 受群組白名單限制 | `ChatRequest` 只接受 `group_id`，班級沒有自己的 VMID scope |
| 班級上課監看 | 已有 classroom service、REST 與 WebSocket；可監看 active 班級的學生機器 | 與本次整合可共用班級機器來源，但仍維持 active-only |
| 班級學生機器 | 顯示 machine node 與 provision 狀態 | 缺少 PVE snapshot、用量、摘要、手動刷新與多機器友善呈現 |
| 班級 AI 檢查 | 目前只有失敗數量與「判讀功能準備中」 | 缺少評分表、腳本、執行結果與 AI PVE 助手 |

另外，目前 `progress`、`ai`、`classroom` 都被 `active` 狀態一起鎖住。這會讓 `provisioning` 或 `partial_failed` 時最需要看的失敗機器與 AI 輔助反而無法進入，必須拆開各分頁的開放條件。

## 3. 方案比較

### 方案 A：直接重用群組頁面並傳入 groupId

不採用。班級與群組沒有可靠的一對一關係，而且群組的單 VM 語意會漏掉班級 machine node；授權也會落在錯誤的 source of truth。

### 方案 B：完整複製群組 AI 後端

不採用。雖然可以完全不碰群組內部程式，但會複製資料表、prompt、腳本生命週期、executor、polling 與修正成本，之後兩套功能容易漂移。

### 方案 C：共用核心、分開 scope 與 API

採用。

- 群組與班級各自解析合法 VMID、成員與操作權限。
- 共用 AI PVE chat/tool/SSH 核心。
- Teacher Judge 的 artifact/run 共用同一套 service 與資料表，但每筆資料只能屬於一種 scope。
- 前端抽出可重用 workspace，群組頁面維持原入口，班級頁面使用 class adapter。

## 4. 目標使用者體驗

### 4.1 學生機器

將群組資源大廳的「觀察能力」整合到班級學生機器，但不搬入群組成員管理或群組批次建立功能。

畫面建議：

- 頂部摘要：學生數、配置機器數、執行中、停止、配置中、失敗、未知。
- 依學生分組，每位學生下方可展開多台機器。
- 每台機器顯示：
  - machine node 名稱、角色與 key
  - VMID、資源類型、Proxmox node
  - provision 狀態與錯誤
  - runtime 狀態
  - CPU、RAM、磁碟使用率
- 提供手動刷新；第一版不加歷史曲線、自動排程或額外監控資料表。
- `provisioning`、`partial_failed`、`active` 均可查看；班級只要已有學生或 machine node 就能進入。

### 4.2 AI 檢查

AI 檢查改為四個子頁籤：

1. 評分表
2. 收集腳本
3. 執行與結果
4. AI PVE 助手

不要再用整個分頁的單一 `active` gate，而是讓各能力顯示自己的前置條件：

- 評分表與腳本管理：班級建立後即可使用。
- AI PVE 助手：班級至少有一個已配置 VMID。
- 腳本執行：至少有一個合法、running、具 IP 與 SSH key 的目標。
- 上課監看：仍維持班級 `active` 才能進入。

## 5. 後端設計

### 5.1 班級學生機器狀態 API

新增：

```http
GET /api/v1/teaching-classes/{class_id}/student-machines
```

建議回傳穩定契約：

```json
{
  "class_id": "uuid",
  "refreshed_at": "2026-07-30T00:00:00Z",
  "summary": {
    "students": 0,
    "machines": 0,
    "running": 0,
    "stopped": 0,
    "provisioning": 0,
    "failed": 0,
    "unknown": 0
  },
  "students": [
    {
      "student_id": "uuid",
      "user_id": "uuid",
      "name": "Student",
      "email": "student@example.com",
      "machines": [
        {
          "mapping_id": "uuid",
          "machine_node_id": "uuid",
          "node_key": "worker",
          "name": "Worker",
          "role": "student",
          "vmid": 100,
          "resource_type": "qemu",
          "provision_status": "ready",
          "provision_error": null,
          "runtime_status": "running",
          "proxmox_node": "pve-1",
          "cpu_usage_pct": 12.5,
          "ram_usage_pct": 48.2,
          "disk_usage_pct": 31.7
        }
      ]
    }
  ]
}
```

實作原則：

- DB source of truth：`TeachingClassStudentMachine` 與 `TeachingClassMachineNode`。
- runtime source：每次 request 只抓一次 PVE resource snapshot，再依 VMID 合併。
- 不呼叫 group repository，不套用「每位成員最新一台 VM」規則。
- PVE 暫時不可用時保留 DB 配置資料，runtime 欄位回 `unknown`；不要讓整頁因監控來源失敗而消失。
- 百分比計算與群組資源大廳共用純函式或 serializer，避免兩邊公式漂移。

### 5.2 班級 AI PVE scope

新增班級專用入口：

```http
POST /api/v1/teaching-classes/{class_id}/ai/pve-log/chat
POST /api/v1/teaching-classes/{class_id}/ai/pve-log/ssh/confirm
```

chat body 只保留 `message`／`messages` 等聊天資料，不再要求前端額外傳 `group_id`。

班級 resolver 必須：

1. 驗證目前使用者是班級 owner 或允許的管理角色。
2. 從 `TeachingClassStudentMachine` 解析班級全部已配置 VMID。
3. 將 VMID 集合傳給既有 `pve_chat(..., allowed_vmids=...)`。
4. 所有查詢、detail、工具選擇與 SSH 操作都受同一集合限制。

SSH 二次確認 token 應綁定：

- `allowed_vmids`
- 發起者 user id
- scope type：`teaching_class`
- scope id：`class_id`

confirm 時重新驗證使用者與 scope，避免 token 被另一位使用者或另一個班級重放。既有群組 AI PVE route 與 request contract 保持不變。

### 5.3 Teacher Judge 多 scope

現有 Teacher Judge 的 file、script artifact 與 script run 都是非空 `group_id`。建議做向後相容的 additive migration：

- `group_id` 改為 nullable。
- 新增 nullable `class_id`，FK 指向 `teaching_classes`。
- 加入 check constraint，保證每筆資料恰好只有一種 scope：
  - `group_id IS NOT NULL AND class_id IS NULL`
  - 或 `group_id IS NULL AND class_id IS NOT NULL`
- 為 class scope 建立必要 index 與 active filename uniqueness。
- 現有資料不需搬移，全部維持 group scope。

新增班級入口，路徑結構與群組功能一致：

```text
/api/v1/teaching-classes/{class_id}/judge/files/...
/api/v1/teaching-classes/{class_id}/judge/scripts/...
/api/v1/teaching-classes/{class_id}/judge/scripts/{script_id}/runs/...
```

內部使用小型且明確的 scope value object，例如 `JudgeScope(kind, id)`，或等價的顯式 helper：

- group route 建立 `group` scope，保留既有 request/response。
- class route 建立 `teaching_class` scope。
- file、artifact、run service 依 scope 查詢，不複製整套 service。
- prompt、AI review、policy review、核准規則與 executor 繼續共用。

不要恢復舊的 execution profile 資料模型；執行命令繼續以目前的 `teacher_judge_template_commands` 為準。

### 5.4 班級腳本執行目標

班級 target resolver 不可使用 group member 的 latest VM 查詢，必須：

1. 讀取班級所有 `TeachingClassStudentMachine`。
2. 驗證 mapping 所屬學生仍在該班級。
3. 驗證 `Resource.user_id` 與該學生相符。
4. 驗證 PVE runtime 為 running。
5. 驗證有可用 IP 與 SSH key。
6. 建立 run target snapshot 後交給既有 executor。

第一版保留目前一次最多 5 個 target 的限制。因同一位學生可能有多台機器，前端選項必須使用 VMID／mapping id，而不是只使用 student id。

## 6. 前端設計

### 6.1 共用功能元件

現有 `AiJudgePanel.jsx` 與 `AiPvePanel.jsx` 綁定群組 route 與 group id。建議抽成：

```text
frontend/src/features/teacher-judge/TeacherJudgeWorkspace.jsx
frontend/src/features/ai-pve/AiPveWorkspace.jsx
```

workspace 接收明確的 scope：

```js
{ type: "group", id: groupId }
{ type: "teaching-class", id: classId }
```

service adapter 根據 scope 選擇既有群組 API 或新增班級 API。避免把每一支 request function 都當 prop 傳入，保持介面聚焦。

保留薄 wrapper：

- 群組 `AiJudgePanel`／`AiPvePanel`：傳入 group scope，維持現有畫面行為。
- 班級 AI 檢查：傳入 teaching-class scope，組合四個子頁籤。

### 6.2 班級頁面

新增或拆分：

```text
frontend/src/pages/system/classes/ClassStudentMachinesPanel.jsx
frontend/src/pages/system/classes/ClassAiCheckPanel.jsx
frontend/src/services/teachingClassAi.js
```

`ClassWorkspacePage` 只負責 route、班級資料與分頁 gate，不承擔 PVE 合併或 AI workflow 狀態。

分頁 gate 改為能力判斷，而非共用 `item.status === "active"`：

| 分頁 | 開放條件 |
| --- | --- |
| 基本設定 | 永遠 |
| 學生名單 | 永遠 |
| 機器節點 | 永遠 |
| 學生機器 | 已有學生或 machine node；配置中與部分失敗仍可看 |
| AI 檢查 | 班級存在；內部功能各自顯示前置條件 |
| 上課監看 | `active` |

## 7. 分階段實作

### 階段 1：補齊學生機器

- 建立班級學生機器 response schema、service 與 API。
- 一次合併 DB mappings 與 PVE snapshot。
- 建立多機器學生卡片、摘要、用量與手動刷新。
- 修正分頁 gate，讓配置中與部分失敗班級可查看。
- 加入 service、route 與前端基本測試。

這一階段完成後，即使 AI 尚未接入，班級配置失敗與 runtime 狀態也已可直接診斷。

### 階段 2：接入 AI PVE

- 建立 class VMID resolver 與 class-scoped chat/confirm routes。
- 將確認 token 綁定使用者與班級 scope。
- 抽出 AI PVE 共用 workspace。
- 在 AI 檢查加入「AI PVE 助手」。
- 驗證跨群組、跨班級與非班級 VMID 均被拒絕。

### 階段 3：Teacher Judge 資料層與 API

- 建立 Alembic migration，新增 class scope 與互斥 constraint。
- 將 file、artifact、run service 改為 scope-aware。
- 保留原群組 routes，新增 class routes。
- 建立班級多機器 target resolver，保留核准與最多 5 台限制。
- 先完成後端回歸測試，再接前端。

### 階段 4：AI 檢查完整畫面

- 抽出 Teacher Judge 共用 workspace。
- 將評分表、收集腳本、執行與結果接到 class service adapter。
- 顯示班級機器前置條件與逐目標錯誤。
- 確認群組頁面功能與顯示不變。

### 階段 5：清理與完整回歸

- 移除抽取後產生的重複 helper、unused state 與一行式過渡 wrapper。
- 更新 OpenAPI 使用端；依專案實際流程產生 client，不手改 generated files。
- 執行 backend focused tests、frontend tests/build、migration 檢查與手動權限 probe。

## 8. 預計影響範圍

後端預計涉及：

```text
backend/app/api/routes/teaching_classes.py
backend/app/api/routes/ai_pve_log.py
backend/app/api/routes/teacher_judge_files.py
backend/app/api/routes/teacher_judge_scripts.py
backend/app/ai/pve_log/
backend/app/ai/teacher_judge/
backend/app/models/
backend/app/schemas/
backend/app/services/
backend/alembic/versions/
backend/tests/
```

前端預計涉及：

```text
frontend/src/pages/system/classes/
frontend/src/pages/system/groups/AiJudgePanel.jsx
frontend/src/pages/system/groups/AiPvePanel.jsx
frontend/src/features/teacher-judge/
frontend/src/features/ai-pve/
frontend/src/services/
```

實作時應以實際 symbol 與 import path 為準；這份清單是變更邊界，不代表每個檔案都一定要修改。

## 9. Migration 與安全邊界

- SQLModel 變更必須建立 Alembic migration。
- migration 前先確認 backend 實際 DB target；不可對不明或 production DB 試跑。
- migration 只做 additive scope 擴充，不刪資料。
- 驗證既有 group rows 在 migration 後仍符合 constraint。
- 同時驗證 clean DB upgrade 與含既有 group judge 資料的 upgrade。
- 不變更 public AI proxy、LiteLLM、vLLM model routing 或 credential。
- 不執行 commit、push、部署或資料轉換。

## 10. 驗證計畫

### 10.1 Backend focused tests

新增或擴充：

```text
tests/services/test_teaching_class_machine_status.py
tests/api/routes/test_teaching_class_ai_pve.py
tests/ai/teacher_judge/test_class_scope.py
```

必須覆蓋：

- 同一學生的多台機器全部回傳，不被 latest VM 規則截斷。
- PVE snapshot 只抓一次，監控失敗時仍回傳 DB 配置。
- 非 owner／admin 無法讀取班級 AI 與機器資料。
- AI PVE 只能讀取或操作該班級 VMID。
- SSH confirm token 無法跨使用者、跨 scope 或跨班級使用。
- Teacher Judge group 舊資料與舊 API 不變。
- class artifact 不可由 group route 讀取，反之亦然。
- class run 只能選合法 mapping、running、有 IP 與 SSH key 的 VM。
- `partial_failed` 班級仍能開啟學生機器並看到錯誤。

回歸測試至少包含：

```powershell
uv run python -m pytest tests/services/test_classroom_service.py -q
uv run python -m pytest tests/services/test_teaching_class_orchestration.py -q
uv run python -m pytest tests/test_teacher_judge_files.py -q
uv run python -m pytest tests/test_teacher_judge_script_artifacts.py -q
uv run python -m pytest tests/test_teacher_judge_boundaries.py -q
uv run python -m pytest tests/test_ai_pve_log_ssh_exec_scope.py -q
uv run python -m pytest tests/api/routes/test_ai_pve_log_session_forwarding.py -q
uv run ruff check app tests
```

實際檔名需在實作前依 repository 現況確認，不為了符合本文件而搬動既有測試。

### 10.2 Migration

在已確認的隔離測試 DB：

- upgrade from current head
- downgrade/upgrade round trip（若 migration 可安全回退）
- clean DB upgrade to head
- 確認 Alembic 只有單一預期 head
- 驗證 exclusivity constraint 與 class indexes

### 10.3 Frontend

```powershell
npm test
npm run build
```

補充 component／integration cases：

- class 與 group scope 呼叫正確的 API。
- 多機器列表及摘要正確。
- 各分頁 gate 不再全部依賴 active。
- AI 執行選項以 machine identity 區分。
- 群組頁面抽取前後行為一致。

### 10.4 手動驗收

1. 建立一個含兩位學生、每人多台機器的班級。
2. 在 `provisioning` 與 `partial_failed` 查看學生機器及錯誤。
3. 刷新後確認 runtime 與 CPU／RAM／磁碟資料。
4. 使用 AI PVE 詢問班級機器，確認其他群組／班級 VMID 不會出現在結果。
5. 上傳評分表、產生並核准腳本。
6. 選擇同一學生的不同 VMID 執行，確認結果逐台保存。
7. 回到既有群組資源大廳、AI 評分與 AI PVE，確認原流程不變。

## 11. 驗收標準

- 班級學生機器完整顯示一位學生的所有配置機器及即時 PVE 狀態。
- 配置中或部分失敗時即可診斷，不必先讓班級進入 active。
- 班級 AI 檢查具備群組現有的評分表、腳本、執行結果與 AI PVE 能力。
- 所有 AI 與 SSH 操作受班級 VMID scope 限制。
- Teacher Judge 每筆資料只能屬於 group 或 teaching class 其中之一。
- 現有群組資料、API、權限與前端使用方式保持相容。
- 上課監看維持 active-only，且不因本次整合改變既有 WebSocket 行為。
- focused tests、migration checks 與 frontend build 全部通過。

## 12. 本次不做

- 不移除或遷移 Group backend。
- 不自動同步群組成員與班級學生。
- 不讓班級建立隱藏群組作為相容層。
- 不新增 AI 評分排程、批次歷史分析或長期用量圖表。
- 不重做 VNC／console 或 classroom WebSocket。
- 不修改 public AI proxy、LiteLLM 或 vLLM runtime。

## 13. 建議執行順序

先完成階段 1，讓班級的機器狀態與配置錯誤可見；接著以階段 2 驗證 class scope 與 AI PVE 的安全邊界；最後才進行需要 migration 的 Teacher Judge 多 scope 與完整 AI 檢查畫面。

這個順序能先填補目前最直接的班級管理缺口，也把風險較高的資料模型變更放在授權與機器 scope 已被測試證明之後。

## 14. 2026-07-30 實作結果

已完成：

- 班級學生機器 API、單次 PVE snapshot 合併、監控失敗降級、多機器前端卡片與摘要。
- 班級 AI PVE chat／SSH confirm routes，以及確認 token 的 user、scope、scope id、VMID 集合綁定。
- Teacher Judge group／teaching class 互斥 scope model、`tjcs01` migration、共用 service 與班級 routes。
- 班級 target resolver 的 enrollment、resource owner、running、IP、SSH key 與最多 5 台驗證。
- 前端 scope-aware Teacher Judge／AI PVE service adapter、AI 四頁籤與分頁 gate 拆分。
- 群組既有 routes、request path 與前端入口保持不變。

已驗證：

- Backend focused regression：82 tests passed；新增 class scope／machine status：3 tests passed。
- Backend `ruff check app tests` 通過。
- 本次新增核心檔案 targeted mypy 通過；全專案 mypy 仍有既存型別錯誤。
- Frontend `npm run build` 通過。
- Alembic 為單一 `tjcs01` head。

尚未執行：

- 未對任何資料庫執行 upgrade／downgrade；需先確認隔離測試 DB target。
- Alembic 全鏈 offline SQL 被既有 `7b4a08d7cf39` migration 的 connection inspection 阻擋。
- 未連線 live PVE／SSH／vLLM，因此 runtime 與手動驗收項目仍待測試環境確認。
