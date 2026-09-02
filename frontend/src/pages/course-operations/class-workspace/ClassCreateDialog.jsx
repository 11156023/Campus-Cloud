import { useEffect, useState } from "react";
import MIcon from "../../../components/MIcon";
import { TeachingClassesService } from "../../../services/teachingClasses";
import {
  CLASS_TIMEZONES,
  classSchedulePayload,
  createClassScheduleForm,
} from "../classScheduleForm";
import styles from "../CourseOperations.module.scss";

export default function ClassCreateDialog({
  item = null,
  closing = false,
  onClose,
  onCreated,
  onUpdated,
}) {
  const isEdit = Boolean(item);
  const [form, setForm] = useState(() => createClassScheduleForm(item));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key === "Escape" && !submitting) onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, submitting]);

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    if (!form.name.trim()) return;
    setSubmitting(true);
    setError("");
    try {
      const payload = classSchedulePayload(form);
      const saved = isEdit
        ? await TeachingClassesService.update(item.id, payload)
        : await TeachingClassesService.create(payload);
      (isEdit ? onUpdated : onCreated)?.(saved);
    } catch (reason) {
      setError(
        reason?.message ??
          (isEdit
            ? "儲存班級失敗，請稍後再試。"
            : "建立班級失敗，請稍後再試。"),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className={`${styles.createDialogOverlay} ${closing ? styles.createDialogOverlayOut : ""}`}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose();
      }}
    >
      <section
        className={styles.createDialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-class-title"
      >
        <header className={styles.createDialogHeader}>
          <h2 id="create-class-title">
            {isEdit ? "編輯班級與課表" : "建立班級"}
          </h2>
          <button
            type="button"
            className={styles.iconBtn}
            aria-label="關閉"
            disabled={submitting}
            onClick={onClose}
          >
            <MIcon name="close" size={19} />
          </button>
        </header>

        <form onSubmit={submit}>
          <div className={styles.createDialogBody}>
            <div className={styles.compactFormSection}>
              <h3>班級資料</h3>
              <div className={styles.createFormGrid}>
                <label className={`${styles.field} ${styles.createNameField}`}>
                  <span>班級名稱</span>
                  <input
                    value={form.name}
                    onChange={(event) => update("name", event.target.value)}
                    placeholder="Linux 系統管理｜114-1"
                    autoFocus
                  />
                </label>
                <label className={styles.field}>
                  <span>班級代碼</span>
                  <input
                    value={form.code}
                    onChange={(event) => update("code", event.target.value)}
                    placeholder="CS-LINUX-1141"
                  />
                </label>
                <label className={styles.field}>
                  <span>學期</span>
                  <input
                    value={form.term}
                    onChange={(event) => update("term", event.target.value)}
                  />
                </label>
                <label className={styles.field}>
                  <span>上課地點</span>
                  <input
                    value={form.location}
                    onChange={(event) => update("location", event.target.value)}
                    placeholder="例如：電腦教室 A"
                  />
                </label>
                <label className={styles.field}>
                  <span>開始日期</span>
                  <input
                    type="date"
                    value={form.startDate}
                    onChange={(event) =>
                      update("startDate", event.target.value)
                    }
                  />
                </label>
                <label className={styles.field}>
                  <span>結束日期</span>
                  <input
                    type="date"
                    value={form.endDate}
                    onChange={(event) => update("endDate", event.target.value)}
                  />
                </label>
              </div>
            </div>

            <div className={styles.compactFormSection}>
              <h3>固定上課時段</h3>
              <div className={styles.createFormGrid}>
                <label className={styles.field}>
                  <span>每週星期</span>
                  <select
                    value={form.weekday}
                    onChange={(event) =>
                      update("weekday", Number(event.target.value))
                    }
                  >
                    {[
                      "星期一",
                      "星期二",
                      "星期三",
                      "星期四",
                      "星期五",
                      "星期六",
                      "星期日",
                    ].map((label, index) => (
                      <option key={label} value={index}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  <span>開始時間</span>
                  <input
                    type="time"
                    value={form.startTime}
                    onChange={(event) =>
                      update("startTime", event.target.value)
                    }
                  />
                </label>
                <label className={styles.field}>
                  <span>結束時間</span>
                  <input
                    type="time"
                    value={form.endTime}
                    onChange={(event) => update("endTime", event.target.value)}
                  />
                </label>
                <label className={styles.field}>
                  <span>時區</span>
                  <select
                    value={form.timezone}
                    onChange={(event) => update("timezone", event.target.value)}
                  >
                    {CLASS_TIMEZONES.map((timezone) => (
                      <option key={timezone}>{timezone}</option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  <span>提前開機</span>
                  <select
                    value={form.bootLeadMinutes}
                    onChange={(event) =>
                      update("bootLeadMinutes", Number(event.target.value))
                    }
                  >
                    <option value={0}>準時開機</option>
                    <option value={5}>提前 5 分鐘</option>
                    <option value={10}>提前 10 分鐘</option>
                    <option value={15}>提前 15 分鐘</option>
                    <option value={30}>提前 30 分鐘</option>
                  </select>
                </label>
              </div>
            </div>
            {error && <p className={styles.errorMessage}>{error}</p>}
          </div>

          <footer className={styles.createDialogFooter}>
            <button
              type="button"
              className={styles.btnSecondary}
              disabled={submitting}
              onClick={onClose}
            >
              取消
            </button>
            <button
              type="submit"
              className={styles.btnPrimary}
              disabled={!form.name.trim() || submitting}
            >
              {submitting ? "儲存中…" : isEdit ? "儲存變更" : "建立班級"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
