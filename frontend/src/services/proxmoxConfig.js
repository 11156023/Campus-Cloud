import { apiDelete, apiGet, apiPost, apiPut } from "./api";

export const ProxmoxConfigService = {
  /** 連線列表（多 PVE 入口） */
  listConnections() {
    return apiGet("/api/v1/proxmox-config/connections");
  },

  /** 新增連線（name / host / port / user / password / verify_ssl / ca_cert / api_timeout / enabled / is_default） */
  createConnection(body) {
    return apiPost("/api/v1/proxmox-config/connections", body);
  },

  /** 更新連線（password 為 null 表示不更新） */
  updateConnection(connectionId, body) {
    return apiPut(`/api/v1/proxmox-config/connections/${connectionId}`, body);
  },

  /** 刪除連線（其節點與 Storage 記錄一併移除） */
  deleteConnection(connectionId) {
    return apiDelete(`/api/v1/proxmox-config/connections/${connectionId}`);
  },

  /** 測試指定連線 */
  testConnectionById(connectionId) {
    return apiPost(`/api/v1/proxmox-config/connections/${connectionId}/test`);
  },

  /** 同步指定連線的節點與 Storage */
  syncConnection(connectionId) {
    return apiPost(`/api/v1/proxmox-config/connections/${connectionId}/sync`);
  },

  /** 取得 PVE 連線與排程設定 */
  getConfig() {
    return apiGet("/api/v1/proxmox-config/");
  },

  /** 更新設定（需傳完整 ProxmoxConfigUpdate；password / ca_cert 選填） */
  updateConfig(body) {
    return apiPut("/api/v1/proxmox-config/", body);
  },

  /** 以暫存設定預覽叢集節點 */
  previewCluster(body) {
    return apiPost("/api/v1/proxmox-config/preview", body);
  },

  /** 節點列表 */
  getNodes() {
    return apiGet("/api/v1/proxmox-config/nodes");
  },

  /** 更新節點（host / port / priority） */
  updateNode(nodeId, body) {
    return apiPut(`/api/v1/proxmox-config/nodes/${nodeId}`, body);
  },

  /** 立即同步節點與 Storage */
  syncNow() {
    return apiPost("/api/v1/proxmox-config/sync-now");
  },

  /** 測試 PVE 連線 */
  testConnection() {
    return apiPost("/api/v1/proxmox-config/test");
  },

  /** 解析 CA 憑證 PEM */
  parseCert(pem) {
    return apiPost("/api/v1/proxmox-config/parse-cert", { pem });
  },

  /** Storage 列表 */
  getStorages() {
    return apiGet("/api/v1/proxmox-config/storages");
  },

  /** 更新 Storage（enabled / speed_tier / user_priority） */
  updateStorage(storageId, body) {
    return apiPut(`/api/v1/proxmox-config/storages/${storageId}`, body);
  },

  /** 叢集即時統計 */
  getClusterStats() {
    return apiGet("/api/v1/proxmox-config/cluster-stats");
  },
};
