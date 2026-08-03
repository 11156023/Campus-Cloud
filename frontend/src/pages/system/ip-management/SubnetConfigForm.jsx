import { useState } from "react";
import styles from "./IpManagementPage.module.scss";

const IPV4_PATTERN = "^(\\d{1,3}\\.){3}\\d{1,3}$";

/** textarea 內容切成 CIDR / IP 陣列（換行或逗號皆可） */
function parseBlockedList(text) {
  return (text ?? "")
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildInitialForm(config) {
  return {
    cidr:          config?.cidr ?? "",
    gateway:       config?.gateway ?? "",
    bridge_name:   config?.bridge_name ?? "vmbr1",
    gateway_vm_ip: config?.gateway_vm_ip ?? "",
    dns_servers:   config?.dns_servers ?? "",
    extra_blocked_subnets: (config?.extra_blocked_subnets ?? []).join("\n"),
  };
}

/**
 * 子網設定表單 — 純受控元件，不直接呼叫 API。
 * 送出時把整理好的 payload 交給 onSubmit，由頁面負責打 service。
 */
export default function SubnetConfigForm({
  config,
  cidrLocked,
  saving,
  deleting,
  onSubmit,
  onCancel,
  onDelete,
}) {
  const [form, setForm] = useState(() => buildInitialForm(config));
  const set = (name, value) => setForm((prev) => ({ ...prev, [name]: value }));
  const isEdit = Boolean(config);
  const busy = saving || deleting;

  function handleSubmit(e) {
    e.preventDefault();
    onSubmit({
      cidr:          form.cidr.trim(),
      gateway:       form.gateway.trim(),
      bridge_name:   form.bridge_name.trim(),
      gateway_vm_ip: form.gateway_vm_ip.trim(),
      dns_servers:   form.dns_servers.trim() || null,
      extra_blocked_subnets: parseBlockedList(form.extra_blocked_subnets),
    });
  }

  return (
    <form className={styles.card} onSubmit={handleSubmit}>
      <h2 className={styles.cardTitle}>
        {isEdit ? "編輯子網設定" : "建立子網設定"}
      </h2>
      <p className={styles.cardDesc}>
        設定子網後，系統才會在建立 VM / LXC 時自動分配靜態 IP。
      </p>

      <div className={styles.formGrid}>
        <label className={styles.field}>
          <span>子網 CIDR *</span>
          <input
            value={form.cidr}
            onChange={(e) => set("cidr", e.target.value)}
            placeholder="例：10.10.0.0/24"
            readOnly={cidrLocked}
            required
          />
          {cidrLocked && (
            <span className={styles.fieldHint}>
              已有 VM / LXC 使用此網段，需先刪除這些機器才能變更 CIDR。
            </span>
          )}
        </label>

        <label className={styles.field}>
          <span>閘道 IP *</span>
          <input
            value={form.gateway}
            onChange={(e) => set("gateway", e.target.value)}
            placeholder="例：10.10.0.1"
            pattern={IPV4_PATTERN}
            required
          />
        </label>

        <label className={styles.field}>
          <span>Bridge 名稱 *</span>
          <input
            value={form.bridge_name}
            onChange={(e) => set("bridge_name", e.target.value)}
            placeholder="例：vmbr1"
            required
          />
        </label>

        <label className={styles.field}>
          <span>Gateway VM IP *</span>
          <input
            value={form.gateway_vm_ip}
            onChange={(e) => set("gateway_vm_ip", e.target.value)}
            placeholder="例：10.10.0.2"
            pattern={IPV4_PATTERN}
            required
          />
          <span className={styles.fieldHint}>不可與閘道 IP 相同。</span>
        </label>

        <label className={styles.field}>
          <span>DNS Servers</span>
          <input
            value={form.dns_servers}
            onChange={(e) => set("dns_servers", e.target.value)}
            placeholder="選填，多組以逗號分隔：8.8.8.8,1.1.1.1"
          />
        </label>
      </div>

      <label className={styles.field}>
        <span>預設封鎖網段 / IP</span>
        <textarea
          rows={4}
          value={form.extra_blocked_subnets}
          onChange={(e) => set("extra_blocked_subnets", e.target.value)}
          placeholder={"選填，每行一個，例：\n192.168.100.0/24\n10.0.0.5"}
          spellCheck={false}
        />
        <span className={styles.fieldHint}>
          儲存時會在所有 VM / LXC 上建立或更新出站 DROP 規則，並清除已移除的舊規則。
        </span>
      </label>

      <div className={styles.cardActions}>
        {isEdit && (
          <button
            type="button"
            className={styles.btnDanger}
            onClick={onDelete}
            disabled={busy}
          >
            {deleting ? "刪除中..." : "刪除子網設定"}
          </button>
        )}
        <button
          type="button"
          className={styles.btnSecondary}
          onClick={onCancel}
          disabled={busy}
        >
          取消
        </button>
        <button type="submit" className={styles.btnPrimary} disabled={busy}>
          {saving ? "儲存中..." : isEdit ? "更新設定" : "建立設定"}
        </button>
      </div>
    </form>
  );
}
