import {
  apiDelete,
  apiGet,
  apiGetBlob,
  apiPatch,
  apiPost,
  apiPostMultipart,
} from "./api";

/** 範本 icon URL 白名單：僅接受本服務的 icon 端點或本地 blob 預覽。
 * icon_url 來自 API 資料，直接進 <img src> 前先驗證格式（防 XSS）。 */
const ICON_URL_RE = /^\/api\/v1\/templates\/[0-9a-fA-F-]{36}\/icon(\?v=\d+)?$/;

export function safeTemplateIconUrl(url) {
  if (!url) return null;
  if (url.startsWith("blob:")) return url; // 上傳前的本地預覽（createObjectURL）
  return ICON_URL_RE.test(url) ? url : null;
}

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

  /** 上傳範本 icon（擁有者或 admin；PNG/JPEG/WebP/SVG/GIF，2MB 內） */
  uploadIcon(templateId, file) {
    const form = new FormData();
    form.append("file", file);
    return apiPostMultipart(`/api/v1/templates/${templateId}/icon`, form);
  },

  /** 移除範本 icon */
  removeIcon(templateId) {
    return apiDelete(`/api/v1/templates/${templateId}/icon`);
  },

  /** 列出範本附件（使用手冊等） */
  listAttachments(templateId) {
    return apiGet(`/api/v1/templates/${templateId}/attachments`);
  },

  /** 上傳範本附件（擁有者或 admin，50MB 內） */
  uploadAttachment(templateId, file) {
    const form = new FormData();
    form.append("file", file);
    return apiPostMultipart(`/api/v1/templates/${templateId}/attachments`, form);
  },

  /** 刪除範本附件 */
  removeAttachment(templateId, attachmentId) {
    return apiDelete(
      `/api/v1/templates/${templateId}/attachments/${attachmentId}`,
    );
  },

  /** 下載附件（回傳 Blob，配 downloadBlob 使用） */
  downloadAttachment(templateId, attachmentId) {
    return apiGetBlob(
      `/api/v1/templates/${templateId}/attachments/${attachmentId}/download`,
    );
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
