import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./IpManagementPage.module.scss";
import MIcon from "../../../components/MIcon";
import SubnetConfigForm from "./SubnetConfigForm";
import { useAuth } from "../../../contexts/AuthContext";
import { IpManagementService } from "../../../services/ipManagement";
import { useToast } from "../../../hooks/useToast";
import useAutoRefresh from "../../../hooks/useAutoRefresh";

const COLUMNS = ["IP 位址", "用途", "VMID", "備註", "分配時間"];

const PURPOSE_LABELS = {
  vm: "VM",
  lxc: "LXC",
  gateway_vm: "Gateway VM",
  subnet_gateway: "閘道",
  reserved: "保留",
};

function EmptyState({ variant, canConfigure, onConfigure }) {
  if (variant === "unconfigured") {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyIcon}>
          <MIcon name="lan" size={40} />
        </div>
        <h2 className={styles.emptyTitle}>尚未設定子網</h2>
        <p className={styles.emptyDesc}>
          建立子網設定後，系統將自動為虛擬機與容器分配 IP 位址
        </p>
        {canConfigure && (
          <button type="button" className={styles.btnPrimary} onClick={onConfigure}>
            <MIcon name="add" size={18} />
            建立子網設定
          </button>
        )}
      </div>
    );
  }

  const isNoMatch = variant === "no-match";
  return (
    <div className={styles.empty}>
      <div className={styles.emptyIcon}>
        <MIcon name={isNoMatch ? "search_off" : "inbox"} size={40} />
      </div>
      <h2 className={styles.emptyTitle}>
        {isNoMatch ? "沒有符合條件的 IP" : "尚無 IP 分配記錄"}
      </h2>
      <p className={styles.emptyDesc}>
        {isNoMatch
          ? "換個 IP、VMID 或備註關鍵字再試一次"
          : "建立虛擬機或容器後，分配的 IP 會顯示在這裡"}
      </p>
    </div>
  );
}

function PurposeBadge({ purpose }) {
  const label = PURPOSE_LABELS[purpose] ?? purpose ?? "—";
  return (
    <span className={`${styles.badge} ${styles[`badge_${purpose ?? "unknown"}`]}`}>
      {label}
    </span>
  );
}

export default function IpManagementPage() {
  const toast = useToast();
  const { user } = useAuth();
  const isAdmin = Boolean(user?.is_superuser || user?.role === "admin");

  const [allocations, setAllocations] = useState([]);
  const [subnet, setSubnet] = useState(null);
  const [status, setStatus] = useState(null);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  /** silent = true 時不觸發 loading 與錯誤提示，供背景自動刷新使用 */
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [allocRes, subnetRes, statusRes] = await Promise.all([
        IpManagementService.listAllocations({ limit: 500 }),
        IpManagementService.getSubnet().catch(() => null),
        IpManagementService.getStatus().catch(() => null),
      ]);
      setAllocations(allocRes?.allocations ?? []);
      setSubnet(subnetRes ?? null);
      setStatus(statusRes ?? null);
    } catch (e) {
      if (!silent) toast.error(e?.message ?? "載入 IP 分配失敗");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);
  /* 編輯中不背景刷新，避免表單被重新掛載而清空輸入 */
  useAutoRefresh(() => { if (!editing) load(true); });

  /* getSubnet 需要管理員權限，非管理員只能靠 status 判斷是否已設定 */
  const configured = Boolean(subnet) || Boolean(status?.configured);

  /* 已有 VM/LXC 佔用網段時後端不允許改 CIDR，先在表單擋下來 */
  const cidrLocked = useMemo(
    () => allocations.some((a) => a.purpose === "vm" || a.purpose === "lxc"),
    [allocations],
  );

  const stats = useMemo(() => {
    const total = subnet?.total_ips ?? status?.total_ips ?? 0;
    const used  = subnet?.used_ips  ?? status?.used_ips  ?? allocations.length;
    const free  = subnet?.available_ips ?? status?.available_ips ?? Math.max(0, total - used);
    return { total, used, free };
  }, [allocations, subnet, status]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return allocations;
    return allocations.filter(
      (a) =>
        (a.ip_address ?? "").toLowerCase().includes(q) ||
        (a.description ?? "").toLowerCase().includes(q) ||
        String(a.vmid ?? "").includes(q),
    );
  }, [allocations, filter]);

  const emptyVariant = !configured
    ? "unconfigured"
    : allocations.length === 0
      ? "no-data"
      : "no-match";

  async function handleSave(payload) {
    setSaving(true);
    try {
      await IpManagementService.upsertSubnet(payload);
      toast.success("子網設定已儲存");
      setEditing(false);
      await load();
    } catch (e) {
      toast.error(e?.message ?? "儲存子網設定失敗");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    const ok = window.confirm(
      "確定刪除子網設定？刪除後全站 VM / LXC 建立功能將被停用，且需無任何 VM / LXC 仍佔用 IP 才能刪除。",
    );
    if (!ok) return;
    setDeleting(true);
    try {
      await IpManagementService.deleteSubnet();
      toast.success("子網設定已刪除");
      setEditing(false);
      await load();
    } catch (e) {
      toast.error(e?.message ?? "刪除子網設定失敗");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div className={styles.pageHeading}>
          <h1 className={styles.pageTitle}>IP 管理</h1>
          <p className={styles.pageSubtitle}>管理子網設定與所有 IP 位址分配</p>
        </div>
        {isAdmin && !editing && (
          <div className={styles.pageActions}>
            <button
              type="button"
              className={styles.btnPrimary}
              onClick={() => setEditing(true)}
            >
              <MIcon name={configured ? "edit" : "add"} size={18} />
              {configured ? "編輯子網設定" : "建立子網設定"}
            </button>
          </div>
        )}
      </div>

      <div className={styles.statRow}>
        <div className={styles.statCard}>
          <div className={styles.statIcon}>
            <MIcon name="public" size={20} />
          </div>
          <div className={styles.statInfo}>
            <span className={styles.statLabel}>子網總 IP</span>
            <span className={styles.statValue}>{stats.total}</span>
          </div>
        </div>
        <div className={styles.statCard}>
          <div className={`${styles.statIcon} ${styles.statIconOk}`}>
            <MIcon name="check_circle" size={20} />
          </div>
          <div className={styles.statInfo}>
            <span className={styles.statLabel}>可用</span>
            <span className={styles.statValue}>{stats.free}</span>
          </div>
        </div>
        <div className={styles.statCard}>
          <div className={`${styles.statIcon} ${styles.statIconBusy}`}>
            <MIcon name="lan" size={20} />
          </div>
          <div className={styles.statInfo}>
            <span className={styles.statLabel}>已分配</span>
            <span className={styles.statValue}>{stats.used}</span>
          </div>
        </div>
      </div>

      {editing && (
        <SubnetConfigForm
          key={subnet?.updated_at ?? "new"}
          config={subnet}
          cidrLocked={cidrLocked}
          saving={saving}
          deleting={deleting}
          onSubmit={handleSave}
          onCancel={() => setEditing(false)}
          onDelete={handleDelete}
        />
      )}

      <div className={styles.toolbar}>
        <div className={styles.search}>
          <MIcon name="search" size={16} />
          <input
            type="text"
            className={styles.searchInput}
            placeholder="搜尋 IP、VMID 或備註"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        {subnet && (
          <span className={styles.muted}>
            子網: <code className={styles.code}>{subnet.cidr}</code> · Bridge: <code className={styles.code}>{subnet.bridge_name}</code>
          </span>
        )}
      </div>

      <div className={styles.content}>
        {visible.length === 0 ? (
          <EmptyState
            variant={emptyVariant}
            canConfigure={isAdmin && !editing}
            onConfigure={() => setEditing(true)}
          />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  {COLUMNS.map((col) => (
                    <th key={col} className={styles.th}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((a) => (
                  <tr key={a.ip_address} className={styles.tr}>
                    <td className={styles.td}>
                      <div className={styles.nameCell}>
                        <div className={styles.nameIcon}>
                          <MIcon name="device_hub" size={18} />
                        </div>
                        <div>
                          <div className={styles.namePrimary}>{a.ip_address}</div>
                        </div>
                      </div>
                    </td>
                    <td className={styles.td}>
                      <PurposeBadge purpose={a.purpose} />
                    </td>
                    <td className={styles.td}>{a.vmid ?? "—"}</td>
                    <td className={styles.td}>{a.description ?? "—"}</td>
                    <td className={styles.td}>
                      {a.allocated_at
                        ? new Date(a.allocated_at).toLocaleString("zh-TW")
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
