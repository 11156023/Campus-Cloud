import { apiPost } from "./api";

export const AiNavigationService = {
  /**
   * 以自然語言解析導航意圖。
   *
   * @param {string} query 這一輪的問題
   * @param {{history?: {role: "user"|"assistant", content: string}[],
   *          currentPath?: string}} options
   *   history 是同一段對話的前文（伺服器端沒有會話表，由前端保存），
   *   currentPath 讓後端判斷流程已經走到哪一步。
   *
   * 回傳 { intent, confidence, action: "navigate"|"suggest"|"clarify"|"guide",
   *        primary?: { title, path, reason, state? }, suggestions: [...],
   *        clarification_question?, flow_id?, flow_title?, steps: [...], active_step? }
   */
  resolve(query, { history = [], currentPath = null } = {}) {
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
    });
  },

  /**
   * 配置模式：問清楚需求再產生配置。回傳還缺哪一格、下一題要問什麼。
   * 判斷在伺服器端本地做（不打模型），所以每一輪都是即時的。
   *
   * @param {{role: string, content: string}[]} history 目前為止的對話
   * @param {string[]} asked 已經問過的欄位 key（問句由推薦 AI 生成，字面對不上，
   *   所以要由前端記住問過什麼）
   * @returns {Promise<{ready: boolean, answered: number, total: number,
   *   known: string[], question: {key: string, text: string, options: string[]}|null,
   *   hint: string}>}
   */
  intake(history = [], asked = []) {
    return apiPost("/api/v1/ai/navigation/intake", {
      history: history
        .filter((message) => message?.role === "user" || message?.role === "assistant")
        .slice(-12)
        .map((message) => ({
          role: message.role,
          content: String(message.content ?? "").slice(0, 2000),
        })),
      asked,
    });
  },
};
