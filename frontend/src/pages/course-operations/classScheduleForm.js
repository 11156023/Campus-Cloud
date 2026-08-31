export const CLASS_TIMEZONES = ["Asia/Taipei", "Asia/Tokyo", "UTC"];

function localDate(date) {
  const value = new Date(date);
  value.setMinutes(value.getMinutes() - value.getTimezoneOffset());
  return value.toISOString().slice(0, 10);
}

export function createClassScheduleForm(item = null, today = new Date()) {
  const start = new Date(today);
  start.setDate(start.getDate() + ((8 - start.getDay()) % 7));
  const end = new Date(start);
  end.setMonth(end.getMonth() + 4);
  const rocYear = start.getFullYear() - 1911;

  return {
    name: item?.name ?? "",
    code: item?.code ?? "",
    term: item?.term ?? `${rocYear}-1`,
    location: item?.location ?? "",
    startDate: item?.startDate ?? item?.start_date ?? localDate(start),
    endDate: item?.endDate ?? item?.end_date ?? localDate(end),
    weekday: item?.weekday ?? (start.getDay() + 6) % 7,
    startTime:
      item?.startTime ?? String(item?.start_time ?? "13:10").slice(0, 5),
    endTime: item?.endTime ?? String(item?.end_time ?? "16:00").slice(0, 5),
    timezone: item?.timezone ?? "Asia/Taipei",
    bootLeadMinutes: item?.bootLeadMinutes ?? item?.boot_lead_minutes ?? 10,
  };
}

export function classSchedulePayload(form) {
  return {
    name: form.name.trim(),
    code: form.code.trim() || `CLASS-${Date.now().toString().slice(-8)}`,
    term: form.term.trim() || "未指定",
    location: form.location.trim() || null,
    start_date: form.startDate,
    end_date: form.endDate,
    weekday: Number(form.weekday),
    start_time: form.startTime,
    end_time: form.endTime,
    timezone: form.timezone,
    boot_lead_minutes: Number(form.bootLeadMinutes),
  };
}
