# Class Management「AI 檢查」導師操作重整計畫

日期：2026-08-26  
狀態：分析與實作計畫，尚未修改功能  
目標頁面：`/class-management/{class_id}/ai`

## 1. 目標與範圍

本次不是重做 Teacher Judge 執行架構，而是把既有 AI 檢查工作區收斂成導師能直接理解的流程：

1. 全面移除畫面上的 `Session` 等工程名詞，統一使用「檢查」、「評分表」、「檢查腳本」與「執行結果」。
2. 導師按下「新增檢查」後，先明確選擇：
   - **從零建立評分表**：建立可保存的空白評分表，再手動新增評分項目或請 AI 產生初稿。
   - **使用已有評分文件**：選擇班級已保存的評分表，或上傳 `.docx`／`.pdf` 後建立檢查。
3. 左側檢查列只露出「釘選」與 `…` 更多功能；重新命名、fork、封存與刪除收進選單，複製後可獨立調整，不會改到原檢查。
4. 「已保存評分表」移出中央主流程，改成右側獨立的直式「評分表來源」欄，可查看、切換與新增來源。
5. 保留既有班級授權、session → script artifact → run lineage、腳本核准與實際機器重新驗證流程。

不納入本次：重做 AI prompt、改變機器執行政策、跨班級複製、複製聊天／腳本／執行歷史、多人協作或新的通用 Library 架構。

## 2. 現況查證

### 2.1 前端現況

`frontend/src/pages/course-operations/ClassWorkspacePage.jsx` 已將此功能掛在班級管理的「AI 檢查」頁籤；實際工作區是 `frontend/src/pages/course-operations/AiJudgePanel.jsx`。

目前已有：

- 左側名稱輸入框「新增檢查名稱」與按鈕「新增」。
- 「進行中／已封存」篩選。
- session 列表、評分表、腳本、執行紀錄與 reload 後恢復。
- header 內的封存與刪除。

主要缺口：

- 頁面仍顯示「AI 評分管理」、「session」、「情境評估表」、「收集腳本」等不同語意層級的名稱。
- 建立動作只是送出名稱，沒有先解釋接下來要從零建立或沿用文件。
- 沒有選定評分表時，後端刻意只提供一般 AI 對話，不會產生 rubric proposal，因此目前不等於真正的「從零建立評分表」。
- 左側整列是 `<button>`；若直接塞入封存／複製按鈕會形成巢狀 button，必須先調整列結構。
- 封存動作在右側 header，和導師正在管理的左側檢查清單距離太遠。

### 2.2 現行資料契約

- `teacher_judge_sessions`：檢查名稱、`active/archived`、目前 `selected_file_id`、摘要與活動時間。
- `teacher_judge_session_messages`：持久化對話。
- `teacher_judge_files`：上傳文件、template、AI 分析後的 `analysis_json`。
- `teacher_judge_script_artifacts`：腳本版本、審查、核准與 session lineage。
- `teacher_judge_script_runs`：執行狀態、各目標結果與 AI 判讀。

目前 `POST /teaching-classes/{class_id}/judge/sessions/` 已能以 `title + selected_file_id` 建立檢查；`PATCH` 能重新命名、換評分表與切換狀態；封存端點也已存在。

### 2.3 為什麼 fork 不能只複製 session

`PATCH /judge/files/{file_id}/analysis` 會直接更新 `teacher_judge_files.analysis_json`。若新舊檢查共用同一個 `selected_file_id`，導師在副本調整評分項目時，原檢查也會一起改變。

因此本計畫把「複製檢查」定義為：

- 建立新的 active session。
- 若來源有評分表，同時建立一份獨立 rubric asset，複製 template 與 `analysis_json`；上傳來源另複製原始檔案 bytes。
- 不複製對話、腳本 artifact、核准狀態、目標機器或 run 歷史。

這個邊界才能符合「複製後調整」且保留歷史可信度。

## 3. 導師用詞契約

### 3.1 頁面與主要物件

| 現行文字／工程名詞 | 導師介面文字 | 使用位置 |
| --- | --- | --- |
| AI 評分管理 | AI 檢查 | 面板標題，與班級頁籤一致 |
| session / Session | 檢查 | 列表、提示、toast、錯誤與確認視窗 |
| 新增檢查名稱 | 檢查名稱 | 建立視窗欄位標籤 |
| 新增 | 新增檢查 | 左側主要 CTA |
| active | 進行中 | 篩選與狀態文字 |
| archived | 已封存 | 篩選與唯讀狀態 |
| 情境評估表／評估表 | 評分表 | 編輯中的結構化評分內容 |
| 原始文件／上傳檔 | 評分文件 | `.docx`／`.pdf` 來源 |
| 收集腳本 | 檢查腳本 | 第二個工作頁籤 |
| 腳本執行 | 執行與結果 | 第三個工作頁籤 |
| 訊息 N · 腳本 N · 執行 N | 對話 N · 腳本 N · 執行 N | 檢查摘要 |

「檢查」代表左側的一個工作單位；「評分項目」代表評分表內的一條規則。不要把左側工作單位稱為「檢查點」，避免和 rubric item 混淆。

### 3.2 建議固定文案

- 頁面說明：`建立評分表、準備檢查腳本，並查看班級機器的執行結果。`
- 進行中空狀態：`尚未建立檢查。新增後可從零設計評分表，或使用已有文件。`
- 已封存空狀態：`目前沒有已封存的檢查。`
- 未選取時：`請從左側選擇一項檢查，或新增檢查。`
- 封存成功：`「{title}」已移至已封存。`
- 複製成功：`已建立「{copy_title}」，可開始調整評分表。`
- archived 唯讀提示：`這項檢查已封存，只能查看內容與複製成新檢查。`

## 4. 新增檢查流程

### 4.1 入口

移除左側常駐的「名稱 input + 新增」表單，改成單一全寬主按鈕：

```text
[ ＋ 新增檢查 ]
```

按下後只開啟輕量的模式選擇視窗，不在小視窗內塞入整份評分表：

- **從零開始建立**：輸入檢查名稱後，先建立空白 session/rubric，再導向專用的問卷式編輯頁。
- **使用已有評分文件**：留在選擇視窗內，選擇已保存來源或上傳 `.docx`／`.pdf` 後建立。

### 4.2 模式選擇視窗

1. 必填「檢查名稱」，例如「期中 Python 環境檢查」。
2. 必選「如何建立評分表？」：
   - **從零開始建立**：說明「前往評分表建立頁，可手動新增評估項目並請 AI 一起協作」。
   - **使用已有文件**：說明「選擇班級已保存的評分表，或上傳 `.docx`／`.pdf`」。
3. 依模式顯示必要欄位。
4. 從零模式的主要動作改為「開始建立」；已有文件模式維持「建立檢查」。

### 4.3 模式 A：從零建立的路由與生命週期

「開始建立」先呼叫 blank create contract，建立 active session 與 created rubric asset，再導向：

```text
/class-management/{class_id}/ai/checks/{session_id}/edit
```

不新增 draft status，也不建立另一套暫存資料表：

- 導師已按「開始建立」，因此 session 從此刻就是正式的進行中檢查。
- 每次欄位失焦或短暫 debounce 後保存 rubric metadata／analysis，AI 訊息沿用 session message persistence。
- 離開頁面前若仍有尚未送出的本地修改才顯示確認；已保存內容可直接返回。
- 零項目檢查留在進行中清單，摘要顯示「尚未新增評估項目」，不偽裝成完成。

`frontend/src/App.jsx` 新增比 `/:classId/:section` 更具體的 route，避免 `edit` 被誤判成 ClassWorkspacePage 的 section。編輯頁保留「返回 AI 檢查」breadcrumb 與班級名稱，不複製整套班級 workspace tab。

### 4.4 從零建立頁的問卷結構

頁面採「主要表單 + AI 助手」布局，主要閱讀順序如下：

```text
+-----------------------------------------------------------------------+
| ← 返回 AI 檢查       從零建立評分表          已儲存     [完成並返回] |
+-----------------------------------------------+-----------------------+
| 基本資料                                      | AI 評分表助手         |
|                                               |                       |
| 檢查名稱  [期中 Python 環境檢查___________]  | 對話／修改建議        |
| 評分表名稱[期中 Python 評分表_____________]  |                       |
|                                               | [產生評估項目初稿]    |
| 評分環境（可複選）                            | [檢查目前評分表]      |
| [✓ Linux] [✓ Python] [□ N8N] [□ PostgreSQL]  |                       |
| 後端環境判斷：尚未啟用（已保留串接位置）      | proposal diff         |
|                                               | [套用選取] [略過]     |
| 評估項目（2）                    [＋新增項目]  |                       |
| #1 主題／說明／AI 偵測判斷                    |                       |
| #2 主題／說明／AI 偵測判斷                    |                       |
+-----------------------------------------------+-----------------------+
```

基本資料使用問卷式分段，不做密集表格：

1. **檢查名稱**：同步更新 session title。
2. **評分表名稱**：同步更新 rubric `display_name`。
3. **評分環境（可複選）**：至少選一項，使用 checkbox card／chip，而非單選 select。
4. **後端環境判斷**：保留 read-only status 區。目前明確顯示「尚未啟用」，不能讓導師誤以為系統已探測機器。

「完成並返回」只要求名稱合法、至少一個評分環境與至少一個有效評估項目；儲存本身是持續進行，不需等到按完成才寫 DB。

### 4.5 多選評分環境的相容契約

目前 command catalog 與多數生成流程以單一 `template_key` 運作；本次不能假裝後端已能自動判斷多環境。契約分成兩層：

- `environment_keys: string[]`：導師選擇的候選環境，可複選並正式保存，未來提供後端 resolver 判斷。
- `template_key: string`：目前實際提供 command catalog／AI 偵測建議的 effective environment。

第一階段行為：

1. Server 驗證 `environment_keys` 非空、去重且都在 supported catalog。
2. 尚未接環境 resolver 時，以陣列第一個項目作為 `template_key`，並在 UI 顯示「目前以 {label} 產生 AI 偵測建議」。
3. 導師調整多選順序或主要項目時才改 effective template；不能因重新 render 任意改變。
4. 未來接入 backend detector 後，只替換 effective template 的決策來源；`environment_keys`、rubric items 與 UI 位置不用重做。
5. 本次不實作 PVE／SSH 環境探測，不宣稱已完成自動判斷。

### 4.6 評估項目與 AI 同頁協作

重用現有 `RubricCard` 能力，不重新發明 item schema。每個項目包含：

- 編號與 `可自動偵測／部分可偵測／需人工評閱` badge。
- 導師可編輯的「主題」與「說明」。
- 刪除動作；刪除已有 AI check steps 的項目時需確認。
- read-only「AI 偵測判斷」：`detection_method`、`fallback` 與 `check_steps`，明確標示只由 AI proposal 更新。

頁面提供兩層 AI 功能：

- **整份評分表助手**：依檢查名稱、所選環境與目前 items 產生初稿、補缺漏或整體潤飾。
- **單一項目 AI 協助**：針對該項目改寫說明、評估可偵測性或補 check steps。

AI 修改規則維持 human-in-the-loop：

1. AI 回傳 proposal，不直接覆寫表單。
2. 以 item id 顯示新增／修改／刪除差異；導師可逐項勾選後「套用選取」。
3. AI request 帶入目前 `analysis_revision`，proposal 回傳 `base_revision`；套用時若 server revision 已前進，回 409 並要求重新產生或明確解衝突。
4. proposal 產生後若導師又手動修改同一 item，即使尚未送到 server，也要以 local dirty item id 標記衝突。
5. 套用後走同一 `analysis_json` 保存流程、增加 revision 並更新統計；不保存 chain-of-thought。
6. AI request 期間仍允許閱讀，但鎖定重複送出；失敗不回退已保存的人工修改。

寬桌面 AI 助手為右側 sticky 欄；中等寬度改 drawer；手機改 full-width sheet。DOM／focus 順序仍以基本資料 → items → AI assistant 為準。

### 4.7 模式 B：使用已有文件

視窗內再提供兩種來源，但仍屬同一模式：

- **從已保存評分表選擇**：顯示 active rubric asset，列出名稱、評分環境、項目數與更新時間。
- **上傳評分文件**：沿用現有 `.docx`／`.pdf` upload、AI 分析與同名衝突處理。

建立按鈕在以下情況才可用：

- 已選一份 active 評分表；或
- 新文件已上傳並分析成功，取得 `file_id`。

上傳完成但 session 建立失敗時，不刪除已分析文件；它仍是班級評分表 Library 的合法項目，並提示導師可重新建立檢查。

### 4.8 建立請求契約

擴充既有 `TeacherJudgeSessionCreateRequest`，讓模式只存在 request，不在 session 重複保存：

```json
{
  "title": "期中 Python 環境檢查",
  "creation_mode": "blank",
  "rubric_name": "期中 Python 評分表",
  "environment_keys": ["python", "linux"],
  "selected_file_id": null
}
```

或：

```json
{
  "title": "期中 Python 環境檢查",
  "creation_mode": "existing",
  "selected_file_id": "..."
}
```

驗證矩陣：

| mode | 必填 | 禁止／忽略 |
| --- | --- | --- |
| `blank` | `title`、`rubric_name`、至少一個合法 `environment_keys` | `selected_file_id` |
| `existing` | `title`、同班級 active `selected_file_id` | `rubric_name`、`environment_keys` |

相容期內，舊 client 未傳 `creation_mode` 時保留目前行為；新 UI 必須明確傳入模式。不要把 `creation_mode` 新增到 `teacher_judge_sessions`，因為建立完成後真正的 source of truth 是所選 rubric asset。

## 5. 左側檢查清單

### 5.1 排版

```text
+----------------------------------+
| [ ＋ 新增檢查 ]                  |
| [進行中] [已封存]                |
|                                  |
| 期中 Python 環境檢查       ☆  … |
| Python 評分表 · 12 項             |
| 8/26 14:30                       |
|                                  |
| N8N 部署驗收               ★  … |
| 尚未建立檢查腳本                 |
+----------------------------------+
```

每列拆成：

- 外層非互動容器。
- 主要選取 `<button>`，涵蓋標題與摘要。
- 獨立 action group，只放釘選與 `…` icon button。
- 與該列相連的浮動 menu；fork、封存與刪除不直接平鋪在清單上。

這可避免巢狀 `<button>`，也讓鍵盤焦點順序明確。

### 5.2 釘選

- 未釘選顯示 outline `push_pin`，已釘選顯示實心／主色狀態。
- tooltip／`aria-label` 使用 `釘選「{title}」` 或 `取消釘選「{title}」`。
- 釘選必須寫入 backend，reload、換瀏覽器後仍保留；不能只改 React 排序。
- `teacher_judge_sessions` 新增 nullable `pinned_at`。釘選時寫入目前時間，取消時設為 null。
- active 清單排序：已釘選優先，其內依 `pinned_at DESC`；未釘選維持 `last_activity_at DESC, id DESC`。
- archived 清單不顯示釘選快捷鍵，避免已封存內容仍占據工作清單優先級。

釘選 icon 與 `…` 在 selected row 必須可見；其他列桌面可降低對比，但 hover／focus-within 時顯示完整對比。觸控裝置不得依賴 hover。

### 5.3 `…` 更多功能選單

進行中的檢查依序顯示：

1. `重新命名`
2. `釘選`／`取消釘選`
3. `複製檢查`，圖示使用 `fork_right`
4. separator
5. `封存`
6. `刪除`，使用 danger 色

已封存的檢查顯示：

1. `複製檢查`
2. `還原至進行中`
3. separator
4. `刪除`

互動契約：

- `…` trigger 具備 `aria-haspopup="menu"`、`aria-expanded`、`aria-controls`。
- menu 開啟後 focus 進入第一個可用項目；支援方向鍵、Enter、Escape、點擊外部關閉。
- menu 錨定目前列並避免超出 viewport；sidebar 捲動或切換 session 時關閉。
- `重新命名` 開啟小型 dialog，預填目前名稱；沿用既有 `PATCH title`。
- `封存` 為非破壞動作，成功後移至已封存，不使用紅色確認。
- `刪除` 維持目前二次確認，清楚列出會刪除聊天、腳本與執行紀錄，但不刪共用評分表來源。
- 每一列只允許一個 pending action；執行中 menu item 顯示 spinner 並防止連點。

所有 icon trigger 的互動目標至少 36×36 px，並提供 tooltip、`aria-label` 與清楚 focus ring。

### 5.4 Fork／複製行為

- active 與 archived 檢查都可複製；新項目一律建立在「進行中」。
- 點擊後可直接使用預設名稱 `{title}（副本）`；若名稱已存在，依序使用 `（副本 2）`、`（副本 3）`。
- 成功後切回「進行中」、選取新檢查並停留在「評分設定」。
- fork 僅複製可編輯設定，不複製歷史證據。

### 5.5 Fork API

新增：

```text
POST /api/v1/teaching-classes/{class_id}/judge/sessions/{session_id}/fork
```

可選 request：

```json
{ "title": "期中 Python 環境檢查（副本）" }
```

response 沿用 `TeacherJudgeSessionPublic`。

後端步驟：

1. 經現有 Teaching Class instructor access 驗證來源 session。
2. 來源有 `selected_file_id` 時，建立新的 rubric asset：
   - 複製 `source_type`、`template_key` 與深拷貝後的 `analysis_json`。
   - `uploaded` 來源複製原始 bytes 並產生不衝突的檔名。
   - `created` 來源只複製結構化內容，不虛構上傳文件。
3. 建立新的 active session，`created_by` 使用目前導師，`selected_file_id` 指向副本。
4. message、summary、artifact、run count 從零開始。
5. DB 或檔案複製任一步驟失敗時回退新資料，不留下半完成 session。

不新增 `forked_from_session_id`；目前需求只要可獨立調整，沒有 lineage 查詢或稽核用途，不預先增加 schema。

## 6. 右側「評分表來源」欄

### 6.1 空間結構

桌面工作區改成三個責任明確的區域：

```text
+------------------+--------------------------------+----------------------+
| 檢查清單         | 目前檢查的主要工作             | 評分表來源           |
|                  |                                |              [＋]    |
| ＋ 新增檢查      | 評分設定／AI 對話              | ● Python 期中評分表  |
| 進行中 已封存    | 檢查腳本                       |   Python · 12 項     |
|                  | 執行與結果                     |                      |
| 檢查 A     ★  …  |                                | ○ Linux 基礎檢查    |
| 檢查 B     ☆  …  |                                |   Linux · 8 項      |
+------------------+--------------------------------+----------------------+
```

- 左側回答「目前在做哪一個檢查」。
- 中央只放目前任務重點：評分設定、AI 對話、腳本或執行結果。
- 右側回答「這個檢查使用哪份評分表」，不再把「已保存評分表」當成中央主欄的一張大型卡片上下堆疊。
- 右欄建議寬度約 280～320px，與左欄分開 sticky；中央維持 `minmax(0, 1fr)`。

### 6.2 來源列表

標題改為「評分表來源」，右上角提供 `＋`／「新增來源」。來源以直式清單顯示，每列包含：

- `display_name`。
- 評分環境、評分項目數、最近更新時間。
- selected indicator；目前 session 使用的來源有主色底與 `已選用` 狀態。
- uploaded 類型可顯示檔案圖示與副檔名；created 類型顯示「建立於系統」。
- 列本身負責選用；原檔下載與刪除收進該來源自己的 `…` menu，不再顯示大型「原檔／刪除」按鈕。

更換來源前若目前評分表有尚未保存的本地修改，必須先要求保存或放棄；不能靜默切換造成內容遺失。

### 6.3 新增來源

按「新增來源」開啟小型選擇面板：

1. `建立空白評分表`：建立 created rubric 並進入同一個問卷式編輯頁；完成後自動選用。
2. `上傳評分文件`：沿用 `.docx`／`.pdf` 分析、同名處理，成功後自動選用。

這與「新增檢查」的兩種建立方式共用相同 service 與資料契約，不另做第三套流程。archived 檢查只可查看來源，不顯示新增或切換入口。

### 6.4 Responsive

- 寬桌面：三欄同時顯示。
- 中等寬度：右側來源欄收成「評分表來源（N）」按鈕，從右側開 drawer；中央保持主要工作寬度。
- 手機：檢查清單在上、中央在下；評分表來源使用 full-width sheet，不把右欄硬塞到主內容底部形成超長頁面。
- drawer／sheet 開啟後 focus trap、Escape、返回焦點與 backdrop 行為必須完整。
- DOM 與鍵盤順序維持檢查清單 → 主工作 → 評分表來源，不能只用 CSS 視覺調換。

## 7. Rubric asset 與釘選的最小資料調整

現有 `teacher_judge_files` 只適合實體 upload，從零建立需要最小擴充，但不另建通用 Library 表。

建議新增／調整：

| 欄位 | 調整 | 說明 |
| --- | --- | --- |
| `source_type` | 新增，`uploaded/created`，default `uploaded` | 區分來源 |
| `display_name` | 新增，非空 | UI 使用的評分表名稱；既有資料回填 `original_filename` |
| `environment_keys` | 新增，JSON array，非空 | 導師複選的候選環境；既有資料回填 `[template_key]` |
| `analysis_revision` | 新增，integer，default 1 | 人工 autosave 與 AI proposal 的 optimistic concurrency token |
| `original_filename` | 改 nullable | `created` 沒有原始上傳檔 |
| `file_hash` | 改 nullable | 只表示原始文件 hash，不冒充目前 `analysis_json` 版本 |

規則：

- `uploaded` 必須有 `original_filename + file_hash + stored file`。
- `created` 必須沒有原始檔路徑，但可以由既有 export 流程匯出目前評分表。
- `environment_keys` 保存候選集合；既有 `template_key` 暫時保存 effective environment，兩者語意不得混用。
- 每次成功更新 `analysis_json` 都增加 `analysis_revision`；update request 必須帶 `expected_revision`，不相符時不得覆寫。
- 下載原始文件按鈕只對 `uploaded` 顯示；created rubric 不呼叫 download route。
- 現有 active filename unique index 只約束 `original_filename IS NOT NULL` 的資料。
- 編輯 `analysis_json` 不改 `file_hash`；hash 仍只代表原始 upload，避免語意混淆。
- `TeacherJudgeFilePublic` 回傳 `source_type`、`display_name`，並讓 `original_filename/file_hash` nullable。

`teacher_judge_sessions` 另新增 nullable `pinned_at`，`TeacherJudgeSessionPublic` 只回傳 `pinned_at`，由前端以是否為 null 推導釘選狀態，避免 `is_pinned` 與時間欄位重複表達同一件事。`TeacherJudgeSessionUpdateRequest` 接受 `is_pinned`，由 server 決定實際時間；client 不得自行提交 `pinned_at`。

## 8. 前端狀態與失敗處理

### 8.1 模式選擇與從零建立頁

- 開啟時預設不選模式，避免導師未理解就直接建立。
- 模式切換不清除檢查名稱。
- 上傳／AI 分析期間鎖定關閉與重複提交，顯示「正在分析評分文件…」。
- API 驗證失敗保留輸入與已選模式。
- blank create 成功才導向問卷頁；失敗留在模式視窗，不建立假的本地 session。
- 問卷頁分別顯示 `正在儲存／已儲存／儲存失敗，重試`，不得只靠 toast 表達長時間編輯狀態。
- 切換班級時關閉 dialog、清空候選檔案與 pending request；延遲 response 不得寫入新班級。

### 8.2 左側列操作

- busy 狀態以 session id 管理，只鎖定正在 pin／rename／fork／archive／delete 的列，不凍結整個 sidebar。
- 點 pin 或 `…` 時 `stopPropagation()`，不能同時誤觸 session 切換。
- 只有一個檢查 menu 可同時開啟；切換 filter、session 或 viewport 時關閉。
- active 檢查封存後：從 local list 移除，再以 API 結果／reload 校正。
- fork 成功後：若目前在 archived filter，先切 active，再選新 session；避免先插入 archived list 後被下一次載入清掉造成閃爍。
- 失敗時保留原選取項目並用導師文字提示，不顯示 `session`、`file_id` 等內部名詞。

### 8.3 空白評分表

- 零項目不是錯誤狀態，而是明確 first-run state。
- 「產生檢查腳本」在沒有任何評分項目時 disabled，旁邊說明「請先新增至少一個評分項目」。
- AI proposal 仍必須由導師按「套用變更」；不自動寫入。
- 手動 item 編輯與 AI 套用共用同一 revision／dirty-state 管理，避免後到 response 蓋掉新輸入。
- archived 檢查禁止新增項目、套用 proposal、產生腳本與建立 run。

## 9. 具體修改範圍

### 9.1 Frontend

- `frontend/src/App.jsx`
  - 新增 `/class-management/:classId/ai/checks/:sessionId/edit` 專用 route，置於現有 generic class route 前。
- `frontend/src/pages/course-operations/AiJudgeRubricEditorPage.jsx`（新增）
  - 問卷式基本資料、多選環境、持續儲存、完成／返回與 AI assistant responsive layout。
- `frontend/src/pages/course-operations/AiJudgeRubricEditor.jsx`（新增或由現有程式抽出）
  - 共用 `RubricCard`、新增／刪除／更新 item、proposal diff 與套用流程，供建立頁及既有工作區使用。
- `frontend/src/pages/course-operations/AiJudgePanel.jsx`
  - 導師用詞、頁籤名稱、empty state。
  - 以「新增檢查」dialog 取代 inline form。
  - sidebar pin、`…` menu、rename／fork／archive／delete pending state與建立後導向。
  - 將「已保存評分表」移出中央卡片，改成右側直式來源欄及 responsive drawer/sheet。
  - created rubric 的初始操作與原始文件下載顯示條件。
- `frontend/src/pages/course-operations/AiJudgePanel.module.scss`
  - 三欄 workspace、sidebar row/menu、右側來源欄、icon hit area、focus 與窄螢幕 drawer/sheet。
  - 建立模式卡片、已選文件與 loading/error state。
- `frontend/src/services/aiJudge.js`
  - create payload、rubric metadata/environment update、pin update 與 `forkSession()`。
- `frontend/src/services/aiJudge.test.js`
  - create mode、pin update 與 fork URL／payload contract。

建立 dialog 若使 `AiJudgePanel.jsx` 持續膨脹，再抽成同目錄的 `AiJudgeSessionCreateDialog.jsx`；不要先建立通用 wizard framework。

### 9.2 Backend

- `backend/app/ai/teacher_judge/schemas.py`
  - creation mode、`environment_keys`、rubric metadata update、fork request、pin update、rubric source type 與 nullable public 欄位。
- `backend/app/models/teacher_judge_session.py`
  - nullable `pinned_at` 與列表排序 index。
- `backend/app/models/teacher_judge_file.py`
  - rubric source/display 欄位與 nullable upload metadata。
- `backend/app/ai/teacher_judge/file_service.py`
  - 建立空白 rubric、更新 display/environment metadata、analysis revision guard、clone rubric、檔名與檔案 rollback。
- `backend/app/ai/teacher_judge/session_service.py`
  - fork service 與複製邊界；維持同班級驗證。
- `backend/app/api/routes/teacher_judge_sessions.py`
  - create mode orchestration、pin update／排序與 fork endpoint。
- `backend/app/api/routes/teacher_judge_files.py`
  - rubric metadata update；public/download 對 source type 的明確行為；upload 仍建立 `uploaded`。
- `backend/app/alembic/versions/<new_revision>_extend_teacher_judge_workspace.py`
  - 從實作當下唯一 head 建 migration、rubric 回填、`pinned_at` 與條件 index。
- `backend/tests/test_teacher_judge_sessions.py`
  - blank/existing validation、fork 邊界、active/archived 來源與跨班級拒絕。
- `backend/tests/test_teacher_judge_files.py`
  - created rubric、uploaded clone、獨立 analysis、filesystem rollback 與 download 行為。

## 10. 分階段實作

### 階段 1：三區布局、名詞與建立 UI 骨架

- 完成導師文案表、頁面／頁籤名稱與空狀態。
- 建立模式選擇 dialog 與兩種模式入口；模式 A 導向專用 route，模式 B 先以現有 saved file contract 接通。
- 重構 sidebar row，完成 pin／`…` menu 骨架並確保不出現巢狀 button。
- 將已保存評分表改成右側「評分表來源」直式欄；中窄螢幕使用 drawer/sheet。

完成條件：導師從畫面看不到 `session`；已有評分表可在建立時直接綁定。

### 階段 2：從零建立與添加評分表來源

- migration 與 rubric source contract。
- create blank rubric + session 的單次 backend transaction，保存多選 `environment_keys` 與 compatibility effective template。
- 問卷式建立頁、持續儲存、評估項目手動編輯與 AI 初稿／proposal diff。
- 右側「新增來源」共用 blank/upload service，成功後自動綁定目前檢查。

完成條件：不需上傳文件也能在專用頁完成名稱、複選環境與評估項目；人工及 AI 變更 reload 後仍存在，新增有效項目後能產生腳本。

### 階段 3：左側釘選與更多功能

- 新增持久化 `pinned_at` 與 pinned-first 排序。
- 完成重新命名、fork、封存與刪除 menu action。
- 實作 rubric 深拷貝與 session fork endpoint。
- active／archived filter 切換、局部 busy、成功選取與錯誤恢復。

完成條件：修改副本的評分項目不會影響來源；副本沒有來源的對話、腳本與 run。

### 階段 4：回歸與視覺驗收

- 驗證既有 upload、同名 copy/overwrite、script generation、approve、run history 與 delete 行為。
- 桌面、窄螢幕、鍵盤與 archived 唯讀驗收。

## 11. 測試矩陣

### 11.1 Backend focused tests

- `blank` 建立得到 active session + created rubric + empty analysis。
- `environment_keys` 至少一項、去重、只接受 supported key；既有 rubric migration 回填 `[template_key]`。
- 尚未啟用 resolver 時 effective `template_key` 穩定取第一個候選，不因陣列序列化或 reload 漂移。
- analysis update 的 `expected_revision` 正確時成功並加一；過期 revision 回 409 且資料不變。
- `existing` 缺 `selected_file_id`、跨班級 file、replaced file 均拒絕。
- blank 模式傳 selected file、existing 模式傳 template/rubric name 均回清楚 validation error。
- fork 空白 session 只建立新 session。
- fork uploaded／created rubric 均產生新 `file_id`，兩份 `analysis_json` 後續可獨立修改。
- fork 不複製 messages、summary、artifacts、runs。
- archived source 可 fork，但 archived session 本身仍不可編輯。
- fork 跨班級／無權限／不存在來源 fail closed。
- pin／unpin reload 後保留；列表永遠 pinned-first，未釘選仍依活動時間排序。
- 實體檔案 copy 失敗時 DB 不留下新 session/file。
- 既有 upload、download、同名 copy/overwrite regression 維持通過。

建議命令（從 `backend/`）：

```powershell
uv run python -m pytest tests/test_teacher_judge_sessions.py -q
uv run python -m pytest tests/test_teacher_judge_files.py -q
uv run python -m pytest tests/test_teacher_judge_script_artifacts.py -q
uv run ruff check app/ai/teacher_judge app/api/routes/teacher_judge_sessions.py app/api/routes/teacher_judge_files.py tests/test_teacher_judge_sessions.py tests/test_teacher_judge_files.py
uv run alembic check
```

Migration 必須另在 disposable PostgreSQL 驗證既有 schema upgrade、clean upgrade，以及 downgrade；不得用未知或 production DB。

### 11.2 Frontend focused tests

- create service 正確序列化 blank/existing payload。
- 專用 editor route 可直接 reload，依 URL 恢復 session/rubric，不依賴上一頁 React state。
- 多選環境至少一項；保存失敗保留 dirty state，重試後不重複 item。
- 手動新增／修改／刪除 item 會更新統計並保存；刪除有 check steps 的項目需確認。
- AI proposal 不直接覆寫；可逐項套用，stale proposal 不覆蓋較新的人工修改。
- fork service 使用 class-scoped endpoint，且不傳 client-side rubric snapshot。
- pin／`…`／menu action 不觸發列選取。
- menu 鍵盤操作、Escape、outside click、切換 filter 後關閉。
- archived view 不顯示 archive action，但仍可 fork。
- 右側來源選用／新增成功後更新 session，archived 狀態維持唯讀。
- 建立視窗在各模式缺欄位時不能送出。
- class 切換與延遲 response 不污染新 class/session。

不為這次 UI 新增大型測試框架；沿用 Vitest service tests，元件互動以現有能力加 focused test，最後跑：

```powershell
npm test -- src/services/aiJudge.test.js
npm run build
```

### 11.3 手動／瀏覽器驗收

- 桌面 1440px：左／中／右三區清楚，兩側 sticky 不互相遮擋，長名稱可截斷。
- 1024px：右側來源收成 drawer，中央不被壓成狹窄欄。
- 390×844：sidebar 改單欄、來源使用 sheet，dialog／menu 不產生頁面水平 overflow。
- 建立頁 1440px：問卷／items 為主要欄，AI assistant sticky 且不壓縮主題與說明輸入。
- 建立頁 390×844：AI assistant 使用 sheet，評估項目欄位維持單欄且無水平 overflow。
- Tab／Shift+Tab：新增、filter、每列選取、pin、`…`、menu 與來源欄順序合理。
- icon 有可見 focus、tooltip、`aria-label`；不以顏色單獨表達 active/archived。
- 快速連按 fork/archive 不建立重複資料。
- 建立、封存、fork 失敗時輸入與目前選取狀態可恢復。

## 12. 風險與防線

| 風險 | 防線 |
| --- | --- |
| 副本與來源共用 rubric，修改互相污染 | fork 必須 clone rubric asset，不重用 `selected_file_id` |
| DB session 建立成功但檔案 clone 失敗 | filesystem staging + DB rollback，成功後才回 response |
| 從零建立只是一般聊天，沒有正式評分表 | 建立空白 created rubric，讓 session 從第一刻就有 source of truth |
| 多選環境讓人誤以為後端已完成探測 | 明示 resolver 尚未啟用；保存候選集合，current effective template 採固定相容規則 |
| AI proposal 蓋掉導師剛輸入的內容 | item revision／dirty-state 比對，stale proposal 必須重新產生或明確解衝突 |
| 建立頁編輯時間長，離開後內容遺失 | session/rubric 先建立、欄位持續保存、頁面常駐保存狀態與離頁保護 |
| `created` rubric 被當成可下載原始文件 | public source type + UI 隱藏 download + route 明確拒絕 |
| sidebar icon 造成 nested button 或鍵盤混亂 | row container、selection button、pin／more 獨立 action group |
| 釘選只存在前端或破壞活動排序 | server-owned `pinned_at`，pinned-first 後再依既有活動排序 |
| 更多選單超出 sidebar 或留下錯誤 focus | viewport-aware positioning、單一 open menu、Escape／outside close 與 focus return |
| 右側來源擠壓中央重點 | 寬桌面三欄，中等以下改 drawer/sheet，不在中央下方重複堆疊 |
| 封存被誤認為刪除 | 中性 archive icon、成功文字「移至已封存」、永久刪除留在危險操作區 |
| 新 mode 破壞舊 client | `creation_mode` 相容期可省略；新 UI 明確傳入，舊 contract focused regression |
| schema 與 runtime 過度擴張 | 不保存 creation mode、不新增 fork lineage、不複製歷史、不建立通用 Library 表 |

## 13. 驗收定義

完成後，一位第一次進入頁面的導師應能在不理解 `session`、artifact 或 template key 的前提下：

1. 按「新增檢查」並知道有「從零開始建立」與「使用已有文件」兩條路。
2. 從零模式進入獨立問卷頁，完成檢查名稱、評分表名稱與可複選評分環境。
3. 在同一頁手動編輯評估項目或請 AI 產生／修改 proposal，確認後才套用，reload 後仍存在。
4. 從已有文件建立後直接看到已分析的評分項目。
5. 釘選常用檢查，reload 後仍排在清單上方。
6. 從 `…` 選單重新命名、fork、封存或刪除；危險程度與確認方式清楚。
7. 在右側直式「評分表來源」查看、切換與添加來源，不必在中央內容上下尋找大型卡片。
8. 複製檢查後調整副本而不影響來源，也不複製舊的執行證據。
9. 清楚辨識進行中與已封存，並在封存項目中查看既有結果。
10. 既有腳本核准、班級機器 scope、執行與歷史證據契約維持不變。
