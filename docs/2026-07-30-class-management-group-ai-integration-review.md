# 班級管理整合群組 AI：實作複查與修正結果

- 日期：2026-07-30
- 對象：`2026-07-30-class-management-group-ai-integration-plan.md`
- 狀態：班級管理主線缺口已修正；待隔離 PostgreSQL 與 live runtime 驗收
- 正式產品邊界：Teaching Class
- 暫時保留邊界：Group

## 1. 最終判斷

群組功能目前只作為既有功能的暫時保存，不再作為新架構的對稱主體。本輪採用以下
收斂原則：

1. 班級管理是授權、學生名單、machine node、學生機器 mapping 與 AI 操作範圍的
   source of truth。
2. 群組路由與資料暫不刪除，也不做資料轉換；只修復會讓既有流程直接失效的相容性
   問題。
3. 不為群組與班級建立雙套 public schema、通用 scope framework 或大型 route
   factory。
4. 共用只發生在已有明確重疊的執行核心；班級的授權與機器解析維持單一正式入口。

複查後確認，原 review 中下列問題是真實 runtime 問題，已完成修正：

| 問題 | 根因 | 修正結果 |
| --- | --- | --- |
| 班級授權規則分散 | AI PVE、Judge file、Judge script 各自判斷 owner/admin | 全部改用 `get_authorized_teaching_class()` |
| AI PVE 與 Judge 的 VMID 集合不同 | 兩條路徑各查自己的 enrollment/mapping | 改用同一 `resolve_teaching_class_machine_targets()` |
| Executor 信任過期 target snapshot | 執行前只重查 Resource owner 與 PVE 狀態 | class run 執行前重新驗證 enrollment、mapping、node、owner 與 VMID |
| Run 可指向不同 scope artifact | executor 只依 `artifact_id` 載入 | scope 不一致時 fail closed，reason code 為 `scope_mismatch` |
| 學生機器 DB N+1 | 每個 mapping 個別查 Resource 與 IP | Resource／ResourceNetwork 改為 VMID 批次載入 |
| 摘要混合配置與 runtime 狀態 | `failed` 與 `unknown` 被放在同一平面 | 拆為 `summary.provision` 與 `summary.runtime` |
| 前端重複抓 PVE snapshot | workspace 與 panel 各 fetch 一次 | 統一由 `useTeachingClassMachines()` 管理 |
| 切換班級暫留舊資料 | `classId` 改變時未 reset | 先清空資料，並丟棄 class id 不符或過期的 response |
| 摘要 CSS 缺失 | `statsGrid`／`statCard` 未定義 | 已補齊對應樣式 |
| 班級畫面顯示群組文案 | 共用 Judge UI 寫死群組描述 | 改為目前範圍的中性文案 |
| 舊群組 SSH confirm body 失效 | 新 token 有 scope，但舊 body 沒有 `group_id` | route 由 token peek group scope，再做最新權限與 VMID 驗證 |

## 2. 正式後端邊界

### 2.1 班級授權

正式入口：

```text
backend/app/services/teaching_class_access.py
  -> get_authorized_teaching_class()
```

它負責：

- Teaching Class 是否存在。
- 目前使用者是否為 owner，或具有既有 group ownership bypass permission。

下列 routes 已使用同一入口：

```text
backend/app/api/routes/teaching_classes.py
backend/app/api/routes/teaching_class_ai.py
backend/app/api/routes/teaching_class_judge_files.py
backend/app/api/routes/teaching_class_judge_scripts.py
```

目前仍沿用既有 `GROUP_OWNERSHIP_BYPASS` permission，因專案尚無獨立 Teaching Class
permission。這是刻意沿用現有權限契約，不在本輪新增角色或 permission schema。

### 2.2 班級 machine scope

正式入口：

```text
backend/app/services/teaching_class_machine_scope.py
  -> resolve_teaching_class_machine_targets()
```

只有同時符合下列條件的 mapping 才能進入 AI PVE 或 Teacher Judge execution：

- enrollment 仍屬於指定 class 且 `status == "active"`。
- machine node 仍屬於指定 class。
- mapping 已有 VMID，且 provision status 為 `completed` 或 `ready`。
- DB `Resource` 存在。
- `Resource.user_id` 仍等於 enrollment student user id。
- 同一班級沒有重複且語意不明的 VMID mapping。

回傳的穩定 target 包含：

```text
mapping_id
class_student_id
machine_node_id
user_id
vmid
resource_type
provision_status
has_ssh_key
```

AI PVE 以此集合建立 `allowed_vmids`。Teacher Judge 建立 run 時用相同集合解析 target；
executor 執行前再解析一次，不只相信建立 run 時的 snapshot。

### 2.3 Executor fail-closed

Executor 現在有兩層 scope 防線：

1. `run.group_id/class_id` 必須與 artifact 完全相同；否則整個 run 失敗，保存
   `reason_code=scope_mismatch`。
2. class target 的 `mapping_id`、`machine_node_id`、`user_id` 與 VMID 必須仍能由最新
   class scope resolver 解析；否則該 target 以 `class_scope_changed` 失敗。

通過 scope 檢查後，仍會繼續驗證：

- DB Resource owner。
- PVE resource type 與 running 狀態。
- IP。
- SSH key。

因此「建立 run 時合法」與「真正執行時仍合法」已分成兩個明確階段。

## 3. 班級學生機器契約

`GET /api/v1/teaching-classes/{class_id}/student-machines` 的 summary 現在分開表達兩種
互不排斥的狀態維度：

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

每次 request：

- Teaching Class students、nodes、mappings、users 各自批次載入。
- Resource 與 ResourceNetwork 依全部 VMID 各批次載入一次。
- PVE `list_all_resources()` 只呼叫一次。
- PVE 失敗時仍回傳 DB 配置，runtime 為 `unknown`。

這個 API 是班級管理的新契約，不需要為暫存群組保留舊版扁平 summary。

## 4. 前端資料流

正式資料流：

```text
ClassWorkspacePage
  -> useTeachingClassMachines(classId)
     -> TeachingClassesService.studentMachines(classId)
  -> ClassStudentMachinesPanel
  -> ClassAiCheckPanel
```

同一個班級 workspace 只持有一份 machine snapshot：

- 「學生機器」與「AI 檢查」共用同一份 data/loading/error/refresh。
- `classId` 或 enabled boundary 改變時先清空。
- 只接受 response `class_id` 等於目前 `classId` 的結果。
- 使用 request sequence 丟棄較舊的非同步回應。

Judge UI 目前仍位於群組頁目錄，這是檔案位置上的技術債，不是 runtime source of
truth。因群組只是暫存功能，本輪沒有投入大型搬檔與 wrapper 架構；班級 route adapter
與資料 scope 已是正式邊界。

## 5. 群組暫存策略

本輪只處理一項會直接破壞現有流程的群組問題：舊 SSH confirm request 沒有
`group_id` 時，route 會先從 pending token 讀取 group scope，再依目前使用者重新驗證
group access 與最新 VMID set。

沒有採用原 review 的下列建議：

- 不建立 `GroupTeacherJudge*Public`／`ClassTeacherJudge*Public` 雙套 schema。
- 不把所有 Teacher Judge service 一次改成只接受 `JudgeScope`。
- 不建立 group/class route factory 或 application workflow framework。
- 不把群組前端重構成與班級完全對稱的 feature workspace。

原因是這些修改主要服務長期群組演進，與目前「班級管理為正式主線、群組暫時保存」
的產品方向不符。現有 nullable group/class schema 與 service 參數仍是技術債，但不阻塞
班級的授權、scope isolation 或 executor 安全。

## 6. 尚未完成與風險

### 6.1 PostgreSQL migration

本輪沒有修改 ORM schema 或 Alembic migration，也沒有對任何 DB 執行 upgrade。
既有 `tjcs01` 仍需在已確認的隔離 PostgreSQL 驗證：

- 含既有 group Teacher Judge rows 的 upgrade。
- clean DB upgrade。
- exactly-one scope constraint。
- class active filename partial unique index。
- 存在 class rows 時 downgrade 的拒絕或明確資料策略。

### 6.2 Live runtime

本機沒有完成下列外部 runtime 驗收：

- live PVE snapshot 與 model readiness。
- 真實 SSH key／IP 執行。
- vLLM Teacher Judge 生成與結果分析。

自動測試證明的是資料契約、scope resolver、executor 防線與前端 build，不代表上述
外部服務已可用。

### 6.3 保留的低優先技術債

- Teacher Judge public response 的 `group_id/class_id` 仍為 nullable 共用 schema。
- Judge routes 仍有 file/script orchestration 重複。
- `AiJudgePanel.jsx` 仍偏大，且檔案位於 group page 目錄。
- Group 與 Teaching Class 仍共用既有 ownership bypass permission。

只有當這些項目開始阻礙班級的新需求時才應處理，不為暫時群組預先擴張架構。

## 7. 驗證結果

本輪實際執行：

```text
Backend focused tests:
89 passed

Backend targeted ruff:
All checks passed

Backend targeted mypy:
Success: no issues found

Frontend:
npm test
69 passed

npm run build
成功
```

另外新增或更新的 regression coverage 包含：

- 班級 machine scope 接受合法 mapping。
- inactive enrollment、failed mapping、Resource owner mismatch 被排除。
- run/artifact scope mismatch 以 `scope_mismatch` fail closed。
- 學生機器多 mapping 與單次 PVE snapshot。
- provision/runtime summary 分離。
- 舊群組 confirm body 可搭配 scoped token。

## 8. 驗收標準

班級管理主線達成以下條件才算完成：

- 所有 class AI routes 使用同一授權入口。
- AI PVE、Teacher Judge run 建立與 executor 使用同一 machine scope resolver。
- 排隊後移除學生、停用 enrollment、改變 mapping/node/owner 時，executor 不會繼續
  對舊 snapshot 執行。
- summary 清楚區分配置與 runtime。
- 學生機器與 AI 檢查不重複抓 snapshot，切班不顯示上一班資料。
- 群組只維持最低相容，不再主導新資料模型或前端架構。
- 隔離 PostgreSQL migration 與 live PVE／SSH／vLLM 驗收另有可重現結果。
