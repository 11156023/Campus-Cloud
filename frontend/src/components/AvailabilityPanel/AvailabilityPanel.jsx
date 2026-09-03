/**
 * AvailabilityPanel — 月曆日期範圍選擇器版
 * Props:
 *   draft         { resource_type, cores, memory, disk_size?, rootfs_size?, gpu_required?, gpu_mapping_id? }
 *   startAt/endAt Current form range; keeps direct input, AI import, and calendar selection in sync
 *   onChange      ({ start_at: string|null, end_at: string|null }) => void
 *   onHintChange  (hint: string|null) => void  — contextual UX hint for the parent to display
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { VmRequestAvailabilityService } from "../../services/vmRequestAvailability";
import styles from "./AvailabilityPanel.module.scss";
import MIcon from "../MIcon";

const MONTH_NAMES = ["一月","二月","三月","四月","五月","六月","七月","八月","九月","十月","十一月","十二月"];
const DAY_HEADERS = ["日","一","二","三","四","五","六"];

/* picking state: "extend" = waiting for user to pick end date; "idle" = can start fresh */
const PICK_EXTEND = "extend";
const PICK_IDLE   = "idle";
const AVAILABILITY_DEBOUNCE_MS = 450;
const AVAILABILITY_CACHE_TTL_MS = 30_000;
const AVAILABILITY_CACHE_MAX = 50;
const availabilityCache = new Map();

function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function localDateAt(dateStr, hour, minute = 0, second = 0) {
  const [year, month, day] = String(dateStr || "").split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day, hour, minute, second, 0);
}

function dateStrFromValue(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : toDateStr(date);
}

function isDraftReady(draft) {
  if (!draft?.resource_type || !draft?.cores || !draft?.memory) return false;
  return draft.resource_type === "vm" ? Boolean(draft.disk_size) : Boolean(draft.rootfs_size);
}

/* 依失敗原因給主訊息；api.js 逾時丟 {status:408, timeout:true}、
   Proxmox 全斷後端回 502、連不上後端則沒有 status */
function availabilityErrorTitle(error) {
  if (error?.timeout) return "伺服器回應較慢，時段月曆載入逾時";
  if (error?.status === 502) return "運算主機暫時沒有回應，查不到可用時段";
  if (error && !error.status) return "無法連線到伺服器，時段月曆暫時無法載入";
  return "時段月曆暫時載入失敗";
}

function cacheAvailability(key, data) {
  availabilityCache.set(key, { data, ts: Date.now() });
  while (availabilityCache.size > AVAILABILITY_CACHE_MAX) {
    availabilityCache.delete(availabilityCache.keys().next().value);
  }
}

export default function AvailabilityPanel({ draft, startAt, endAt, onChange, onHintChange, onDataChange }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const [retryToken, setRetryToken] = useState(0);

  const today = useMemo(() => new Date(), []);
  const todayStr = useMemo(() => toDateStr(today), [today]);
  const maxDate = useMemo(() => {
    const value = new Date(today);
    value.setDate(value.getDate() + 90);
    return value;
  }, [today]);
  const maxDateStr = useMemo(() => toDateStr(maxDate), [maxDate]);

  const [viewYear, setViewYear]   = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  const [startDate, setStartDate] = useState(() => dateStrFromValue(startAt));
  const [endDate, setEndDate]     = useState(() => dateStrFromValue(endAt));
  const [hoverDate, setHoverDate] = useState(null);
  const [picking, setPicking]     = useState(PICK_IDLE);

  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  const onHintChangeRef = useRef(onHintChange);
  useEffect(() => { onHintChangeRef.current = onHintChange; }, [onHintChange]);

  const onDataChangeRef = useRef(onDataChange);
  useEffect(() => { onDataChangeRef.current = onDataChange; }, [onDataChange]);

  useEffect(() => {
    const nextStartDate = dateStrFromValue(startAt);
    const nextEndDate = dateStrFromValue(endAt);
    if (startDate === nextStartDate && endDate === nextEndDate) return;
    setStartDate(nextStartDate);
    setEndDate(nextEndDate);
    setPicking(PICK_IDLE);
  }, [startAt, endAt]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    onDataChangeRef.current?.(data);
  }, [data]);

  /* ── Fetch ── */
  const draftReady = isDraftReady(draft);
  const draftKey = draftReady
    ? `${draft.resource_type}|${draft.cores}|${draft.memory}|${draft.disk_size ?? ""}|${draft.rootfs_size ?? ""}|${draft.gpu_required ?? 0}|${draft.gpu_mapping_id ?? ""}|${draft.ostemplate ?? ""}|${draft.template_id ?? ""}`
    : null;

  useEffect(() => {
    if (!draftKey) {
      setData(null);
      setLoading(false);
      return;
    }
    let cancelled = false;

    const cached = availabilityCache.get(draftKey);
    if (cached && Date.now() - cached.ts < AVAILABILITY_CACHE_TTL_MS) {
      setData(cached.data);
      setError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setData(null);
    setLoading(true);
    setError(null);
    const timeoutId = window.setTimeout(() => {
      if (cancelled) return;
      VmRequestAvailabilityService.preview(draft, { signal: controller.signal })
        .then((res) => {
          if (cancelled) return;
          cacheAvailability(draftKey, res);
          setData(res);
        })
        .catch((err) => {
          if (cancelled || err?.name === "AbortError") return;
          setError({ status: err?.status, timeout: Boolean(err?.timeout) });
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, data ? AVAILABILITY_DEBOUNCE_MS : 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [draftKey, retryToken]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Day map ── */
  const dayMap = useMemo(() => {
    const map = {};
    data?.days.forEach((d) => { map[d.date] = d; });
    return map;
  }, [data]);

  function getDayLevel(dateStr) {
    const day = dayMap[dateStr];
    if (!day) return null;
    const total     = day.slots.length;
    const available = day.slots.filter((s) => s.status === "available").length;
    const selectable = day.slots.filter((s) => s.status === "available" || s.status === "limited").length;
    if (selectable === 0) return "none";
    if (available / total >= 0.5) return "good";
    return "limited";
  }

  function isDateSelectable(dateStr) {
    const level = getDayLevel(dateStr);
    return Boolean(dateStr) && dateStr >= todayStr && dateStr <= maxDateStr && level && level !== "none";
  }

  useEffect(() => {
    if (!data || !startDate || !endDate) return;
    if (!isDateSelectable(startDate) || !isDateSelectable(endDate)) {
      setStartDate(null);
      setEndDate(null);
      setPicking(PICK_IDLE);
    }
  }, [data, startDate, endDate, todayStr]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Calendar grid ── */
  const calendarDays = useMemo(() => {
    const first = new Date(viewYear, viewMonth, 1);
    const last  = new Date(viewYear, viewMonth + 1, 0);
    const days  = Array(first.getDay()).fill(null);
    for (let d = 1; d <= last.getDate(); d++) days.push(new Date(viewYear, viewMonth, d));
    return days;
  }, [viewYear, viewMonth]);

  function prevMonth() {
    if (viewYear === today.getFullYear() && viewMonth === today.getMonth()) return;
    if (viewMonth === 0) { setViewYear((y) => y - 1); setViewMonth(11); }
    else setViewMonth((m) => m - 1);
  }
  function nextMonth() {
    if (viewYear === maxDate.getFullYear() && viewMonth === maxDate.getMonth()) return;
    if (viewMonth === 11) { setViewYear((y) => y + 1); setViewMonth(0); }
    else setViewMonth((m) => m + 1);
  }

  const canGoPrevious = viewYear > today.getFullYear()
    || (viewYear === today.getFullYear() && viewMonth > today.getMonth());
  const canGoNext = viewYear < maxDate.getFullYear()
    || (viewYear === maxDate.getFullYear() && viewMonth < maxDate.getMonth());

  /* ── Notify parent ── */
  /* 只在使用者「點擊月曆」時通知表單。不能用 effect 監聽 startDate/endDate：
     那會把表單 prop 同步進來的變化也回推出去（拍平成 00:00–23:59 的回聲），
     蓋掉使用者在 datetime-local 輸入框選的時間。 */
  function notifyRange(nextStart, nextEnd) {
    if (!nextStart || !nextEnd) {
      onChangeRef.current?.({ start_at: null, end_at: null });
      return;
    }
    const start = nextStart === todayStr ? new Date() : localDateAt(nextStart, 0);
    const end = localDateAt(nextEnd, 23, 59, 59);
    onChangeRef.current?.({
      start_at: start?.toISOString() ?? null,
      end_at: end?.toISOString() ?? null,
    });
  }

  /* ── Day click ── */
  function handleDayClick(dateStr, level) {
    if (!level || level === "none") return;
    if (picking === PICK_IDLE || !startDate) {
      setStartDate(dateStr); setEndDate(dateStr);
      setPicking(PICK_EXTEND);
      notifyRange(dateStr, dateStr);
    } else {
      if (dateStr > startDate) {
        setEndDate(dateStr);
        setPicking(PICK_IDLE);
        notifyRange(startDate, dateStr);
      } else {
        // Same or earlier date: restart as single-day
        setStartDate(dateStr); setEndDate(dateStr);
        notifyRange(dateStr, dateStr);
      }
    }
  }

  useEffect(() => {
    let hint = null;
    if (!startDate) hint = "點選日期即可選取單日，或繼續點選其他日期延伸範圍";
    else if (picking === PICK_EXTEND && startDate === endDate) hint = `已選單日 ${startDate}，審核通過後會依日期啟用`;
    else if (picking === PICK_IDLE && endDate)
      hint = "日期已選定，點選日期即可重新選擇";
    onHintChangeRef.current?.(hint);
  }, [startDate, endDate, picking]);

  /* ── Early returns ── */
  if (!draftReady) return (
    <div className={styles.root}>
      <p className={styles.hint}>先填完基本規格後，再選日期與連續時段。</p>
    </div>
  );
  if (loading) return (
    <div className={styles.root}>
      <div className={styles.skeletonWrap}>
        <div className={`${styles.skeleton} ${styles.skeletonCalendar}`} />
      </div>
    </div>
  );
  if (error || !data) return (
    <div className={styles.root}>
      <div className={styles.errorBox}>
        <div className={styles.errorText}>
          <span className={styles.errorTitle}>{availabilityErrorTitle(error)}</span>
          <span className={styles.errorDesc}>
            不影響申請送出——可直接在上方欄位填寫開始與結束時間。
          </span>
        </div>
        <button
          type="button"
          className={styles.retryBtn}
          onClick={() => setRetryToken((t) => t + 1)}
        >
          <MIcon name="refresh" size={13} />
          重新載入
        </button>
      </div>
    </div>
  );

  const isComplete     = startDate && endDate;
  const isHoverPreview = picking === PICK_EXTEND && Boolean(hoverDate) && hoverDate > startDate;
  const effectiveEnd   = isHoverPreview ? hoverDate : endDate;
  const hasRange       = picking === PICK_IDLE && Boolean(startDate) && Boolean(endDate) && startDate !== endDate;

  return (
    <div className={styles.root}>

      {/* ── Calendar ── */}
      <div className={styles.calendar}>
        <div className={styles.calendarNav}>
          <button type="button" className={styles.calendarNavBtn} onClick={prevMonth} disabled={!canGoPrevious}>
            <MIcon name="chevron_left" size={18} />
          </button>
          <span className={styles.calendarTitle}>{MONTH_NAMES[viewMonth]} {viewYear}</span>
          <button type="button" className={styles.calendarNavBtn} onClick={nextMonth} disabled={!canGoNext}>
            <MIcon name="chevron_right" size={18} />
          </button>
        </div>
        <div className={styles.calendarGrid}>
          {DAY_HEADERS.map((h) => (
            <div key={h} className={styles.calendarDayHeader}>{h}</div>
          ))}
          {calendarDays.map((d, i) => {
            if (!d) return <div key={`pad-${i}`} />;
            const dateStr  = toDateStr(d);
            const level    = getDayLevel(dateStr);
            const isPast   = dateStr < todayStr;
            const unavailable = isPast || dateStr > maxDateStr || !level || level === "none";
            const disabled = unavailable;
            const isStart   = dateStr === startDate;
            const isEnd     = dateStr === endDate;
            const inRange   = Boolean(startDate) && Boolean(effectiveEnd)
              && dateStr > startDate && dateStr < effectiveEnd;
            const isPreview = isHoverPreview && inRange;

            const dayClass = [
              styles.calendarDay,
              !unavailable && level === "good"    && styles.calendarDayGood,
              !unavailable && level === "limited" && styles.calendarDayLimited,
              !unavailable && level === "none"    && styles.calendarDayNone,
              isStart                          && styles.calendarDayStart,
              isEnd                            && styles.calendarDayEnd,
              isStart && hasRange              && styles.calendarDayStartBar,
              isEnd   && hasRange              && styles.calendarDayEndBar,
              inRange && !isPreview            && styles.calendarDayInRange,
              isPreview                        && styles.calendarDayPreview,
              unavailable                      && styles.calendarDayDisabled,
            ].filter(Boolean).join(" ");

            return (
              <button
                key={dateStr}
                type="button"
                disabled={disabled}
                className={dayClass}
                onClick={() => handleDayClick(dateStr, level)}
                onMouseEnter={() => picking === PICK_EXTEND && setHoverDate(dateStr)}
                onMouseLeave={() => setHoverDate(null)}
              >
                <span className={styles.dayInner}>{d.getDate()}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Legend ── */}
      <div className={styles.legend}>
        {[
          { cls: styles.calendarDayGood,    label: "可申請" },
          { cls: styles.calendarDayLimited, label: "名額有限" },
          { cls: styles.calendarDayNone,    label: "已滿" },
        ].map(({ cls, label }) => (
          <div key={label} className={styles.legendItem}>
            <span className={`${styles.legendDot} ${cls}`} />
            <span>{label}</span>
          </div>
        ))}
      </div>

      {/* ── Summary ── */}
      {isComplete && (
        <div className={styles.summary}>
          <MIcon name="check_circle" size={14} />
          <span>
            {startDate}
            {startDate !== endDate ? ` → ${endDate}` : ""}
          </span>
        </div>
      )}

    </div>
  );
}
