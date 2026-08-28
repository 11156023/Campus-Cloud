import { beforeEach, describe, expect, test, vi } from "vitest";
import { QuickPracticeService } from "./quickPractice";

const jsonRes = (body, status = 200) => ({
  ok: true,
  status,
  json: async () => body,
});

beforeEach(() => {
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  });
});

describe("QuickPracticeService", () => {
  test("normalizes a multi-machine environment", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonRes([{
      id: "environment-1",
      version_id: "version-1",
      usage_scope: "quick_practice",
      nodes: [{
        node_key: "mysql",
        resource_type: "lxc",
        memory_mb: 3072,
        disk_gb: 20,
      }],
    }])));

    const [template] = await QuickPracticeService.listTemplates();

    expect(template).toMatchObject({
      id: "environment-1",
      versionId: "version-1",
      usageScope: "quick_practice",
    });
    expect(template.nodes[0]).toMatchObject({
      id: "mysql",
      type: "lxc",
      memory: 3,
      disk: 20,
    });
  });

  test("launches the whole environment without student configuration", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonRes({
      id: "session-1",
      environment_id: "environment-1",
      environment_version_id: "version-1",
      kind_label: "快速練習",
      machines: [{
        id: "machine-1",
        request_id: "request-1",
        resource_type: "qemu",
        ip_address: null,
      }],
    }, 202));
    vi.stubGlobal("fetch", fetchMock);

    const session = await QuickPracticeService.launch("environment-1");

    expect(fetchMock.mock.calls[0][0]).toContain(
      "/api/v1/quick-practice/templates/environment-1/launch",
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({});
    expect(session.machines[0]).toMatchObject({
      requestId: "request-1",
      type: "qemu",
      ip: null,
    });
  });
});
