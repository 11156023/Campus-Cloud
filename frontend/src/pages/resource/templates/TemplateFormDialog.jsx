import { useEffect, useRef, useState } from "react";
import styles from "./TemplatesPage.module.scss";
import MIcon from "../../../components/MIcon";
import { useAuth } from "../../../contexts/AuthContext";
import { ResourcesService } from "../../../services/resources";
import { TemplatesService, safeTemplateIconUrl } from "../../../services/templates";
import { useToast } from "../../../hooks/useToast";
import { useConfirm } from "../../../components/ConfirmDialog/ConfirmProvider";

const CORE_MIN = 1;
const CORE_MAX = 8;
const MEMORY_MIN = 512;
const MEMORY_MAX = 32768;

// 與後端 template_files.py 的限制一致（前端先擋，後端仍會驗證）
const ICON_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
  "image/gif",
]);
const ICON_MAX_BYTES = 2 * 1024 * 1024;
const ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024;
const ATTACHMENT_MAX_COUNT = 10;
const ATTACHMENT_EXTS = new Set([
  ".pdf", ".md", ".txt", ".doc", ".docx", ".ppt", ".pptx",
  ".xls", ".xlsx", ".odt", ".odp", ".zip",
  ".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4",
]);

const fileExt = (name) => {
  const idx = String(name || "").lastIndexOf(".");
  return idx >= 0 ? String(name).slice(idx).toLowerCase() : "";
};

const formatBytes = (bytes) => {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
};

/**
 * 建立（從 VM 轉換）或編輯範本的 dialog。
 * template 有值 = 編輯模式。
 * icon / 附件：編輯模式即時上傳；建立模式先暫存，create 成功後補上傳。
 */
export default function TemplateFormDialog({ template, closing = false, onClose, onSaved }) {
  const toast = useToast();
  const confirm = useConfirm();
  const { user } = useAuth();
  const isEdit = Boolean(template);
  const isAdmin = user?.role === "admin" || user?.is_superuser === true;

  const [sourceVmid, setSourceVmid] = useState("");
  const [name, setName] = useState(template?.name ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [visibility, setVisibility] = useState(template?.visibility ?? "private");
  const [useCustomSpec, setUseCustomSpec] = useState(
    Boolean(template?.default_cores || template?.default_memory),
  );
  const [defaultCores, setDefaultCores] = useState(template?.default_cores || 2);
  const [defaultMemory, setDefaultMemory] = useState(template?.default_memory || 2048);
  const [allowPasswordChange, setAllowPasswordChange] = useState(
    template ? template.allow_password_change !== false : true,
  );
  const [requiresGpu, setRequiresGpu] = useState(Boolean(template?.requires_gpu));
  const [resources, setResources] = useState([]);
  const [resourcesLoading, setResourcesLoading] = useState(!isEdit);
  const [busy, setBusy] = useState(false);

  // 編輯模式：既有 icon / 附件（即時操作）
  const [iconUrl, setIconUrl] = useState(template?.icon_url ?? null);
  const [iconBusy, setIconBusy] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [attachBusy, setAttachBusy] = useState(false);
  // 建立模式：暫存檔案，create 成功後補上傳
  const [pendingIcon, setPendingIcon] = useState(null);
  const [pendingAttachments, setPendingAttachments] = useState([]);
  const iconInputRef = useRef(null);
  const attachInputRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    if (!isEdit) {
      (isAdmin ? ResourcesService.listAll() : ResourcesService.list())
        .then((res) => !cancelled && setResources(res ?? []))
        .catch(() => {})
        .finally(() => !cancelled && setResourcesLoading(false));
    } else {
      TemplatesService.listAttachments(template.id)
        .then((res) => !cancelled && setAttachments(res?.data ?? []))
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [isEdit, isAdmin, template?.id]);

  // 來源機類型決定可否設定 GPU（hostpci 僅 qemu 支援）
  const selectedResource = resources.find((r) => String(r.vmid) === sourceVmid);
  const resourceType = isEdit ? template.resource_type : selectedResource?.type;
  const gpuSelectable = resourceType !== "lxc";

  useEffect(() => {
    if (!gpuSelectable && requiresGpu) setRequiresGpu(false);
  }, [gpuSelectable, requiresGpu]);

  const validateIcon = (file) => {
    if (!ICON_TYPES.has(file.type)) {
      toast.error("僅支援 PNG / JPEG / WebP / SVG / GIF 圖片");
      return false;
    }
    if (file.size > ICON_MAX_BYTES) {
      toast.error("圖片大小不可超過 2MB");
      return false;
    }
    return true;
  };

  const validateAttachment = (file, currentCount) => {
    const ext = fileExt(file.name);
    if (!ATTACHMENT_EXTS.has(ext)) {
      toast.error(`不支援的檔案類型 ${ext || "(無副檔名)"}`);
      return false;
    }
    if (file.size > ATTACHMENT_MAX_BYTES) {
      toast.error("檔案大小不可超過 50MB");
      return false;
    }
    if (currentCount >= ATTACHMENT_MAX_COUNT) {
      toast.error(`附件數量已達上限 ${ATTACHMENT_MAX_COUNT} 個`);
      return false;
    }
    return true;
  };

  const handleIconSelect = async (file) => {
    if (!file || !validateIcon(file)) {
      if (iconInputRef.current) iconInputRef.current.value = "";
      return;
    }
    if (!isEdit) {
      setPendingIcon(file);
      if (iconInputRef.current) iconInputRef.current.value = "";
      return;
    }
    setIconBusy(true);
    try {
      const updated = await TemplatesService.uploadIcon(template.id, file);
      setIconUrl(updated?.icon_url ?? null);
      toast.success("icon 已更新");
      onSaved?.();
    } catch (e) {
      toast.error(e?.message ?? "icon 上傳失敗");
    } finally {
      setIconBusy(false);
      if (iconInputRef.current) iconInputRef.current.value = "";
    }
  };

  const handleIconRemove = async () => {
    if (!isEdit) {
      setPendingIcon(null);
      return;
    }
    setIconBusy(true);
    try {
      await TemplatesService.removeIcon(template.id);
      setIconUrl(null);
      onSaved?.();
    } catch (e) {
      toast.error(e?.message ?? "icon 移除失敗");
    } finally {
      setIconBusy(false);
    }
  };

  const handleAttachmentSelect = async (file) => {
    const currentCount = isEdit ? attachments.length : pendingAttachments.length;
    if (!file || !validateAttachment(file, currentCount)) {
      if (attachInputRef.current) attachInputRef.current.value = "";
      return;
    }
    if (!isEdit) {
      setPendingAttachments((prev) => [...prev, file]);
      if (attachInputRef.current) attachInputRef.current.value = "";
      return;
    }
    setAttachBusy(true);
    try {
      await TemplatesService.uploadAttachment(template.id, file);
      const res = await TemplatesService.listAttachments(template.id);
      setAttachments(res?.data ?? []);
      toast.success("附件已上傳");
    } catch (e) {
      toast.error(e?.message ?? "附件上傳失敗");
    } finally {
      setAttachBusy(false);
      if (attachInputRef.current) attachInputRef.current.value = "";
    }
  };

  const handleAttachmentRemove = async (attachmentId) => {
    setAttachBusy(true);
    try {
      await TemplatesService.removeAttachment(template.id, attachmentId);
      setAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
    } catch (e) {
      toast.error(e?.message ?? "附件刪除失敗");
    } finally {
      setAttachBusy(false);
    }
  };

  /** create 成功後補上傳暫存檔（best-effort，失敗可稍後在編輯補） */
  const uploadPendingFiles = async (templateId) => {
    const failed = [];
    if (pendingIcon) {
      try {
        await TemplatesService.uploadIcon(templateId, pendingIcon);
      } catch {
        failed.push("icon");
      }
    }
    for (const file of pendingAttachments) {
      try {
        await TemplatesService.uploadAttachment(templateId, file);
      } catch {
        failed.push(file.name);
      }
    }
    if (failed.length > 0) {
      toast.error(
        `部分檔案上傳失敗：${failed.join("、")}。可稍後在「編輯」重新上傳`,
      );
    }
  };

  const handleSubmit = async () => {
    if (!isEdit && !sourceVmid) {
      toast.error("請選擇要轉換的來源 VM");
      return;
    }
    if (!name.trim()) {
      toast.error("請輸入範本名稱");
      return;
    }

    const common = {
      name: name.trim(),
      description: description.trim() || null,
      visibility,
      default_cores: useCustomSpec ? Number(defaultCores) : null,
      default_memory: useCustomSpec ? Number(defaultMemory) : null,
      allow_password_change: allowPasswordChange,
      requires_gpu: requiresGpu,
    };

    if (!isEdit) {
      const ok = await confirm({
        title: "開始轉換為範本？",
        message:
          "轉換時來源機會被關機，且其所有快照（備份點）會被移除，之後變成唯讀範本、無法再直接開機。此動作無法復原。",
        confirmText: "關機並轉換",
        danger: true,
      });
      if (!ok) return;
    }

    setBusy(true);
    try {
      if (isEdit) {
        await TemplatesService.update(template.id, common);
        toast.success("範本已更新");
      } else {
        const res = await TemplatesService.create({
          ...common,
          source_vmid: Number(sourceVmid),
        });
        const newTemplateId = res?.template?.id;
        if (newTemplateId) {
          await uploadPendingFiles(newTemplateId);
        }
        toast.success("已開始轉換範本，來源 VM 會先關機、移除所有快照，再轉為唯讀範本");
      }
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e?.message ?? (isEdit ? "更新範本失敗" : "建立範本失敗"));
    } finally {
      setBusy(false);
    }
  };

  const shownIconUrl = isEdit ? safeTemplateIconUrl(iconUrl) : null;
  const hasIcon = isEdit ? Boolean(shownIconUrl) : Boolean(pendingIcon);
  const shownAttachments = isEdit
    ? attachments
    : pendingAttachments.map((file, idx) => ({
        id: `pending-${idx}`,
        filename: file.name,
        size_bytes: file.size,
        pendingIndex: idx,
      }));

  return (
    <div
      className={`${styles.modalOverlay} ${closing ? styles.modalOverlayOut : ""}`}
      onClick={onClose}
    >
      <div className={`${styles.modal} ${styles.modalWide}`} onClick={(e) => e.stopPropagation()}>
        <span className={styles.modalTitle}>
          <MIcon name="library_books" size={20} />
          {isEdit ? "編輯範本" : "把 VM 轉為範本"}
        </span>
        <p className={styles.modalDesc}>
          {isEdit
            ? "更新範本的名稱、說明、可見範圍、克隆政策與預設規格。"
            : "選擇一台已裝好環境的母機。轉換會先關機並移除該機的所有快照，完成後原 VM 變成唯讀範本，無法再直接開機。"}
        </p>

        {!isEdit && (
          <div className={styles.field}>
            <label htmlFor="tpl-source">來源母機</label>
            <select
              id="tpl-source"
              value={sourceVmid}
              onChange={(e) => setSourceVmid(e.target.value)}
            >
              <option value="">選擇要轉換的 VM/LXC…</option>
              {resources
                .filter((r) => r.vmid != null && r.vmid > 0 && !r.is_placeholder)
                .map((r) => (
                  <option key={r.vmid} value={String(r.vmid)}>
                    {r.name}（VMID {r.vmid} · {r.type}）
                  </option>
                ))}
            </select>
            {!resourcesLoading && resources.length === 0 && (
              <span className={styles.fieldWarn}>找不到可用的 VM，請先建立並設定好一台母機。</span>
            )}
          </div>
        )}

        <div className={styles.field}>
          <label htmlFor="tpl-name">範本名稱</label>
          <input
            id="tpl-name"
            type="text"
            maxLength={255}
            placeholder="例如 Ubuntu 22.04 + Docker 實驗環境"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="tpl-desc">說明（選填）</label>
          <textarea
            id="tpl-desc"
            rows={3}
            maxLength={1000}
            placeholder="描述這個範本裝了什麼、適合哪些課程使用"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className={styles.field}>
          <label>可見範圍</label>
          <div className={styles.visibilityOptions}>
            <label className={`${styles.visibilityOption} ${visibility !== "global" ? styles.visibilityOptionActive : ""}`}>
              <input
                type="radio"
                name="template-visibility"
                value="private"
                checked={visibility !== "global"}
                onChange={() => setVisibility("private")}
              />
              <span>
                <strong>私人</strong>
                <small>只有建立者與管理員可以看到及使用</small>
              </span>
            </label>
            <label className={`${styles.visibilityOption} ${visibility === "global" ? styles.visibilityOptionActive : ""}`}>
              <input
                type="radio"
                name="template-visibility"
                value="global"
                checked={visibility === "global"}
                onChange={() => setVisibility("global")}
              />
              <span>
                <strong>全部可見</strong>
                <small>所有使用者都可以看到及克隆</small>
              </span>
            </label>
          </div>
        </div>

        <label className={styles.checkLine}>
          <input
            type="checkbox"
            checked={allowPasswordChange}
            onChange={(e) => setAllowPasswordChange(e.target.checked)}
          />
          允許使用者在克隆時自訂/重設登入密碼（取消勾選＝克隆機沿用範本內建帳密）
        </label>

        <label className={styles.checkLine} title={gpuSelectable ? undefined : "LXC 範本不支援 GPU 直通"}>
          <input
            type="checkbox"
            checked={requiresGpu}
            disabled={!gpuSelectable}
            onChange={(e) => setRequiresGpu(e.target.checked)}
          />
          使用此範本需要 GPU（克隆時強制選擇並配置 GPU；僅 VM 範本可設）
        </label>

        <label className={styles.checkLine}>
          <input
            type="checkbox"
            checked={useCustomSpec}
            onChange={(e) => setUseCustomSpec(e.target.checked)}
          />
          自訂克隆預設規格（未勾選＝沿用範本機器本身的 CPU / 記憶體設定）
        </label>

        {useCustomSpec && (
          <>
            <div className={styles.field}>
              <div className={styles.sliderLabelRow}>
                <label htmlFor="tpl-cores">預設 CPU 核心數</label>
                <span className={styles.sliderValue}>{defaultCores} 核心</span>
              </div>
              <input
                id="tpl-cores"
                type="range"
                min={CORE_MIN}
                max={CORE_MAX}
                step={1}
                className={styles.slider}
                value={defaultCores}
                onChange={(e) => setDefaultCores(Number(e.target.value))}
              />
              <div className={styles.sliderTicks}>
                {[1, 2, 4, 6, 8].map((v) => (
                  <span key={v} style={{ left: `${((v - CORE_MIN) / (CORE_MAX - CORE_MIN)) * 100}%` }}>
                    {v}
                  </span>
                ))}
              </div>
            </div>

            <div className={styles.field}>
              <div className={styles.sliderLabelRow}>
                <label htmlFor="tpl-memory">預設記憶體 (RAM)</label>
                <span className={styles.sliderValue}>{(defaultMemory / 1024).toFixed(1)} GB</span>
              </div>
              <input
                id="tpl-memory"
                type="range"
                min={MEMORY_MIN}
                max={MEMORY_MAX}
                step={512}
                className={styles.slider}
                value={defaultMemory}
                onChange={(e) => setDefaultMemory(Number(e.target.value))}
              />
              <div className={styles.sliderTicks}>
                {[[1024, "1GB"], [8192, "8GB"], [16384, "16GB"], [24576, "24GB"], [32768, "32GB"]].map(([v, label]) => (
                  <span key={label} style={{ left: `${((v - MEMORY_MIN) / (MEMORY_MAX - MEMORY_MIN)) * 100}%` }}>
                    {label}
                  </span>
                ))}
              </div>
            </div>
          </>
        )}

        <div className={styles.field}>
          <label>預設磁碟</label>
          <div className={styles.diskFixed}>
            <MIcon name="lock" size={15} />
            {isEdit && template.default_disk
              ? `${template.default_disk} GB（跟母機一致，轉換時自動偵測，不可調整）`
              : "跟母機一致，轉換完成後自動偵測，不可調整"}
          </div>
        </div>

        <div className={styles.field}>
          <label>範本 icon（選填）</label>
          <div className={styles.iconUploadRow}>
            {shownIconUrl ? (
              <img className={styles.iconThumb} src={shownIconUrl} alt="範本 icon" />
            ) : pendingIcon ? (
              <>
                <span className={styles.iconThumb}>
                  <MIcon name="image" size={20} />
                </span>
                <span className={styles.fieldHint}>{pendingIcon.name}</span>
              </>
            ) : (
              <span className={styles.iconThumb} />
            )}
            <input
              ref={iconInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
              style={{ display: "none" }}
              onChange={(e) => handleIconSelect(e.target.files?.[0])}
            />
            <button
              type="button"
              className={styles.btnSecondary}
              disabled={iconBusy}
              onClick={() => iconInputRef.current?.click()}
            >
              <MIcon name="upload" size={14} />
              {iconBusy ? "處理中…" : hasIcon ? "更換圖片" : "上傳圖片"}
            </button>
            {hasIcon && (
              <button
                type="button"
                className={styles.btnSecondary}
                disabled={iconBusy}
                onClick={handleIconRemove}
              >
                移除
              </button>
            )}
          </div>
          <span className={styles.fieldHint}>
            PNG / JPEG / WebP / SVG / GIF，2MB 內
            {!isEdit && "；會在轉換開始後自動上傳"}
          </span>
        </div>

        <div className={styles.field}>
          <label>使用手冊 / 附件（選填，最多 10 個）</label>
          {shownAttachments.length > 0 && (
            <div className={styles.attachList}>
              {shownAttachments.map((a) => (
                <div key={a.id} className={styles.attachItem}>
                  <MIcon name="description" size={15} />
                  <span className={styles.attachName}>{a.filename}</span>
                  <span className={styles.attachSize}>{formatBytes(a.size_bytes)}</span>
                  <button
                    type="button"
                    className={`${styles.attachBtn} ${styles.attachBtnDanger}`}
                    disabled={attachBusy}
                    onClick={() =>
                      isEdit
                        ? handleAttachmentRemove(a.id)
                        : setPendingAttachments((prev) =>
                            prev.filter((_, idx) => idx !== a.pendingIndex),
                          )
                    }
                    title="刪除附件"
                  >
                    <MIcon name="delete_outline" size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <input
            ref={attachInputRef}
            type="file"
            style={{ display: "none" }}
            onChange={(e) => handleAttachmentSelect(e.target.files?.[0])}
          />
          <div>
            <button
              type="button"
              className={styles.btnSecondary}
              disabled={attachBusy || shownAttachments.length >= ATTACHMENT_MAX_COUNT}
              onClick={() => attachInputRef.current?.click()}
            >
              <MIcon name="upload_file" size={14} />
              {attachBusy ? "處理中…" : "上傳附件"}
            </button>
          </div>
          <span className={styles.fieldHint}>
            支援 PDF、Office 文件、圖片、壓縮檔等，單檔 50MB 內；學生在克隆視窗可下載
            {!isEdit && "；會在轉換開始後自動上傳"}
          </span>
        </div>

        <div className={styles.modalActions}>
          <button type="button" className={styles.btnSecondary} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className={styles.btnPrimary}
            disabled={busy}
            onClick={handleSubmit}
          >
            {busy ? "處理中…" : isEdit ? "儲存變更" : "開始轉換"}
          </button>
        </div>
      </div>
    </div>
  );
}
