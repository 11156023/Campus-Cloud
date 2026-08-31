import { useEffect, useState } from "react";
import styles from "./TemplatesPage.module.scss";
import MIcon from "../../../components/MIcon";
import { TemplatesService, safeTemplateIconUrl } from "../../../services/templates";
import { downloadBlob } from "../../../services/api";
import { useToast } from "../../../hooks/useToast";

const CORE_MIN = 1;
const MEMORY_MIN = 512;

const formatBytes = (bytes) => {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
};

/** 從範本克隆開通（teacher/admin 可批量，student 固定單台） */
export default function TemplateCloneDialog({ template, canBatch, onClose, onCloned }) {
  const toast = useToast();
  const [hostname, setHostname] = useState("");
  const [count, setCount] = useState("1");
  const [cores, setCores] = useState(template?.default_cores || 2);
  const [memory, setMemory] = useState(template?.default_memory || 2048);
  const [password, setPassword] = useState("");
  const [start, setStart] = useState(true);
  const [busy, setBusy] = useState(false);

  const [attachments, setAttachments] = useState([]);
  const [downloadingId, setDownloadingId] = useState(null);

  const allowPassword = template?.allow_password_change !== false;
  const coresMax = Math.max(8, template?.default_cores || 0);
  const memoryMax = Math.max(32768, template?.default_memory || 0);
  const coreTicks = [...new Set([1, 2, 4, 6, 8, coresMax])].sort((a, b) => a - b);
  const memoryTicks = [
    ...new Set([1024, 8192, 16384, 24576, 32768, memoryMax]),
  ].sort((a, b) => a - b);

  useEffect(() => {
    let cancelled = false;
    TemplatesService.listAttachments(template.id)
      .then((res) => !cancelled && setAttachments(res?.data ?? []))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [template.id]);

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

  const handleSubmit = async () => {
    if (allowPassword && password && password.length < 8) {
      toast.error("自訂密碼至少需要 8 個字元");
      return;
    }
    setBusy(true);
    try {
      const res = await TemplatesService.clone(template.id, {
        hostname: hostname.trim() || null,
        count: canBatch ? Math.max(1, Number(count) || 1) : 1,
        cores: Number(cores),
        memory: Number(memory),
        login_password: allowPassword && password ? password : null,
        start,
      });
      toast.success(
        (res?.tasks?.length ?? 0) > 1
          ? `已送出 ${res.tasks.length} 台克隆任務，進度請見側欄「背景任務」`
          : "克隆任務已送出，完成後會出現在你的資源列表",
      );
      onCloned?.();
      onClose();
    } catch (e) {
      toast.error(e?.message ?? "克隆失敗");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <span className={styles.modalTitle}>
          {safeTemplateIconUrl(template.icon_url) ? (
            <img
              className={styles.iconThumbSmall}
              src={safeTemplateIconUrl(template.icon_url)}
              alt=""
            />
          ) : (
            <MIcon name="content_copy" size={20} />
          )}
          克隆「{template.name}」
        </span>
        <p className={styles.modalDesc}>
          系統會自動複製範本並完成必要設定（IP、防火牆），完成後可在資源頁操作使用。
        </p>

        {attachments.length > 0 && (
          <div className={styles.field}>
            <label>使用手冊</label>
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
          </div>
        )}

        <div className={styles.cloneGrid}>
          <div className={styles.field}>
            <label htmlFor="clone-hostname">主機名稱（選填）</label>
            <input
              id="clone-hostname"
              type="text"
              maxLength={63}
              placeholder="預設使用範本名稱"
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
            />
          </div>
          {canBatch && (
            <div className={styles.field}>
              <label htmlFor="clone-count">數量</label>
              <input
                id="clone-count"
                type="number"
                min={1}
                max={50}
                value={count}
                onChange={(e) => setCount(e.target.value)}
              />
            </div>
          )}
        </div>

        <div className={styles.field}>
          <div className={styles.sliderLabelRow}>
            <label htmlFor="clone-cores">CPU 核心數</label>
            <span className={styles.sliderValue}>{cores} 核心</span>
          </div>
          <input
            id="clone-cores"
            type="range"
            min={CORE_MIN}
            max={coresMax}
            step={1}
            className={styles.slider}
            value={cores}
            onChange={(e) => setCores(Number(e.target.value))}
          />
          <div className={styles.sliderTicks}>
            {coreTicks.map((v) => (
              <span key={v} style={{ left: `${((v - CORE_MIN) / (coresMax - CORE_MIN)) * 100}%` }}>
                {v}
              </span>
            ))}
          </div>
        </div>

        <div className={styles.field}>
          <div className={styles.sliderLabelRow}>
            <label htmlFor="clone-memory">記憶體 (RAM)</label>
            <span className={styles.sliderValue}>{(memory / 1024).toFixed(1)} GB</span>
          </div>
          <input
            id="clone-memory"
            type="range"
            min={MEMORY_MIN}
            max={memoryMax}
            step={512}
            className={styles.slider}
            value={memory}
            onChange={(e) => setMemory(Number(e.target.value))}
          />
          <div className={styles.sliderTicks}>
            {memoryTicks.map((v) => (
              <span
                key={v}
                style={{ left: `${((v - MEMORY_MIN) / (memoryMax - MEMORY_MIN)) * 100}%` }}
              >
                {v >= 1024 ? `${Math.round(v / 1024)}GB` : `${v}MB`}
              </span>
            ))}
          </div>
        </div>

        <div className={styles.field}>
          <label>硬碟空間</label>
          <div className={styles.diskFixed}>
            <MIcon name="lock" size={15} />
            {template.default_disk
              ? `固定 ${template.default_disk} GB（跟隨範本，不可調整）`
              : "跟隨範本磁碟大小，不可調整"}
          </div>
        </div>

        {allowPassword ? (
          <div className={styles.field}>
            <label htmlFor="clone-password">登入密碼（選填）</label>
            <input
              id="clone-password"
              type="password"
              maxLength={64}
              placeholder="留空由系統產生隨機密碼"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        ) : (
          <div className={styles.policyNote}>
            <MIcon name="lock" size={15} />
            此範本已鎖定帳號密碼：克隆機沿用範本內建帳密，無法自訂或重設。
          </div>
        )}

        <label className={styles.checkLine}>
          <input
            type="checkbox"
            checked={start}
            onChange={(e) => setStart(e.target.checked)}
          />
          克隆完成後自動開機
        </label>

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
            <MIcon name="content_copy" size={14} />
            {busy ? "送出中…" : "開始克隆"}
          </button>
        </div>
      </div>
    </div>
  );
}
