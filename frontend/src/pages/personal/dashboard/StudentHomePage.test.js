import { describe, expect, it, vi } from "vitest";

vi.mock("../resources/TerminalDialog", () => ({ default: () => null }));
vi.mock("../resources/VncDialog", () => ({ default: () => null }));

import {
  assignmentsUntilToday,
  buildPracticeMachines,
  practiceMachineActionLabel,
} from "./StudentHomePage";

describe("assignmentsUntilToday", () => {
  it("保留今天以前的所有任務、排除未來任務並依日期排列", () => {
    const assignments = assignmentsUntilToday([
      { id: "today", approved_at: "2026-08-25T15:00:00+08:00" },
      { id: "future", approved_at: "2026-08-26T09:00:00+08:00" },
      { id: "older", approved_at: "2026-08-18T09:00:00+08:00" },
      { id: "legacy", approved_at: null },
    ], new Date("2026-08-25T10:00:00+08:00"));

    expect(assignments.map((item) => item.id)).toEqual(["legacy", "older", "today"]);
  });
});

describe("buildPracticeMachines", () => {
  it("保留課程中的多台機器角色，並合併即時資源狀態", () => {
    const machines = buildPracticeMachines([
      { machine_node_id: "main", name: "操作主機", role: "主要練習機", resource_type: "qemu", vmid: 218, status: "completed" },
      { machine_node_id: "db", name: "資料庫主機", role: "資料庫驗證", resource_type: "lxc", vmid: null, status: "pending" },
    ], [
      { vmid: 218, name: "student-main", type: "qemu", status: "running" },
    ]);

    expect(machines).toHaveLength(2);
    expect(machines[0]).toMatchObject({
      classMachineName: "操作主機",
      classMachineRole: "主要練習機",
      name: "student-main",
      status: "running",
    });
    expect(machines[1]).toMatchObject({
      classMachineName: "資料庫主機",
      vmid: null,
      status: "pending",
    });
  });

  it("相容舊課程的單一房間部署", () => {
    const machines = buildPracticeMachines([], [
      { vmid: 301, name: "legacy-lab", type: "qemu", status: "running" },
    ], { vmid: 301, status: "running" }, "Linux 權限練習");

    expect(machines).toHaveLength(1);
    expect(machines[0]).toMatchObject({
      vmid: 301,
      classMachineName: "Linux 權限練習",
      classMachineRole: "本章節練習環境",
    });
  });
});

describe("practiceMachineActionLabel", () => {
  it("課堂機器只顯示自動開機狀態，不提供學生啟動操作", () => {
    expect(practiceMachineActionLabel({ vmid: 218, status: "running" })).toBe("直接開啟");
    expect(practiceMachineActionLabel({ vmid: 218, status: "stopped" })).toBe("等待自動開機");
    expect(practiceMachineActionLabel({ vmid: null, status: "pending" })).toBe("環境配置中");
  });
});
