import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import MIcon from "../MIcon";
import { useJobs } from "./JobsProvider";
import { JobEmpty, JobLoading, JobRow } from "./JobRow";
import styles from "./Jobs.module.scss";

/**
 * 任務鈴鐺按鈕：有執行中任務時右上角亮紅色提示點，
 * 點開 popover 列出執行中任務，點單筆開詳情（dialog 由 JobsProvider 掛載）。
 * 需在 JobsProvider 內使用。
 */
export default function JobsButton() {
  const { items, isAdmin, notifyOnlyMine, setNotifyOnlyMine, openJob } = useJobs();
  const [open, setOpen] = useState(false);
  const popRef = useRef(null);

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
    <div ref={popRef} className={styles.bellWrap}>
      <button
        type="button"
        className={styles.bellBtn}
        onClick={() => setOpen((v) => !v)}
        aria-label="背景任務"
      >
        <MIcon name="notifications" size={16} />
        <span>任務</span>
        {hasRunning && <span className={styles.bellDot} />}
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
                onChange={(e) => setNotifyOnlyMine(e.target.checked)}
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
                    openJob(j.id);
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
  );
}
