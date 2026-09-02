import { useEffect, useState } from "react";

/**
 * useDialogPresence
 * 讓 Dialog / Popup 在關閉時先播放離場動畫再卸載。
 * 依樣式規範採 setTimeout + CSS transition（不用 onAnimationEnd）。
 *
 * 用法（布林開關）：
 *   const { open, closing } = useDialogPresence(showDialog);
 *   {open && <div className={`${styles.overlay} ${closing ? styles.overlayOut : ""}`}>…</div>}
 *
 * 用法（物件開關，關閉期間保留最後一筆資料供動畫顯示）：
 *   const { item, closing } = useDialogPresence(editTarget);
 *   {item && <EditModal target={item} …/>}
 *
 * @param {*} value 真值 = 開啟（可為布林或資料物件）；假值 = 關閉
 * @param {number} duration 離場動畫毫秒數，需與 SCSS transition 時間一致
 */
export default function useDialogPresence(value, duration = 150) {
  const [item, setItem] = useState(value || null);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (value) {
      setItem(value);
      setClosing(false);
      return;
    }
    if (item == null) return;
    setClosing(true);
    const timer = setTimeout(() => {
      setItem(null);
      setClosing(false);
    }, duration);
    return () => clearTimeout(timer);
  }, [value, item, duration]);

  return { open: item != null, item, closing };
}
