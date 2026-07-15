import MIcon from "../MIcon";
import styles from "./Jobs.module.scss";

/** 任務類型顯示名稱（與 JobsPage 的 KIND_LABELS 對齊，popover 用短版） */
export const JOB_KIND_LABEL = {
  migration:     "遷移",
  script_deploy: "部署",
  vm_request:    "開機申請",
  spec_change:   "規格變更",
  deletion:      "刪除",
};

/** 狀態顯示名稱 + MIcon 名稱 + 色調 class key */
export const JOB_STATUS_META = {
  pending:   { label: "等待中", icon: "pause",         tone: "toneMuted" },
  running:   { label: "執行中", icon: "autorenew",     tone: "toneInfo", spin: true },
  completed: { label: "已完成", icon: "check_circle",  tone: "toneSuccess" },
  failed:    { label: "失敗",   icon: "cancel",        tone: "toneDanger" },
  blocked:   { label: "受阻",   icon: "error_outline", tone: "toneWarning" },
  cancelled: { label: "已取消", icon: "cancel",        tone: "toneMuted" },
};

function fmtTime(iso) {
  try {
    return new Intl.DateTimeFormat("zh-TW", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function JobRow({ job, onClick }) {
  const meta = JOB_STATUS_META[job.status] ?? JOB_STATUS_META.pending;
  const showProgress =
    job.progress !== null &&
    job.status !== "completed" &&
    job.status !== "cancelled" &&
    job.status !== "failed";
  const clickable = typeof onClick === "function";

  return (
    <button
      type="button"
      className={styles.jobRow}
      onClick={clickable ? () => onClick(job) : undefined}
      disabled={!clickable}
    >
      <span className={`${styles.jobRowIcon} ${styles[meta.tone]} ${meta.spin ? styles.spin : ""}`}>
        <MIcon name={meta.icon} size={16} />
      </span>
      <span className={styles.jobRowBody}>
        <span className={styles.jobRowHead}>
          <span className={styles.jobKindChip}>{JOB_KIND_LABEL[job.kind] ?? job.kind}</span>
          <span className={styles.jobRowTitle} title={job.title}>{job.title}</span>
        </span>
        {job.message && (
          <span className={styles.jobRowMessage} title={job.message}>{job.message}</span>
        )}
        {showProgress && (
          <span className={styles.jobRowProgress}>
            <span
              className={`${styles.jobRowProgressFill} ${job.status === "blocked" ? styles.jobRowProgressBlocked : ""}`}
              style={{ width: `${job.progress ?? 5}%` }}
            />
          </span>
        )}
        <span className={styles.jobRowFoot}>
          <span>{meta.label}</span>
          <span>{fmtTime(job.updated_at)}</span>
        </span>
      </span>
    </button>
  );
}

export function JobEmpty({ message = "目前沒有任務" }) {
  return (
    <div className={styles.jobEmpty}>
      <MIcon name="auto_awesome" size={24} />
      <span>{message}</span>
    </div>
  );
}

export function JobLoading() {
  return (
    <div className={styles.jobLoading}>
      <span className={styles.spin}>
        <MIcon name="refresh" size={16} />
      </span>
      <span>載入中…</span>
    </div>
  );
}
