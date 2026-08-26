import { beforeEach, describe, expect, test, vi } from "vitest";
import { BatchProvisionService } from "./batchProvision";
import { TeachingClassesService } from "./teachingClasses";

const jsonRes = (body = {}) => ({
  ok: true,
  status: 200,
  json: async () => body,
});

beforeEach(() => {
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  });
});

describe("TeachingClassesService", () => {
  test("runs full capacity preview before provisioning", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonRes({ ready: true }));
    vi.stubGlobal("fetch", fetchMock);

    await TeachingClassesService.capacityPreview("class-1");

    expect(fetchMock.mock.calls[0][0]).toContain(
      "/api/v1/teaching-classes/class-1/capacity-preview",
    );
  });

  test("supports retry and reset recovery actions", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonRes({ status: "pending_review" }))
      .mockResolvedValueOnce(jsonRes({ status: "planning" }));
    vi.stubGlobal("fetch", fetchMock);

    await TeachingClassesService.retryFailed("class-1");
    await TeachingClassesService.resetFailed("class-1");

    expect(fetchMock.mock.calls[0][0]).toContain("/class-1/retry-failed");
    expect(fetchMock.mock.calls[1][0]).toContain("/class-1/reset-failed");
  });

  test("supports class extension, archive, and reclaim lifecycle", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonRes({ end_date: "2026-12-31" }))
      .mockResolvedValueOnce(jsonRes({ class: { status: "archived" } }))
      .mockResolvedValueOnce(jsonRes({ queued_vmids: [101] }));
    vi.stubGlobal("fetch", fetchMock);

    await TeachingClassesService.extend("class-1", "2026-12-31");
    await TeachingClassesService.archive("class-1");
    await TeachingClassesService.reclaim("class-1", { force: true });

    expect(fetchMock.mock.calls[0][0]).toContain("/class-1/extend");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ end_date: "2026-12-31" });
    expect(fetchMock.mock.calls[1][0]).toContain("/class-1/archive");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ reclaim_resources: true, force: false });
    expect(fetchMock.mock.calls[2][0]).toContain("/class-1/reclaim");
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ reclaim_resources: true, force: true });
  });

  test("admin reviews all class nodes through one endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonRes([]));
    vi.stubGlobal("fetch", fetchMock);

    await BatchProvisionService.reviewClass("class-1", { decision: "approved" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/v1/batch-provision/class/class-1/review");
    expect(init.method).toBe("POST");
  });
});
