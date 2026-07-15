import { apiGet } from "./api";
import { wsBaseUrl } from "../hooks/useClassroomSocket";

export const JobsService = {
  /** 列出統一背景任務,支援篩選 */
  list(params) {
    const q = new URLSearchParams();
    if (params?.kinds?.length)    q.set("kinds",        params.kinds.join(","));
    if (params?.statuses?.length) q.set("statuses",     params.statuses.join(","));
    if (params?.activeOnly)       q.set("active_only",  "true");
    if (params?.limit != null)    q.set("limit",        String(params.limit));
    if (params?.offset != null)   q.set("offset",       String(params.offset));
    if (params?.historyDays)      q.set("history_days", String(params.historyDays));
    const qs = q.toString();
    return apiGet(`/api/v1/jobs/${qs ? `?${qs}` : ""}`);
  },

  /** 最近 N 筆 (Banner popover 用) */
  recent(limit = 5) {
    return apiGet(`/api/v1/jobs/recent?limit=${limit}`);
  },

  /** 取得單一 Job 詳情 (id 格式: <kind>:<source_id>) */
  detail(jobId) {
    return apiGet(`/api/v1/jobs/${encodeURIComponent(jobId)}`);
  },
};

/**
 * 建立 /ws/jobs 即時推送連線，每次收到後端 snapshot 時呼叫 onSnapshot。
 * 斷線後每 5 秒自動重連。回傳中止函式（供 useEffect cleanup 用）。
 */
export function connectJobsWebSocket(token, onSnapshot) {
  const url = `${wsBaseUrl()}/ws/jobs?token=${encodeURIComponent(token)}`;

  let ws = null;
  let stopped = false;
  let reconnectTimer = null;

  const schedule = () => {
    if (stopped || reconnectTimer !== null) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      open();
    }, 5000);
  };

  const open = () => {
    if (stopped) return;
    try {
      ws = new WebSocket(url);
    } catch {
      schedule();
      return;
    }
    ws.onmessage = (evt) => {
      try {
        onSnapshot(JSON.parse(evt.data));
      } catch {
        // 非 JSON 訊息直接忽略
      }
    };
    ws.onclose = () => {
      ws = null;
      schedule();
    };
  };

  open();

  return () => {
    stopped = true;
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (ws) {
      try { ws.close(); } catch { /* noop */ }
      ws = null;
    }
  };
}
