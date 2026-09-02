import { describe, expect, it } from "vitest";
import { buildEnvironmentGroups, groupedResourceKeys } from "./environmentGroups";

describe("environment group builders", () => {
  it("merges quick session machines with live resources", () => {
    const groups = buildEnvironmentGroups(
      [{ vmid: 501, request_id: "request-1", name: "generated-name", status: "running", type: "lxc", node: "pve", ip_address: "10.0.0.5" }],
      [{ id: "session-1", kindLabel: "快速練習", title: "資料庫練習", expiresAt: "2026-08-27T15:00:00Z", status: "running", machines: [{ id: "machine-1", requestId: "request-1", name: "MySQL", role: "資料庫", type: "lxc", status: "provisioning" }] }],
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].machines[0]).toMatchObject({ name: "MySQL", status: "running", vmid: 501 });
    expect(groupedResourceKeys(groups).vmids.has(501)).toBe(true);
  });

  it("groups teaching-class resources separately", () => {
    const groups = buildEnvironmentGroups([
      { vmid: 601, request_id: "course-1", teaching_class_id: "class-1", name: "linux", status: "stopped", type: "qemu", environment_type: "網頁課" },
      { vmid: 602, request_id: "course-2", teaching_class_id: "class-1", name: "database", status: "running", type: "lxc", environment_type: "網頁課" },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ kind: "course", title: "網頁課" });
    expect(groups[0].machines).toHaveLength(2);
  });
});
