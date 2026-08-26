import { describe, expect, it } from "vitest";
import { machineRuntimeState, resourceUsageByVmid, usageForMetric } from "./classHeatmapUsage";

describe("class heatmap usage", () => {
  const machine = { vmid: 7300, status: "completed" };

  it("indexes one batch response by VMID", () => {
    const indexed = resourceUsageByVmid([{ vmid: 7300, status: "running" }]);
    expect(indexed["7300"].status).toBe("running");
  });

  it("distinguishes running, stopped, and unavailable machines", () => {
    expect(machineRuntimeState(machine, { status: "running" })).toBe("on");
    expect(machineRuntimeState(machine, { status: "stopped" })).toBe("off");
    expect(machineRuntimeState(machine, undefined)).toBe("unavailable");
  });

  it("reads real percentages without inventing a fallback value", () => {
    const runtime = { cpu_usage_pct: 42.67, ram_usage_pct: 75 };
    expect(usageForMetric(runtime, "cpu")).toBe(43);
    expect(usageForMetric(runtime, "ram")).toBe(75);
    expect(usageForMetric({}, "cpu")).toBeNull();
  });
});
