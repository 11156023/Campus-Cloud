import { useEffect, useState } from "react";
import styles from "./ReverseProxyRuleModal.module.scss";
import MIcon from "../MIcon";
import { useToast } from "../../hooks/useToast";
import { ResourcesService } from "../../services/resources";

export const COMMON_PORTS = [
  { value: "80", label: "80 — Nginx / Apache（網頁伺服器）" },
  { value: "443", label: "443 — HTTPS" },
  { value: "3000", label: "3000 — Node.js / React / Next.js" },
  { value: "5000", label: "5000 — Flask / Python" },
  { value: "8000", label: "8000 — FastAPI / Django" },
  { value: "8080", label: "8080 — 常見替代 Port" },
  { value: "8888", label: "8888 — Jupyter Notebook" },
];

export function findZoneByDomain(domain, zones = []) {
  return [...zones]
    .sort((a, b) => b.name.length - a.name.length)
    .find((zone) => domain === zone.name || domain.endsWith(`.${zone.name}`));
}

export function extractHostnamePrefix(domain, zoneName) {
  if (domain === zoneName) return "";
  const suffix = `.${zoneName}`;
  return domain.endsWith(suffix) ? domain.slice(0, -suffix.length) : domain;
}

/**
 * 反向代理規則建立／編輯 Modal（共用元件）。
 * - 全域反向代理頁：不帶 fixedResource，顯示 VM 下拉選單。
 * - 資源詳情頁：帶 fixedResource（{ vmid, name }），鎖定綁定的 VM。
 */
export default function ReverseProxyRuleModal({
  rule,
  setupContext,
  isAdmin = false,
  fixedResource = null,
  loading,
  onClose,
  onSubmit,
}) {
  const toast = useToast();
  const zones = setupContext?.zones ?? [];
  const matchedZone = rule
    ? zones.find((z) => z.id === rule.zone_id) ?? findZoneByDomain(rule.domain, zones)
    : null;
  const matchedCommonPort = rule
    ? COMMON_PORTS.find((p) => p.value === String(rule.internal_port))
    : null;

  const [resources, setResources] = useState([]);
  const [loadingResources, setLoadingResources] = useState(!fixedResource);
  const [form, setForm] = useState({
    vmid: rule
      ? String(rule.vmid)
      : fixedResource
        ? String(fixedResource.vmid)
        : "",
    zoneId: matchedZone?.id ?? zones[0]?.id ?? "",
    hostnamePrefix: rule
      ? matchedZone
        ? extractHostnamePrefix(rule.domain, matchedZone.name)
        : rule.domain
      : "",
    port: matchedCommonPort?.value ?? (rule ? "" : "80"),
    customPort: rule && !matchedCommonPort ? String(rule.internal_port) : "",
    useCustomPort: Boolean(rule && !matchedCommonPort),
    enableHttps: rule?.enable_https ?? true,
  });

  useEffect(() => {
    if (fixedResource) return;
    const fetcher = isAdmin ? ResourcesService.listAll() : ResourcesService.list();
    fetcher
      .then((res) => setResources(Array.isArray(res) ? res : res?.data ?? []))
      .catch(() => {})
      .finally(() => setLoadingResources(false));
  }, [isAdmin, fixedResource]);

  function set(name, value) {
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  const selectedZone = zones.find((z) => z.id === form.zoneId);
  const effectivePort = form.useCustomPort ? form.customPort : form.port;
  const prefix = form.hostnamePrefix.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
  const previewDomain = selectedZone
    ? prefix
      ? `${prefix}.${selectedZone.name}`
      : selectedZone.name
    : "";

  function submit(e) {
    e.preventDefault();
    const parsedPort = Number(effectivePort);
    if (!form.vmid) {
      toast.error("請先選擇你要綁定的 VM");
      return;
    }
    if (!form.zoneId) {
      toast.error("請先選擇網址結尾");
      return;
    }
    if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      toast.error("Port 必須是 1 到 65535 之間的數字");
      return;
    }
    onSubmit({
      vmid: Number(form.vmid),
      zone_id: form.zoneId,
      hostname_prefix: prefix,
      internal_port: parsedPort,
      enable_https: form.enableHttps,
    });
  }

  return (
    <div className={styles.modalOverlay} onMouseDown={onClose}>
      <form className={styles.modal} onSubmit={submit} onMouseDown={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <div>
            <h2>{rule ? "編輯網址" : "新增網址"}</h2>
            <p>
              幫你 VM 裡的服務取一個好記的公開網址。儲存後系統會自動完成所有設定，
              稍等片刻就能用這個網址打開你的服務。
            </p>
          </div>
          <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="關閉">
            <MIcon name="close" size={18} />
          </button>
        </div>

        {setupContext?.default_dns_target_type && setupContext?.default_dns_target_value && (
          <div className={styles.noticeInfo}>
            <p>
              <strong>系統自動處理：</strong>建立或更新網址時，系統會自動把它指向平台入口（
              {setupContext.default_dns_target_type} {setupContext.default_dns_target_value}
              ），你不需要自己設定
            </p>
          </div>
        )}

        {fixedResource ? (
          <div className={styles.field}>
            <span>綁定的 VM</span>
            <div className={styles.fixedVm}>
              <MIcon name="dns" size={16} />
              {fixedResource.name
                ? `${fixedResource.name}（VM ${fixedResource.vmid}）`
                : `VM ${fixedResource.vmid}`}
            </div>
          </div>
        ) : (
          <label className={styles.field}>
            <span>選擇你的 VM *</span>
            <select value={form.vmid} onChange={(e) => set("vmid", e.target.value)}>
              <option value="">{loadingResources ? "載入 VM 列表..." : "選擇一台 VM..."}</option>
              {resources.map((r) => (
                <option key={r.vmid} value={String(r.vmid)}>
                  {r.name}（VM {r.vmid}）
                </option>
              ))}
            </select>
            {!loadingResources && resources.length === 0 && (
              <em className={styles.fieldHint}>你目前沒有任何 VM，請先建立一台 VM。</em>
            )}
          </label>
        )}

        <div className={styles.fieldRow}>
          <label className={styles.field}>
            <span>網址開頭（自己取名）</span>
            <input
              value={form.hostnamePrefix}
              onChange={(e) => set("hostnamePrefix", e.target.value)}
              placeholder="例如 myapp，留空代表直接用主網址"
            />
          </label>
          <label className={styles.field}>
            <span>網址結尾 *</span>
            <select value={form.zoneId} onChange={(e) => set("zoneId", e.target.value)}>
              <option value="">選擇網址結尾</option>
              {zones.map((zone) => (
                <option key={zone.id} value={zone.id}>{zone.name}</option>
              ))}
            </select>
          </label>
        </div>

        <label className={styles.field}>
          <span>你的服務跑在哪個 Port（連接埠）？*</span>
          {!form.useCustomPort ? (
            <select value={form.port} onChange={(e) => set("port", e.target.value)}>
              {COMMON_PORTS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          ) : (
            <input
              type="number"
              min={1}
              max={65535}
              value={form.customPort}
              onChange={(e) => set("customPort", e.target.value)}
              placeholder="輸入 Port 號碼（1-65535）"
            />
          )}
          <button
            type="button"
            className={styles.linkBtn}
            onClick={() => set("useCustomPort", !form.useCustomPort)}
          >
            {form.useCustomPort ? "← 選擇常見 Port" : "我的 Port 不在列表中"}
          </button>
        </label>

        <label className={styles.checkRow}>
          <input
            type="checkbox"
            checked={form.enableHttps}
            onChange={(e) => set("enableHttps", e.target.checked)}
          />
          <span>啟用安全連線（https，瀏覽器網址列會顯示鎖頭）— 憑證由系統自動處理</span>
        </label>

        {previewDomain && form.vmid && (
          <div className={styles.noticeInfo}>
            <p>
              <strong>結果預覽：</strong>之後任何人打開{" "}
              {form.enableHttps ? "https" : "http"}://{previewDomain}
              ，就會連到 VM {form.vmid} 裡 Port {effectivePort} 的服務
            </p>
          </div>
        )}

        <div className={styles.modalActions}>
          <button type="button" className={styles.btnSecondary} onClick={onClose} disabled={loading}>
            取消
          </button>
          <button type="submit" className={styles.btnPrimary} disabled={loading}>
            {loading ? "儲存中..." : rule ? "儲存變更" : "建立網址"}
          </button>
        </div>
      </form>
    </div>
  );
}
