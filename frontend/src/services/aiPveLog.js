import { apiPost } from "./api";

export const AiPveLogService = {
  /**
   * AI-PVE 對話。
   * 第一輪帶 { message, group_id }；之後帶完整 { messages, group_id } 歷史。
   * 回應含 reply / tools_called / needs_confirmation / messages / error。
   */
  chat(payload) {
    return apiPost("/api/v1/ai/pve-log/chat", payload);
  },

  /** 回覆 AI 請求的 SSH 指令確認（approved + 可修改後的 command） */
  confirmSsh({ token, approved, command }) {
    return apiPost("/api/v1/ai/pve-log/ssh/confirm", { token, approved, command });
  },
};

export function createAiPveLogService(scope) {
  if (!scope || scope.type === "group") {
    const groupId = scope?.id;
    return {
      chat(payload) {
        return AiPveLogService.chat({ ...payload, group_id: groupId });
      },
      confirmSsh(payload) {
        return apiPost("/api/v1/ai/pve-log/ssh/confirm", {
          ...payload,
          group_id: groupId,
        });
      },
    };
  }
  if (scope.type === "teaching-class") {
    const base = `/api/v1/teaching-classes/${scope.id}/ai/pve-log`;
    return {
      chat(payload) {
        return apiPost(`${base}/chat`, payload);
      },
      confirmSsh(payload) {
        return apiPost(`${base}/ssh/confirm`, payload);
      },
    };
  }
  throw new Error("Invalid AI PVE scope");
}
