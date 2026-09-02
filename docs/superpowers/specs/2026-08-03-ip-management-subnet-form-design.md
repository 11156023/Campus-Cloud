# IP 管理頁補回子網設定表單 — 設計

日期：2026-08-03
分支：`feature/multi-pve-connections`

## 背景

新前端遷移時，IP 管理頁只帶過唯讀的分配清單，漏掉了子網設定表單。造成：

- `frontend/src/pages/network/ip-management/IpManagementPage.jsx` 的空狀態寫著「尚未設定子網」卻沒有任何建立入口。
- `frontend/src/components/SubnetBanner/SubnetBanner.jsx` 的「前往設定」連結導到該頁後無事可做。
- `frontend/src/services/ipManagement.js` 的 `upsertSubnet()` / `deleteSubnet()` 已存在但沒有任何頁面呼叫。

後端 API 完整可用，不需改動：

- `GET /api/v1/ip-management/subnet`（AdminUser，未設定時回 `null`）
- `PUT /api/v1/ip-management/subnet`（AdminUser）
- `DELETE /api/v1/ip-management/subnet`（AdminUser）

舊前端的對應實作可參考 git 歷史中的 `frontend_old/src/routes/_layout/admin.ip-management.tsx`（目錄已於 2026-09 移除，`git show 79c8b220:frontend_old/src/routes/_layout/admin.ip-management.tsx` 可查）。

## 目標

1. 在 IP 管理頁補回子網設定的建立／編輯／刪除入口。
2. 把 IP 管理從側欄「網路」群組移到「系統管理」群組。

非目標：不動後端、不改 URL、不重構頁面既有的統計列與分配表格。

## 設計

### 一、位置調整

側欄 `frontend/src/components/Sidebar/Sidebar.jsx`：`ip-management` 項目自 `network` 群組移至 `system` 群組，排在「配額管理」之後、「系統設定」之前。

依 CLAUDE.md「pages 依側欄分類」的慣例，頁面目錄一併移動：

```
frontend/src/pages/network/ip-management/  →  frontend/src/pages/system/ip-management/
```

- 兩者相對根目錄同深度，`.module.scss` 的 `@use "../../../assets/styles/..."` 不需修改。
- `frontend/src/App.jsx` 的 lazy import 路徑更新，`<Route>` 由「網路」區塊移到「系統管理」區塊。
- **URL 維持 `/ip-management`**，因此 `SubnetBanner` 的連結與 `AiFloatingChat` 的 `/^\/ip-management/` 比對都不受影響。

`backend/app/ai/navigation/catalog.py` 內的 `/admin/ip-management` 屬舊前端遺留路徑，與本次目標無關，不在此處理。

### 二、元件切分

新增 `frontend/src/pages/system/ip-management/SubnetConfigForm.jsx`：

- 純受控表單元件，props：`{ config, cidrLocked, saving, onSubmit, onCancel, onDelete }`。
- 自行管理欄位 state，**不呼叫任何 API**；送出時把整理好的 payload 交給父層。
- `config` 為 `null` → 建立模式（`bridge_name` 預設 `vmbr1`）；有值 → 編輯模式。

`IpManagementPage.jsx` 維持容器角色，新增 `editing` / `saving` state，負責呼叫 service 並在成功後 `load()` 重刷。

這個切分讓表單可獨立理解與測試，page 仍只負責資料流。

### 三、UI 與動線

- 頁首右上新增按鈕，沿用 module.scss 中已定義但未使用的 `.pageActions` 與 `.btnPrimary`：
  - 未設定 → 「建立子網設定」
  - 已設定 → 「編輯子網設定」
- 按下後在統計列與工具列之間展開表單卡片；「取消」收合。
- `EmptyState` 文案下方追加同一個 CTA。
- 按鈕與 CTA 皆以 `useAuth()` 判定的 isAdmin 為顯示條件。`/ip-management` 這條 route 沒有 admin guard，非管理員進得來但 API 會回 403，判斷方式與 `SubnetBanner.jsx` 一致（`user?.is_superuser || user?.role === "admin"`）。

### 四、表單欄位

| 欄位 | 必填 | 說明 |
|------|------|------|
| `cidr` | 是 | 子網 CIDR，例 `10.10.0.0/24` |
| `gateway` | 是 | 閘道 IP |
| `bridge_name` | 是 | Bridge 名稱，預設 `vmbr1` |
| `gateway_vm_ip` | 是 | Gateway VM IP |
| `dns_servers` | 否 | 逗號分隔字串，空字串送 `null` |
| `extra_blocked_subnets` | 否 | textarea，每行一個 CIDR/IP；送出前以 `/[\n,]+/` 切分、trim、濾空成陣列 |

版面為兩欄 grid，樣式比照 `SettingsPage` 的 `.field` / `.formGrid` 寫法搬進本頁 module.scss。依 STYLE_GUIDE，不新增任何 SCSS 變數或 CSS 自訂屬性，顏色一律用既有 `--color-*`。

### 五、驗證與錯誤處理

前端只做輕量驗證：

- HTML `required` ＋ IPv4 `pattern`。
- **CIDR 鎖定提示**：page 已載入的 `allocations` 中若存在 `purpose` 為 `vm` 或 `lxc` 的記錄，將 `cidr` 欄位設為 `readOnly` 並於下方註明「已有 VM/LXC 使用此網段，需先刪除才能變更」。這是把後端既有的 409 提前呈現，規則本身仍只實作在後端。

其餘規則不在前端複製，由後端回錯誤：

- 閘道 / Gateway VM IP 必須落在 CIDR 範圍內
- 閘道 IP 不可等於 Gateway VM IP
- 已有 VM/LXC 分配時不可變更 CIDR（409）

錯誤一律以 `useToast()` 的 `toast.error(e?.message ?? "…")` 呈現，與本頁既有錯誤處理一致。成功則 `toast.success` 並重刷。

（後端規則出處：`backend/app/services/network/ip_management_service.py` 的 `upsert_subnet_config`）

### 六、刪除

表單卡片底部設危險區，放「刪除子網配置」按鈕，以 `window.confirm` 二次確認，訊息需說明刪除後全站 VM/LXC 建立功能會被停用。這是本 codebase 的既有慣例（見 `SettingsPage.jsx` 刪除 PVE 連線、`QuotasPage.jsx` 刪除配額），不另寫 Dialog 元件。

仍有 VM/LXC 分配時後端回 409，同樣走 toast。

### 七、測試

`services/ipManagement.js` 目前沒有對應的 vitest，其餘 service 幾乎都有。新增 `frontend/src/services/ipManagement.test.js`，比照 `proxmoxConfig.test.js` 的 mock 方式，覆蓋 `getSubnet` / `upsertSubnet` / `deleteSubnet` / `listAllocations` 的 URL 與 HTTP method。

後端不新增測試（無程式碼變更）。

## 影響檔案

| 檔案 | 動作 |
|------|------|
| `frontend/src/pages/network/ip-management/` | 移動至 `pages/system/ip-management/` |
| `frontend/src/pages/system/ip-management/IpManagementPage.jsx` | 改：頁首按鈕、editing/saving state、API 呼叫、EmptyState CTA |
| `frontend/src/pages/system/ip-management/SubnetConfigForm.jsx` | 新增 |
| `frontend/src/pages/system/ip-management/IpManagementPage.module.scss` | 改：新增表單卡片相關 class |
| `frontend/src/components/Sidebar/Sidebar.jsx` | 改：`ip-management` 移至 `system` 群組 |
| `frontend/src/App.jsx` | 改：import 路徑與 Route 位置 |
| `frontend/src/services/ipManagement.test.js` | 新增 |

後端無變更。
