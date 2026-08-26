import { apiDelete, apiGet, apiGetBlob, apiPost, apiPut } from "./api";

export const ResourcesService = {
  /** 克隆機來源範本的使用手冊（資源擁有者即可，不受範本可見範圍影響） */
  getTemplateManual(vmid) {
    return apiGet(`/api/v1/resources/${vmid}/template-manual`);
  },

  /** 下載來源範本手冊（回傳 Blob，配 downloadBlob 使用） */
  downloadTemplateManual(vmid, attachmentId) {
    return apiGetBlob(
      `/api/v1/resources/${vmid}/template-manual/${attachmentId}/download`,
    );
  },

  /** 取得我的資源列表 */
  list(options) {
    return apiGet("/api/v1/resources/my", options);
  },

  /** 取得單一資源 */
  get(vmid) {
    return apiGet(`/api/v1/resources/${vmid}`);
  },

  /** 取得資源目前配置（cpu_cores / memory_mb） */
  getConfig(vmid) {
    return apiGet(`/api/v1/resources/${vmid}/config`);
  },

  /** 取得所有資源列表（管理員） */
  listAll(options) {
    return apiGet("/api/v1/resources/", options);
  },

  /** 啟動 */
  start(vmid) {
    return apiPost(`/api/v1/resources/${vmid}/start`, {});
  },

  /** 強制停止 */
  stop(vmid) {
    return apiPost(`/api/v1/resources/${vmid}/stop`, {});
  },

  /** 正常關機 */
  shutdown(vmid) {
    return apiPost(`/api/v1/resources/${vmid}/shutdown`, {});
  },

  /** 重新啟動 */
  reboot(vmid) {
    return apiPost(`/api/v1/resources/${vmid}/reboot`, {});
  },

  /** 強制重置 */
  reset(vmid) {
    return apiPost(`/api/v1/resources/${vmid}/reset`, {});
  },

  /** 刪除（非同步，返回 202） */
  delete(vmid) {
    return apiDelete(`/api/v1/resources/${vmid}`);
  },

  /** 批次操作（action: start|stop|shutdown|reboot|reset|delete）→ { succeeded, failed } */
  batchAction(vmids, action) {
    return apiPost("/api/v1/resources/batch", { vmids, action });
  },

  /** 練習階段狀態（自動關機／到期警告用）→ { should_warn, warn_reason, ... } */
  sessionStatus(vmid) {
    return apiGet(`/api/v1/resources/${vmid}/session-status`);
  },

  /** 延長練習階段 → { vmid, auto_stop_at, extended_minutes } */
  extendSession(vmid) {
    return apiPost(`/api/v1/resources/${vmid}/extend-session`, {});
  },

  /** 取得 VNC 控制台資訊（QEMU VM） */
  getConsole(vmid) {
    return apiGet(`/api/v1/vm/${vmid}/console`);
  },

  /** 取得 SSH 金鑰 */
  getSshKey(vmid) {
    return apiGet(`/api/v1/resources/${vmid}/ssh-key`);
  },

  /* ── 詳情頁端點（resource_details.py） ── */

  /** 即時狀態（CPU/記憶體/磁碟/網路目前值） */
  getCurrentStats(vmid) {
    return apiGet(`/api/v1/resources/${vmid}/current-stats`);
  },

  /** RRD 歷史趨勢（timeframe: hour|day|week） */
  getStats(vmid, timeframe = "hour") {
    return apiGet(`/api/v1/resources/${vmid}/stats?timeframe=${timeframe}`);
  },

  /** 快照列表 */
  listSnapshots(vmid) {
    return apiGet(`/api/v1/resources/${vmid}/snapshots`);
  },

  /** 建立快照（body: { snapname, description, vmstate }） */
  createSnapshot(vmid, body) {
    return apiPost(`/api/v1/resources/${vmid}/snapshots`, body);
  },

  /** 刪除快照 */
  deleteSnapshot(vmid, snapname) {
    return apiDelete(
      `/api/v1/resources/${vmid}/snapshots/${encodeURIComponent(snapname)}`,
    );
  },

  /** 還原到指定快照 */
  rollbackSnapshot(vmid, snapname) {
    return apiPost(
      `/api/v1/resources/${vmid}/snapshots/${encodeURIComponent(snapname)}/rollback`,
      {},
    );
  },

  /** 管理員直改規格（body: { cores, memory, disk_size }） */
  updateSpecDirect(vmid, body) {
    return apiPut(`/api/v1/resources/${vmid}/spec/direct`, body);
  },

  /** 一鍵重置到初始快照（202，背景任務） */
  resetToInit(vmid) {
    return apiPost(`/api/v1/resources/${vmid}/reset-to-init`, {});
  },

  /** 建立初始快照（教師/管理員） */
  createInitSnapshot(vmid) {
    return apiPost(`/api/v1/resources/${vmid}/init-snapshot`, {});
  },
};
