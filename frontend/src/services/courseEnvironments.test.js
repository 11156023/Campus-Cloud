import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  courseNodeHasUsableSource,
  CourseEnvironmentsService,
  environmentPayload,
} from "./courseEnvironments";

const jsonRes = (body) => ({
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

describe("CourseEnvironmentsService", () => {
  test("published list uses the classroom selection endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonRes([]));
    vi.stubGlobal("fetch", fetchMock);

    await CourseEnvironmentsService.listPublished();

    expect(fetchMock.mock.calls[0][0]).toContain(
      "/api/v1/course-environments/published",
    );
  });

  test("payload stores memory in MB and pins the PVE template", () => {
    const payload = environmentPayload({
      code: "WEB",
      name: "Web Lab",
      description: "",
      usageScope: "both",
      nodes: [{
        id: "web",
        sourceTemplateId: "tpl-id",
        name: "Web",
        role: "server",
        type: "VM",
        cpu: 2,
        memory: 4,
        disk: 30,
        network: "lab-net",
      }],
    });

    expect(payload.usage_scope).toBe("both");
    expect(payload.nodes[0]).toEqual({
      node_key: "web",
      source_type: "template",
      source_template_id: "tpl-id",
      custom_image_ref: null,
      custom_username: null,
      custom_unprivileged: true,
      name: "Web",
      role: "server",
      resource_type: "qemu",
      cpu: 2,
      memory_mb: 4096,
      disk_gb: 30,
      network: "lab-net",
      position_x: 80,
      position_y: 120,
    });
  });

  test("payload supports a custom LXC node and firewall-style edge", () => {
    const payload = environmentPayload({
      code: "NET",
      name: "Network Lab",
      nodes: [
        { id: "fw", sourceType: "custom", customImageRef: "local:vztmpl/debian.tar.zst", customUnprivileged: true, name: "Firewall", role: "gateway", type: "lxc", cpu: 2, memory: 2, disk: 8, network: "lab-net" },
        { id: "web", sourceType: "custom", customImageRef: "9000", customUsername: "student", name: "Web", role: "server", type: "qemu", cpu: 2, memory: 4, disk: 20, network: "lab-net" },
      ],
      edges: [{ source: "fw", target: "web", direction: "one_way", protocol: "tcp", port: "443" }],
    });

    expect(payload.nodes[0].source_template_id).toBeNull();
    expect(payload.nodes[0].custom_image_ref).toContain("debian");
    expect(payload.edges[0]).toEqual({
      source_node_key: "fw",
      target_node_key: "web",
      direction: "one_way",
      protocol: "tcp",
      port: 443,
    });
  });

  test("classroom selection accepts both machine templates and custom images", () => {
    expect(courseNodeHasUsableSource({
      sourceType: "template",
      sourceTemplateId: "tpl-id",
    })).toBe(true);
    expect(courseNodeHasUsableSource({
      sourceType: "custom",
      customImageRef: "local:vztmpl/debian.tar.zst",
    })).toBe(true);
    expect(courseNodeHasUsableSource({
      sourceType: "custom",
      sourceTemplateId: null,
      customImageRef: "",
    })).toBe(false);
  });
});
