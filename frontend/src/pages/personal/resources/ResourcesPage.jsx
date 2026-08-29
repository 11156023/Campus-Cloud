import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../contexts/AuthContext";
import styles from "./ResourcesPage.module.scss";
import MIcon from "../../../components/MIcon";
import PowerMenu from "../../../components/PowerMenu/PowerMenu";
import SharedEmptyState from "../../../components/EmptyState/EmptyState";
import { ResourcesService } from "../../../services/resources";
import {
  PENDING_POLL_INTERVAL,
  cancelVmRequest,
  fetchPendingResources,
  pendingSignature,
} from "../../../services/pendingResources";
import { useToast } from "../../../hooks/useToast";
import useAutoRefresh from "../../../hooks/useAutoRefresh";
import TerminalDialog from "./TerminalDialog";
import VncDialog from "./VncDialog";
import QuotaUsageBar from "../../../components/Teaching/QuotaUsageBar";
import PageHeader from "../../../components/PageHeader/PageHeader";
import { QuickPracticeService } from "../../../services/quickPractice";
import { buildEnvironmentGroups, groupedResourceKeys } from "../../../utils/environmentGroups";

/* ── Constants ── */
const STATUS_MAP = {
  scheduled:    { label: "已排程",   color: "info",    icon: "event"          },
  provisioning: { label: "建立中",   color: "info",    icon: "settings"       },
  running:      { label: "執行中",   color: "success", icon: "play_circle"    },
  stopped:      { label: "已關機",   color: "muted",   icon: "stop_circle"    },
  paused:       { label: "已暫停",   color: "muted",   icon: "pause_circle"   },
  deleting:     { label: "刪除中",   color: "danger",  icon: "hourglass_empty"},
  failed:       { label: "建立失敗", color: "danger",  icon: "error_outline"  },
  deleted:      { label: "已刪除",   color: "danger",  icon: "delete_forever" },
  unknown:      { label: "狀態未知", color: "muted",   icon: "help_outline"   },
};

const TYPE_MAP = {
  lxc:   { label: "容器 (LXC)", icon: "terminal" },
  qemu:  { label: "虛擬機 (VM)", icon: "computer" },
};

/* ── Helpers ── */
function formatDate(isoStr) {
  if (!isoStr) return null;
  return new Date(isoStr).toLocaleDateString("zh-TW", {
    year: "numeric", month: "2-digit", day: "2-digit",
  });
}

function formatDatetime(isoStr) {
  if (!isoStr) return null;
  return new Date(isoStr).toLocaleString("zh-TW", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

/* ── Primitive sub-components ── */
function StatusBadge({ status }) {
  const s = STATUS_MAP[status] ?? { label: status, color: "muted", icon: "help_outline" };
  return (
    <span className={`${styles.badge} ${styles[`badge_${s.color}`]}`}>
      {s.label}
    </span>
  );
}

/* ── Confirm Modal ── */
function ConfirmModal({ title, desc, confirmLabel = "確定", danger = false, loading = false, onConfirm, onClose }) {
  const [closing, setClosing] = useState(false);

  function close() {
    if (closing) return;
    setClosing(true);
  }

  function handleAnimationEnd() {
    if (closing) onClose();
  }

  return (
    <div
      className={`${styles.modalOverlay} ${closing ? styles.modalOverlayOut : ""}`}
      onClick={close}
      onAnimationEnd={handleAnimationEnd}
    >
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <span className={styles.modalTitle}>{title}</span>
        {desc && <p className={styles.modalDesc}>{desc}</p>}
        <div className={styles.modalActions}>
          <button type="button" className={styles.btnSecondary} onClick={close}>
            取消
          </button>
          <button
            type="button"
            className={danger ? styles.btnDanger : styles.btnPrimary}
            disabled={loading}
            onClick={onConfirm}
          >
            {loading ? "處理中…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Creating placeholder row ── */

/** 依申請階段決定 placeholder 的狀態顯示（開通中 / 超時 / 失敗…） */
function getCreatingDisplay(req) {
  if (req.status === "pending") {
    return { label: "審核中", color: "info", spin: true };
  }
  if (req.provisioning_status === "failed") {
    return { label: "開通失敗", color: "danger", spin: false };
  }
  if (req.provisioning_status === "running") {
    return { label: "開通中", color: "info", spin: true };
  }
  // approved 等待排程開機：start_at 已過但仍未開始建立 → 超時
  if (req.start_at && new Date(req.start_at).getTime() < Date.now()) {
    const overdueMin = Math.floor((Date.now() - new Date(req.start_at).getTime()) / 60_000);
    const overdueLabel = overdueMin >= 60 ? `${Math.floor(overdueMin / 60)} 小時` : `${overdueMin} 分鐘`;
    return { label: `超時 (${overdueLabel})`, color: "danger", spin: false };
  }
  return { label: "排程中", color: "info", spin: true };
}

function formatMemory(memoryMb) {
  if (memoryMb == null) return null;
  return memoryMb >= 1024 ? `${memoryMb / 1024} GB` : `${memoryMb} MB`;
}

function CreatingRow({ request, onCancelled }) {
  const toast = useToast();
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [cancelling, setCancelling]       = useState(false);

  const type    = TYPE_MAP[request.resource_type === "lxc" ? "lxc" : "qemu"];
  const display = getCreatingDisplay(request);
  // 開通流程一旦開始跑 Proxmox clone 就無法取消
  const canCancel = request.provisioning_status !== "running";

  async function handleCancel() {
    setCancelling(true);
    try {
      await cancelVmRequest(request.id);
      toast.success(`已送出取消申請「${request.hostname}」`);
      setCancelConfirm(false);
      onCancelled();
    } catch (err) {
      toast.error(err?.message ?? "取消申請失敗");
    } finally {
      setCancelling(false);
    }
  }

  const specs = [
    request.cores != null ? `${request.cores} 核心` : null,
    formatMemory(request.memory),
  ].filter(Boolean).join(" / ");

  return <>
    <tr className={`${styles.tr} ${styles.pendingRow}`}>
      <td className={styles.td}>
        <div className={styles.nameCell}>
          <span className={styles.nameIcon}><MIcon name={type.icon} size={18} /></span>
          <div><strong>{request.hostname}</strong><small>{type.label} · {specs || "規格處理中"}</small></div>
        </div>
      </td>
      <td className={styles.td}><div className={styles.envPrimary}>資源申請</div><div className={styles.envSub}>建立中</div></td>
      <td className={styles.td}>
        <span className={`${styles.badge} ${styles[`badge_${display.color}`]} ${styles.creatingBadge}`}>
          <span className={display.spin ? styles.spin : styles.badgeIcon}><MIcon name={display.spin ? "autorenew" : "error_outline"} size={12} /></span>{display.label}
        </span>
      </td>
      <td className={styles.td}><span className={styles.muted}>N/A</span></td>
      <td className={styles.td}>{formatDatetime(request.start_at) ?? formatDatetime(request.created_at)}</td>
      <td className={styles.td}>{request.assigned_node ?? request.desired_node ?? "尚未分配"}</td>
      <td className={styles.td}>
        <button type="button" className={styles.cancelBtn} disabled={!canCancel || cancelling} onClick={() => setCancelConfirm(true)}>
          <MIcon name="cancel" size={14} />取消申請
        </button>
      </td>
    </tr>
    {cancelConfirm && createPortal(
      <ConfirmModal
        title="確定取消資源申請？"
        desc={`取消「${request.hostname}」後，如有需要必須重新提出申請。`}
        confirmLabel="取消申請"
        danger
        loading={cancelling}
        onConfirm={handleCancel}
        onClose={() => setCancelConfirm(false)}
      />,
      document.body,
    )}
  </>;
}

const LIVE_STATUSES = new Set(["running", "stopped", "paused"]);

function resourceRowKey(resource, index) {
  const parts = [
    resource.type || "resource",
    resource.node || "unknown-node",
    resource.vmid ?? resource.request_id ?? resource.name ?? "unknown",
  ];
  return `${parts.join(":")}:${index}`;
}

/* ── Resource row ── */
function ResourceRow({ resource, onUpdated, onDeleted }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  /* VMID 是系統內部編號，僅管理員／老師看得到 */
  const showVmid = user?.is_superuser || user?.role === "admin" || user?.role === "teacher";
  const [actionLoading, setActionLoading] = useState(null);
  const [deleteConfirm, setDeleteConfirm]  = useState(false);
  const [deleting, setDeleting]            = useState(false);
  const [menuOpen, setMenuOpen]            = useState(false);
  const [menuClosing, setMenuClosing]      = useState(false);
  const [consoleOpen, setConsoleOpen]      = useState(false);
  const menuBtnRef = useRef(null);

  function closeMenu() {
    setMenuClosing(true);
    setTimeout(() => { setMenuOpen(false); setMenuClosing(false); }, 130);
  }

  const type    = TYPE_MAP[resource.type] ?? { label: resource.type, icon: "computer" };
  const isLxc   = resource.type === "lxc";
  const canControl = resource.can_control !== false && resource.vmid != null && resource.vmid > 0;
  const isLive  = canControl && LIVE_STATUSES.has(resource.status);

  async function handleControl(action) {
    setActionLoading(action);
    try {
      await ResourcesService[action](resource.vmid);
      onUpdated({ ...resource, status: action === "start" ? "running" : "stopped" });
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await ResourcesService.delete(resource.vmid);
      onDeleted(resource.vmid);
    } finally {
      setDeleting(false);
      setDeleteConfirm(false);
    }
  }

  return <>
    <tr className={styles.tr} data-guide="resource-card">
      <td className={styles.td}>
        <div className={styles.nameCell}>
          <span className={styles.nameIcon}><MIcon name={type.icon} size={18} /></span>
          <div>
            {resource.vmid > 0
              ? <button type="button" className={styles.nameLink} onClick={() => navigate(`/my-resources/${resource.vmid}`)}>{resource.name}</button>
              : <strong>{resource.name}</strong>}
            <small>{type.label}{showVmid && resource.vmid > 0 ? ` · VMID ${resource.vmid}` : ""}</small>
          </div>
        </div>
      </td>
      <td className={styles.td}><div className={styles.envPrimary}>{resource.environment_type || "Custom"}</div><div className={styles.envSub}>{resource.os_info || "—"}</div></td>
      <td className={styles.td}><StatusBadge status={resource.status} /></td>
      <td className={styles.td}><span className={styles.mono}>{resource.ip_address ?? "N/A"}</span></td>
      <td className={styles.td}>{resource.expiry_date ? formatDate(resource.expiry_date) : <span className={styles.cardPeriodUnlimited}>∞ 無期限</span>}</td>
      <td className={styles.td}>{resource.node ?? "—"}</td>
      <td className={styles.td}>
        {isLive ? <div className={styles.rowActions}>
          <button type="button" className={styles.terminalBtn} disabled={resource.status !== "running"} onClick={() => setConsoleOpen(true)} data-guide="resource-console">
            <MIcon name={isLxc ? "terminal" : "desktop_windows"} size={14} />{isLxc ? "終端機" : "控制台"}
          </button>
          {actionLoading && <MIcon name="hourglass_empty" size={16} />}
          <div className={styles.menuWrap}>
            {menuOpen && <PowerMenu resource={resource} actionLoading={actionLoading} onControl={handleControl} onDeleteClick={() => { closeMenu(); setDeleteConfirm(true); }} onClose={closeMenu} anchorRef={menuBtnRef} closing={menuClosing} />}
            <button ref={menuBtnRef} type="button" className={`${styles.menuBtn} ${menuOpen ? styles.menuBtnActive : ""}`} onClick={() => menuOpen ? closeMenu() : setMenuOpen(true)} title="更多操作"><MIcon name="more_vert" size={18} /></button>
          </div>
        </div> : <span className={styles.deletedNote}>{STATUS_MAP[resource.status]?.label ?? resource.status}</span>}
      </td>
    </tr>
    {deleteConfirm && createPortal(<ConfirmModal title="確定刪除資源？" desc={`「${resource.name}」${showVmid ? `（VMID ${resource.vmid}）` : ""}刪除後無法復原。`} confirmLabel="刪除" danger loading={deleting} onConfirm={handleDelete} onClose={() => setDeleteConfirm(false)} />, document.body)}
    {consoleOpen && isLxc && createPortal(<TerminalDialog resource={resource} onClose={() => setConsoleOpen(false)} />, document.body)}
    {consoleOpen && !isLxc && createPortal(<VncDialog resource={resource} onClose={() => setConsoleOpen(false)} />, document.body)}
  </>;
}

function EnvironmentMachineRow({ machine, onUpdated }) {
  const toast = useToast();
  const type = TYPE_MAP[machine.type] ?? { label: machine.type, icon: "computer" };
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const resource = machine.resource;
  const isLxc = machine.type === "lxc";
  const canControl = Boolean(resource?.vmid && resource.can_control !== false);
  const canOpen = canControl && resource.status === "running";
  const controlAction = resource?.status === "running" ? "shutdown" : "start";

  async function handleControl() {
    if (!canControl || actionLoading) return;
    setActionLoading(true);
    try {
      await ResourcesService[controlAction](resource.vmid);
      const status = controlAction === "start" ? "running" : "stopped";
      onUpdated({ ...resource, status });
      toast.success(controlAction === "start" ? "已送出啟動指令" : "已送出正常關機指令");
    } catch (error) {
      toast.error(error?.message ?? "機器操作失敗");
    } finally {
      setActionLoading(false);
    }
  }

  return <>
    <tr className={`${styles.tr} ${styles.environmentMachineRow}`}>
    <td className={styles.td}><div className={`${styles.nameCell} ${styles.environmentMachineName}`}><span className={styles.machineBranch}>└</span><span className={styles.nameIcon}><MIcon name={type.icon} size={18} /></span><div><strong>{machine.name}</strong><small>{machine.role} · {type.label}</small></div></div></td>
    <td className={styles.td}><div className={styles.envPrimary}>{machine.os}</div><div className={styles.envSub}>{machine.resource ? "已連接實際資源" : "建立中"}</div></td>
    <td className={styles.td}><StatusBadge status={machine.status} /></td>
    <td className={styles.td}><span className={styles.mono}>{machine.ip}</span></td>
    <td className={styles.td}><span className={styles.muted}>依環境管理</span></td>
    <td className={styles.td}>{machine.node}</td>
    <td className={styles.td}><div className={styles.rowActions}><button type="button" className={styles.terminalBtn} disabled={!canOpen} title={canOpen ? (isLxc ? "終端機" : "控制台") : "機器尚未完成或未開機"} onClick={() => setConsoleOpen(true)}><MIcon name={isLxc ? "terminal" : "desktop_windows"} size={14} />{isLxc ? "終端機" : "控制台"}</button><button type="button" className={styles.terminalBtn} disabled={!canControl || actionLoading || !["running", "stopped"].includes(resource?.status)} onClick={handleControl}><MIcon name={actionLoading ? "hourglass_empty" : controlAction === "start" ? "play_arrow" : "power_settings_new"} size={14} />{controlAction === "start" ? "啟動" : "關機"}</button></div></td>
    </tr>
    {consoleOpen && isLxc && createPortal(<TerminalDialog resource={resource} onClose={() => setConsoleOpen(false)} />, document.body)}
    {consoleOpen && !isLxc && createPortal(<VncDialog resource={resource} onClose={() => setConsoleOpen(false)} />, document.body)}
  </>;
}

function EnvironmentGroupRows({ group, onUpdated }) {
  const [expanded, setExpanded] = useState(true);
  const running = group.machines.filter((machine) => machine.status === "running").length;
  return <>
    <tr className={`${styles.tr} ${styles.environmentGroupRow}`}>
      <td className={styles.td}><button type="button" className={styles.environmentToggle} aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}><MIcon name={expanded ? "expand_more" : "chevron_right"} size={20} /><span className={styles.environmentIcon}><MIcon name={group.kind === "course" ? "school" : "bolt"} size={19} /></span><span><strong>{group.kindLabel}｜{group.title}</strong><small>{group.machines.length} 台機器 · 整組管理</small></span></button></td>
      <td className={styles.td}><div className={styles.envPrimary}>{group.kind === "course" ? "課程多機環境" : "快速練習環境"}</div><div className={styles.envSub}>整組檢視、逐台操作</div></td>
      <td className={styles.td}><span className={`${styles.badge} ${styles.badge_info}`}>{running}/{group.machines.length} 執行中</span></td>
      <td className={styles.td}><span className={styles.muted}>展開查看</span></td>
      <td className={styles.td}><strong className={styles.environmentTiming}>{group.timingLabel}</strong></td>
      <td className={styles.td}>{group.nodeLabel}</td>
      <td className={styles.td}><button type="button" className={styles.terminalBtn} onClick={() => setExpanded((value) => !value)}><MIcon name="dns" size={14} />{expanded ? "收合機器" : "使用機器"}</button></td>
    </tr>
    {expanded && group.machines.map((machine) => <EnvironmentMachineRow key={machine.id} machine={machine} onUpdated={onUpdated} />)}
  </>;
}

/* ── Skeleton ── */
function SkeletonRow() {
  return <tr className={styles.tr} aria-hidden>{[0, 1, 2, 3, 4, 5, 6].map((column) => <td key={column} className={styles.td}><div className={`${styles.skeleton} ${styles.skRow}`} style={{ width: column === 0 ? "75%" : "60%", height: 14 }} /></td>)}</tr>;
}

/* ── Empty / Error states ── */
function EmptyState() {
  return <SharedEmptyState icon="dns" title="尚無資源" />;
}

function ErrorState({ onRetry }) {
  return (
    <EmptyState
      icon="error_outline"
      title="載入失敗"
      action={
        <button type="button" className={styles.btnSecondary} onClick={onRetry}>
          <MIcon name="refresh" size={16} />
          重試
        </button>
      }
    />
  );
}

/* ── Page ── */
export default function ResourcesPage() {
  const navigate = useNavigate();
  const [resources, setResources] = useState([]);
  const [quickSessions, setQuickSessions] = useState([]);
  const [pending, setPending]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(false);
  const pendingSigRef = useRef(null);

  /** silent = true 時不觸發 skeleton / error state，供背景同步使用 */
  const fetchResources = useCallback(async (silent = false, signal) => {
    if (!silent) {
      setLoading(true);
      setError(false);
    }
    try {
      const [data, sessions] = await Promise.all([
        ResourcesService.list({ signal }),
        QuickPracticeService.listMySessions({ signal }).catch(() => []),
      ]);
      setResources(data ?? []);
      setQuickSessions(sessions ?? []);
    } catch (err) {
      if (!silent && !err?.cancelled) setError(true);
    } finally {
      if (!silent && !signal?.aborted) setLoading(false);
    }
  }, []);

  /** 輪詢建立中的申請；階段變化（開通完成／失敗／取消）時靜默刷新資源列表 */
  const refreshPending = useCallback(async () => {
    try {
      const items = await fetchPendingResources();
      setPending(items);
      const sig = pendingSignature(items);
      if (pendingSigRef.current !== null && sig !== pendingSigRef.current) {
        fetchResources(true);
      }
      pendingSigRef.current = sig;
    } catch {
      // 輪詢失敗靜默忽略，下一輪再試
    }
  }, [fetchResources]);

  useEffect(() => {
    const controller = new AbortController();
    fetchResources(false, controller.signal);
    return () => controller.abort();
  }, [fetchResources]);

  useEffect(() => {
    refreshPending();
    const timer = setInterval(refreshPending, PENDING_POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [refreshPending]);

  useAutoRefresh(() => fetchResources(true));

  function handleUpdated(updated) {
    setResources((prev) => prev.map((r) => r.vmid === updated.vmid ? updated : r));
  }

  function handleDeleted(vmid) {
    setResources((prev) => prev.filter((r) => r.vmid !== vmid));
  }

  // 建立中申請會同時出現在 pending 與資源 API；先移除 placeholder，避免重複列。
  const pendingRequestIds = new Set(pending.map((request) => String(request.id)));
  const resourcesForDisplay = resources.filter((resource) => !(
    resource.is_placeholder
    && resource.request_id != null
    && pendingRequestIds.has(String(resource.request_id))
  ));
  const environmentGroups = buildEnvironmentGroups(resourcesForDisplay, quickSessions);
  const grouped = groupedResourceKeys(environmentGroups);
  const visibleResources = resourcesForDisplay.filter((resource) => (
    !grouped.vmids.has(resource.vmid)
    && !grouped.requestIds.has(String(resource.request_id))
  ));
  const visiblePending = pending.filter((request) => !grouped.requestIds.has(String(request.id)));

  return (
    <div className={styles.page}>
      <PageHeader title="我的資源" subtitle="查看與管理申請通過的虛擬機和容器">
        <button
          type="button"
          className={styles.btnPrimary}
          onClick={() => navigate("/my-requests", { state: { create: true } })}
        >
          <MIcon name="add" size={16} />
          申請資源
        </button>
      </PageHeader>

      {/* 我的配額用量（模組 E） */}
      <QuotaUsageBar />

      <div className={styles.content}>
        {error ? (
          <ErrorState onRetry={() => fetchResources()} />
        ) : !loading && visibleResources.length === 0 && visiblePending.length === 0 && environmentGroups.length === 0 ? (
          <EmptyState />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th className={styles.th}>名稱</th><th className={styles.th}>環境／系統</th><th className={styles.th}>狀態</th><th className={styles.th}>IP 位址</th><th className={styles.th}>到期日</th><th className={styles.th}>節點</th><th className={styles.th}>動作</th></tr>
              </thead>
              <tbody>
                {loading ? [0, 1, 2].map((i) => <SkeletonRow key={i} />) : <>
                  {environmentGroups.map((group) => <EnvironmentGroupRows key={group.id} group={group} onUpdated={handleUpdated} />)}
                  {visiblePending.map((req) => <CreatingRow key={`creating:${req.id}`} request={req} onCancelled={refreshPending} />)}
                  {visibleResources.map((r, index) => <ResourceRow key={resourceRowKey(r, index)} resource={r} onUpdated={handleUpdated} onDeleted={handleDeleted} />)}
                </>}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}
