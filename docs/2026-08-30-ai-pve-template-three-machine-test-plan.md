# AI PVE Template 三機測試詳細分析與實作計畫

| 項目 | 內容 |
| --- | --- |
| 文件日期 | 2026-08-30（Asia/Taipei） |
| 適用範圍 | `AI_PVE_template/` 隔離測試頁與 `/api/v1/ai/pve-template/*` |
| 目標 | 一次輸入三個 VMID，逐台選擇 AI 機器模板，讓 AI 在同一段對話中辨識三台角色並受控使用 SSH |
| 本次限制 | 初始上下文只使用使用者選取的模板，不額外抓取 PVE、SSH 或 guest 規格 |
| 不在本次範圍 | 正式 `/ai-pve` 管理頁、Proxmox 建機模板、自動辨識模板、真實硬體規格同步、資料庫 migration |

## 1. 決策摘要

測試版採用「三個固定目標槽位，每個槽位各自選擇一個 AI 機器角色模板」：

```text
機器 1：VMID + AI 機器模板
機器 2：VMID + AI 機器模板
機器 3：VMID + AI 機器模板
```

使用者送出任務後，後端依三個 `template_key` 讀取既有 `ai_pve_templates`，將每台
VMID 與其模板的 `display_name`、`description`、`system_prompt` 組合成同一份 system
prompt。AI 因此在第一次推理前就知道三個目標及各自的模板角色，不需要先呼叫 PVE tool
或 SSH 探測。

這個版本保留既有 SSH 能力：AI 若根據使用者任務需要取得 guest 內程序、版本、port、
服務狀態或日誌，可以針對三個已授權 VMID 呼叫 `ssh_exec`。模板帶入只提供角色與診斷
方向，不會授權指令，也不會提供 SSH host、帳號、private key 或密碼。

## 2. 「AI 知道三台規格」的測試版定義

### 2.1 本次能確實提供的資訊

目前 `ai_pve_templates` 只有以下欄位：

- `template_key`
- `display_name`
- `description`
- `system_prompt`
- `enabled`

因此本次「規格」定義為使用者明確選取的**模板角色與模板描述**，例如：

| VMID | 選取模板 | AI 初始知道的內容 |
| --- | --- | --- |
| 102 | N8N | 這是 N8N 角色，優先關注程序、container、5678、HTTP、日誌與磁碟 |
| 107 | PostgreSQL | 這是 PostgreSQL 角色，優先關注版本、服務、監聽、連線與錯誤 |
| 115 | Python | 這是 Python 角色，優先關注版本、venv、套件管理、程序、port 與日誌 |

這些資訊全部來自使用者選擇與既有 DB 模板，不由模型猜測，也不需要 runtime 探測。

### 2.2 本次不宣稱 AI 已知道的資訊

選取目前的 AI 模板後，AI **不會自然取得**以下真實 runtime 資料：

- CPU core 數與即時使用率
- RAM 配置與使用量
- Disk 容量與使用量
- VM/LXC 類型、PVE node 與 power state
- guest OS 實際版本
- IP、interface、監聽 port 與執行中服務

初始 prompt 不得把模板角色描述成已驗證的真實狀態。若使用者詢問這些資料，AI 應明確
區分「模板宣告」與「實際檢查結果」。測試版不主動預抓；只有使用者任務確實要求時，才
使用現有 PVE read tool 或受控 SSH 取得資料。

若未來需要「一選模板就知道固定 CPU／RAM／Disk」，必須另外定義可驗證的模板規格來源，
例如引用 `VMTemplate` 或在 AI 模板之外建立明確 mapping；本次不新增該資料契約。

## 3. 現況與缺口

目前隔離測試流程為：

```text
單一 template_key + 固定 VMID 102
  -> 查詢一個 ai_pve_templates row
  -> 驗證一個 VMID
  -> compose_system_prompt(template, vmid)
  -> allowed_vmids={vmid}
  -> 共用 pve_log agent loop
```

主要缺口如下：

1. `AIPVETemplateChatRequest` 只接受一個 `template_key` 與一個 `vmid`。
2. 測試頁 VMID 欄位為 readonly，`app.js` request 仍寫死 `vmid: 102`。
3. `compose_system_prompt()` 只能放入一個模板與一個 VMID。
4. `pve_chat()` 的 `template_key` 是單值；三台選不同模板時，SSH read-command policy
   無法判斷某個 VMID 應套用哪個模板規則。
5. pending context 只保存一個 VMID；確認後無法恢復完整三機上下文。
6. 前端只處理一個 pending confirmation token，不能安全同時確認多筆未知命令。

底層已有可重用能力：

- `pve_chat(..., allowed_vmids=set[int])` 可以限制一組 VMID。
- PVE tool 與 `ssh_exec` 都會檢查目標是否在 `allowed_vmids`。
- SSH pending token 已綁定 requester、scope 與 allowed VMID set。
- SSH host、private key 與實際連線資料由後端 Resource 解析，不由瀏覽器傳入。

所以本次不建立第二套 agent，也不建立每台一個獨立對話；只把既有單機模板 orchestration
擴充為同一個三機 scope。

## 4. 測試頁設計

### 4.1 目標輸入

`AI_PVE_template/index.html` 顯示三個固定槽位：

```text
┌ 機器 1 ─────────────────────────┐
│ VMID [ 102 ]  模板 [ N8N       ] │
└──────────────────────────────────┘
┌ 機器 2 ─────────────────────────┐
│ VMID [ 107 ]  模板 [ PostgreSQL] │
└──────────────────────────────────┘
┌ 機器 3 ─────────────────────────┐
│ VMID [ 115 ]  模板 [ Python    ] │
└──────────────────────────────────┘
```

模板清單只載入一次，再提供給三個 select 使用。三台可以選擇相同模板，也可以各自選擇
不同模板。

### 4.2 送出前驗證

- 三個 VMID 都必須存在且為大於零的整數。
- 三個 VMID 不得重複。
- 每台都必須選擇一個已載入模板。
- Access token、API base 與 message 沿用現有檢查。
- 正在送出或等待 SSH 確認時，鎖定 VMID、模板與訊息輸入。
- VMID 或模板變更時清除既有 `state.messages`，避免舊目標的 tool result 混入新對話。

### 4.3 結果顯示

對話仍維持一份整體 AI reply；tool records 依 `args.vmid` 或 `result.vmid` 分組：

```text
VMID 102 / N8N
  - ssh_exec: success

VMID 107 / PostgreSQL
  - ssh_exec: connection failed

VMID 115 / Python
  - ssh_exec: success
```

任何結果無法對應本次三個 VMID 時，不顯示成正常目標結果，並標記為 scope error。

## 5. API 資料契約

### 5.1 Request

將單一 `template_key`／`vmid` 改為聚焦的 `targets`：

```json
{
  "targets": [
    { "vmid": 102, "template_key": "n8n" },
    { "vmid": 107, "template_key": "postgresql" },
    { "vmid": 115, "template_key": "python" }
  ],
  "message": "確認三台機器的服務是否正常",
  "messages": null
}
```

新增 schema：

```python
class AIPVETemplateTarget(BaseModel):
    vmid: int = Field(ge=1)
    template_key: str = Field(min_length=1, max_length=50)


class AIPVETemplateChatRequest(BaseModel):
    targets: list[AIPVETemplateTarget] = Field(min_length=1, max_length=3)
    message: str | None = Field(default=None, min_length=1, max_length=2000)
    messages: list[dict[str, Any]] | None = Field(default=None, max_length=40)
```

API 允許一至三台，隔離測試頁則要求三個槽位全部填寫。這樣可保留 focused 單機測試，
也不需要同時保留頂層 `vmid`／`template_key` 相容欄位。

### 5.2 Response

Response 回傳已正規化的目標，讓前端與測試不必從 prompt 推測 scope：

```json
{
  "targets": [
    {
      "vmid": 102,
      "template_key": "n8n",
      "display_name": "N8N"
    },
    {
      "vmid": 107,
      "template_key": "postgresql",
      "display_name": "PostgreSQL"
    },
    {
      "vmid": 115,
      "template_key": "python",
      "display_name": "Python"
    }
  ],
  "reply": "",
  "tools_called": [],
  "needs_confirmation": false,
  "messages": [],
  "error": null,
  "confirmation_result": null
}
```

不新增重複的 `machine_results` JSON。工具結果本身已有 VMID，前端可依 VMID 分組；AI
文字則負責整體比較與說明。

## 6. 模板上下文組合

### 6.1 後端查詢與授權順序

```text
驗證 targets 數量及 VMID 唯一性
  -> 一次查詢三個 template_key
  -> 確認每個模板存在且 enabled
  -> 查詢並授權三個 Resource VMID
  -> 所有目標都通過後才組合 prompt
  -> allowed_vmids={102, 107, 115}
  -> 呼叫一次 pve_chat
```

模板或 VMID 只要有一項不存在／未授權，整個 request fail closed；不得帶著部分目標呼叫
LLM、PVE 或 SSH，避免模型在不完整或越權 scope 下工作。

### 6.2 Prompt 格式

`compose_system_prompt()` 改接收完整 target context：

```text
本次唯一允許的目標共有 3 台：

[目標 1]
VMID：102
機器模板：N8N（n8n）
模板描述：N8N 自動化工作流程機器的診斷與受控操作。
模板角色提示：...

[目標 2]
VMID：107
機器模板：PostgreSQL（postgresql）
模板描述：PostgreSQL 資料庫機器的唯讀健康檢查與受控診斷。
模板角色提示：...

[目標 3]
VMID：115
機器模板：Python（python）
模板描述：Python 應用機器的執行環境與服務診斷。
模板角色提示：...
```

固定規則補充：

- 不得把某台的模板、檢查結果或指令套到另一個 VMID。
- 回覆與工具結論必須標明 VMID。
- 模板是使用者選取的測試上下文，不代表已驗證實際安裝內容。
- 初始上下文不需要呼叫 PVE 或 SSH 來再次辨識模板。
- 使用者要求 guest 資料時，才依各台模板角色呼叫受控 SSH。
- 任一台失敗時保留另外兩台結果，最後明確回報 partial failure。
- DB `system_prompt` 仍只描述角色，不能覆蓋 code-owned safety、scope 或 command policy。

### 6.3 不新增規格抓取工具

本次明確不做：

- 不新增 `get_target_details()`。
- 不在 request 開始時呼叫 `collect_snapshot()`。
- 不用 SSH 自動執行 `lscpu`、`free`、`df` 或 OS 探測來建立初始 context。
- 不把 PVE raw config 塞入 system prompt。
- 不修改 `ai_pve_templates` schema 來保存 CPU／RAM／Disk。

若任務只是「比較三台選取的模板角色」，focused test 應證明 PVE collector 與 SSH executor
完全沒有被呼叫。

## 7. 三機 SSH 控制

### 7.1 每台使用自己的模板 policy

現有 `pve_chat()` 只有單一 `template_key`。改為傳入：

```python
template_keys_by_vmid = {
    102: "n8n",
    107: "postgresql",
    115: "python",
}
```

處理 `ssh_exec` tool call 時，先驗證 `vmid in allowed_vmids`，再以該 VMID 對應的
`template_key` 呼叫 `is_known_read_command()`。這可避免：

- 將 N8N 唯讀規則套用到 PostgreSQL VM。
- 模型透過改寫 VMID 取得另一個模板的 auto-run 權限。
- 三台共用第一台模板造成錯誤確認判斷。

### 7.2 並行定義

測試版的「同時測試三台」定義為：

- AI 可以在同一 tool round 對三個已授權 VMID 提出獨立 SSH 檢查。
- 已知唯讀命令最多三台 bounded concurrency 執行。
- 後端保留 tool call 原順序，再把三台結果一起交回 AI。
- 單台連線失敗不取消另外兩台；AI 最終回覆標為部分完成。

這個並行只適用於已知唯讀檢查。不能為了並行放寬 confirmation 或 hard-deny。

### 7.3 未知或可能修改環境的命令

目前前端只安全處理一個 confirmation token，因此同一輪最多建立一筆 pending SSH：

1. 第一筆需確認命令建立 token 並暫停。
2. 其他需確認命令回傳 deferred，不建立額外 token。
3. 使用者允許或拒絕後，AI 從原 messages 恢復。
4. 若仍需操作另一台，由 AI 再提出下一筆確認。

不得以「一次同意三台」的方式擴張授權，也不得讓一個 token 任意修改三台 command。

## 8. Pending context 與確認恢復

現有 pending context 的單一 `vmid` 改為完整 target snapshot：

```python
@dataclass(slots=True)
class _PendingContext:
    created_at: float
    scope_id: uuid.UUID
    targets: tuple[ResolvedTemplateTarget, ...]
    allowed_vmids: frozenset[int]
    template_keys_by_vmid: dict[int, str]
    messages: list[dict[str, Any]]
```

確認時必須重新驗證：

- token requester 與目前使用者一致。
- token scope 與 pending context 一致。
- token 保存的 allowed VMID set 與 context 完全相同。
- pending command 的 VMID 仍在 allowed set。
- 三個 Resource 仍存在且目前使用者仍有權限。
- 三個模板仍存在且 enabled。
- 五分鐘 TTL、一次性 token、hard-deny、timeout、redaction 與輸出上限維持不變。

確認後重新組合三機 system prompt，不信任 history 中舊的 system message。

## 9. 實作檔案

### 9.1 Backend

| 檔案 | 修改 |
| --- | --- |
| `backend/app/ai/pve_template/schemas.py` | 新增 target request/read schema；request/response 改為 targets |
| `backend/app/ai/pve_template/repository.py` | 沿用既有 enabled template 查詢；本次不新增規格資料來源 |
| `backend/app/ai/pve_template/service.py` | 正規化三個目標、整批授權、建立 scope、保存三機 pending context |
| `backend/app/ai/pve_template/prompts.py` | 組合三個 VMID 與三個 DB 模板角色，不抓 runtime 規格 |
| `backend/app/ai/pve_log/chat.py` | 支援 `template_keys_by_vmid`、三台唯讀 SSH 並行與單一 pending |
| `backend/tests/test_ai_pve_template.py` | 三機 contract、prompt、scope、SSH、confirmation 與 partial failure 回歸 |

本次不修改 `backend/app/ai/pve_log/collector.py`，因為模板上下文不新增 PVE 規格抓取。

### 9.2 隔離測試頁

| 檔案 | 修改 |
| --- | --- |
| `AI_PVE_template/index.html` | 三組 VMID／模板欄位與分機結果區 |
| `AI_PVE_template/app.js` | 三機 payload、輸入鎖定、history reset、結果分組 |
| `AI_PVE_template/ui.js` | targets 驗證、VMID 分組、confirmation 顯示 helper |
| `AI_PVE_template/README.md` | 三機操作方式、模板上下文與非真實規格邊界 |
| `frontend/src/services/aiPveTemplateUi.test.js` | 三機 UI contract 與 token redaction 測試 |

本次不接入 `frontend/src/pages/system/ai-pve/AiPvePage.jsx`；正式頁仍是獨立管理員 AI PVE
維運入口。

## 10. 分階段實作

### Phase 1：三機 request 與模板 context

1. 建立 `targets` schema 與 VMID 唯一性 validator。
2. 批次讀取三個 enabled templates。
3. 所有 VMID 完成 Resource authorization 後才呼叫 AI。
4. 產生三機 prompt 與 `template_keys_by_vmid`。
5. Response 回傳 resolved targets。

完成條件：只問模板角色時，AI 能逐台說明三個 VMID，且測試證明沒有呼叫 PVE／SSH。

### Phase 2：SSH scope 與 template policy

1. `_execute_ssh_tool()` 依 VMID 取得對應 template key。
2. known read-only SSH 可對三台 bounded concurrency 執行。
3. 未授權或不存在的 VMID 在 SSH transport 前被拒絕。
4. 單台失敗保留其他機器結果。

完成條件：三台可使用不同模板 policy，沒有 cross-template auto-run。

### Phase 3：單一 confirmation 與對話恢復

1. pending context 保存完整三機 scope。
2. 同輪只允許一個 pending token。
3. 確認前重新驗證三機 scope 與 requester。
4. 接續 AI 時重新注入三機 prompt。

完成條件：允許、拒絕、過期、冒用與 scope 變更都有 fail-closed 測試。

### Phase 4：測試頁與文件

1. 加入三個 VMID input 和三個 template select。
2. 加入 duplicate、空值及未載入模板錯誤。
3. 依 VMID 顯示 tool result 與 confirmation。
4. 更新 README 的測試流程與限制。

完成條件：使用者可只靠測試頁完成三機模板對話與受控 SSH 流程。

## 11. 測試矩陣

### 11.1 Backend focused tests

| 情境 | 預期 |
| --- | --- |
| 三個不同 VMID、三個不同模板 | prompt 正確包含三段 VMID／模板 mapping |
| 三個 VMID 使用相同模板 | 合法，各台仍有獨立 target |
| VMID 重複 | 422，未呼叫 service runtime |
| target 超過三台 | 422 |
| 任一模板不存在或 disabled | 整筆失敗，未呼叫 LLM |
| 任一 VMID 不存在或未授權 | 整筆失敗，未呼叫 LLM/PVE/SSH |
| 只詢問模板角色 | LLM 收到模板 context；PVE collector 與 SSH 均未被呼叫 |
| N8N command 指向 N8N VM | 套用 N8N read policy |
| 相同 command 指向 Python VM | 不得誤用 N8N policy |
| 三台 known read SSH | 最多三台並行，結果順序穩定 |
| 一台 SSH 失敗 | 另外兩台完成，AI 回報 partial failure |
| 同輪多筆 unknown command | 只有第一筆產生 pending token，其餘 deferred |
| confirm requester 不同 | token 不消耗，拒絕執行 |
| confirm allowed set 不同 | token 不消耗，拒絕執行 |
| confirm 後模板停用或 VM 權限消失 | 拒絕恢復與執行 |
| SSH 輸出包含 secret／過長 | 保持 redaction 與 truncation |

### 11.2 Frontend focused tests

- 三個 VMID 與三個模板可建立正確 `targets` payload。
- 空值、非整數、零、負數與 duplicate VMID 不可送出。
- 切換任一 VMID／模板會清除舊 history。
- pending 時所有 target 欄位鎖定。
- confirmation 顯示正確 VMID、reason 與 command。
- confirmation token 不出現在可見 tool transcript。
- tool results 依 VMID 分組且 HTML escaping 保持有效。

### 11.3 建議指令

```powershell
# backend/
uv run python -m pytest tests/test_ai_pve_template.py -q
uv run ruff check app/ai/pve_template app/ai/pve_log/chat.py tests/test_ai_pve_template.py

# repository root
npm --prefix frontend test -- --run src/services/aiPveTemplateUi.test.js
node --check AI_PVE_template/app.js
node --check AI_PVE_template/ui.js
npm --prefix frontend run build
git diff --check
```

### 11.4 三台實機驗收

實作完成後，再以三個已登記、有權限且設定 SSH key 的測試 VMID 驗收：

1. 選取三個不同模板，只詢問角色，確認沒有 runtime probe。
2. 要求取得三台 guest 內版本／服務資料，確認每台只執行對應 VMID 的指令。
3. 讓一台 SSH 無法連線，確認另外兩台仍完成。
4. 提出未知命令，確認一次只出現一個確認項目。
5. 改用未授權 VMID，確認 LLM、PVE 與 SSH 都未啟動。

自動化 focused tests、frontend build 與靜態頁檢查不能取代這組真實 SSH E2E；完成回報
必須分開列出。

## 12. 驗收標準

- 測試頁提供三個可輸入 VMID 欄位及三個模板選單。
- 每個 VMID 與模板一對一對應，後端不依位置外的資訊猜測。
- AI 第一次推理前已收到三個模板角色，不需額外抓取 PVE 或 SSH 規格。
- AI 不把模板宣告說成已驗證的 CPU、RAM、Disk、OS 或服務狀態。
- 三台 VMID 全部完成後端授權才進入 LLM。
- SSH 只能對本次 allowed VMID set 執行，host/key 不由 client 提供。
- 每台 SSH auto-run policy 使用該台選取的模板 key。
- 三台已知唯讀檢查可以並行；單台失敗不遮蔽其他結果。
- 未知或可能修改的命令維持逐筆人工確認。
- hard-deny、requester/scope binding、TTL、timeout、redaction 與輸出上限不退化。
- 不新增 PVE 規格抓取工具、不修改 collector、不新增 migration。

## 13. 後續但不屬於本次

若測試確認三機對話與 SSH scope 可行，再依真實需求選擇是否增加：

1. AI 模板與 `VMTemplate`／多機環境節點的正式 mapping。
2. CPU、RAM、Disk 等宣告規格的穩定 schema。
3. PVE runtime 與模板宣告差異檢查。
4. 自動辨識 guest OS、服務與 capability。
5. 正式 `/ai-pve` 或 Teaching Class 工作區整合。

上述項目不預先放入本次測試版，避免把三機模板驗證擴張成完整的多機資產管理功能。
