# 多機環境、快速練習與資源管理：最新流程、完成度及最終檢查

> 本文件保留 2026-08-27 的實作狀態與驗證紀錄。現行產品角色、教師發布及學生使用的正式作業規範，請以 [`multi-machine-environment-sop.md`](multi-machine-environment-sop.md) 為準。

> 2026-08-31 更新：學生單機 clone 路徑與 API 已關閉；快速練習已加入整組 IP 預留、發布拓撲套用、Session 狀態協調、部分失敗整組補償，以及到期三十分鐘後自動回收。本文件後續「未完成」敘述是 2026-08-27 的歷史快照，不代表目前程式狀態。

| 項目 | 內容 |
| --- | --- |
| 文件版本 | v1.0 |
| 更新日期 | 2026-08-27（Asia/Taipei） |
| 對應提交 | `4b417539`、`6c9dcd6b` |
| 文件性質 | 實作現況、流程說明、優化分析、部署及驗證紀錄 |
| 本次排除 | 學生課程內容頁、作答流程、Course Room 與 Course CMS |

## 一、結論

快速模板已不再使用舊的「學生複製單台 LXC 並自行填寫規格」流程。目前正式採用「已發布的多機環境版本」作為快速練習來源：教師先定義一至三台固定機器，選擇提供方式並發布；學生啟動時不需人工審核，也不能修改 CPU、RAM、Disk、機器數量或期限，系統會一次建立整組機器。

目前已形成三條清楚分離的流程：

| 流程 | 環境來源 | 審核 | 使用期限 | 學生可改規格 |
| --- | --- | --- | --- | --- |
| 一般／研究機器 | 個別 VMRequest | 依角色與政策審核 | 依核准期間 | 依既有申請流程 |
| 正式課堂機器 | 已發布多機環境版本 | 教師送出班級、管理員審核容量 | 依班級與課表 | 不可 |
| 快速練習 | 已發布且開放快速練習的多機環境版本 | 學生啟動免審核 | 系統練習時數，預設 3 小時 | 不可 |

本次也將「我的資源」及「資源管理」改為真實條列群組：課堂機器與快速練習環境會以一個父層環境顯示，展開後看到各台 VM／LXC，並可依權限使用終端機、控制台、啟動或正常關機。

整體判斷：核心使用流程已可運作，但仍屬第一階段。發布審核、指定班級可見性、整組原子容量／IP 預留、部分失敗補償、到期自動刪除與舊 clone API 治理仍需後續完成，不能宣稱 8/26 設計案已全部落地。

## 二、名詞與目前實際模型

8/26 設計文件使用 `PracticeOffering`、`PracticeBlueprintVersion` 與 `PracticeSession` 描述長期目標。目前第一階段為降低重複模型與改動風險，採用既有課程環境模型加上快速練習 Session：

```text
CourseEnvironment
├─ usage_scope = course | quick_practice | both
└─ CourseEnvironmentVersion（發布後鎖定）
   ├─ CourseEnvironmentNode 1..3
   └─ CourseEnvironmentEdge

QuickPracticeSession
├─ user_id
├─ environment_version_id
├─ created_at
├─ expires_at
└─ QuickPracticeSessionMachine 1..3
   └─ vm_request_id → VMRequest → Resource
```

各模型責任如下：

| 模型 | 現在的責任 |
| --- | --- |
| `VMTemplate` | 單台底層 PVE VM／LXC 母模板及預設規格。 |
| `CourseEnvironment` | 可重複使用的一組多機環境，並決定可供正式課程、快速練習或兩者使用。 |
| `CourseEnvironmentVersion` | 固定某次發布的節點、規格與拓樸版本。 |
| `QuickPracticeSession` | 某位學生啟動一次完整快速練習的父層；次數與同時使用限制均以 Session 計算。 |
| `QuickPracticeSessionMachine` | Session 中的一台固定機器，連結實際的 VMRequest。 |
| `VMRequest` | 每台機器的核准、節點配置、供應與到期關機執行紀錄。 |
| `Resource` | 已建立機器的 PVE 與平台 metadata，提供資源頁操作。 |

這個做法已實現多機 Session 的必要父層，但尚未建立獨立的 Offering、audience、review 或 quota pool 模型。

## 三、最新角色流程

### 3.1 教師／管理者建立多機環境

```text
進入「多機環境模板」
        ↓
填寫環境名稱、代碼及用途
        ↓
選擇提供方式
├─ 只用於正式課程
├─ 只用於快速練習
└─ 正式課程與快速練習
        ↓
加入 1～3 台 VM／LXC
├─ 引用 ready 的 VMTemplate
└─ 使用自訂基礎映像／PVE VMID
        ↓
設定每台固定 CPU、RAM、Disk、角色及拓樸
        ↓
儲存草稿
        ↓
發布並鎖定版本
```

發布後版本不可直接修改，需要建立新版本。`usage_scope` 的 API 值如下：

| 值 | 行為 |
| --- | --- |
| `course` | 只會出現在正式班級環境選擇清單。 |
| `quick_practice` | 只會出現在學生快速練習清單。 |
| `both` | 正式班級與快速練習均可使用。 |

後端除了過濾正式課程清單，也在班級套用 API 再次驗證用途，避免直接呼叫 API 將快速練習專用環境套用到正式班級。

### 3.2 學生啟動快速練習

```text
學生首頁讀取可用快速練習環境
        ↓
選擇一個已發布環境
        ↓
查看固定機器清單、整組資源合計與使用時數
        ↓
按「啟動 N 台機器」
        ↓
後端鎖定該使用者，避免重複點擊或並行請求繞過限制
        ↓
驗證環境用途及發布版本
        ↓
以 Session 維度檢查
├─ 同時最多 1 組
└─ 24 小時內最多 3 組
        ↓
檢查整組 CPU、RAM、Disk、實例數及目前容量
        ↓
建立 1 筆 QuickPracticeSession
        ↓
依節點建立 N 筆自動核准 VMRequest
        ↓
提交背景供應工作
        ↓
導向「我的資源」，以一個環境群組顯示
```

學生送出內容只有環境 ID。以下內容全部由已發布版本及後端政策決定：

- 機器數量。
- VM／LXC 類型。
- CPU、RAM 與 Disk。
- 底層模板或映像。
- 主機名稱與安全密碼。
- 開始時間與到期時間。
- 是否自動核准。

因此學生無法使用前端參數提高規格或延長快速練習期限。

### 3.3 我的資源／資源管理

```text
資源 API 回傳實際 VM／LXC
        +
Quick Practice Session API 回傳環境與機器關係
        ↓
前端以 request_id 合併 Session machine 與實際 Resource
        ↓
依環境顯示父層列
├─ 課堂機器｜環境名稱
└─ 快速模板｜環境名稱
        ↓
展開顯示各台機器
├─ 名稱與角色
├─ VM／LXC 類型
├─ 狀態、IP、節點
├─ 終端機／控制台
└─ 啟動／正常關機
```

同一台已納入環境群組的機器不會再次出現在一般機器列表。快速練習到期後，只要實際 Resource 仍存在，群組仍會保留；整組資源都刪除後才從群組消失。

目前環境父層提供整組狀態及展開／收合，機器控制仍為逐台操作，尚未提供「整組啟動、整組停止、整組刪除」。這是刻意避免用既有批次 API 繞過課堂時段與個別資源政策。

### 3.4 課堂機器提醒與學生自主延長

本次沒有修改學生課程頁，但有修正資源生命週期：

- 執行中的機器會沿用既有 Session Warning 輪詢及自動關機提醒。
- 課堂機器的 `window_grace` 到期提醒現在允許機器所屬學生自主延長。
- 延長時數使用系統 `practice_session_hours`，預設 3 小時。
- 新到期時間為「目前自動停止時間」與「現在」較晚者，再加一個練習時段；提早按延長不會反而縮短時間。
- 快速練習仍為固定期限，後端明確拒絕延長。
- 到期日型的長期資源仍不能使用此按鈕延長，需走原有申請／管理流程。

目前沒有新增「每位教師、每個班級是否允許延長、每次分鐘數、每堂上限」政策。現況是使用系統全域練習時數；如果後續需要更嚴格的課堂資源治理，才應新增班級層政策，而不是在學生課程頁硬寫規則。

## 四、API 與資料庫變更

### 4.1 快速練習 API

| Method | Endpoint | 權限 | 用途 |
| --- | --- | --- | --- |
| GET | `/api/v1/quick-practice/templates` | 已登入使用者 | 列出已發布且用途為快速練習／兩者共用的環境。 |
| GET | `/api/v1/quick-practice/templates/{environment_id}` | 已登入使用者 | 取得固定節點、資源合計及練習時數。 |
| POST | `/api/v1/quick-practice/templates/{environment_id}/launch` | 已登入使用者 | 免審核建立整組環境，回傳 Session。 |
| GET | `/api/v1/quick-practice/sessions/my` | 已登入使用者 | 取得自己的有效或仍有實際資源的 Session。 |
| GET | `/api/v1/quick-practice/sessions` | 管理者 | 取得所有有效或仍有實際資源的 Session。 |

### 4.2 資料庫

Alembic migration：

```text
qp01_quick_practice
```

新增內容：

- `course_environments.usage_scope`
- `quick_practice_sessions`
- `quick_practice_session_machines`
- Session 使用者、環境版本、建立／到期時間索引
- Session machine 對 request 的唯一關係

目前開發資料庫的 `alembic_version` 指向本 checkout 不存在的舊 revision `ee43b1a50858`，因此不能直接安全執行一般 `alembic upgrade head`。專案既有的相容安裝腳本已擴充並實際執行：

```powershell
cd backend
$env:PYTHONPATH=(Resolve-Path .).Path
uv run python scripts/apply_course_environment_compat.py
```

該腳本只做 additive／idempotent 操作：補缺少的欄位、資料表及索引，不改寫 `alembic_version`，重複執行也不會重建既有資料。新的正常環境仍應使用 Alembic migration；只有 migration 歷史已不相容的部署才使用相容腳本。

## 五、8/26 設計案完成度對照

| 設計項目 | 狀態 | 最新情況 |
| --- | --- | --- |
| 一至三台固定機器 | 已完成 | 重用 CourseEnvironmentVersion；後端及前端均限制最多三台。 |
| 快速練習不逐次審核 | 已完成 | 每台 request 由內部流程自動核准。 |
| 學生不可自選規格 | 已完成 | launch API 不接受規格 payload。 |
| 精確 Session 到期時間 | 已完成 | 後端建立共用 `expires_at`，各 VMRequest 使用相同 `end_at`。 |
| 同時一組／每日三組按 Session 計算 | 已完成 | 不再按多台 VMRequest 重複計次。 |
| 多機環境共用資源清單入口 | 已完成 | 我的資源及管理資源均使用真實群組資料。 |
| 到期後維持群組關係 | 已完成 | Resource 尚存在時仍回傳 Session 群組。 |
| 課程／快速用途隔離 | 已完成 | 清單過濾及正式班級 API 二次驗證。 |
| 整組個人配額檢查 | 已完成 | CPU、RAM、Disk、instances 以所有節點合計。 |
| 併發點擊防護 | 已完成 | launch 時鎖定使用者資料列。 |
| 快速練習禁止延長 | 已完成 | Resource 依 request kind 拒絕延長。 |
| 課堂機器學生自主延長 | 已完成 | 使用全域練習時數，未新增班級個別政策。 |
| 整組 PVE 容量預留 | 部分完成 | 每台 request 依相同時窗進入 placement reservation；尚無獨立 Session reservation。 |
| 整組 IP 原子預留 | 未完成 | 尚未在 launch 前一次預留所有 IP。 |
| 全有或全無 provisioning | 部分完成 | Session 與所有 request 的 DB 建立同一交易；背景建機仍可能部分成功。 |
| 部分失敗冪等補建／整組回收 | 未完成 | 目前保留各機器失敗狀態，未提供 Session repair／rollback。 |
| Offering 最大並行數 | 未完成 | 只有每位使用者限制，沒有每個環境的全域並行上限。 |
| practice quota pool | 未完成 | 目前沿用個人 quota 與叢集 placement，尚無獨立 practice pool。 |
| audience：班級／指定學生 | 未完成 | 所有已登入使用者可見所有快速練習用途的已發布環境。 |
| 教師版本資源／安全審核 | 未完成 | 目前教師發布即生效，尚無超額、GPU、網路或腳本審核狀態機。 |
| Content Bundle／學生成果保存 | 未完成 | 本次不處理課程內容與作答流程。 |
| 到期後整組刪除及釋放 | 未完成 | 現有 scheduler 到期關機；尚未建立回收緩衝與整組刪除工作。 |
| 母模板引用保護與 PVE 對帳 | 未完成 | 尚未完整阻擋被已發布環境引用的模板 hard delete。 |

### 5.1 完成度評估

| 面向 | 完成度 | 判斷 |
| --- | ---: | --- |
| 教師建立與發布固定多機環境 | 85% | 建立、版本、用途與發布已可用；缺版本審核及 audience。 |
| 學生快速啟動 | 85% | 固定配置、Session 計次、免審核及供應已接通；缺排隊與 offering 並行上限。 |
| 資源條列管理 | 85% | 真實群組、console、啟停已完成；缺整組操作及管理者學生辨識。 |
| 容量與一致性治理 | 65% | 有整組 quota 與 placement；缺整組 IP／容量 reservation、補償交易。 |
| 到期與回收 | 55% | 固定期限、提醒、關機及禁止延長已完成；缺回收緩衝、自動刪除及成果處理。 |
| 發布、安全與授權治理 | 35% | 只有 owner 管理及全體登入者可用；缺 audience、審核與高風險能力政策。 |
| 整體第一階段 | 約 70% | 核心體驗可用，正式大規模開放前仍需完成 P0 治理項目。 |

## 六、目前設計的優點

### 6.1 沒有再建立第二套多機編輯器

正式課程與快速練習共用同一個 CourseEnvironmentVersion，避免教師維護兩份相同的 n8n／Database／Linux 環境。用途由 `usage_scope` 決定，符合「模板描述環境，入口決定生命週期」原則。

### 6.2 學生操作簡化且規則難以繞過

快速練習 launch API 不接受規格、時段或核准欄位。前端即使被修改，後端仍只會依發布版本建立固定節點，降低超規格與任意延長風險。

### 6.3 次數與限制從單機提升到 Session

三台機器只計為一次啟動；同時一組與每日三組也都在 Session 層執行，解決舊邏輯把三台機器當成三次快速模板的問題。

### 6.4 資源頁維持條列式

沒有將既有資源頁整體改成卡片或拓樸畫面，而是在原表格加入可展開父列。一般機器維持原列；課堂或快速環境以父列加子列呈現，符合現有操作習慣。

### 6.5 課堂與快速期限沒有混用

正式課堂仍使用班級課表；快速練習使用固定 Session 到期時間。課堂機器可依既有提醒自主延長，快速練習 request kind 則禁止延長。

## 七、主要風險與下一輪優化

### P0：正式大量開放前必須處理

#### 7.1 關閉學生直接 clone 的規則繞道

目前 `/api/v1/templates/{template_id}/clone` 仍接受一般已登入使用者，學生可直接複製單台模板。雖然新的學生首頁已不再使用這條 API，但直接呼叫仍可能繞過 QuickPracticeSession 的三小時、Session 次數及群組規則。

建議：

- 將一般 clone API 限制為教師／管理者；或
- 讓學生 clone 自動轉入 QuickPracticeSession；或
- 若仍保留單台快速模板，至少也必須建立 Session 父層並套用相同期限。

這是目前最高優先的治理缺口。

#### 7.2 增加 Offering／環境最大並行數

目前只限制每位學生同時一組，沒有限制同一個高規格環境可同時啟動幾組。若大量學生同時點擊，只能依 placement 當下拒絕，無法提供明確的環境額滿狀態。

建議在環境發布設定加入：

- `max_concurrent_sessions`
- `max_sessions_per_user_per_24h`
- `enabled_for_quick_practice`
- 預估最壞容量：每組資源 × 最大並行數

#### 7.3 完成整組 reservation 與失敗補償

目前 DB request 建立具交易性，但 PVE provisioning 是多個背景工作。若第二台失敗、第一台成功，Session 會顯示部分失敗，尚不會自動重試或整組回收。

建議建立 Session 狀態機：

```text
creating → ready → stopping → reclaimed
    └────→ partial_failed → repairing | reclaiming
```

並加入：

- 啟動前整組容量及 IP reservation。
- 每台 machine 的 idempotency key。
- 只補建失敗節點。
- 無法修復時整組停止、刪除及釋放 reservation。

#### 7.4 完成到期回收

目前到期會由 VMRequest scheduler 關機，但 Resource 不會自動刪除。長期累積會占用磁碟與 VMID，也讓學生保留大量停止的快速練習機器。

建議：

```text
expires_at
→ 整組正常關機
→ 15～30 分鐘回收緩衝
→ 整組刪除
→ 釋放 IP／容量
→ Session = reclaimed
```

快速練習不可逐台刪除，較合理的產品操作是「結束整組練習」。

### P1：權限與發布治理

#### 7.5 audience 與版本審核

目前用途為快速練習的已發布環境對所有登入使用者可見。教師也能直接發布高規格環境，沒有一次性管理員審核。

建議新增：

- `system`、`campus`、`class`、`users`、`private` audience。
- 教師安全額度內自動發布。
- 超額、GPU、特權 LXC、公開連接埠或高權限腳本進入審核。
- 修改規格或底層模板後建立新版本並重新判定。

#### 7.6 母模板引用保護

已發布環境引用的 VMTemplate 不應被 hard delete。需要在刪除服務加入反向引用檢查，並補 `deprecated／retired／unavailable` 狀態及 PVE 對帳。

### P2：管理體驗

#### 7.7 管理者群組需要學生識別

管理者資源頁目前課堂機器依 `teaching_class_id` 聚合；同一班多位學生的機器可能集中在同一父列，缺少學生姓名／帳號資訊。後續應讓 ResourcePublic 回傳 owner label，並以「班級＋學生」分組。

#### 7.8 整組操作

目前可逐台啟動、關機及開 console。後續整組操作必須有專用 Session API，不能直接把現有 batch API 套上去，以免略過課堂時段、固定期限及部分失敗處理。

## 八、部署與操作注意事項

### 8.1 建立第一份快速練習環境

目前開發資料庫已有一份用途為 `course` 的測試環境，但沒有任何 `quick_practice`／`both` 環境，因此學生首頁會正確顯示空狀態。

要讓學生看到快速練習：

1. 以教師或管理者進入「多機環境模板」。
2. 建立新環境，或替既有已發布環境建立新版本。
3. 在「套用方式」選擇「只用於快速練習」或「正式課程與快速練習」。
4. 加入固定 VM／LXC 節點並確認整組規格。
5. 儲存、發布並鎖定。
6. 使用學生帳號重新載入首頁。

### 8.2 練習時數

快速練習期限與課堂機器每次延長時間均來自系統設定：

```text
practice_session_hours
```

預設為 3 小時，可由系統設定頁調整。文件及 UI 不應永遠硬寫 3 小時，應顯示 API 回傳的 `duration_hours` 或 `extended_minutes`。

### 8.3 CORS

已實際啟動最新後端並驗證：

```text
Origin: http://127.0.0.1:5173
API:    http://127.0.0.1:8001
```

登入 OPTIONS 預檢回應包含：

```text
Access-Control-Allow-Origin: http://127.0.0.1:5173
Access-Control-Allow-Credentials: true
```

因此先前 `127.0.0.1` 前端呼叫 `localhost` API 的 CORS 問題，在目前設定下已驗證正常。若實際開發服務仍顯示舊錯誤，需重新啟動後端以載入最新設定。

## 九、最終檢查紀錄

### 9.1 程式與測試

| 檢查 | 結果 |
| --- | --- |
| 前端 Vitest 全套 | 30 個 test files、167 個 tests 全數通過 |
| 前端 production build | Vite build 通過；動態 import 可正常產生 chunk |
| 後端相關服務測試 | 40 個 tests 通過 |
| 後端 Ruff | `app`、相容腳本及相關測試全數通過 |
| Python compileall | 通過 |
| Alembic head | `qp01_quick_practice (head)` |
| 相容 schema 腳本 | 連續執行通過，確認 idempotent |
| 實際 PostgreSQL 查詢 | quick template／session 查詢成功 |
| 實際 HTTP 啟動 | FastAPI 啟動成功，Quick Practice routes 存在 |
| CORS 預檢 | `127.0.0.1:5173` 回傳正確 allow-origin |
| Git 工作區 | 提交後乾淨 |

上述後端 40 個測試是本次功能與相鄰教學治理的範圍測試，不代表整個 backend 所有測試均已執行。正式部署前仍建議在獨立測試資料庫執行完整 suite 及真實 PVE 建機驗收。

### 9.2 功能驗收清單

- [x] 快速練習改用多機環境版本，不再由學生組單台規格。
- [x] 一個環境可含 VM 與 LXC。
- [x] 學生看得到每台固定規格及整組合計。
- [x] 學生啟動免人工審核。
- [x] 同一 Session 所有機器共用到期時間。
- [x] 同時一組與每日三組按 Session 計算。
- [x] 快速練習不可自主延長。
- [x] 課堂機器到期提醒可由所屬學生延長。
- [x] 正式課程不會選到快速練習專用環境。
- [x] 我的資源與資源管理皆為條列群組。
- [x] 群組子機器可使用 console 及啟停。
- [x] 假資料已移除。
- [x] 未修改學生課程內容、Course Room、Course CMS 或作答流程。
- [ ] 一般模板 clone API 已阻止學生繞道。
- [ ] 高規格／高風險環境發布審核。
- [ ] Offering audience 與最大並行數。
- [ ] 整組容量及 IP 原子預留。
- [ ] 部分失敗補建／整組回收。
- [ ] 到期後自動刪除與成果保存。
- [ ] 真實 PVE 多機環境端對端建立、部分失敗及到期回收測試。

## 十、建議下一步

下一輪不應再調整學生課程頁，應集中完成快速練習治理閉環：

1. 先限制學生直接使用一般 template clone API，堵住三小時規則繞道。
2. 為每個快速環境增加最大並行 Session 與 audience。
3. 建立 Session 狀態、整組 reservation、repair 與 reclaim service。
4. 到期後先關機、再經緩衝整組刪除。
5. 管理者資源群組增加班級及學生識別。
6. 在獨立測試資料庫與真實 PVE 執行完整端對端驗收。

## 十一、最終判斷

目前實作已解決最核心的產品錯位：快速模板現在是一個固定、免審核、有期限的多機練習環境，而不是學生自由複製的一台永久機器；課程與快速練習也共用同一份多機環境版本，避免重複維護。

現階段適合進行教師建立環境、少量學生啟動及資源列表操作的整合驗收。若要開放整班或全校大量同時啟動，必須先完成一般 clone API 治理、Offering 並行上限、整組 reservation、部分失敗補償及到期自動回收。這些是容量與營運安全問題，不應只靠前端提示取代後端控制。
