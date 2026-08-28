import styles from "./LoadingState.module.scss";

/**
 * 純 spinner（六角形動畫），給自帶文案排版的容器使用（如登入驗證卡片）。
 *
 * @param {number} [size=60] 寬度（px，高度依比例自動計算）
 */
export function LoadingSpinner({ size = 60 }) {
  return <span className={styles.spinner} style={{ width: size }} aria-hidden="true" />;
}

/**
 * 共用載入狀態：資料尚未回來前的佔位畫面（3D 方塊堆疊動畫）。
 *
 * @param {string}  [text="載入中…"] 顯示文字
 * @param {boolean} [fullPage=false] 佔滿整頁高度（頁面層級載入用）
 */
export default function LoadingState({ text = "載入中…", fullPage = false }) {
  return (
    <div
      className={fullPage ? `${styles.wrap} ${styles.wrapFull}` : styles.wrap}
      role="status"
      aria-live="polite"
    >
      <div className={styles.loader} aria-hidden="true">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className={`${styles.box} ${styles[`box${index}`]}`}>
            <div />
          </div>
        ))}
        <div className={styles.ground}>
          <div />
        </div>
      </div>
      {text && <span className={styles.text}>{text}</span>}
    </div>
  );
}
