import { AuthStorage } from "./auth";
import { apiGet } from "./api";

export const AuthSessionStatus = Object.freeze({
  CHECKING: "checking",
  AUTHENTICATED: "authenticated",
  ANONYMOUS: "anonymous",
  UNAVAILABLE: "unavailable",
});

/**
 * 以 localStorage 中的 token 還原登入狀態。
 *
 * 只有 API 層已確認 refresh token 失效並清除 token 時才回 anonymous；
 * 網路、timeout、CORS 與 5xx 一律保留 token，交由 UI 顯示暫時無法驗證。
 */
export async function restoreStoredSession({ signal } = {}) {
  if (!AuthStorage.isLoggedIn()) {
    return { status: AuthSessionStatus.ANONYMOUS, user: null };
  }

  try {
    const user = await apiGet("/api/v1/users/me", { signal });
    return { status: AuthSessionStatus.AUTHENTICATED, user };
  } catch (error) {
    if (error?.cancelled) throw error;
    if (error?.authExpired || !AuthStorage.isLoggedIn()) {
      return { status: AuthSessionStatus.ANONYMOUS, user: null };
    }
    return { status: AuthSessionStatus.UNAVAILABLE, user: null, error };
  }
}
