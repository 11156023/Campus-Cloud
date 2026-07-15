import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import MIcon from "../MIcon";
import { useAuth } from "../../contexts/AuthContext";
import { AuthStorage } from "../../services/auth";
import { connectJobsWebSocket, JobsService } from "../../services/jobs";
import JobDetailDialog from "./JobDetailDialog";
import { JOB_KIND_LABEL, JobEmpty, JobLoading, JobRow } from "./JobRow";
import styles from "./Jobs.module.scss";

const NOTIFY_ONLY_MINE_KEY = "jobs:notifyOnlyMine";

/* 從 running/pending/blocked → 終態時觸發 toast */
const TERMINAL_STATUSES = new Set(["completed", "failed", "blocked", "cancelled"]);

function notifyJobTransition(job, prevStatus, onView) {
  // 第一次看到（prev undefined）且本來就是終態 → 不通知（避免重整時轟炸）
  if (prevStatus === undefined) return;
  if (prevStatus === job.status) return;
  if (!TERMINAL_STATUSES.has(job.status)) return;

  const kindLabel = JOB_KIND_LABEL[job.kind] ?? job.kind;
  const action = { label: "檢視", onClick: () => onView(job.id) };
  const description = job.title;

  switch (job.status) {
    case "completed":
      toast.success(`${kindLabel}已完成`, { description, action });
      break;
    case "failed":
      toast.error(`${kindLabel}失敗`, { description: job.message ?? description, action });
      break;
    case "blocked":
      toast.warning(`${kindLabel}受阻`, { description: job.message ?? description, action });
      break;
    case "cancelled":
      toast(`${kindLabel}已取消`, { description, action });
      break;
  }
}

/**
 * 全站常駐的任務提醒：左側顯示執行中任務摘要，右側鈴鐺按鈕
 * 展開 popover 列出執行中任務，點單筆開詳情。
 * 資料以 /ws/jobs WebSocket 即時推送為主，REST 每 15 秒輪詢為 fallback；
 * 任務進入終態（完成／失敗／受阻／取消）時彈 toast 通知。
 */
export default function JobsBanner() {
  const { user } = useAuth();
  const [items, setItems] = useState(null); // null = 尚未載入
  const [open, setOpen] = useState(false);
  const [focusJobId, setFocusJobId] = useState(null);
  const [notifyOnlyMine, setNotifyOnlyMine] = useState(
    () => localStorage.getItem(NOTIFY_ONLY_MINE_KEY) === "1",
  );
  const popRef = useRef(null);

  const isAdmin = Boolean(user?.is_superuser || user?.role === "admin");
  const myUserId = user?.id ?? null;
  // 使用 ref 送進 WS callback，避免 closure 抓舊設定導致 effect 重連
  const filterRef = useRef({ enabled: false, myUserId: null });
  filterRef.current = { enabled: notifyOnlyMine && isAdmin, myUserId };
  // 上一次 WS snapshot 中各 job 的狀態，用於 diff 觸發 toast
  const prevStatusMapRef = useRef(null);

  /* REST fallback：每 15 秒抓一次執行中任務（WS 為主） */
  const load = useCallback(async () => {
    try {
      const res = await JobsService.list({ statuses: ["running"], limit: 200, historyDays: 30 });
      setItems(res?.items ?? []);
    } catch {
      // 靜默失敗，維持現有畫面；WS 重連後會補上
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(() => {
      if (!document.hidden) load();
    }, 15000);
    return () => clearInterval(timer);
  }, [load]);

  /* WebSocket 即時推送 */
  useEffect(() => {
    const token = AuthStorage.getAccessToken();
    if (!token) return;
    return connectJobsWebSocket(token, (snapshot) => {
      const all = snapshot?.items ?? [];
      setItems(all.filter((j) => j.status === "running"));

      // ── Diff: 比對上一次 snapshot 的狀態，發 toast ──
      const prev = prevStatusMapRef.current;
      const next = new Map();
      for (const j of all) next.set(j.id, j.status);
      // 只在已建立 baseline 後才比對（首次連線當下視為基準，不要彈通知）
      if (prev !== null) {
        const { enabled, myUserId } = filterRef.current;
        for (const j of all) {
          // admin 開「只通知自己」：跳過非本人的 job
          if (enabled && j.user_id !== myUserId) continue;
          notifyJobTransition(j, prev.get(j.id), setFocusJobId);
        }
      }
      prevStatusMapRef.current = next;
    });
  }, []);

  /* 點擊外部關閉 popover */
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (popRef.current && !popRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const running = items?.length ?? 0;
  const hasRunning = running > 0;

  return (
    <div className={`${styles.banner} ${hasRunning ? styles.bannerActive : ""}`}>
      <div className={styles.bannerSummary}>
        <span className={`${styles.bannerPulse} ${hasRunning ? styles.spin : ""}`}>
          <MIcon name={hasRunning ? "autorenew" : "task_alt"} size={16} />
        </span>
        <span className={styles.bannerText}>
          {hasRunning ? `目前有 ${running} 個任務執行中` : "目前無任務執行中"}
        </span>
      </div>

      <div ref={popRef} className={styles.bellWrap}>
        <button
          type="button"
          className={styles.bellBtn}
          onClick={() => setOpen((v) => !v)}
          aria-label="背景任務"
        >
          <MIcon name="notifications" size={16} />
          <span>任務</span>
          {hasRunning && (
            <span className={styles.bellCount}>{running > 99 ? "99+" : running}</span>
          )}
        </button>

        {open && (
          <div className={styles.popover}>
            <div className={styles.popoverHeader}>
              <span className={styles.popoverTitle}>執行中任務</span>
              <span className={styles.popoverSub}>
                {hasRunning ? `${running} 個執行中` : "無執行中任務"}
              </span>
            </div>
            {isAdmin && (
              <label className={styles.notifyToggle}>
                <input
                  type="checkbox"
                  checked={notifyOnlyMine}
                  onChange={(e) => {
                    const next = e.target.checked;
                    setNotifyOnlyMine(next);
                    try {
                      localStorage.setItem(NOTIFY_ONLY_MINE_KEY, next ? "1" : "0");
                    } catch {
                      // localStorage 不可用時該設定僅本次瀏覽生效
                    }
                  }}
                />
                <span>只通知「我的」任務（避免被其他使用者的任務轟炸）</span>
              </label>
            )}
            <div className={styles.popoverList}>
              {items === null ? (
                <JobLoading />
              ) : items.length === 0 ? (
                <JobEmpty message="目前無執行中任務，其他狀態請至「背景任務」頁面查看" />
              ) : (
                items.map((job) => (
                  <JobRow
                    key={job.id}
                    job={job}
                    onClick={(j) => {
                      setFocusJobId(j.id);
                      setOpen(false);
                    }}
                  />
                ))
              )}
            </div>
            <div className={styles.popoverFooter}>
              <Link to="/jobs" className={styles.popoverLink} onClick={() => setOpen(false)}>
                <span>查看全部任務與歷史</span>
                <MIcon name="chevron_right" size={16} />
              </Link>
            </div>
          </div>
        )}
      </div>

      <JobDetailDialog jobId={focusJobId} onClose={() => setFocusJobId(null)} />
    </div>
  );
}
