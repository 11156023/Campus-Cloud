import styles from "./TemplatesPage.module.scss";

export const TEMPLATE_STATUS_LABEL = {
  creating: "建立中",
  ready: "就緒",
  updating: "更新循環中",
  failed: "失敗",
  deleted: "已刪除",
};

const TEMPLATE_STATUS_CLASS = {
  creating: "badge_info",
  ready: "badge_ok",
  updating: "badge_info",
  failed: "badge_err",
  deleted: "badge_muted",
};

export function TemplateStatusBadge({ status }) {
  return (
    <span className={`${styles.badge} ${styles[TEMPLATE_STATUS_CLASS[status] ?? "badge_muted"]}`}>
      {TEMPLATE_STATUS_LABEL[status] ?? status}
    </span>
  );
}

