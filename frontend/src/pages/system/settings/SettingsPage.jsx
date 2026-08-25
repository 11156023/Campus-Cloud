import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import styles from "./SettingsPage.module.scss";
import MIcon from "../../../components/MIcon";
import { useConfirm } from "../../../components/ConfirmDialog/ConfirmProvider";
import { useToast } from "../../../hooks/useToast";
import { ProxmoxConfigService } from "../../../services/proxmoxConfig";
import GovernanceTab from "./GovernanceTab";
import LdapTab from "./LdapTab";

const TABS = [
  { key: "pve",       label: "PVE 連線",  icon: "device_hub"    },
  { key: "scheduler", label: "資源排程",  icon: "settings_input_component" },
  { key: "governance", label: "治理",     icon: "policy"        },
  { key: "ldap",      label: "LDAP",      icon: "badge"         },
  { key: "nodes",     label: "節點管理",  icon: "lock"          },
  { key: "storage",   label: "Storage",   icon: "storage"       },
];

/**
 * PUT /proxmox-config 需要的完整欄位（password / ca_cert 另外處理）。
 *
 * 連線與叢集資源欄位（host / user / storage / pool / gateway…）已改由
 * 「PVE 連線」的新增·編輯表單管理，這裡保留只是為了原樣送回 singleton，
 * 讓排程設定能單獨儲存；UI 不再提供編輯入口。
 */
const UPDATE_KEYS = [
  "host", "user", "verify_ssl", "iso_storage", "data_storage",
  "api_timeout", "task_check_interval", "pool_name", "gateway_ip",
  "local_subnet", "default_node", "placement_strategy",
  "cpu_overcommit_ratio", "disk_overcommit_ratio",
  "placement_peak_cpu_margin",
  "placement_peak_memory_margin", "placement_loadavg_warn_per_core",
  "placement_loadavg_max_per_core", "placement_loadavg_penalty_weight",
  "placement_cpu_peak_warn_share", "placement_cpu_peak_high_share",
  "placement_memory_peak_warn_share", "placement_memory_peak_high_share",
  "placement_resource_weight_cpu", "placement_resource_weight_memory",
  "placement_resource_weight_disk",
  "scheduled_boot_batch_size", "scheduled_boot_batch_interval_seconds",
  "scheduled_boot_lead_time_minutes", "window_grace_period_minutes",
  "practice_session_hours", "practice_warning_minutes",
  "expiry_warning_hours",
];

function buildFormFromConfig(config) {
  const form = {};
  for (const key of UPDATE_KEYS) form[key] = config?.[key] ?? "";
  form.password = "";
  form.ca_cert = "";
  return form;
}

function buildPayload(form) {
  const payload = {};
  for (const key of UPDATE_KEYS) {
    const value = form[key];
    payload[key] = value === "" ? null : value;
  }
  if (form.password) payload.password = form.password;
  if (form.ca_cert?.trim()) payload.ca_cert = form.ca_cert.trim();
  return payload;
}

/* ── PVE 多連線管理 ─────────────────────────────────── */
const EMPTY_CONNECTION_FORM = {
  name: "",
  host: "",
  port: 8006,
  user: "root@pam",
  password: "",
  verify_ssl: false,
  ca_cert: "",
  api_timeout: 30,
  pool_name: "SkyLab",
  iso_storage: "local",
  data_storage: "local-lvm",
  task_check_interval: 2,
  gateway_ip: "",
  local_subnet: "",
  default_node: "",
  enabled: true,
  is_default: false,
};

/** 編輯既有連線時，把 API 回傳的連線資料轉成表單狀態 */
function connectionToForm(conn) {
  return {
    ...EMPTY_CONNECTION_FORM,
    name: conn.name,
    host: conn.host,
    port: conn.port,
    user: conn.user,
    verify_ssl: conn.verify_ssl,
    api_timeout: conn.api_timeout,
    pool_name: conn.pool_name ?? "",
    iso_storage: conn.iso_storage ?? "",
    data_storage: conn.data_storage ?? "",
    task_check_interval: conn.task_check_interval ?? 2,
    gateway_ip: conn.gateway_ip ?? "",
    local_subnet: conn.local_subnet ?? "",
    default_node: conn.default_node ?? "",
    enabled: conn.enabled,
    is_default: conn.is_default,
  };
}

function ConnectionForm({ initial, isEdit, saving, onSubmit, onCancel }) {
  const [form, setForm] = useState(initial);
  const set = (name, value) => setForm((prev) => ({ ...prev, [name]: value }));

  function handleSubmit(e) {
    e.preventDefault();
    const payload = {
      name: form.name.trim(),
      host: form.host.trim(),
      port: Number(form.port) || 8006,
      user: form.user.trim(),
      verify_ssl: Boolean(form.verify_ssl),
      api_timeout: Number(form.api_timeout) || 30,
      pool_name: form.pool_name.trim() || "SkyLab",
      iso_storage: form.iso_storage.trim() || "local",
      data_storage: form.data_storage.trim() || "local-lvm",
      task_check_interval: Number(form.task_check_interval) || 2,
      gateway_ip: form.gateway_ip.trim() || null,
      local_subnet: form.local_subnet.trim() || null,
      default_node: form.default_node.trim() || null,
      enabled: Boolean(form.enabled),
      is_default: Boolean(form.is_default),
    };
    if (isEdit) {
      payload.password = form.password ? form.password : null;
      payload.ca_cert = form.ca_cert?.trim() ? form.ca_cert.trim() : null;
    } else {
      payload.password = form.password;
      if (form.ca_cert?.trim()) payload.ca_cert = form.ca_cert.trim();
    }
    onSubmit(payload);
  }

  return (
    <form className={styles.card} onSubmit={handleSubmit}>
      <h2 className={styles.cardTitle}>{isEdit ? "編輯連線" : "新增連線"}</h2>
      <h3 className={styles.sectionTitle}>連線設定</h3>
      <div className={styles.formGrid}>
        <label className={styles.field}>
          <span>名稱 *</span>
          <input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="例：機房A" required />
        </label>
        <label className={styles.field}>
          <span>Host *</span>
          <input value={form.host} onChange={(e) => set("host", e.target.value)} placeholder="例：192.168.100.2" required />
        </label>
        <label className={styles.field}>
          <span>Port</span>
          <input type="number" min={1} max={65535} value={form.port} onChange={(e) => set("port", e.target.value)} />
        </label>
        <label className={styles.field}>
          <span>API 使用者 *</span>
          <input value={form.user} onChange={(e) => set("user", e.target.value)} placeholder="root@pam" required />
        </label>
        <label className={styles.field}>
          <span>密碼{isEdit ? "（留空表示不變更）" : " *"}</span>
          <input
            type="password"
            value={form.password}
            onChange={(e) => set("password", e.target.value)}
            placeholder={isEdit ? "已設定" : "PVE 密碼"}
            required={!isEdit}
          />
        </label>
        <label className={styles.field}>
          <span>API Timeout（秒）</span>
          <input type="number" min={1} max={300} value={form.api_timeout} onChange={(e) => set("api_timeout", e.target.value)} />
        </label>
      </div>
      <label className={styles.checkRow}>
        <input type="checkbox" checked={Boolean(form.verify_ssl)} onChange={(e) => set("verify_ssl", e.target.checked)} />
        <span>驗證 SSL 憑證</span>
      </label>
      {form.verify_ssl && (
        <label className={styles.field}>
          <span>CA 憑證 PEM{isEdit ? "（留空表示不變更）" : ""}</span>
          <textarea
            rows={5}
            value={form.ca_cert}
            onChange={(e) => set("ca_cert", e.target.value)}
            placeholder="-----BEGIN CERTIFICATE-----"
            spellCheck={false}
          />
        </label>
      )}

      <h3 className={styles.sectionTitle}>此叢集的資源設定</h3>
      <p className={styles.cardDesc}>
        pool、storage 與網段是各叢集獨立的設定，建立於此連線的 VM / LXC 會套用這裡的值。
      </p>
      <div className={styles.formGrid}>
        <label className={styles.field}>
          <span>Pool 名稱</span>
          <input value={form.pool_name} onChange={(e) => set("pool_name", e.target.value)} placeholder="SkyLab" />
        </label>
        <label className={styles.field}>
          <span>ISO Storage</span>
          <input value={form.iso_storage} onChange={(e) => set("iso_storage", e.target.value)} placeholder="local" />
        </label>
        <label className={styles.field}>
          <span>Data Storage</span>
          <input value={form.data_storage} onChange={(e) => set("data_storage", e.target.value)} placeholder="local-lvm" />
        </label>
        <label className={styles.field}>
          <span>任務檢查間隔（秒）</span>
          <input
            type="number"
            min={1}
            max={60}
            value={form.task_check_interval}
            onChange={(e) => set("task_check_interval", e.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span>Gateway IP</span>
          <input value={form.gateway_ip} onChange={(e) => set("gateway_ip", e.target.value)} placeholder="選填" />
        </label>
        <label className={styles.field}>
          <span>內網網段</span>
          <input value={form.local_subnet} onChange={(e) => set("local_subnet", e.target.value)} placeholder="例：192.168.100.0/24" />
        </label>
        <label className={styles.field}>
          <span>預設節點</span>
          <input value={form.default_node} onChange={(e) => set("default_node", e.target.value)} placeholder="選填，未指定時優先使用" />
        </label>
      </div>

      <div className={styles.toggleGrid}>
        <label className={styles.checkRow}>
          <input type="checkbox" checked={Boolean(form.enabled)} onChange={(e) => set("enabled", e.target.checked)} />
          <span>啟用此連線</span>
        </label>
        <label className={styles.checkRow}>
          <input type="checkbox" checked={Boolean(form.is_default)} onChange={(e) => set("is_default", e.target.checked)} />
          <span>設為預設連線</span>
        </label>
      </div>
      <div className={styles.cardActions}>
        <button type="button" className={styles.btnSecondary} onClick={onCancel}>取消</button>
        <button type="submit" className={styles.btnPrimary} disabled={saving}>
          {saving ? "儲存中..." : "儲存連線"}
        </button>
      </div>
    </form>
  );
}

function ConnectionsSection({ connections, loading, onRefresh }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(null); // null | "new" | connection 物件
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);

  async function handleSubmit(payload) {
    setSaving(true);
    try {
      if (editing === "new") {
        await ProxmoxConfigService.createConnection(payload);
        toast.success("連線已新增");
      } else {
        await ProxmoxConfigService.updateConnection(editing.id, payload);
        toast.success("連線已更新");
      }
      setEditing(null);
      onRefresh();
    } catch (err) {
      toast.error(err?.message ?? "儲存連線失敗");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(conn) {
    const ok = await confirm({
      title: "刪除 PVE 連線",
      message: `確定刪除連線「${conn.name}」？其節點與 Storage 記錄將一併移除。`,
      confirmText: "刪除",
      danger: true,
    });
    if (!ok) return;
    setBusyId(conn.id);
    try {
      await ProxmoxConfigService.deleteConnection(conn.id);
      toast.success("連線已刪除");
      onRefresh();
    } catch (err) {
      toast.error(err?.message ?? "刪除連線失敗");
    } finally {
      setBusyId(null);
    }
  }

  async function handleTest(conn) {
    setBusyId(conn.id);
    try {
      const res = await ProxmoxConfigService.testConnectionById(conn.id);
      if (res.success) toast.success(res.message || "連線成功");
      else toast.error(res.message || "連線失敗");
    } catch (err) {
      toast.error(err?.message ?? "連線測試失敗");
    } finally {
      setBusyId(null);
    }
  }

  async function handleSync(conn) {
    setBusyId(conn.id);
    try {
      const res = await ProxmoxConfigService.syncConnection(conn.id);
      if (res.success) {
        toast.success(`同步完成：${res.nodes?.length ?? 0} 節點、${res.storage_count ?? 0} storage`);
        onRefresh();
      } else {
        toast.error(res.error || "同步失敗");
      }
    } catch (err) {
      toast.error(err?.message ?? "同步失敗");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className={styles.panelStack}>
      <div className={styles.card}>
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>PVE 連線清單</h2>
          <button type="button" className={styles.btnSecondary} onClick={() => setEditing("new")}>
            <MIcon name="add" size={16} />
            新增連線
          </button>
        </div>
        {loading ? (
          <div className={styles.loading}>載入連線清單...</div>
        ) : connections.length === 0 ? (
          <p className={styles.cardDesc}>
            尚未建立連線。點「新增連線」完成第一組設定（將自動成為預設連線）。
          </p>
        ) : (
          <div className={styles.list}>
            {connections.map((conn) => (
              <div key={conn.id} className={styles.nodeRow}>
                <div className={styles.rowMain}>
                  <span className={styles.rowName}>
                    {conn.name}
                    {conn.is_default && <span className={`${styles.badge} ${styles.badge_info}`}>預設</span>}
                    {!conn.enabled && <span className={`${styles.badge} ${styles.badge_danger}`}>停用</span>}
                  </span>
                  <span className={styles.rowMeta}>
                    {conn.host}:{conn.port} · {conn.user} · {conn.node_count} 節點
                  </span>
                </div>
                <button type="button" className={styles.btnSecondary} disabled={busyId === conn.id} onClick={() => handleTest(conn)}>
                  <MIcon name="wifi_tethering" size={16} />
                  測試
                </button>
                <button type="button" className={styles.btnSecondary} disabled={busyId === conn.id} onClick={() => handleSync(conn)}>
                  <MIcon name="sync" size={16} />
                  同步
                </button>
                <button type="button" className={styles.btnSecondary} disabled={busyId === conn.id} onClick={() => setEditing(conn)}>
                  <MIcon name="edit" size={16} />
                  編輯
                </button>
                <button type="button" className={styles.btnSecondary} disabled={busyId === conn.id} onClick={() => handleDelete(conn)}>
                  <MIcon name="delete" size={16} />
                  刪除
                </button>
              </div>
            ))}
          </div>
        )}
        <p className={styles.cardHint}>
          節點即時用量、趨勢圖與告警請至{" "}
          <Link to="/monitoring" className={styles.inlineLink}>監控與日誌 → 資源監控</Link>
          {" "}查看。
        </p>
      </div>

      {editing !== null && (
        <ConnectionForm
          key={editing === "new" ? "new" : editing.id}
          isEdit={editing !== "new"}
          saving={saving}
          initial={
            editing === "new" ? EMPTY_CONNECTION_FORM : connectionToForm(editing)
          }
          onSubmit={handleSubmit}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}

/* ── 資源排程 ──────────────────────────────────────── */
const SCHEDULER_GROUPS = [
  {
    title: "放置與超配",
    fields: [
      { key: "cpu_overcommit_ratio", label: "CPU 超配比", step: 0.1 },
      { key: "disk_overcommit_ratio", label: "Disk 超配比", step: 0.1 },
    ],
  },
  {
    title: "資源評估閾值",
    fields: [
      { key: "placement_peak_cpu_margin", label: "CPU 峰值餘裕", step: 0.01 },
      { key: "placement_peak_memory_margin", label: "RAM 峰值餘裕", step: 0.01 },
      { key: "placement_loadavg_warn_per_core", label: "LoadAvg 警戒 / 核", step: 0.1 },
      { key: "placement_loadavg_max_per_core", label: "LoadAvg 上限 / 核", step: 0.1 },
      { key: "placement_loadavg_penalty_weight", label: "LoadAvg 懲罰權重", step: 0.01 },
      { key: "placement_cpu_peak_warn_share", label: "CPU 峰值警戒占比", step: 0.01 },
      { key: "placement_cpu_peak_high_share", label: "CPU 峰值高位占比", step: 0.01 },
      { key: "placement_memory_peak_warn_share", label: "RAM 峰值警戒占比", step: 0.01 },
      { key: "placement_memory_peak_high_share", label: "RAM 峰值高位占比", step: 0.01 },
      { key: "placement_resource_weight_cpu", label: "資源權重 CPU", step: 0.01 },
      { key: "placement_resource_weight_memory", label: "資源權重 RAM", step: 0.01 },
      { key: "placement_resource_weight_disk", label: "資源權重 Disk", step: 0.01 },
    ],
  },
  {
    title: "排程開機與時段",
    fields: [
      { key: "scheduled_boot_batch_size", label: "開機批次大小" },
      { key: "scheduled_boot_batch_interval_seconds", label: "批次間隔（秒）" },
      { key: "scheduled_boot_lead_time_minutes", label: "提前開機（分）" },
      { key: "window_grace_period_minutes", label: "時段寬限（分）" },
      { key: "practice_session_hours", label: "練習時段（小時）" },
      { key: "practice_warning_minutes", label: "練習提醒（分）" },
      { key: "expiry_warning_hours", label: "到期提醒（小時）" },
    ],
  },
];

function SchedulerTab({ form, setField, onSave, saving }) {
  return (
    <form className={styles.panelStack} onSubmit={onSave}>
      <div className={styles.card}>
        <h2 className={styles.cardTitle}>放置策略</h2>
        <div className={styles.strategyGrid}>
          {[
            {
              value: "dominant_share_min",
              title: "Dominant Share Min",
              desc: "每次選擇主要資源份額最低的節點，讓負載平均分散於整個叢集。",
            },
            {
              value: "priority_dominant_share",
              title: "Priority Dominant Share",
              desc: "先按節點優先級篩選候選節點，相同優先級內再以 Dominant Share 排序。",
            },
          ].map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={form.placement_strategy === opt.value ? styles.strategyCardActive : styles.strategyCard}
              onClick={() => setField("placement_strategy", opt.value)}
            >
              <span className={styles.strategyTitle}>{opt.title}</span>
              <span className={styles.strategyDesc}>{opt.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {SCHEDULER_GROUPS.map((group) => (
        <div key={group.title} className={styles.card}>
          <h2 className={styles.cardTitle}>{group.title}</h2>
          <div className={styles.formGrid}>
            {group.fields.map((f) => (
              <label key={f.key} className={styles.field}>
                <span>{f.label}</span>
                <input
                  type="number"
                  step={f.step ?? 1}
                  value={form[f.key]}
                  onChange={(e) => setField(f.key, Number(e.target.value))}
                />
              </label>
            ))}
          </div>
        </div>
      ))}

      <div className={styles.cardActions}>
        <button type="submit" className={styles.btnPrimary} disabled={saving}>
          {saving ? "儲存中..." : "儲存排程設定"}
        </button>
      </div>
    </form>
  );
}

/* ── 節點管理 ──────────────────────────────────────── */
function NodesTab() {
  const toast = useToast();
  const [nodes, setNodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // node id
  const [editForm, setEditForm] = useState({ host: "", port: 8006, priority: 0 });
  const [saving, setSaving] = useState(false);

  const fetchNodes = useCallback(() => {
    setLoading(true);
    ProxmoxConfigService.getNodes()
      .then(setNodes)
      .catch((err) => toast.error(err?.message ?? "載入節點失敗"))
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(() => {
    fetchNodes();
  }, [fetchNodes]);

  function startEdit(node) {
    setEditing(node.id);
    setEditForm({ host: node.host, port: node.port, priority: node.priority });
  }

  async function saveEdit(node) {
    setSaving(true);
    try {
      const updated = await ProxmoxConfigService.updateNode(node.id, {
        host: editForm.host.trim(),
        port: Number(editForm.port) || 8006,
        priority: Number(editForm.priority) || 0,
        enabled: node.enabled ?? true,
      });
      setNodes((prev) => prev.map((n) => (n.id === node.id ? updated : n)));
      toast.success("節點已更新");
      setEditing(null);
    } catch (err) {
      toast.error(err?.message ?? "更新節點失敗");
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnabled(node, enabled) {
    setSaving(true);
    try {
      const updated = await ProxmoxConfigService.updateNode(node.id, {
        host: node.host,
        port: node.port,
        priority: node.priority,
        enabled,
      });
      setNodes((prev) => prev.map((n) => (n.id === node.id ? updated : n)));
      toast.success(
        enabled ? `${node.name} 已啟用` : `${node.name} 已停用（不再接收新 VM）`
      );
    } catch (err) {
      toast.error(err?.message ?? "更新節點失敗");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className={styles.loading}>載入節點...</div>;
  if (nodes.length === 0) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyIcon}><MIcon name="lock" size={40} /></div>
        <h2 className={styles.emptyTitle}>尚無節點資料</h2>
        <p className={styles.emptyDesc}>請先完成 PVE 連線設定並執行同步</p>
      </div>
    );
  }

  return (
    <div className={styles.list}>
      {nodes.map((node) => (
        <div key={node.id ?? node.name} className={styles.nodeRow}>
          <div className={styles.rowMain}>
            <span className={styles.rowName}>
              {node.name}
              {node.is_primary && <span className={`${styles.badge} ${styles.badge_info}`}>主節點</span>}
              {node.enabled === false && (
                <span className={`${styles.badge} ${styles.badge_danger}`}>停用</span>
              )}
            </span>
            <span className={styles.rowMeta}>
              {node.host}:{node.port} · Priority {node.priority}
              {node.enabled === false && " · 不接收新 VM（既有 VM 不受影響）"}
            </span>
          </div>
          <span className={`${styles.badge} ${node.is_online ? styles.badge_success : styles.badge_danger}`}>
            {node.is_online ? "在線" : "離線"}
          </span>
          <label className={styles.checkRow} title="停用後不再接收新 VM，既有 VM 不受影響">
            <input
              type="checkbox"
              checked={node.enabled !== false}
              disabled={saving || node.id == null}
              onChange={(e) => toggleEnabled(node, e.target.checked)}
            />
            <span>啟用</span>
          </label>
          {editing === node.id ? (
            <div className={styles.nodeEdit}>
              <input
                value={editForm.host}
                onChange={(e) => setEditForm((p) => ({ ...p, host: e.target.value }))}
                placeholder="Host"
              />
              <input
                type="number"
                value={editForm.port}
                onChange={(e) => setEditForm((p) => ({ ...p, port: e.target.value }))}
                placeholder="Port"
              />
              <input
                type="number"
                value={editForm.priority}
                onChange={(e) => setEditForm((p) => ({ ...p, priority: e.target.value }))}
                placeholder="Priority"
              />
              <button type="button" className={styles.btnPrimary} disabled={saving} onClick={() => saveEdit(node)}>
                {saving ? "..." : "儲存"}
              </button>
              <button type="button" className={styles.btnSecondary} onClick={() => setEditing(null)}>
                取消
              </button>
            </div>
          ) : (
            <button type="button" className={styles.btnSecondary} onClick={() => startEdit(node)} disabled={node.id == null}>
              <MIcon name="edit" size={16} />
              編輯
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── Storage ───────────────────────────────────────── */
function StorageTab() {
  const toast = useToast();
  const [storages, setStorages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);

  useEffect(() => {
    ProxmoxConfigService.getStorages()
      .then(setStorages)
      .catch((err) => toast.error(err?.message ?? "載入 Storage 失敗"))
      .finally(() => setLoading(false));
  }, [toast]);

  // 只有一組 PVE 連線時不必再標註連線名稱
  const multiConnection = useMemo(
    () => new Set(storages.map((s) => s.connection_id ?? null)).size > 1,
    [storages],
  );

  async function save(storage, patch) {
    setSavingId(storage.id);
    try {
      const updated = await ProxmoxConfigService.updateStorage(storage.id, {
        enabled: patch.enabled ?? storage.enabled,
        speed_tier: patch.speed_tier ?? storage.speed_tier,
        user_priority: patch.user_priority ?? storage.user_priority,
      });
      setStorages((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      const nodeCount = updated.node_names?.length ?? 1;
      toast.success(
        updated.is_shared && nodeCount > 1
          ? `${storage.storage} 已更新（套用至 ${nodeCount} 個節點）`
          : `${storage.storage} 已更新`,
      );
    } catch (err) {
      toast.error(err?.message ?? "更新 Storage 失敗");
    } finally {
      setSavingId(null);
    }
  }

  if (loading) return <div className={styles.loading}>載入 Storage...</div>;
  if (storages.length === 0) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyIcon}><MIcon name="storage" size={40} /></div>
        <h2 className={styles.emptyTitle}>尚無 Storage 設定</h2>
        <p className={styles.emptyDesc}>請先完成 PVE 連線設定並執行同步</p>
      </div>
    );
  }

  return (
    <div className={styles.list}>
      {storages.map((storage) => (
        <div key={storage.id} className={styles.storageRow}>
          <div className={styles.rowMain}>
            <span className={styles.rowName}>
              {storage.storage}
              {multiConnection && storage.connection_name && (
                <span className={`${styles.badge} ${styles.badge_muted}`}>{storage.connection_name}</span>
              )}
              {storage.is_shared ? (
                <span
                  className={`${styles.badge} ${styles.badge_info}`}
                  title={(storage.node_names ?? []).join("、")}
                >
                  共享 · {storage.node_names?.length ?? 1} 節點
                </span>
              ) : (
                <span className={`${styles.badge} ${styles.badge_muted}`}>{storage.node_name}</span>
              )}
            </span>
            <span className={styles.rowMeta}>
              {storage.storage_type ?? "?"} · {Math.round(storage.used_gb)} / {Math.round(storage.total_gb)} GB ·
              {" "}{[storage.can_vm && "VM", storage.can_lxc && "LXC", storage.can_iso && "ISO", storage.can_backup && "Backup"].filter(Boolean).join(" / ") || "無用途"}
            </span>
          </div>
          <select
            value={storage.speed_tier}
            disabled={savingId === storage.id}
            onChange={(e) => save(storage, { speed_tier: e.target.value })}
            className={styles.inlineSelect}
          >
            <option value="nvme">NVMe</option>
            <option value="ssd">SSD</option>
            <option value="hdd">HDD</option>
            <option value="unknown">未知</option>
          </select>
          <input
            type="number"
            className={styles.inlineInput}
            title="使用者優先度"
            value={storage.user_priority}
            disabled={savingId === storage.id}
            onChange={(e) => save(storage, { user_priority: Number(e.target.value) || 0 })}
          />
          <label className={styles.checkRow}>
            <input
              type="checkbox"
              checked={storage.enabled}
              disabled={savingId === storage.id}
              onChange={(e) => save(storage, { enabled: e.target.checked })}
            />
            <span>啟用</span>
          </label>
        </div>
      ))}
    </div>
  );
}

/* ── Page ──────────────────────────────────────────── */
export default function SettingsPage() {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState("pve");
  const [form, setForm] = useState(buildFormFromConfig(null));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [connections, setConnections] = useState([]);
  const [connectionsLoading, setConnectionsLoading] = useState(true);

  useEffect(() => {
    ProxmoxConfigService.getConfig()
      .then((cfg) => setForm(buildFormFromConfig(cfg)))
      .catch((err) => toast.error(err?.message ?? "載入排程設定失敗"))
      .finally(() => setLoading(false));
  }, [toast]);

  const fetchConnections = useCallback(() => {
    setConnectionsLoading(true);
    ProxmoxConfigService.listConnections()
      .then(setConnections)
      .catch((err) => toast.error(err?.message ?? "載入 PVE 連線清單失敗"))
      .finally(() => setConnectionsLoading(false));
  }, [toast]);

  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  const setField = useCallback((name, value) => {
    setForm((prev) => ({ ...prev, [name]: value }));
  }, []);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const updated = await ProxmoxConfigService.updateConfig(buildPayload(form));
      setForm(buildFormFromConfig(updated));
      toast.success("設定已儲存");
    } catch (err) {
      toast.error(err?.message ?? "儲存設定失敗");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.page}>
      {/* ── 頁首 ── */}
      <div className={styles.pageHeader}>
        <div className={styles.pageHeading}>
          <h1 className={styles.pageTitle}>系統設定</h1>
          <p className={styles.pageSubtitle}>
            管理 Proxmox VE 連線、節點、Storage 與資源排程設定。
          </p>
        </div>

        {/* ── Tabs ── */}
        <div className={styles.tabs}>
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`${styles.tab} ${activeTab === tab.key ? styles.tabActive : ""}`}
              onClick={() => setActiveTab(tab.key)}
            >
              <MIcon name={tab.icon} size={16} />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── 內容 ── */}
      <div className={styles.content}>
        {loading ? (
          <div className={styles.loading}>載入設定...</div>
        ) : (
          <>
            {activeTab === "pve" && (
              <ConnectionsSection
                connections={connections}
                loading={connectionsLoading}
                onRefresh={fetchConnections}
              />
            )}
            {activeTab === "scheduler" && (
              <SchedulerTab form={form} setField={setField} onSave={handleSave} saving={saving} />
            )}
            {activeTab === "governance" && <GovernanceTab />}
            {activeTab === "ldap" && <LdapTab />}
            {activeTab === "nodes" && <NodesTab />}
            {activeTab === "storage" && <StorageTab />}
          </>
        )}
      </div>
    </div>
  );
}
