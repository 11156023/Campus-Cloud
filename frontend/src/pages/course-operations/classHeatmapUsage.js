export const RESOURCE_METRICS = {
  cpu: { label: "CPU", icon: "memory", field: "cpu_usage_pct" },
  ram: { label: "RAM", icon: "storage", field: "ram_usage_pct" },
};

export function resourceUsageByVmid(items = []) {
  return Object.fromEntries(items.map((item) => [String(item.vmid), item]));
}

export function machineRuntimeState(machine, runtime) {
  if (!machine?.vmid || !["completed", "running"].includes(machine.status)) return "unavailable";
  const status = String(runtime?.status ?? "").toLowerCase();
  if (["stopped", "offline", "shutdown", "off"].includes(status)) return "off";
  if (["running", "online", "started", "on"].includes(status)) return "on";
  return "unavailable";
}

export function usageForMetric(runtime, metric) {
  const field = RESOURCE_METRICS[metric]?.field;
  const raw = field ? runtime?.[field] : null;
  if (raw === null || raw === undefined || raw === "" || !Number.isFinite(Number(raw))) return null;
  return Math.round(Math.max(0, Math.min(100, Number(raw))));
}
