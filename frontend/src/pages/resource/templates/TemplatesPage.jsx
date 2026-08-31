import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import styles from "./TemplatesPage.module.scss";
import MIcon from "../../../components/MIcon";
import EmptyState from "../../../components/EmptyState/EmptyState";
import { useAuth } from "../../../contexts/AuthContext";
import { TemplatesService, safeTemplateIconUrl } from "../../../services/templates";
import { downloadBlob } from "../../../services/api";
import { useToast } from "../../../hooks/useToast";
import { useConfirm } from "../../../components/ConfirmDialog/ConfirmProvider";
import { TemplateStatusBadge } from "./TemplateBadges";
import TemplateCloneDialog from "./TemplateCloneDialog";
import TemplateFormDialog from "./TemplateFormDialog";
import LoadingState from "../../../components/LoadingState/LoadingState";
import PageHeader from "../../../components/PageHeader/PageHeader";

function visibilityLabel(template) {
  return template.visibility === "global"
    ? "全部可見"
    : "私人";
}

const formatBytes = (bytes) => {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
};

/** 使用手冊（附件）瀏覽與下載 */
function ManualDialog({ template, onClose }) {
  const toast = useToast();
  const [attachments, setAttachments] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    TemplatesService.listAttachments(template.id)
      .then((res) => !cancelled && setAttachments(res?.data ?? []))
      .catch((e) => {
        if (!cancelled) {
          toast.error(e?.message ?? "附件載入失敗");
          setAttachments([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [template.id, toast]);

  const handleDownload = async (attachment) => {
    setDownloadingId(attachment.id);
    try {
      const blob = await TemplatesService.downloadAttachment(template.id, attachment.id);
      downloadBlob(blob, attachment.filename);
    } catch (e) {
      toast.error(e?.message ?? "下載失敗");
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <span className={styles.modalTitle}>
          <MIcon name="description" size={20} />
          「{template.name}」使用手冊
        </span>
        {attachments === null ? (
          <LoadingState text="載入附件中…" />
        ) : attachments.length === 0 ? (
          <p className={styles.stateText}>此範本目前沒有附件。</p>
        ) : (
          <div className={styles.attachList}>
            {attachments.map((a) => (
              <div key={a.id} className={styles.attachItem}>
                <MIcon name="description" size={15} />
                <span className={styles.attachName}>{a.filename}</span>
                <span className={styles.attachSize}>{formatBytes(a.size_bytes)}</span>
                <button
                  type="button"
                  className={styles.attachBtn}
                  disabled={downloadingId === a.id}
                  onClick={() => handleDownload(a)}
                >
                  <MIcon name="download" size={15} />
                  {downloadingId === a.id ? "下載中…" : "下載"}
                </button>
              </div>
            ))}
          </div>
        )}
        <div className={styles.modalActions}>
          <button type="button" className={styles.btnSecondary} onClick={onClose}>
            關閉
          </button>
        </div>
      </div>
    </div>
  );
}

/** 單列的「⋯」操作選單 */
function RowMenu({ template, cycleBusy, onClone, onEdit, onManual, onRetry, onCycle, onDelete, onClose, anchorRef }) {
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (!ref.current?.contains(e.target) && !anchorRef?.current?.contains(e.target)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose, anchorRef]);

  return (
    <div ref={ref} className={styles.rowMenu}>
      <button
        type="button"
        className={styles.rowMenuItem}
        disabled={template.status !== "ready"}
        onClick={() => { onClose(); onClone(template); }}
      >
        <MIcon name="content_copy" size={15} />
        克隆開通
      </button>
      <button
        type="button"
        className={styles.rowMenuItem}
        onClick={() => { onClose(); onEdit(template); }}
      >
        <MIcon name="edit" size={15} />
        編輯 / 可見範圍
      </button>
      {template.attachment_count > 0 && (
        <button
          type="button"
          className={styles.rowMenuItem}
          onClick={() => { onClose(); onManual(template); }}
        >
          <MIcon name="description" size={15} />
          使用手冊（{template.attachment_count}）
        </button>
      )}
      <div className={styles.rowMenuDivider} />
      {template.status === "failed" && (
        <button
          type="button"
          className={styles.rowMenuItem}
          disabled={cycleBusy}
          onClick={() => { onClose(); onRetry(template.id); }}
        >
          <MIcon name="restart_alt" size={15} />
          重新轉換
        </button>
      )}
      {template.status === "ready" && (
        <button
          type="button"
          className={styles.rowMenuItem}
          disabled={cycleBusy}
          onClick={() => { onClose(); onCycle(template.id, "start"); }}
        >
          <MIcon name="sync" size={15} />
          開始更新循環
        </button>
      )}
      {template.status === "updating" && (
        <>
          <button
            type="button"
            className={styles.rowMenuItem}
            disabled={cycleBusy}
            onClick={() => { onClose(); onCycle(template.id, "finish"); }}
          >
            <MIcon name="sync" size={15} />
            完成更新（轉為新版）
          </button>
          <button
            type="button"
            className={styles.rowMenuItem}
            disabled={cycleBusy}
            onClick={() => { onClose(); onCycle(template.id, "cancel"); }}
          >
            取消更新循環
          </button>
        </>
      )}
      <div className={styles.rowMenuDivider} />
      <button
        type="button"
        className={`${styles.rowMenuItem} ${styles.rowMenuItemDanger}`}
        onClick={() => { onClose(); onDelete(template); }}
      >
        <MIcon name="delete_outline" size={15} />
        刪除範本
      </button>
    </div>
  );
}

function ManagementRow({ template, cycleBusy, onClone, onEdit, onManual, onRetry, onCycle, onDelete }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtnRef = useRef(null);

  return (
    <tr className={styles.tr}>
      <td className={styles.td}>
        <div className={styles.nameCell}>
          {safeTemplateIconUrl(template.icon_url) && (
            <img
              className={styles.iconThumbSmall}
              src={safeTemplateIconUrl(template.icon_url)}
              alt=""
            />
          )}
          <span className={styles.namePrimary}>{template.name}</span>
          {template.pve_exists === false && template.status === "ready" && (
            <span className={styles.pveMissing} title="PVE 端找不到這個範本，可能已被手動刪除">
              <MIcon name="warning" size={13} />
              PVE 不存在
            </span>
          )}
        </div>
        {template.description && (
          <p className={styles.nameDesc}>{template.description}</p>
        )}
        {template.error_message && (
          <p className={styles.nameError}>{template.error_message}</p>
        )}
      </td>
      <td className={`${styles.td} ${styles.monoCell}`}>{template.pve_vmid}</td>
      <td className={styles.td}>
        <span className={styles.typeChip}>{template.resource_type}</span>
      </td>
      <td className={styles.td}>
        <TemplateStatusBadge status={template.status} />
      </td>
      <td className={`${styles.td} ${styles.mutedCell}`}>{visibilityLabel(template)}</td>
      <td className={`${styles.td} ${styles.mutedCell}`}>v{template.version}</td>
      <td className={`${styles.td} ${styles.tdMenu}`}>
        <div className={styles.menuWrap}>
          {menuOpen && (
            <RowMenu
              template={template}
              cycleBusy={cycleBusy}
              onClone={onClone}
              onEdit={onEdit}
              onManual={onManual}
              onRetry={onRetry}
              onCycle={onCycle}
              onDelete={onDelete}
              onClose={() => setMenuOpen(false)}
              anchorRef={menuBtnRef}
            />
          )}
          <button
            ref={menuBtnRef}
            type="button"
            className={styles.menuBtn}
            onClick={() => setMenuOpen((v) => !v)}
            title="更多操作"
          >
            <MIcon name="more_horiz" size={18} />
          </button>
        </div>
      </td>
    </tr>
  );
}

function StudentCatalog({ templates, onClone, onManual }) {
  if (templates.length === 0) {
    return (
      <div className={styles.card}>
        <EmptyState icon="widgets" title="目前沒有可用的範本" />
      </div>
    );
  }

  return (
    <div className={styles.catalogGrid}>
      {templates.map((template) => (
        <div key={template.id} className={styles.catalogCard}>
          <div className={styles.catalogHead}>
            {safeTemplateIconUrl(template.icon_url) ? (
              <img
                className={styles.iconThumb}
                src={safeTemplateIconUrl(template.icon_url)}
                alt=""
              />
            ) : (
              <MIcon name="library_books" size={18} />
            )}
            <span className={styles.catalogName}>{template.name}</span>
          </div>
          {template.description && (
            <p className={styles.catalogDesc}>{template.description}</p>
          )}
          <div className={styles.catalogChips}>
            <span className={styles.typeChip}>{template.resource_type}</span>
            {template.default_cores && (
              <span className={styles.typeChip}>{template.default_cores} 核</span>
            )}
            {template.default_memory && (
              <span className={styles.typeChip}>
                {Math.round(template.default_memory / 1024)} GB RAM
              </span>
            )}
            {template.default_disk && (
              <span className={styles.typeChip}>{template.default_disk} GB 磁碟</span>
            )}
            <span className={styles.typeChip}>v{template.version}</span>
            {template.requires_gpu && (
              <span className={styles.typeChip}>需要 GPU</span>
            )}
            {template.allow_password_change === false && (
              <span className={styles.typeChip}>固定帳密</span>
            )}
          </div>
          <div className={styles.catalogActions}>
            <button
              type="button"
              className={`${styles.btnPrimary} ${styles.catalogBtn}`}
              onClick={() => onClone(template)}
            >
              <MIcon name="content_copy" size={14} />
              一鍵克隆
            </button>
            {template.attachment_count > 0 && (
              <button
                type="button"
                className={`${styles.btnSecondary} ${styles.catalogBtn}`}
                onClick={() => onManual(template)}
              >
                <MIcon name="description" size={14} />
                使用手冊（{template.attachment_count}）
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function TemplatesPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const { user } = useAuth();
  const canManage =
    user?.role === "admin" || user?.role === "teacher" || user?.is_superuser === true;

  const [templates, setTemplates] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [cloneTarget, setCloneTarget] = useState(null);
  const [manualTarget, setManualTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [cycleBusy, setCycleBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const timerRef = useRef(null);
  const [searchParams, setSearchParams] = useSearchParams();

  // 儀表板「快速入門」深連結：?clone=<templateId> 直接打開克隆視窗
  useEffect(() => {
    const cloneId = searchParams.get("clone");
    if (!cloneId || templates === null) return;
    const target = templates.find(
      (t) => t.id === cloneId && t.status === "ready",
    );
    if (target) setCloneTarget(target);
    setSearchParams({}, { replace: true });
  }, [templates, searchParams, setSearchParams]);

  const load = useCallback(async () => {
    try {
      const res = await TemplatesService.list();
      setTemplates(res?.data ?? []);
      return res?.data ?? [];
    } catch (e) {
      toast.error(e?.message ?? "載入範本失敗");
      setTemplates((prev) => prev ?? []);
      return [];
    }
  }, [toast]);

  /** 有 creating/updating 中的範本時 4 秒輪詢，否則 30 秒 */
  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      const list = await load();
      if (cancelled) return;
      const active = list.some((t) => t.status === "creating" || t.status === "updating");
      timerRef.current = setTimeout(tick, active ? 4_000 : 30_000);
    };

    tick();
    return () => {
      cancelled = true;
      clearTimeout(timerRef.current);
    };
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const handleCycle = async (templateId, action) => {
    if (action === "finish") {
      const ok = await confirm({
        title: "完成更新並轉為新版範本？",
        message:
          "暫存母機會被關機，且其所有快照（備份點）會被移除，接著轉為新版唯讀範本並汰換舊版。此動作無法復原。",
        confirmText: "關機並轉換",
        danger: true,
      });
      if (!ok) return;
    }
    setCycleBusy(true);
    try {
      if (action === "start") await TemplatesService.startUpdateCycle(templateId);
      else if (action === "finish") await TemplatesService.finishUpdateCycle(templateId);
      else await TemplatesService.cancelUpdateCycle(templateId);
      toast.success(
        action === "start"
          ? "已開始更新循環：系統正在複製一台暫存母機，完成後會出現在你的資源列表，修改完再回到此頁按「完成更新」"
          : action === "finish"
            ? "正在把暫存母機轉為新版範本"
            : "已取消更新循環，暫存母機將被回收",
      );
      await load();
    } catch (e) {
      toast.error(e?.message ?? "操作失敗");
    } finally {
      setCycleBusy(false);
    }
  };

  const handleRetry = async (templateId) => {
    const ok = await confirm({
      title: "重新轉換為範本？",
      message:
        "母機會被關機，且其所有快照（備份點）會被移除，再轉為唯讀範本。此動作無法復原。",
      confirmText: "關機並轉換",
      danger: true,
    });
    if (!ok) return;
    setCycleBusy(true);
    try {
      await TemplatesService.retry(templateId);
      toast.success("已重新送出轉換；母機會先安全關機、移除所有快照，再轉為唯讀範本");
      await load();
    } catch (e) {
      toast.error(e?.message ?? "重新轉換失敗");
    } finally {
      setCycleBusy(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await TemplatesService.remove(deleteTarget.id);
      toast.success("刪除任務已送出，進度請見側欄「背景任務」");
      setDeleteTarget(null);
      await load();
    } catch (e) {
      toast.error(e?.message ?? "刪除範本失敗");
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  const list = templates ?? [];
  const readyTemplates = list.filter((t) => t.status === "ready");

  return (
    <div className={styles.page}>
      <PageHeader title="機器母範本" subtitle="管理教師組裝多機環境時使用的單機來源；學生不會直接看到或複製母範本。">
        <div className={styles.pageActions}>
          <button
            type="button"
            className={styles.btnSecondary}
            onClick={refresh}
            disabled={refreshing}
          >
            <MIcon name="sync" size={16} />
            {refreshing ? "載入中…" : "重新整理"}
          </button>
          {canManage && (
            <button
              type="button"
              className={styles.btnPrimary}
              onClick={() => setCreateOpen(true)}
            >
              <MIcon name="add" size={16} />
              從 VM 建立範本
            </button>
          )}
        </div>
      </PageHeader>

      {templates === null ? (
        <LoadingState fullPage text="載入範本中…" />
      ) : canManage ? (
        list.length === 0 ? (
          <div className={styles.card}>
            <EmptyState
              icon="widgets"
              title="還沒有任何範本"
            />
          </div>
        ) : (
          <div className={styles.card}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th}>名稱</th>
                  <th className={styles.th}>VMID</th>
                  <th className={styles.th}>類型</th>
                  <th className={styles.th}>狀態</th>
                  <th className={styles.th}>可見範圍</th>
                  <th className={styles.th}>版本</th>
                  <th className={styles.th} />
                </tr>
              </thead>
              <tbody>
                {list.map((template) => (
                  <ManagementRow
                    key={template.id}
                    template={template}
                    cycleBusy={cycleBusy}
                    onClone={setCloneTarget}
                    onEdit={setEditTarget}
                    onManual={setManualTarget}
                    onRetry={handleRetry}
                    onCycle={handleCycle}
                    onDelete={setDeleteTarget}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        <StudentCatalog
          templates={readyTemplates}
          onClone={setCloneTarget}
          onManual={setManualTarget}
        />
      )}

      {createOpen && (
        <TemplateFormDialog
          onClose={() => setCreateOpen(false)}
          onSaved={() => load()}
        />
      )}
      {editTarget && (
        <TemplateFormDialog
          template={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => load()}
        />
      )}
      {manualTarget && (
        <ManualDialog
          template={manualTarget}
          onClose={() => setManualTarget(null)}
        />
      )}
      {cloneTarget && (
        <TemplateCloneDialog
          template={cloneTarget}
          canBatch={canManage}
          onClose={() => setCloneTarget(null)}
        />
      )}

      {deleteTarget && (
        <div className={styles.modalOverlay} onClick={() => setDeleteTarget(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <span className={styles.modalTitle}>刪除範本「{deleteTarget.name}」？</span>
            <p className={styles.modalDesc}>
              PVE 端的範本磁碟會一併刪除，動作無法復原。如果還有從此範本克隆出的機器（linked
              clone），系統會拒絕刪除。
            </p>
            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={() => setDeleteTarget(null)}
              >
                取消
              </button>
              <button
                type="button"
                className={styles.btnDanger}
                disabled={deleting}
                onClick={handleDelete}
              >
                {deleting ? "刪除中…" : "確認刪除"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
