/**
 * 表單送出時發現欄位未填，把游標定位到該欄位並平滑捲動置中。
 * 先 focus（preventScroll）再自行捲動，避免瀏覽器預設的瞬間跳動。
 */
export function focusInvalidField(node) {
  if (!node) return;
  node.focus({ preventScroll: true });
  node.scrollIntoView({ block: "center", behavior: "smooth" });
}
