import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import MIcon from "../MIcon";
import { useJobs } from "./JobsProvider";
import { JobEmpty, JobLoading, JobRow } from "./JobRow";
import styles from "./Jobs.module.scss";

const POPOVER_WIDTH = 360;
const GAP = 8;      // popover 與按鈕的間距
const MARGIN = 16;  // popover 與視窗邊緣的最小留白

/**
 * 側欄任務入口：有執行中任務時顯示數量（側欄收合時改為紅點），
 * 點開 popover 列出執行中任務，點單筆開詳情（dialog 由 JobsProvider 掛載）。
 * 需在 JobsProvider 內使用。
 *
 * popover 以 portal 掛在 document.body：側欄的 backdrop-filter 會成為
 * fixed 子元素的定位基準，加上 overflow-x: hidden 會把彈出內容裁掉。
 */
export default function JobsButton({ collapsed = false }) {
  const { items, isAdmin, notifyOnlyMine, setNotifyOnlyMine, openJob } = useJobs();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const popRef = useRef(null);

  /* 依按鈕位置把 popover 放到側欄右側、底部對齊按鈕 */
  const updatePos = useCallback(() => {
    const btn = btnRef.current;
    const rect = btn?.getBoundingClientRect();
    if (!rect) return;
    // 以側欄外緣（而非按鈕右緣）為基準，才不會蓋到側欄內距與圓角邊框
    const anchorRight = btn.closest("aside")?.getBoundingClientRect().right ?? rect.right;
    const maxLeft = window.innerWidth - POPOVER_WIDTH - MARGIN;
    setPos({
      left: Math.max(MARGIN, Math.min(anchorRight + GAP, maxLeft)),
      bottom: Math.max(MARGIN, window.innerHeight - rect.bottom),
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePos();
    const onDown = (e) => {
      if (btnRef.current?.contains(e.target)) return;
      if (popRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", updatePos);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", updatePos);
    };
  }, [open, updatePos]);

  /* 側欄收合／展開時按鈕會位移且有寬度動畫，直接收起 popover 免得對不準 */
  useEffect(() => {
    setOpen(false);
  }, [collapsed]);

  const running = items?.length ?? 0;
  const hasRunning = running > 0;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`${styles.sidebarBtn} ${collapsed ? styles.sidebarBtnCollapsed : ""} ${open ? styles.sidebarBtnActive : ""}`}
        onClick={() => setOpen((v) => !v)}
        title={collapsed ? "背景任務" : undefined}
        aria-label="背景任務"
        aria-expanded={open}
      >
        <span className={styles.sidebarBtnIcon}>
          <MIcon name="notifications" size={20} />
          {collapsed && hasRunning && <span className={styles.bellDot} />}
        </span>
        {!collapsed && (
          <>
            <span className={styles.sidebarBtnLabel}>背景任務</span>
            {hasRunning && <span className={styles.countBadge}>{running}</span>}
          </>
        )}
      </button>

      {open && pos && createPortal(
        <div
          ref={popRef}
          className={styles.popover}
          style={{ left: pos.left, bottom: pos.bottom }}
        >
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
        </div>,
        document.body,
      )}
    </>
  );
}
