import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import styles from "./ResourceMgmtPage.module.scss";
import MIcon from "../../../components/MIcon";
import PowerMenu from "../../../components/PowerMenu/PowerMenu";
import SharedEmptyState from "../../../components/EmptyState/EmptyState";
import { useToast } from "../../../hooks/useToast";
import useAutoRefresh from "../../../hooks/useAutoRefresh";
import LoadingState from "../../../components/LoadingState/LoadingState";
import { ResourcesService } from "../../../services/resources";
import TerminalDialog from "../../personal/resources/TerminalDialog";
import VncDialog from "../../personal/resources/VncDialog";
import PageHeader from "../../../components/PageHeader/PageHeader";
import { QuickPracticeService } from "../../../services/quickPractice";
import { buildEnvironmentGroups, groupedResourceKeys } from "../../../utils/environmentGroups";

/* ── Constants ── */
const STATUS_MAP = {
  scheduled:    { label: "已排程",   color: "info"    },
  provisioning: { label: "建立中",   color: "info"    },
  running:      { label: "執行中",   color: "success" },
  stopped:      { label: "已關機",   color: "muted"   },
  paused:       { label: "已暫停",   color: "muted"   },
  failed:       { label: "建立失敗", color: "danger"  },
  deleted:      { label: "已刪除",   color: "danger"  },
  unknown:      { label: "狀態未知", color: "muted"   },
};

const TYPE_MAP = {
  lxc:  { label: "容器 (LXC)",  icon: "terminal" },
  qemu: { label: "虛擬機 (VM)", icon: "computer" },
};

const ACTION_LABEL = {
  start:    "啟動",
  stop:     "強制停止",
  shutdown: "關機",
  reset:    "強制重置",
  reboot:   "重新啟動",
};

const COLUMNS = ["名稱", "環境 / 系統", "狀態", "IP 位址", "到期日", "節點", "動作"];

const BATCH_ACTIONS = [
  { action: "start",    label: "啟動",     icon: "play_arrow" },
  { action: "shutdown", label: "關機",     icon: "power_settings_new" },
  { action: "reboot",   label: "重新啟動", icon: "restart_alt" },
  { action: "stop",     label: "強制停止", icon: "stop" },
  { action: "reset",    label: "強制重置", icon: "cancel" },
];

const LIVE_STATUSES = new Set(["running", "stopped", "paused"]);

/* ── Helpers ── */
function formatDate(isoStr) {
  if (!isoStr) return null;
  return new Date(isoStr).toLocaleDateString("zh-TW", {
    year: "numeric", month: "2-digit", day: "2-digit",
  });
}

function resourceRowKey(resource, index) {
  const parts = [
    resource.type || "resource",
    resource.node || "unknown-node",
    resource.vmid ?? resource.request_id ?? resource.name ?? "unknown",
  ];
  return `${parts.join(":")}:${index}`;
}

/** 電源操作後的樂觀狀態：start/reboot/reset 後仍為執行中，stop/shutdown 後為已關機 */
function statusAfterAction(action) {
  return action === "stop" || action === "shutdown" ? "stopped" : "running";
}

/* ── Primitive sub-components ── */
function StatusBadge({ status }) {
  const s = STATUS_MAP[status] ?? { label: status, color: "muted" };
  return (
    <span className={`${styles.badge} ${styles[`badge_${s.color}`]}`}>
      {s.label}
    </span>
  );
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
      <td className={`${styles.td} ${styles.checkCell}`} />
      <td className={styles.td}>
        <div className={`${styles.nameCell} ${styles.environmentMachineName}`}>
          <span className={styles.machineBranch} aria-hidden="true">└</span>
          <div className={styles.nameIcon}><MIcon name={type.icon} size={18} /></div>
          <div>
            <div className={styles.namePrimary}>{machine.name}</div>
            <div className={styles.nameSub}>{machine.role} · {type.label}</div>
          </div>
        </div>
      </td>
      <td className={styles.td}>
        <div className={styles.envPrimary}>{machine.os}</div>
        <div className={styles.envSub}>{machine.resource ? "已連接實際資源" : "建立中"}</div>
      </td>
      <td className={styles.td}><StatusBadge status={machine.status} /></td>
      <td className={styles.td}><span className={styles.mono}>{machine.ip}</span></td>
      <td className={styles.td}><span className={styles.noAction}>依環境統一管理</span></td>
      <td className={styles.td}>{machine.node}</td>
      <td className={styles.td}><div className={styles.actions}>
        <button type="button" className={styles.consoleBtn} disabled={!canOpen} title={canOpen ? (isLxc ? "終端機" : "控制台") : "機器尚未完成或未開機"} onClick={() => setConsoleOpen(true)}>
          <MIcon name={isLxc ? "terminal" : "desktop_windows"} size={14} />
          {isLxc ? "終端機" : "控制台"}
        </button>
        <button type="button" className={styles.consoleBtn} disabled={!canControl || actionLoading || !["running", "stopped"].includes(resource?.status)} onClick={handleControl}><MIcon name={actionLoading ? "hourglass_empty" : controlAction === "start" ? "play_arrow" : "power_settings_new"} size={14} />{controlAction === "start" ? "啟動" : "關機"}</button>
      </div></td>
    </tr>
    {consoleOpen && isLxc && createPortal(<TerminalDialog resource={resource} onClose={() => setConsoleOpen(false)} />, document.body)}
    {consoleOpen && !isLxc && createPortal(<VncDialog resource={resource} onClose={() => setConsoleOpen(false)} />, document.body)}
  </>;
}

function EnvironmentGroupRows({ group, onUpdated }) {
  const [expanded, setExpanded] = useState(true);
  const running = group.machines.filter((machine) => machine.status === "running").length;
  const allRunning = running === group.machines.length;
  return (
    <>
      <tr className={`${styles.tr} ${styles.environmentGroupRow}`}>
        <td className={`${styles.td} ${styles.checkCell}`} />
        <td className={styles.td}>
          <button
            type="button"
            className={styles.environmentToggle}
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            <MIcon name={expanded ? "expand_more" : "chevron_right"} size={20} />
            <span className={styles.environmentIcon}><MIcon name={group.kind === "course" ? "school" : "bolt"} size={19} /></span>
            <span><strong>{group.kindLabel}｜{group.title}</strong><small>{group.machines.length} 台機器 · 整組管理</small></span>
          </button>
        </td>
        <td className={styles.td}>
          <div className={styles.envPrimary}>{group.kind === "course" ? "課程多機環境" : "快速練習環境"}</div>
          <div className={styles.envSub}>整組檢視、逐台操作</div>
        </td>
        <td className={styles.td}>
          <span className={`${styles.badge} ${styles[`badge_${allRunning ? "success" : "info"}`]}`}>{running}/{group.machines.length} 執行中</span>
        </td>
        <td className={styles.td}><span className={styles.noAction}>展開查看</span></td>
        <td className={styles.td}><strong className={styles.environmentTiming}>{group.timingLabel}</strong></td>
        <td className={styles.td}>{group.nodeLabel}</td>
        <td className={styles.td}>
          <button type="button" className={styles.consoleBtn} onClick={() => setExpanded((value) => !value)}>
            <MIcon name="dns" size={14} />{expanded ? "收合機器" : "使用機器"}
          </button>
        </td>
      </tr>
      {expanded && group.machines.map((machine) => (
        <EnvironmentMachineRow key={machine.id} machine={machine} onUpdated={onUpdated} />
      ))}
    </>
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

/* ── 批次操作列（有勾選才顯示） ── */
function BatchActionBar({ selectedVmids, onDone, onClear }) {
  const toast = useToast();
  const [pending, setPending] = useState(null); // 進行中的 action
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const count = selectedVmids.length;

  async function run(action) {
    setPending(action);
    try {
      const res = await ResourcesService.batchAction(selectedVmids, action);
      const label = action === "delete" ? "刪除" : ACTION_LABEL[action];
      if ((res?.failed ?? 0) === 0) {
        toast.success(`已對 ${res?.succeeded ?? count} 台送出「${label}」`);
      } else {
        toast.error(`「${label}」成功 ${res?.succeeded ?? 0} 台、失敗 ${res?.failed} 台`);
      }
      onDone();
    } catch (err) {
      toast.error(err?.message ?? "批次操作失敗");
    } finally {
      setPending(null);
      setDeleteConfirm(false);
    }
  }

  if (count === 0) return null;

  return (
    <div className={styles.batchBar}>
      <span className={styles.batchCount}>已選 {count} 台</span>
      <span className={styles.batchDivider} />
      {BATCH_ACTIONS.map(({ action, label, icon }) => (
        <button
          key={action}
          type="button"
          className={styles.btnSecondary}
          disabled={pending !== null}
          onClick={() => run(action)}
        >
          <MIcon name={icon} size={14} />
          {label}
        </button>
      ))}
      <span className={styles.batchDivider} />
      <button
        type="button"
        className={styles.btnDangerOutline}
        disabled={pending !== null}
        onClick={() => setDeleteConfirm(true)}
      >
        <MIcon name="delete" size={14} />
        刪除
      </button>
      <button
        type="button"
        className={styles.btnGhost}
        disabled={pending !== null}
        onClick={onClear}
      >
        取消選取
      </button>

      {deleteConfirm && (
        <ConfirmModal
          title={`刪除 ${count} 台資源？`}
          desc="將對所有勾選的虛擬機/容器送出刪除請求，此操作無法復原。"
          confirmLabel={pending === "delete" ? "刪除中…" : "確認刪除"}
          danger
          loading={pending !== null}
          onConfirm={() => run("delete")}
          onClose={() => setDeleteConfirm(false)}
        />
      )}
    </div>
  );
}

function ResourceRow({ resource, onUpdated, onDeleted, selected = false, onToggleSelect = null }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [actionLoading, setActionLoading] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting]           = useState(false);
  const [menuOpen, setMenuOpen]           = useState(false);
  const [menuClosing, setMenuClosing]     = useState(false);
  const [consoleOpen, setConsoleOpen]     = useState(false);
  const menuBtnRef = useRef(null);

  function closeMenu() {
    setMenuClosing(true);
    setTimeout(() => { setMenuOpen(false); setMenuClosing(false); }, 130);
  }

  const type  = TYPE_MAP[resource.type] ?? { label: resource.type, icon: "computer" };
  const isLxc = resource.type === "lxc";
  const canControl = resource.can_control !== false && resource.vmid != null && resource.vmid > 0;
  const isLive = canControl && LIVE_STATUSES.has(resource.status);

  async function handleControl(action) {
    setActionLoading(action);
    try {
      await ResourcesService[action](resource.vmid);
      toast.success(`已送出「${ACTION_LABEL[action]}」指令（${resource.name}）`);
      onUpdated({ ...resource, status: statusAfterAction(action) });
    } catch (err) {
      toast.error(err?.message ?? `${ACTION_LABEL[action]}失敗`);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await ResourcesService.delete(resource.vmid);
      toast.success(`已送出刪除請求（${resource.name}）`);
      onDeleted(resource.vmid);
    } catch (err) {
      toast.error(err?.message ?? "刪除失敗");
    } finally {
      setDeleting(false);
      setDeleteConfirm(false);
    }
  }

  return (
    <>
      <tr className={styles.tr}>
        {/* 勾選 */}
        <td className={`${styles.td} ${styles.checkCell}`}>
          {onToggleSelect && canControl ? (
            <input
              type="checkbox"
              className={styles.checkbox}
              checked={selected}
              onChange={() => onToggleSelect(resource.vmid)}
              aria-label={`選取 ${resource.name}`}
            />
          ) : null}
        </td>
        {/* 名稱 */}
        <td className={styles.td}>
          <div className={styles.nameCell}>
            <div className={styles.nameIcon}>
              <MIcon name={type.icon} size={18} />
            </div>
            <div>
              {resource.vmid > 0 ? (
                <button
                  type="button"
                  className={`${styles.namePrimary} ${styles.nameLink}`}
                  title="查看詳情"
                  onClick={() => navigate(`/resource-mgmt/${resource.vmid}`)}
                >
                  {resource.name}
                </button>
              ) : (
                <div className={styles.namePrimary}>{resource.name}</div>
              )}
              <div className={styles.nameSub}>
                {type.label}
                {resource.vmid > 0 && ` · VMID ${resource.vmid}`}
              </div>
            </div>
          </div>
        </td>

        {/* 環境 / 系統 */}
        <td className={styles.td}>
          <div className={styles.envPrimary}>{resource.environment_type ?? "—"}</div>
          {resource.os_info && <div className={styles.envSub}>{resource.os_info}</div>}
        </td>

        {/* 狀態 */}
        <td className={styles.td}>
          <StatusBadge status={resource.status} />
        </td>

        {/* IP */}
        <td className={styles.td}>
          <span className={styles.mono}>{resource.ip_address ?? "N/A"}</span>
        </td>

        {/* 到期日 */}
        <td className={styles.td}>
          {resource.expiry_date
            ? formatDate(resource.expiry_date)
            : <span className={styles.noExpiry}>∞ 無期限</span>
          }
        </td>

        {/* 節點 */}
        <td className={styles.td}>{resource.node ?? "—"}</td>

        {/* 動作 */}
        <td className={styles.td}>
          {isLive ? (
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.consoleBtn}
                title={isLxc ? "終端機" : "控制台"}
                disabled={resource.status !== "running"}
                onClick={() => setConsoleOpen(true)}
              >
                <MIcon name={isLxc ? "terminal" : "desktop_windows"} size={14} />
                {isLxc ? "終端機" : "控制台"}
              </button>
              {actionLoading && <MIcon name="hourglass_empty" size={16} />}
              <div className={styles.menuWrap}>
                {menuOpen && (
                  <PowerMenu
                    resource={resource}
                    actionLoading={actionLoading}
                    onControl={handleControl}
                    onDeleteClick={() => { closeMenu(); setDeleteConfirm(true); }}
                    onClose={closeMenu}
                    anchorRef={menuBtnRef}
                    closing={menuClosing}
                  />
                )}
                <button
                  ref={menuBtnRef}
                  type="button"
                  className={`${styles.menuBtn} ${menuOpen ? styles.menuBtnActive : ""}`}
                  onClick={() => menuOpen ? closeMenu() : setMenuOpen(true)}
                  title="電源控制"
                >
                  <MIcon name="more_vert" size={18} />
                </button>
              </div>
            </div>
          ) : (
            <span className={styles.noAction}>
              {STATUS_MAP[resource.status]?.label ?? "—"}
            </span>
          )}
        </td>
      </tr>

      {/* Portal 到 body：列在 <tbody> 內，div 直接掛這裡是不合法巢狀，
          且 .tableWrap 的 backdrop-filter 會讓 fixed 遮罩只蓋住表格範圍 */}
      {deleteConfirm && createPortal(
        <ConfirmModal
          title="確定刪除資源？"
          desc={`「${resource.name}」(VMID ${resource.vmid}) 刪除後無法復原，所有資料將會消失。`}
          confirmLabel="刪除"
          danger
          loading={deleting}
          onConfirm={handleDelete}
          onClose={() => setDeleteConfirm(false)}
        />,
        document.body,
      )}

      {consoleOpen && isLxc && createPortal(
        <TerminalDialog resource={resource} onClose={() => setConsoleOpen(false)} />,
        document.body,
      )}
      {consoleOpen && !isLxc && createPortal(
        <VncDialog resource={resource} onClose={() => setConsoleOpen(false)} />,
        document.body,
      )}
    </>
  );
}

/* ── Empty / Error states ── */
function EmptyState() {
  return <SharedEmptyState icon="dns" title="尚無虛擬機或容器" />;
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
export default function ResourceMgmtPage() {
  const navigate = useNavigate();
  const [resources, setResources] = useState([]);
  const [quickSessions, setQuickSessions] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(false);
  const [selectedVmids, setSelectedVmids] = useState(() => new Set());

  const environmentGroups = buildEnvironmentGroups(resources, quickSessions);
  const grouped = groupedResourceKeys(environmentGroups);
  const visibleResources = resources.filter((resource) => (
    !grouped.vmids.has(resource.vmid)
    && !grouped.requestIds.has(String(resource.request_id))
  ));
  const selectableVmids = visibleResources
    .filter((r) => r.can_control !== false && r.vmid != null && r.vmid > 0)
    .map((r) => r.vmid);
  const allSelected = selectableVmids.length > 0 && selectableVmids.every((v) => selectedVmids.has(v));

  function toggleSelect(vmid) {
    setSelectedVmids((prev) => {
      const next = new Set(prev);
      if (next.has(vmid)) next.delete(vmid);
      else next.add(vmid);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedVmids(allSelected ? new Set() : new Set(selectableVmids));
  }

  /** silent = true 時不觸發 loading / error state，供背景自動刷新使用 */
  const fetchResources = useCallback(async (silent = false, signal) => {
    if (!silent) {
      setLoading(true);
      setError(false);
    }
    try {
      const [data, sessions] = await Promise.all([
        ResourcesService.listAll({ signal }),
        QuickPracticeService.listAllSessions({ signal }).catch(() => []),
      ]);
      setResources(data ?? []);
      setQuickSessions(sessions ?? []);
    } catch (err) {
      if (!silent && !err?.cancelled) setError(true);
    } finally {
      if (!silent && !signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchResources(false, controller.signal);
    return () => controller.abort();
  }, [fetchResources]);
  useAutoRefresh(() => fetchResources(true));

  function handleUpdated(updated) {
    setResources((prev) => prev.map((r) => r.vmid === updated.vmid ? updated : r));
  }

  function handleDeleted(vmid) {
    setResources((prev) => prev.filter((r) => r.vmid !== vmid));
    setSelectedVmids((prev) => {
      if (!prev.has(vmid)) return prev;
      const next = new Set(prev);
      next.delete(vmid);
      return next;
    });
  }

  return (
    <div className={styles.page}>
      {/* ── 頁首 ── */}
      <PageHeader title="虛擬機與容器" subtitle="查看與管理系統中所有虛擬機與 LXC 容器">
        <div className={styles.pageActions}>
          <button type="button" className={styles.btnPrimary} onClick={() => navigate("/my-requests")}>
            <MIcon name="add" size={16} />
            建立資源
          </button>
        </div>
      </PageHeader>

      {/* ── 批次操作 ── */}
      <BatchActionBar
        selectedVmids={[...selectedVmids]}
        onDone={() => {
          setSelectedVmids(new Set());
          fetchResources();
        }}
        onClear={() => setSelectedVmids(new Set())}
      />

      {/* ── 內容 ── */}
      <div className={styles.content}>
        <div className={styles.previewNotice} role="note">
          <MIcon name="account_tree" size={17} />
          <span><strong>多機環境</strong>課堂機器與快速練習會整組顯示，展開後可操作實際機器。</span>
        </div>
        {error ? (
          <ErrorState onRetry={fetchResources} />
        ) : loading ? (
          <LoadingState fullPage />
        ) : visibleResources.length === 0 && environmentGroups.length === 0 ? (
          <EmptyState />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={`${styles.th} ${styles.checkCell}`}>
                    <input
                      type="checkbox"
                      className={styles.checkbox}
                      checked={allSelected}
                      disabled={selectableVmids.length === 0}
                      onChange={toggleSelectAll}
                      aria-label="全選"
                    />
                  </th>
                  {COLUMNS.map((col) => (
                    <th key={col} className={styles.th}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {environmentGroups.map((group) => <EnvironmentGroupRows key={group.id} group={group} onUpdated={handleUpdated} />)}
                {visibleResources.map((r, index) => (
                  <ResourceRow
                    key={resourceRowKey(r, index)}
                    resource={r}
                    onUpdated={handleUpdated}
                    onDeleted={handleDeleted}
                    selected={selectedVmids.has(r.vmid)}
                    onToggleSelect={toggleSelect}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
