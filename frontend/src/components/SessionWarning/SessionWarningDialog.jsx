/**
 * SessionWarningDialog
 * 練習階段警告對話框，依 warn_reason 分兩種：
 * - auto_stop：VM 即將自動關機（課程時段緩衝或練習額度）。
 *   練習額度與課堂時段型都可由機器擁有者自助延長。
 * - expiry：VM 即將到期停用。無法自助延長，須向管理員申請。
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import MIcon from "../MIcon";
import { ResourcesService } from "../../services/resources";
import styles from "./SessionWarningDialog.module.scss";

export default function SessionWarningDialog({ status, onClose, onDismissPermanent }) {
  const [doNotShow, setDoNotShow] = useState(false);
  const [extending, setExtending] = useState(false);

  if (!status) return null;

  const isExpiry = status.warn_reason === "expiry";

  const handleClose = () => {
    if (doNotShow) onDismissPermanent();
    else onClose();
    setDoNotShow(false);
  };

  const handleExtend = async () => {
    setExtending(true);
    try {
      const result = await ResourcesService.extendSession(status.vmid);
      toast.success(`已延長 ${result.extended_minutes / 60} 小時`);
      onClose();
    } catch (e) {
      toast.error(e?.message ?? "延長失敗");
    } finally {
      setExtending(false);
    }
  };

  return createPortal(
    <div className={styles.overlay} onClick={handleClose}>
      <div
        className={styles.dialog}
        role="alertdialog"
        aria-modal="true"
        aria-label={isExpiry ? "資源即將到期" : "VM 即將自動關機"}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.title}>
          <span className={isExpiry ? styles.iconExpiry : styles.iconAutoStop}>
            <MIcon name={isExpiry ? "event_busy" : "schedule"} size={20} />
          </span>
          {isExpiry ? "資源即將到期" : "VM 即將自動關機"}
        </div>

        <p className={styles.desc}>
          {isExpiry ? (
            <>
              VM #{status.vmid} 將在約 <strong>{status.hours_until_expiry ?? "?"} 小時</strong>{" "}
              後到期並停用。請及早備份資料；如需延長使用期限，請向管理員申請。
            </>
          ) : (
            <>
              VM #{status.vmid} 將在約 <strong>{status.minutes_until_stop ?? "?"} 分鐘</strong>{" "}
              後自動關機。需要繼續使用嗎？
            </>
          )}
        </p>

        <label className={styles.doNotShow}>
          <input
            type="checkbox"
            checked={doNotShow}
            onChange={(e) => setDoNotShow(e.target.checked)}
          />
          <span>不再顯示此提醒</span>
        </label>

        <div className={styles.actions}>
          <button type="button" className={styles.btnSecondary} onClick={handleClose}>
            {isExpiry ? "知道了" : "稍後再說"}
          </button>
          {!isExpiry && (
            <button
              type="button"
              className={styles.btnPrimary}
              disabled={!status.can_extend || extending}
              onClick={handleExtend}
            >
              <span className={extending ? styles.spin : ""}>
                <MIcon name="autorenew" size={16} />
              </span>
              延長使用時間
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
