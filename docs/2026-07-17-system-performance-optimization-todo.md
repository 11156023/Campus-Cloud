# Campus Cloud 系統順暢度優化待辦

- 文件名稱：Campus Cloud 系統順暢度優化待辦
- 建立日期：2026-07-17
- 文件狀態：待執行
- 優化範圍：後端 API、Proxmox、Redis、非同步任務、排程器、前端輪詢、監控

## 目標

- 降低資源頁、監控頁與教室頁等待時間。
- 避免重複呼叫 Proxmox API。
- 確保背景工作在 API 重啟後不會遺失。
- 避免多個 Backend worker 重複執行相同排程。
- 減少前端無效輪詢與不必要的資料庫寫入。
- 保留資源評估與租借容量判斷，不恢復機器搬移功能。

## 目前基準

### Redis

- Redis 連線池、API 限流、JWT token blacklist 已有程式實作。
- ARQ 已用於部分範本工作，共有 7 種已註冊任務。
- 目前本機 `.env` 未設定 `REDIS_ENABLED` 與 `REDIS_URL`。
- 目前執行中的 Backend 實際為 `redis_enabled = False`。
- 目前沒有 Redis server 與 ARQ worker 程序。
- Proxmox 狀態快取、Redis Pub/Sub、Scheduler 分散式鎖尚未實作。

### 非同步與背景工作

- API handler 共 279 個：同步 229 個、非同步 50 個。
- 同步 SQLModel 路由由 FastAPI thread pool 執行，此部分不需要全面改寫成 `async def`。
- WebSocket、VNC、Terminal、AI HTTP client 已使用非同步處理。
- 範本工作已進入 ARQ，但 provisioning、delete、reset、config push、batch spec 等仍有程序內背景工作。
- 程序內背景工作遇到 reload、崩潰或多 worker 切換時，可能遺失或無法被其他 worker 查詢。

### 已觀察的 API 基準

> 樣本數仍少，後續需持續蒐集；監控錯誤數包含 migration 修正前的歷史結果。

| API | 平均時間 | 樣本數 | 錯誤數 |
|---|---:|---:|---:|
| `GET /api/v1/script-deploy/logs` | 433 ms | 1 | 0 |
| `GET /api/v1/resources/` | 228 ms | 1 | 0 |
| `GET /api/v1/monitoring/overview` | 188 ms | 9 | 5 |
| `GET /api/v1/jobs/` | 148 ms | 3 | 0 |
| `GET /api/v1/resources/my` | 94 ms | 3 | 0 |
| `GET /api/v1/vm-requests/my` | 85 ms | 31 | 0 |

## P0：先處理穩定性

### Redis 與 Worker 啟用

- [ ] 在實際執行環境補上 `REDIS_ENABLED=true`。
- [ ] 設定正確的 `REDIS_URL`；本機開發使用 `redis://localhost:6379/0`，Compose 使用 `redis://redis:6379/0`。
- [ ] 啟動 Redis server。
- [ ] 啟動 ARQ worker。
- [ ] 確認 Backend 啟動時 Redis ping 成功。
- [ ] 確認 `queue.ping` 可以成功入列並由 worker 執行。
- [ ] 確認 Redis 中斷時 API 有明確 degraded 狀態，而不是只有靜默跳過。

驗收標準：

- Health check 能分別顯示 PostgreSQL、Redis、Proxmox 與 ARQ 狀態。
- API rate limit 與 JWT token blacklist 實際生效。
- ARQ 任務可以在 Backend restart 後繼續執行。

### Scheduler 單例化

- [ ] 確認正式環境實際 Backend worker 數量。
- [ ] 將 Scheduler 拆成獨立 service，或加入 PostgreSQL advisory lock／Redis lock。
- [ ] 確保同一時間只有一個 Scheduler leader。
- [ ] 每個排程工作加入執行 timeout。
- [ ] 每個排程工作記錄開始、完成、耗時與錯誤。
- [ ] 避免 snapshot cleanup、mining detection 等慢工作延遲 provisioning。

驗收標準：

- 啟動 4 個 Backend worker 時，每個排程週期仍只執行一次。
- 任一治理工作 timeout 時，其他工作仍可準時執行。

## P1：改善主要頁面速度

### Proxmox Cluster Snapshot Cache

- [ ] 建立統一 `ClusterSnapshotService`。
- [ ] 將 `cluster/resources` 結果快取至 Redis，TTL 設為 3～5 秒。
- [ ] 將 node 狀態快取至 Redis，TTL 設為 5～10 秒。
- [ ] 將 Proxmox 設定快取 30～60 秒。
- [ ] 管理員更新 Proxmox 設定時主動清除設定快取。
- [ ] VM start、stop、create、delete 完成後主動清除 cluster snapshot。
- [ ] 加入 single-flight，避免快取過期時多個請求同時打 Proxmox。
- [ ] 讓監控、資源列表、教室、容量評估與治理掃描共用 snapshot。

驗收標準：

- 同一個 5 秒區間內，多個頁面讀取只觸發一次 `cluster/resources`。
- Proxmox 暫時無法連線時，可短暫回傳 stale cache 並標示資料時間。
- 不影響資源租借所需的容量與 placement 評估。

### 移除資源列表 N+1

- [ ] 資源清單一次批量讀取所有需要的 `Resource`。
- [ ] 一次批量讀取所有需要的 `ResourceNetwork`。
- [ ] 使用 `vmid` map 合併 DB 與 Proxmox 資料。
- [ ] 移除資源列表內逐台呼叫 `get_ip_address()`。
- [ ] 移除 response 組裝過程中的逐台 DB update／flush。
- [ ] 資源列表優先讀取現有 IP cache。
- [ ] IP 缺少或過期時，交由背景 worker 更新。
- [ ] 為 IP refresh 設定併發上限與 timeout。

驗收標準：

- 資源數量增加時，DB query 數不隨 VM 數量線性增加。
- 一次資源清單請求不會逐台寫入資料庫。
- `GET /api/v1/resources/my` 在一般 LAN 環境的 p95 低於 150 ms。

## P2：背景工作可靠化

### 將長工作搬到 ARQ

- [ ] 建立 `vm.provision` 任務。
- [ ] 建立 `vm.delete` 任務。
- [ ] 建立 `vm.reset` 任務。
- [ ] 建立 `vm.control` 任務。
- [ ] 建立 `config.push` 任務。
- [ ] 建立 `batch.spec` 任務。
- [ ] 建立 `snapshot.cleanup` 任務。
- [ ] 建立 `ip.refresh` 任務。
- [ ] 所有任務使用穩定 job ID 避免重複執行。
- [ ] 所有任務寫入 `TaskRecord` 狀態與進度。
- [ ] 為可重試錯誤設定 exponential backoff。
- [ ] 針對不可重試錯誤立即標記 failed。
- [ ] 保留操作冪等性，避免 retry 建立重複 VM。

### 工作佇列分流

- [ ] Proxmox heavy queue concurrency 設為 2～4。
- [ ] SSH/config queue concurrency 設為 4～8。
- [ ] Notification queue concurrency 設為 8～16。
- [ ] 補上 queue depth、執行中數量、成功率與失敗率監控。

驗收標準：

- Backend reload 不會造成已接受的工作遺失。
- 重複送出相同操作時不會產生重複 VM 或重複刪除。
- 高負載批次工作不會阻塞一般 API。

## P3：降低前端輪詢

- [ ] pending request 為空時停止每 5 秒輪詢。
- [ ] pending request 輪詢改成 2、4、8、15、30 秒退避。
- [ ] 所有固定輪詢在 `document.hidden` 時暫停。
- [ ] Pair session 輪詢在元件不可見時暫停。
- [ ] Classroom students 改用事件更新或降低固定輪詢頻率。
- [ ] Batch/config progress 優先改用 SSE 或 WebSocket。
- [ ] VM request 狀態變更時推播給使用者。
- [ ] 多 worker 環境以 Redis Pub/Sub 傳遞跨程序事件。
- [ ] WebSocket 中斷時保留低頻輪詢 fallback。

驗收標準：

- 沒有 pending request 時，不再固定呼叫 `/vm-requests/my`。
- 背景分頁不持續產生監控與狀態請求。
- 工作完成後 UI 能在 2 秒內更新。

## P4：資料庫與查詢優化

- [ ] 為主要 API 加入 query count 測試。
- [ ] 修正 course path progress 的逐學生／逐 room 查詢。
- [ ] 將使用者與完成題目一次批量載入。
- [ ] 檢查 scheduler due query 的實際執行計畫。
- [ ] 檢查 `idle_checked_at`、`mining_checked_at` 是否需要複合或 partial index。
- [ ] 啟用或評估 `pg_stat_statements`。
- [ ] 找出平均耗時與總耗時最高的 SQL。
- [ ] 清理 Alembic `check` 顯示的 teacher judge schema drift，另建獨立 migration。

驗收標準：

- 常用列表 API 有固定 query count 上限。
- 資料筆數增加時不產生明顯 N+1。
- Alembic schema check 無未納管差異。

## P5：監控與效能驗收

- [ ] 增加 Proxmox API latency histogram。
- [ ] 增加 Redis command latency 與 error counter。
- [ ] 增加 Scheduler task duration 與 last-success timestamp。
- [ ] 增加 ARQ queue depth、running、retry、failed 指標。
- [ ] 增加 DB pool checked-out／overflow 指標。
- [ ] 增加 thread pool saturation 指標。
- [ ] Prometheus 指標區分 route、status 與外部服務。
- [ ] 建立資源頁、監控頁、申請流程的壓力測試。
- [ ] 建立 10、50、100 台 VM 規模的效能基準。

建議目標：

| 項目 | 目標 |
|---|---:|
| 一般 DB API p95 | 低於 200 ms |
| 資源列表 p95 | 低於 300 ms |
| 監控 overview p95 | 低於 300 ms |
| 工作建立 API | 低於 200 ms 回傳 202 |
| UI 工作狀態更新 | 2 秒內 |
| Scheduler 重複執行 | 0 次 |
| 已接受背景工作遺失 | 0 件 |

## 建議執行批次

### 第一批

- [ ] 啟用 Redis 與 ARQ worker。
- [ ] Scheduler 加入單例鎖。
- [ ] 實作 Proxmox cluster snapshot cache。
- [ ] 資源清單改成批量查詢，移除逐台 IP 查詢與 DB 寫入。
- [ ] pending request 沒資料時停止輪詢。

### 第二批

- [ ] Provision、delete、reset 搬到 ARQ。
- [ ] 增加 queue、scheduler、Proxmox 外部呼叫監控。
- [ ] 將工作進度改成 SSE/WebSocket。

### 第三批

- [ ] 修正 course progress N+1。
- [ ] 完成 Redis Pub/Sub 與多 worker 即時事件。
- [ ] 執行 10／50／100 台 VM 壓力測試並記錄結果。

## 執行紀錄

| 日期 | 批次／項目 | 結果 | 備註 |
|---|---|---|---|
| 2026-07-17 | 建立優化待辦文件 | 完成 | 尚未開始修改程式 |

