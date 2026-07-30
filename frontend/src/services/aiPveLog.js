import { apiPost } from "./api";

export const AiPveLogService = {
  /**
   * 管理員層級的 AI-PVE 對話。
   * 第一輪帶 { message }；之後帶完整 { messages } 歷史。
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
