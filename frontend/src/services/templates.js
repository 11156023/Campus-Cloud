import { apiDelete, apiGet, apiPatch, apiPost } from "./api";

export const TemplatesService = {
  /** 列出可見範本（admin 全部；teacher 自有+可見；student 僅 ready 且可見） */
  list(options) {
    return apiGet("/api/v1/templates/", options);
  },

  /** 單一範本 */
  get(templateId) {
    return apiGet(`/api/v1/templates/${templateId}`);
  },

  /** 把現有 VM/LXC 轉為範本（背景任務） */
  create(body) {
    return apiPost("/api/v1/templates/", body);
  },

  /** 更新範本 metadata / 可見範圍 */
  update(templateId, body) {
    return apiPatch(`/api/v1/templates/${templateId}`, body);
  },

  /** 重新送出失敗的母機轉換任務 */
  retry(templateId) {
    return apiPost(`/api/v1/templates/${templateId}/retry`, {});
  },

  /** 刪除範本（仍有 linked clone 子機時後端回 409） */
  remove(templateId) {
    return apiDelete(`/api/v1/templates/${templateId}`);
  },

  /** 從範本克隆開通（student 單台；teacher/admin 可批量） */
  clone(templateId, body) {
    return apiPost(`/api/v1/templates/${templateId}/clone`, body);
  },

  /** 更新循環：克隆暫存母機 / 轉為新版 / 取消 */
  startUpdateCycle(templateId) {
    return apiPost(`/api/v1/templates/${templateId}/update-cycle/start`, {});
  },
  finishUpdateCycle(templateId) {
    return apiPost(`/api/v1/templates/${templateId}/update-cycle/finish`, {});
  },
  cancelUpdateCycle(templateId) {
    return apiPost(`/api/v1/templates/${templateId}/update-cycle/cancel`, {});
  },
};
