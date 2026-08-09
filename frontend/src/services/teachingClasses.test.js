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

  test("admin reviews all class nodes through one endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonRes([]));
    vi.stubGlobal("fetch", fetchMock);

    await BatchProvisionService.reviewClass("class-1", { decision: "approved" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/v1/batch-provision/class/class-1/review");
    expect(init.method).toBe("POST");
  });
});
