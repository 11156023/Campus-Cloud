import { ResourcesService } from "../../../../services/resources";

/* 學生首頁與課程總覽共用的純邏輯；不含任何畫面，方便單獨測試。 */

/** 把任意進度值收斂成 0–100 的整數。 */
export function toPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

/**
 * 從課程或章節清單挑出「現在該做的那一個」。
 * 優先順序：進行中（0 < 進度 < 100）→ 尚未完成 → 第一筆。
 */
export function pickInProgress(items) {
  const list = items ?? [];
  return (
    list.find((item) => toPercent(item.progress_percent) > 0 && toPercent(item.progress_percent) < 100)
    ?? list.find((item) => toPercent(item.progress_percent) < 100)
    ?? list[0]
    ?? null
  );
}

/** 取台北時區的 YYYY-MM-DD，用來比對「是否已發布到今天」。 */
function taipeiDateKey(value) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

/** 保留已發布到今天（含）的任務，排除未來任務，並依發布日期由舊到新排列。 */
export function assignmentsUntilToday(assignments, now = new Date()) {
  const todayKey = taipeiDateKey(now);
  return [...(assignments ?? [])]
    .filter((assignment) => {
      if (!assignment?.approved_at) return true;
      const approvedAt = new Date(assignment.approved_at);
      return !Number.isNaN(approvedAt.getTime()) && taipeiDateKey(approvedAt) <= todayKey;
    })
    .sort((left, right) => {
      const leftTime = left.approved_at ? new Date(left.approved_at).getTime() : 0;
      const rightTime = right.approved_at ? new Date(right.approved_at).getTime() : 0;
      return leftTime - rightTime;
    });
}

/** 任務列上的發布日期；沒有日期或格式錯誤時退回「已發布」。 */
export function formatAssignmentDate(value) {
  if (!value) return "已發布";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "已發布";
  return new Intl.DateTimeFormat("zh-TW", { month: "numeric", day: "numeric" }).format(date);
}

/** 課表時間（HH:MM，24 小時制）；無法解析時回空字串。 */
export function formatScheduleTime(value) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(parsed);
}

/** 把課表 API 的扁平欄位收進 schedule 物件，讓兩個頁面用同一組欄位名。 */
export function normalizeSchedule(row) {
  return {
    ...row,
    schedule: {
      state: row.state,
      label: row.label,
      time: `${formatScheduleTime(row.start_at)}–${formatScheduleTime(row.end_at)}`,
      teacher: row.teacher,
      place: row.location,
    },
  };
}

/**
 * 合併「課程定義的機器」與「我的資源即時狀態」。
 * 舊課程只有單一房間部署時，退回用 deployment 補一台。
 */
export function buildPracticeMachines(classMachines, resources, deployment, roomTitle) {
  const machines = (classMachines ?? []).map((machine) => {
    const resource = (resources ?? []).find(
      (item) => machine.vmid != null && Number(item.vmid) === Number(machine.vmid),
    );
    return {
      ...machine,
      ...resource,
      classMachineName: machine.name,
      classMachineRole: machine.role,
      type: resource?.type ?? machine.resource_type,
      name: resource?.name ?? machine.name,
    };
  });

  if (machines.length === 0 && deployment?.vmid) {
    const fallbackResource = (resources ?? []).find(
      (resource) => Number(resource.vmid) === Number(deployment.vmid),
    );
    machines.push({
      ...fallbackResource,
      vmid: deployment.vmid,
      status: fallbackResource?.status ?? deployment.status,
      type: fallbackResource?.type ?? "qemu",
      name: fallbackResource?.name ?? roomTitle ?? "課堂練習機",
      classMachineName: roomTitle ?? "課堂練習機",
      classMachineRole: "本章節練習環境",
    });
  }

  return machines;
}

/** 課堂機器按鈕的文字；學生只看到狀態，不提供手動開關機。 */
export function practiceMachineActionLabel(machine, openingMachineId = null) {
  if (machine?.vmid == null) return "環境配置中";
  if (openingMachineId === machine.vmid) return "正在啟動…";
  if (machine.status === "running") return "進入機器";
  return "啟動並進入";
}

/** 送出開機後輪詢資源狀態，直到 running 或次數用盡（約 20 秒）。 */
export async function waitForPracticeMachine(vmid, attempts = 20) {
  let resource = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    resource = await ResourcesService.get(vmid);
    if (resource.status === "running") return resource;
    if (attempt < attempts - 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
    }
  }
  return resource;
}
