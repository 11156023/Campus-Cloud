import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import MIcon from "../MIcon";
import { JobsService } from "../../services/jobs";
import { JOB_KIND_LABEL, JOB_STATUS_META } from "./JobRow";
import styles from "./Jobs.module.scss";

const fmt = (iso) => {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("zh-TW", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
};

const formatExtraValue = (v) => {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "是" : "否";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
};

const EXTRA_LABELS = {
  request_id: "請求 ID",
  vmid: "VMID",
  source_node: "來源節點",
  target_node: "目標節點",
  attempt_count: "嘗試次數",
  rebalance_epoch: "Rebalance epoch",
  claimed_by: "Claimed by",
  requested_at: "請求時間",
  available_at: "可開始時間",
  claimed_at: "Claim 時間",
  started_at: "開始時間",
  finished_at: "完成時間",
  hostname: "Hostname",
  task_id: "Task ID",
  template_slug: "模板 slug",
  template_name: "模板名稱",
  raw_status: "原始狀態",
  progress_text: "進度文字",
  resource_type: "資源類型",
  cores: "CPU 核心數",
  memory: "記憶體 (MB)",
  storage: "Storage",
  disk_size: "磁碟 (GB)",
  rootfs_size: "rootfs (GB)",
  ostemplate: "OS 模板",
  template_id: "模板 ID",
  assigned_node: "指派節點",
  actual_node: "實際節點",
  desired_node: "期望節點",
  migration_status: "遷移狀態",
  expiry_date: "到期日",
  start_at: "開始時間",
  end_at: "結束時間",
  reason: "原因",
  review_comment: "審核備註",
  change_type: "變更類型",
  current_cpu: "目前 CPU",
  current_memory: "目前記憶體",
  current_disk: "目前磁碟",
  requested_cpu: "請求 CPU",
  requested_memory: "請求記憶體",
  requested_disk: "請求磁碟",
  applied_at: "套用時間",
};

/** 任務還在跑就每 3 秒刷新詳情 */
const ACTIVE_STATUSES = new Set(["pending", "running", "blocked"]);

export default function JobDetailDialog({ jobId, onClose }) {
  const open = jobId !== null;
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) {
      setData(null);
      setError(null);
      return;
    }
    let cancelled = false;
    let timer = null;

    const load = async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const res = await JobsService.detail(jobId);
        if (cancelled) return;
        setData(res);
        setError(null);
        if (ACTIVE_STATUSES.has(res?.item?.status)) {
          timer = setTimeout(() => load(true), 3000);
        }
      } catch (e) {
        if (!cancelled) setError(e?.message ?? "Unknown error");
      } finally {
        if (!cancelled && !silent) setLoading(false);
      }
    };
    load();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [open, jobId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const item = data?.item;
  const statusMeta = item ? JOB_STATUS_META[item.status] : null;
  const extraEntries = data
    ? Object.entries(data.extra ?? {}).filter(
        ([, v]) => v !== null && v !== undefined && v !== "",
      )
    : [];

  // Portal 到 body：banner 的 backdrop-filter 會建立 stacking context，
  // 直接 render 會讓 fixed overlay 被限制在 banner 內
  return createPortal(
    <div className={styles.dialogOverlay} onClick={onClose}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label="任務詳細"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.dialogHeader}>
          <div className={styles.dialogTitleRow}>
            {item ? (
              <>
                <span className={styles.jobKindChip}>{JOB_KIND_LABEL[item.kind] ?? item.kind}</span>
                <h2 className={styles.dialogTitle}>{item.title}</h2>
              </>
            ) : (
              <h2 className={styles.dialogTitle}>任務詳細</h2>
            )}
          </div>
          <button type="button" className={styles.dialogClose} onClick={onClose} aria-label="關閉">
            <MIcon name="close" size={18} />
          </button>
        </div>
        <div className={styles.dialogJobId}>{jobId}</div>

        {loading && !data && <JobDetailLoading />}

        {error && (
          <div className={styles.dialogError}>
            <MIcon name="error_outline" size={16} />
            <div>
              <div className={styles.dialogErrorTitle}>無法載入任務詳細</div>
              <div>{error}</div>
            </div>
          </div>
        )}

        {item && (
          <div className={styles.dialogBody}>
            {/* 狀態列 */}
            <div className={styles.dialogStatusRow}>
              {statusMeta && (
                <span className={`${styles.statusBadge} ${styles[statusMeta.tone]}`}>
                  <span className={statusMeta.spin ? styles.spin : ""}>
                    <MIcon name={statusMeta.icon} size={14} />
                  </span>
                  {statusMeta.label}
                </span>
              )}
              {typeof item.progress === "number" && (
                <span className={styles.statusBadge}>{item.progress}%</span>
              )}
              {item.user_email && (
                <span className={styles.dialogInitiator}>發起人：{item.user_email}</span>
              )}
            </div>

            {/* 時間 */}
            <div className={styles.dialogTimes}>
              <div>
                <div className={styles.dialogFieldLabel}>建立</div>
                <div className={styles.dialogMono}>{fmt(item.created_at)}</div>
              </div>
              <div>
                <div className={styles.dialogFieldLabel}>更新</div>
                <div className={styles.dialogMono}>{fmt(item.updated_at)}</div>
              </div>
              <div>
                <div className={styles.dialogFieldLabel}>完成</div>
                <div className={styles.dialogMono}>{fmt(item.completed_at)}</div>
              </div>
            </div>

            {/* 訊息 */}
            {item.message && (
              <div>
                <div className={styles.dialogFieldLabel}>訊息</div>
                <div className={styles.dialogMessage}>{item.message}</div>
              </div>
            )}

            {/* 詳細欄位 */}
            {extraEntries.length > 0 && (
              <div>
                <div className={styles.dialogFieldLabel}>詳細</div>
                <div className={styles.dialogExtraGrid}>
                  {extraEntries.map(([k, v]) => (
                    <div key={k} className={styles.dialogExtraItem}>
                      <span className={styles.dialogExtraKey}>{EXTRA_LABELS[k] ?? k}：</span>
                      <span className={styles.dialogMono}>{formatExtraValue(v)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 錯誤 */}
            {data.error && (
              <div>
                <div className={`${styles.dialogFieldLabel} ${styles.toneDanger}`}>錯誤</div>
                <pre className={styles.dialogErrorOutput}>{data.error}</pre>
              </div>
            )}

            {/* 輸出 */}
            {data.output && (
              <div>
                <div className={styles.dialogFieldLabel}>輸出</div>
                <pre className={styles.dialogOutput}>{data.output}</pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function JobDetailLoading() {
  return (
    <div className={styles.jobLoading}>
      <span className={styles.spin}>
        <MIcon name="refresh" size={16} />
      </span>
      <span>載入中…</span>
    </div>
  );
}
