import { apiPost } from "./api";

export const AiNavigationService = {
  /**
   * 以自然語言解析導航意圖。
   *
   * @param {string} query 這一輪的問題
   * @param {{history?: {role: "user"|"assistant", content: string}[],
   *          currentPath?: string, sessionId?: string}} options
   *   history 是同一段對話的前文（伺服器端沒有會話表，由前端保存），
   *   currentPath 讓後端判斷流程已經走到哪一步。
   *
   * 回傳 { intent, confidence, action: "navigate"|"suggest"|"clarify"|"guide",
   *        primary?: { title, path, reason, state? }, suggestions: [...],
   *        clarification_question?, flow_id?, flow_title?, steps: [...], active_step? }
   */
  resolve(query, { history = [], currentPath = null, sessionId = null } = {}) {
    return apiPost("/api/v1/ai/navigation/resolve", {
      query,
      history: history
        .filter((message) => message?.role === "user" || message?.role === "assistant")
        .slice(-12)
        .map((message) => ({
          role: message.role,
          content: String(message.content ?? "").slice(0, 2000),
        })),
      current_path: currentPath,
      session_id: sessionId,
    });
  },
};
