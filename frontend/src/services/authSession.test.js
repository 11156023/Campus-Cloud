import { beforeEach, describe, expect, test, vi } from "vitest";
import { AuthStorage } from "./auth";
import { AuthSessionStatus, restoreStoredSession } from "./authSession";

function fakeStorage() {
  const values = new Map();
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

const jsonRes = (status, body = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

let fetchMock;
let dispatched;

beforeEach(() => {
  vi.stubGlobal("localStorage", fakeStorage());
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  dispatched = [];
  const target = new EventTarget();
  vi.stubGlobal("window", {
    addEventListener: (...args) => target.addEventListener(...args),
    removeEventListener: (...args) => target.removeEventListener(...args),
    dispatchEvent: (event) => {
      dispatched.push(event.type);
      return target.dispatchEvent(event);
    },
  });
});

describe("restoreStoredSession", () => {
  test("舊版 token keys 會遷移到同一個 session generation，不要求重新登入", async () => {
    localStorage.setItem("access_token", "legacy-access");
    localStorage.setItem("refresh_token", "legacy-refresh");
    fetchMock.mockResolvedValueOnce(jsonRes(200, { id: 1, name: "Legacy User" }));

    await expect(restoreStoredSession()).resolves.toMatchObject({
      status: AuthSessionStatus.AUTHENTICATED,
      user: { id: 1, name: "Legacy User" },
    });
    expect(AuthStorage.getSnapshot().sessionId).toBeTruthy();
    expect(AuthStorage.getAccessToken()).toBe("legacy-access");
    expect(AuthStorage.getRefreshToken()).toBe("legacy-refresh");
    expect(localStorage.getItem("access_token")).toBe(null);
    expect(localStorage.getItem("refresh_token")).toBe(null);
  });

  test("沒有 access token 時回 anonymous，不呼叫 API", async () => {
    await expect(restoreStoredSession()).resolves.toEqual({
      status: AuthSessionStatus.ANONYMOUS,
      user: null,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("users/me 成功時還原 authenticated session", async () => {
    AuthStorage.setTokens({ access_token: "access", refresh_token: "refresh" });
    fetchMock.mockResolvedValueOnce(jsonRes(200, { id: 1, name: "User" }));

    await expect(restoreStoredSession()).resolves.toEqual({
      status: AuthSessionStatus.AUTHENTICATED,
      user: { id: 1, name: "User" },
    });
    expect(AuthStorage.getAccessToken()).toBe("access");
  });

  test("users/me 500 時回 unavailable 並保留 token", async () => {
    AuthStorage.setTokens({ access_token: "access", refresh_token: "refresh" });
    fetchMock.mockResolvedValueOnce(jsonRes(500, { detail: "backend restarting" }));

    const result = await restoreStoredSession();

    expect(result.status).toBe(AuthSessionStatus.UNAVAILABLE);
    expect(result.error).toMatchObject({ status: 500 });
    expect(AuthStorage.getAccessToken()).toBe("access");
    expect(AuthStorage.getRefreshToken()).toBe("refresh");
    expect(dispatched).not.toContain("auth:unauthorized");
  });

  test("users/me 網路錯誤時回 unavailable 並保留 token", async () => {
    AuthStorage.setTokens({ access_token: "access", refresh_token: "refresh" });
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const result = await restoreStoredSession();

    expect(result.status).toBe(AuthSessionStatus.UNAVAILABLE);
    expect(AuthStorage.getAccessToken()).toBe("access");
    expect(dispatched).not.toContain("auth:unauthorized");
  });

  test("access 401 且 refresh 401 時才回 anonymous 並清 token", async () => {
    AuthStorage.setTokens({ access_token: "access", refresh_token: "expired" });
    fetchMock
      .mockResolvedValueOnce(jsonRes(401))
      .mockResolvedValueOnce(jsonRes(401));

    const result = await restoreStoredSession();

    expect(result.status).toBe(AuthSessionStatus.ANONYMOUS);
    expect(AuthStorage.getAccessToken()).toBe(null);
    expect(AuthStorage.getRefreshToken()).toBe(null);
    expect(dispatched).toContain("auth:unauthorized");
  });

  test("access 401 但 refresh 503 時回 unavailable 並保留 token", async () => {
    AuthStorage.setTokens({ access_token: "access", refresh_token: "refresh" });
    fetchMock
      .mockResolvedValueOnce(jsonRes(401))
      .mockResolvedValueOnce(jsonRes(503, { detail: "maintenance" }));

    const result = await restoreStoredSession();

    expect(result.status).toBe(AuthSessionStatus.UNAVAILABLE);
    expect(result.error).toMatchObject({ status: 503, authUnavailable: true });
    expect(AuthStorage.getAccessToken()).toBe("access");
    expect(AuthStorage.getRefreshToken()).toBe("refresh");
    expect(dispatched).not.toContain("auth:unauthorized");
  });
});
