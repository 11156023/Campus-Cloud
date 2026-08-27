/**
 * templates.test.js
 * 驗證 TemplatesService 的 URL 組裝。
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { TemplatesService, safeTemplateIconUrl } from "./templates";

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

describe("safeTemplateIconUrl", () => {
  test("接受本服務 icon 端點與 blob 預覽，拒絕其他來源", () => {
    const good = "/api/v1/templates/0b7f8a3e-1234-4abc-9def-0123456789ab/icon?v=123";
    expect(safeTemplateIconUrl(good)).toBe(good);
    const blob = "blob:http://localhost:5173/0b7f8a3e-1234-4abc-9def-0123456789ab";
    expect(safeTemplateIconUrl(blob)).toBe(blob);
    expect(safeTemplateIconUrl("blob:http://x/abc")).toBeNull();
    expect(safeTemplateIconUrl(null)).toBeNull();
    expect(safeTemplateIconUrl("javascript:alert(1)")).toBeNull();
    expect(safeTemplateIconUrl("https://evil.example/icon.svg")).toBeNull();
    expect(safeTemplateIconUrl("/api/v1/users/x/avatar")).toBeNull();
  });
});

describe("TemplatesService", () => {
  test("clone 以 POST 送出克隆參數", async () => {
    fetchMock.mockResolvedValueOnce(jsonRes(200, { tasks: [] }));

    await TemplatesService.clone("tpl-1", { hostname: "lab", count: 3, start: true });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/v1/templates/tpl-1/clone");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ hostname: "lab", count: 3, start: true });
  });

  test("uploadIcon 以 multipart 上傳", async () => {
    fetchMock.mockResolvedValueOnce(jsonRes(200, { icon_url: "/api/v1/templates/tpl-1/icon?v=1" }));

    await TemplatesService.uploadIcon("tpl-1", new Blob(["png"]));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/v1/templates/tpl-1/icon");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
  });

  test("listAttachments 打到 attachments 列表", async () => {
    fetchMock.mockResolvedValueOnce(jsonRes(200, { data: [], count: 0 }));

    await TemplatesService.listAttachments("tpl-1");

    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/v1/templates/tpl-1/attachments");
  });

  test("removeAttachment 以 DELETE 刪除附件", async () => {
    fetchMock.mockResolvedValueOnce(jsonRes(200, { message: "ok" }));

    await TemplatesService.removeAttachment("tpl-1", "att-9");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/v1/templates/tpl-1/attachments/att-9");
    expect(init.method).toBe("DELETE");
  });

  test("startUpdateCycle 打到 update-cycle/start", async () => {
    fetchMock.mockResolvedValueOnce(jsonRes(200, {}));

    await TemplatesService.startUpdateCycle("tpl-1");

    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/v1/templates/tpl-1/update-cycle/start");
  });

  test("retry 以 POST 重新送出失敗的轉換", async () => {
    fetchMock.mockResolvedValueOnce(jsonRes(200, { template: {}, task: {} }));

    await TemplatesService.retry("tpl-1");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/v1/templates/tpl-1/retry");
    expect(init.method).toBe("POST");
  });
});
