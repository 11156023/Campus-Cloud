# 班級管理整合群組 AI 實作檢查與修正建議

- 日期：2026-07-30
- 對象：`2026-07-30-class-management-group-ai-integration-plan.md` 的目前實作
- 狀態：Review 完成，待修正
- 目標：先建立穩定、可擴充的基本架構，再新增其他 scope 或 AI 能力

## 1. 結論

目前功能主幹已接通：

- 班級學生機器可合併 DB mapping 與 PVE snapshot。
- 班級已有 AI PVE chat／SSH confirm routes。
- Teacher Judge 已加入 teaching-class scope、migration 與班級 routes。
- 前端已有學生機器畫面與 AI 四頁籤。
- 群組與班級共用主要 Teacher Judge、AI PVE service。

但目前較適合視為「功能原型完成」，尚未形成適合後續擴充的穩定基座。

最需要先固定的三個邊界：

1. 統一的 scope value object 與對外 response contract。
2. 統一的班級授權與 machine scope resolver。
3. 真正 scope-neutral 的前端 workspace。

本次 review 沒有確認到可直接越權操作其他班級 VM 的漏洞，但有一項既有群組 SSH confirm 相容性回歸，以及數項執行時 scope/invariant 防線不足。

## 2. 必須優先修正

### 2.1 群組 SSH confirm 舊 request contract 已被破壞

目前 AI chat 建立的確認 token 會綁定：

- requester user id
- scope type
- scope id
- allowed VMID set

但舊客戶端的 confirm request 只會傳：

```json
{
  "token": "...",
  "approved": true,
  "command": "..."
}
```

如果 request 沒有新增的 `group_id`，群組 route 會使用空 scope 呼叫 `confirm_exec()`。新 token 內已有 group scope metadata，因此比對失敗，舊客戶端無法完成確認。

相關位置：

```text
backend/app/api/routes/ai_pve_log.py
backend/app/ai/pve_log/ssh_exec.py
backend/app/ai/pve_log/schemas.py
frontend/src/services/aiPveLog.js
```

這違反「既有群組 request contract 保持不變」。

建議修正：

- pending token store 提供 server-side `peek_scope(token)`。
- route 從 token 解析 scope，而不是要求舊客戶端新增 `group_id`。
- route 依 token 的 group id 重新驗證目前使用者權限與 VMID set。
- request 中可接受 `group_id` 作為額外防線，但不得改成必要欄位。
- 補一個「舊 confirm body＋新 scoped token」回歸測試。

### 2.2 Executor 沒有驗證 run 與 artifact scope 一致

`_load_run_and_artifact()` 目前只根據 `run.artifact_id` 載入 artifact，沒有驗證：

```text
run.group_id == artifact.group_id
run.class_id == artifact.class_id
```

相關位置：

```text
backend/app/ai/teacher_judge/script_executor_service.py
```

一般 API 建立的資料會一致，但資料修復、舊程式、測試 fixture 或未來新增入口仍可能建立錯誤關聯。Executor 是最後執行邊界，必須 fail closed，不能只依賴 route 正確。

建議修正：

- `_load_run_and_artifact()` 驗證 run 與 artifact scope 完全相同。
- 不一致時將 run 標記為 failed。
- 使用穩定 reason code，例如 `scope_mismatch`。
- 加入 group/class 交叉 artifact regression test。

### 2.3 執行前沒有重新確認 VM 仍屬於班級

建立 run 時會驗證 enrollment、mapping 與 Resource owner，但背景 executor 真正執行前只重新驗證：

- Resource owner 與 target snapshot user 相同。
- VM/LXC 仍在 running。
- resource type 合法。
- 仍有 IP 與 SSH key。

如果 run 排隊後學生被移除、停用或 mapping 改變，executor 仍可能對 snapshot 中的 VM 執行腳本。

建議修正：

- 建立共用 `TeachingClassMachineScopeResolver`。
- 建立 run 時解析一次合法目標。
- executor 執行前用同一 resolver 重新驗證 enrollment、mapping、owner 與 VMID。
- class scope 不再只相信 target snapshot。

## 3. 後端架構缺口

### 3.1 班級授權規則散落且不一致

目前班級授權判斷分散在：

```text
backend/app/api/routes/teaching_classes.py::_get_class
backend/app/api/routes/teaching_class_ai.py::_resolve_class_vmids
backend/app/api/routes/teaching_class_judge_files.py::_ensure_access
backend/app/api/routes/teaching_class_judge_scripts.py::_ensure_access
```

部分使用 `require_group_access()`，部分直接檢查：

```python
current_user.is_superuser
current_user.role == "admin"
```

未來新增角色或 permission 時容易出現路由間行為漂移。

建議新增共用入口：

```python
def get_authorized_teaching_class(
    *,
    session: Session,
    current_user: User,
    class_id: UUID,
) -> TeachingClass:
    ...
```

所有 class route 使用同一 authorizer，不再自行判斷 role。

### 3.2 AI PVE 與 Teacher Judge 使用不同 VMID resolver

AI PVE resolver 目前只確認：

- enrollment 屬於 class。
- mapping 有 VMID。

尚未確認：

- enrollment `status == "active"`。
- mapping provisioning 狀態。
- Resource owner 是否仍為該學生。
- machine node 是否屬於同一 class。

Teacher Judge target resolver 則有另一套較嚴格的驗證。兩套規則長期會漂移。

建議建立：

```text
backend/app/services/teaching_class_machine_scope.py
```

核心回傳穩定資料：

```python
TeachingClassMachineTarget(
    mapping_id,
    class_student_id,
    machine_node_id,
    user_id,
    vmid,
    resource_type,
    provision_status,
)
```

不同能力再疊加條件：

| 能力 | 額外條件 |
| --- | --- |
| 學生機器監控 | VMID 可為空，PVE 可離線 |
| AI PVE | 必須有合法 VMID |
| Teacher Judge execution | running、IP、SSH key |
| SSH confirm | token scope 與最新 VMID scope 相同 |

### 3.3 Teacher Judge route orchestration 重複

群組與班級 routes 目前分開實作 upload、analysis、script、approve、run 等流程。核心 service 已共用，但 route orchestration 與錯誤處理仍會漂移。

不建議建立大型 route factory。較短的做法是抽出 application-level handler：

```text
teacher_judge/file_workflow.py
teacher_judge/script_workflow.py
```

route 只負責：

1. 解析 path scope。
2. 驗證 scope access。
3. 呼叫 workflow。
4. 回傳 scope-specific response。

### 3.4 對外群組 response contract 已改變

原本群組 Teacher Judge response 中：

```python
group_id: str
```

現在共用 schema 改成：

```python
group_id: str | None
class_id: str | None
```

即使實際 group response 仍會回傳非空 `group_id`，OpenAPI 與 generated client 型別已經改變，嚴格來說不是「群組 response contract 不變」。

建議：

- 內部使用統一 `JudgeScope`。
- 對外分成 `GroupTeacherJudge*Public` 與 `ClassTeacherJudge*Public`。
- group route 繼續使用原本必填 `group_id` schema。
- class route 使用必填 `class_id` schema。
- 不讓內部 nullable ORM 設計直接洩漏到 public API contract。

### 3.5 run 與 artifact 缺少跨資料表 scope invariant

目前每張表各自保證：

```text
只能有 group_id 或 class_id 其中一個
```

但 DB 沒有保證 run 與 artifact 屬於相同 scope。

跨資料表 constraint 不容易用一般 FK 表達，因此至少需要：

- create service 驗證。
- executor 再驗證一次。
- 測試直接建立不一致 row，確認 executor fail closed。

### 3.6 學生機器 service 有 DB N+1 查詢

目前每個 mapping 可能執行：

- `get_resource_by_vmid()`
- `get_cached_ip_address()`
- cached IP fallback 再查一次 Resource

PVE snapshot 雖然只有一次，但 DB query 數量會隨機器數線性增加。

建議批次載入：

```text
resources WHERE vmid IN (...)
resource_networks WHERE resource_vmid IN (...)
```

再以 dict 合併。

## 4. 前端架構缺口

### 4.1 Workspace 尚未真正 scope-neutral

班級頁目前直接 import：

```text
frontend/src/pages/system/groups/AiJudgePanel.jsx
frontend/src/pages/system/groups/AiPvePanel.jsx
```

`AiJudgePanel.jsx` 仍約 1600 行，內部參數與文案仍使用：

```text
groupId
群組內
此群組
管理群組評分表
```

這表示班級只是重用群組頁元件，尚未形成真正的共用 feature。

建議目標：

```text
frontend/src/features/teacher-judge/
  TeacherJudgeWorkspace.jsx
  scopeAdapter.js
  components/

frontend/src/features/ai-pve/
  AiPveWorkspace.jsx
  scopeAdapter.js
```

入口：

```jsx
<TeacherJudgeWorkspace
  scope={{ type: "group", id: groupId }}
  targets={members}
/>

<TeacherJudgeWorkspace
  scope={{ type: "teaching-class", id: classId }}
  targets={machines}
/>
```

workspace 內不應再使用 `groupId` 命名或群組專屬文案。

### 4.2 應建立共用 machine data hook

進入學生機器頁時：

- `ClassWorkspacePage` fetch 一次 machine status。
- `ClassStudentMachinesPanel` 再 fetch 一次。

初次載入會產生兩次 PVE snapshot request。

建議建立：

```text
frontend/src/features/teaching-class-machines/useTeachingClassMachines.js
```

統一管理：

```js
{
  data,
  loading,
  error,
  refresh,
}
```

學生機器與 AI 檢查共用同一份資料。

### 4.3 切換班級時可能暫時顯示上一班資料

`classId` 改變後會重新 fetch，但目前沒有先清空 `machineData`。新資料回來前，AI 執行頁可能短暫顯示上一班的 VM 選項。

後端仍會拒絕錯誤 VMID，因此不是直接越權，但屬於資料洩漏與錯誤 UX。

建議：

- `classId` 改變時先 reset data。
- fetch 完成前顯示 loading。
- classId 與 response class_id 不同時丟棄 response。

### 4.4 學生機器摘要 CSS class 不存在

`ClassStudentMachinesPanel.jsx` 使用：

```js
styles.statsGrid
styles.statCard
```

但 `CourseOperations.module.scss` 沒有這兩個 class。Vite build 不會因此失敗，但畫面沒有預期摘要排版。

需要補上對應樣式或改用既有 summary 元件。

### 4.5 班級頁仍顯示群組專屬文案

目前共用 Judge UI 仍包含：

```text
管理群組內由評分表產生的受管 Python 收集腳本
選擇群組內運行中的 VM/LXC
確認這些 VM/LXC 仍屬於此群組
管理群組評分表、收集腳本與腳本執行
```

應改由 workspace 根據 scope 顯示：

```text
群組
班級
```

或使用不依賴 scope 的中性文案。

## 5. 資料契約問題

### 5.1 學生機器 summary 混合兩種狀態維度

目前 summary 同時包含：

```json
{
  "running": 0,
  "stopped": 0,
  "provisioning": 0,
  "failed": 0,
  "unknown": 0
}
```

但 provisioning／failed 是配置狀態，running／stopped／unknown 是 runtime 狀態。

一台配置失敗且沒有 PVE snapshot 的機器會同時增加：

```text
failed
unknown
```

因此這些欄位不是互斥分類，UI 卻把它們顯示成同一組摘要。

建議改成：

```json
{
  "students": 10,
  "machines": 20,
  "provision": {
    "ready": 16,
    "provisioning": 2,
    "failed": 2
  },
  "runtime": {
    "running": 12,
    "stopped": 4,
    "unknown": 4
  }
}
```

這能讓未來加入 `paused`、`migrating` 或其他 runtime 狀態時不必破壞 provision 契約。

### 5.2 Scope 應成為明確內部 contract

目前 service 大量接受：

```python
group_id: UUID | None = None
class_id: UUID | None = None
```

再於 runtime 檢查只能有一個。這容易讓未來呼叫端漏傳或同時傳入。

建議 service 直接接受：

```python
scope: JudgeScope
```

只有 route adapter 負責從 path 建立 scope。

保留明確且小型的 value object 即可，不需要建立 scope framework 或 registry。

## 6. Migration 問題

### 6.1 Downgrade 在存在 class rows 時不可安全執行

目前 downgrade 會：

1. 刪除 `class_id`。
2. 把 `group_id` 改回 non-null。

只要存在 class-scope Teacher Judge rows，downgrade 就無法安全完成。

建議二選一：

- 將 migration 標示為 forward-only，downgrade 主動檢查 class rows 並拒絕。
- 若確實需要 downgrade，先要求明確資料轉換策略；不可自動刪除或轉成 group。

目前不應宣稱支援安全 round trip。

### 6.2 尚未完成隔離 DB migration 驗證

目前只確認：

- Alembic 是單一 `tjcs01` head。
- model metadata 可在測試 SQLite 建表。

尚未確認：

- 含既有 group Teacher Judge rows 的 PostgreSQL upgrade。
- class scope exactly-one constraint。
- class active filename partial unique index。
- migration 後舊 group routes。
- clean PostgreSQL upgrade。

全鏈 offline SQL 目前被既有 `7b4a08d7cf39` migration 的 connection inspection 阻擋，這不是 `tjcs01` 自身錯誤，但仍表示 migration 尚未完整驗證。

## 7. 測試缺口

目前新增測試主要只有：

- 學生多機器與單次 PVE snapshot。
- PVE snapshot 失敗降級。
- class file 無法由 group scope 讀取。

仍需補齊：

### 7.1 Authorization

- class owner 可以讀取。
- admin／具 bypass permission 使用者可以讀取。
- 非 owner 無法讀取學生機器、AI PVE、Teacher Judge。
- 各 class route 使用相同 permission contract。

### 7.2 SSH scope

- token 不可跨 user。
- token 不可跨 class。
- token 不可跨 group/class。
- token 中 VMID set 與最新 scope 不同時拒絕。
- 舊群組 confirm request body 仍可使用。

### 7.3 Teacher Judge scope

- class file/artifact/run 不可由 group route 讀取。
- group file/artifact/run 不可由 class route 讀取。
- run 與 artifact scope mismatch 時 executor fail closed。
- class active filename uniqueness 不影響另一個 class。

### 7.4 Class target resolver

- inactive enrollment。
- mapping 不屬於 class node。
- Resource owner mismatch。
- VM 不在 running。
- 缺少 IP。
- 缺少 SSH key。
- 同一學生多台 VM 可獨立選擇。
- 超過 5 台被拒絕。

### 7.5 Frontend

- group/class scope 使用正確 API base。
- 四個 AI 子頁籤。
- classId 改變時清除舊 machine data。
- provisioning／partial_failed 可以進入學生機器。
- classroom 仍為 active-only。
- 多機器使用 mapping id／VMID 作為 identity。
- 群組 workspace 行為與文案沒有回歸。

## 8. 建議修正順序

### 階段 A：先關閉安全與相容性缺口

1. 修復舊群組 SSH confirm contract。
2. Executor 驗證 run/artifact scope。
3. Executor 執行前重新驗證班級 mapping。
4. 補跨 user、跨 class、跨 scope tests。

### 階段 B：固定後端擴充邊界

1. 建立統一 class authorizer。
2. 建立 `TeachingClassMachineScopeResolver`。
3. Service 改為接收 `JudgeScope`。
4. 分離 group/class public response schema。
5. 移除重複 class route authorization helper。

### 階段 C：完成前端 workspace 抽離

1. 將 Teacher Judge 移到 `features/teacher-judge/`。
2. 將 AI PVE 移到 `features/ai-pve/`。
3. 改成 scope-neutral props 與文案。
4. 建立共用 class machine hook。
5. 修正重複 fetch、stale data 與 summary CSS。

### 階段 D：收斂契約與效能

1. 拆分 provision/runtime summary。
2. 批量載入 Resource／ResourceNetwork。
3. 補 OpenAPI contract tests。
4. 移除抽取後留下的舊 wrapper、unused props 與群組專屬命名。

### 階段 E：Migration 與 live runtime 驗收

1. 確認隔離 PostgreSQL target。
2. 備份或建立 disposable DB。
3. 驗證既有 group rows upgrade。
4. 驗證 exactly-one constraint 與 indexes。
5. 執行 group/class API regression。
6. 連線 live PVE、SSH、vLLM 完成手動驗收。

## 9. 驗收標準

完成本修正計畫後應符合：

- 舊群組 API request/response contract 保持不變。
- 所有 class route 使用同一授權入口。
- AI PVE、Teacher Judge 與 executor 使用同一班級 machine scope resolver。
- Executor 不相信過期 snapshot，執行前重新驗證 scope。
- Teacher Judge service 只接受明確 `JudgeScope`。
- 前端 workspace 不再位於 group page 目錄，也不使用 group-specific 命名。
- provision 與 runtime summary 是兩個清楚維度。
- 學生機器頁不重複抓取 PVE snapshot，且沒有 per-machine DB N+1。
- migration 在隔離 PostgreSQL 有可重現的 upgrade 驗證結果。
- authorization、scope isolation、frontend adapter 與 group regression tests 完整通過。

## 10. 本輪不建議增加

為維持最短可行路徑，本輪不需要：

- 通用 scope plugin framework。
- 動態 scope registry。
- 新的 execution profile 資料模型。
- 長期監控資料表或歷史曲線。
- 排程式 Teacher Judge。
- 額外 run mode 或 CLI 參數。
- 將 Group 轉換或同步成 Teaching Class。

本輪只需把現有 group／teaching-class 兩種真實需求的共同邊界固定好，之後新增功能再沿同一契約擴充。
