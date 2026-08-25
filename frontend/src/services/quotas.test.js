/**
 * quotas.test.js
 * 驗證配額 service 的 URL、method 與送出的 body。
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { QuotasService } from "./quotas";

function fakeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

const jsonRes = (status, body = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

let fetchMock;

beforeEach(() => {
  vi.stubGlobal("localStorage", fakeStorage());
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

describe("QuotasService 全域預設配額", () => {
  test("getGlobal 以 GET 打 /quotas/global", async () => {
    fetchMock.mockResolvedValueOnce(jsonRes(200, { max_cpu_cores: 8 }));

    await QuotasService.getGlobal();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/v1/quotas/global");
    expect(init.method ?? "GET").toBe("GET");
  });

  test("updateGlobal 以 PUT 送 partial 欄位", async () => {
    fetchMock.mockResolvedValueOnce(jsonRes(200, {}));

    await QuotasService.updateGlobal({ max_cpu_cores: 32, max_instances: 10 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/v1/quotas/global");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({
      max_cpu_cores: 32,
      max_instances: 10,
    });
  });
});

describe("QuotasService 個人覆寫", () => {
  test("update 以 PUT 打指定 quota id", async () => {
    fetchMock.mockResolvedValueOnce(jsonRes(200, {}));

    await QuotasService.update("q-1", { max_cpu_cores: 4 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/v1/quotas/q-1");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({ max_cpu_cores: 4 });
  });
});
