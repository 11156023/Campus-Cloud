import { useEffect, useState } from "react";
import styles from "./TemplatesPage.module.scss";
import MIcon from "../../../components/MIcon";
import { useAuth } from "../../../contexts/AuthContext";
import { ResourcesService } from "../../../services/resources";
import { TemplatesService } from "../../../services/templates";
import { useToast } from "../../../hooks/useToast";
import { useConfirm } from "../../../components/ConfirmDialog/ConfirmProvider";

const CORE_MIN = 1;
const CORE_MAX = 8;
const MEMORY_MIN = 512;
const MEMORY_MAX = 32768;

/**
 * 建立（從 VM 轉換）或編輯範本的 dialog。
 * template 有值 = 編輯模式。
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
  const [studentRequestable, setStudentRequestable] = useState(Boolean(template?.student_requestable));
  const [resources, setResources] = useState([]);
  const [resourcesLoading, setResourcesLoading] = useState(!isEdit);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isEdit) return undefined;
    let cancelled = false;
    (isAdmin ? ResourcesService.listAll() : ResourcesService.list())
      .then((res) => !cancelled && setResources(res ?? []))
      .catch(() => {})
      .finally(() => !cancelled && setResourcesLoading(false));
    return () => {
      cancelled = true;
    };
  }, [isEdit, isAdmin]);

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
      student_requestable: studentRequestable,
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
        await TemplatesService.create({ ...common, source_vmid: Number(sourceVmid) });
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
            ? "更新範本的名稱、說明、可見範圍與預設規格。"
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
                <small>所有教師都可以看到，並用於組多機環境</small>
              </span>
            </label>
          </div>
        </div>

        <label className={styles.checkLine}>
          <input
            type="checkbox"
            checked={studentRequestable}
            onChange={(e) => setStudentRequestable(e.target.checked)}
          />
          開放學生自行申請（學生可在申請機器時直接選用這個範本，仍需審核；規格固定為下方預設值）
        </label>

        <label className={styles.checkLine}>
          <input
            type="checkbox"
            checked={useCustomSpec}
            onChange={(e) => setUseCustomSpec(e.target.checked)}
          />
          自訂預設規格（未勾選＝沿用範本機器本身的 CPU / 記憶體設定）
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
