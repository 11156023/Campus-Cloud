/**
 * gpu.test.js
 * 驗證 GpuService.listOptions 的 query 組裝（含 node = 範本所在節點的叢集過濾）。
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { GpuService } from "./gpu";

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

describe("GpuService.listOptions", () => {
  test("無參數時不帶 query", async () => {
    fetchMock.mockResolvedValueOnce(jsonRes(200, []));

    await GpuService.listOptions();

    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/v1/gpu/options");
    expect(url).not.toContain("?");
  });

  test("帶 node 時附上叢集過濾參數", async () => {
    fetchMock.mockResolvedValueOnce(jsonRes(200, []));

    await GpuService.listOptions({ node: "pve205" });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain("node=pve205");
  });

  test("時段與 node 可同時帶", async () => {
    fetchMock.mockResolvedValueOnce(jsonRes(200, []));

    await GpuService.listOptions({
      startAt: "2026-08-28T10:00",
      endAt: "2026-08-28T12:00",
      node: "pve205",
    });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain("start_at=");
    expect(url).toContain("end_at=");
    expect(url).toContain("node=pve205");
  });
});
