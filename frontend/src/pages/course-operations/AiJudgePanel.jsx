import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import styles from "./AiJudgePanel.module.scss";
import LoadingState from "../../components/LoadingState/LoadingState";
import MIcon from "../../components/MIcon";
import { useToast } from "../../hooks/useToast";
import useAutoRefresh from "../../hooks/useAutoRefresh";
import { downloadBlob } from "../../services/api";
import {
  AiJudgeService,
  RUBRIC_POLISH_PROMPT,
  RUBRIC_REASSESS_PROMPT,
  TEMPLATE_OPTIONS,
  getTemplateLabel,
  rubricToContext,
} from "../../services/aiJudge";

/* ── 共用小元件 ─────────────────────────────────────────── */

function Spinner({ size = 16 }) {
  return (
    <span className={styles.spinning}>
      <MIcon name="autorenew" size={size} />
    </span>
  );
}

/** 偵測方式標籤：auto=綠、partial=藍、manual=紅（不使用黃色警示色） */
const DETECTABLE_INFO = {
  auto: { label: "可自動偵測", className: styles.detBadge_auto },
  partial: { label: "部分可偵測", className: styles.detBadge_partial },
  manual: { label: "需人工評閱", className: styles.detBadge_manual },
};

function getDetectableInfo(detectable) {
  return DETECTABLE_INFO[detectable] ?? DETECTABLE_INFO.manual;
}

function formatDateTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("zh-TW");
}

/* ── 評分表統計 ─────────────────────────────────────────── */

export function RubricStats({
  items,
  needsReview = false,
  isReassessing = false,
  onReassess,
  readOnly = false,
}) {
  const total = items.length;
  const autoCount = items.filter((item) => item.detectable === "auto").length;
  const partialCount = items.filter((item) => item.detectable === "partial").length;
  const manualCount = items.filter((item) => item.detectable === "manual").length;
  const pct = (count) => (total > 0 ? Math.round((count / total) * 100) : 0);

  return (
    <div className={styles.assessmentSummary}>
      <div className={styles.assessmentHead}>
        <div>
          <div className={styles.assessmentTitleRow}>
            <h4>自動偵測可用性</h4>
            <span
              className={needsReview ? styles.assessmentStatus_stale : styles.assessmentStatus_current}
            >
              {needsReview ? "需要重新評估" : "評估結果已更新"}
            </span>
          </div>
          <p aria-live="polite">
            {needsReview
              ? "評分項目已變更；下方顯示上次結果，請重新評估後再判斷是否適合自動檢查。"
              : "依目前評分項目的 AI 偵測判斷，協助確認自動檢查的適用程度。"}
          </p>
        </div>
        {!readOnly && onReassess && (
          <button
            type="button"
            className={needsReview ? styles.btnPrimary : styles.btnSecondary}
            onClick={onReassess}
            disabled={isReassessing || total === 0}
            title={total === 0 ? "請先新增至少一個評估項目" : undefined}
          >
            {isReassessing ? <Spinner size={15} /> : <MIcon name="refresh" size={16} />}
            {isReassessing ? "重新評估中..." : "重新評估"}
          </button>
        )}
      </div>
      <div className={styles.statsGrid}>
        <div className={styles.statBox}>
          <p className={styles.statValue}>{total}</p>
          <p className={styles.statLabel}>共幾題</p>
        </div>
        <div className={`${styles.statBox} ${styles.statBox_success}`}>
          <p className={styles.statValue}>
            <MIcon name="check_circle" size={16} />
            {autoCount}
          </p>
          <p className={styles.statLabel}>可自動偵測（{pct(autoCount)}%）</p>
        </div>
        <div className={`${styles.statBox} ${styles.statBox_info}`}>
          <p className={styles.statValue}>
            <MIcon name="info" size={16} />
            {partialCount}
          </p>
          <p className={styles.statLabel}>部分可偵測（{pct(partialCount)}%）</p>
        </div>
        <div className={`${styles.statBox} ${styles.statBox_danger}`}>
          <p className={styles.statValue}>
            <MIcon name="schedule" size={16} />
            {manualCount}
          </p>
          <p className={styles.statLabel}>需人工評閱（{pct(manualCount)}%）</p>
        </div>
      </div>
    </div>
  );
}

/* ── 單一評分項目卡片 ───────────────────────────────────── */

function RubricCard({ item, index, onChange, onDelete, disabled }) {
  const detectableInfo = getDetectableInfo(item.detectable);
  const checkSteps = item.check_steps ?? [];
  const cardVariant =
    item.detectable === "auto"
      ? styles.rubricCard_auto
      : item.detectable === "partial"
        ? styles.rubricCard_partial
        : styles.rubricCard_manual;

  return (
    <div className={`${styles.rubricCard} ${cardVariant}`}>
      <div className={styles.rubricCardHead}>
        <div className={styles.rubricCardHeadMain}>
          <span className={styles.rubricIndex}>#{index + 1}</span>
          <span className={`${styles.detBadge} ${detectableInfo.className}`}>
            {detectableInfo.label}
          </span>
        </div>
        <button
          type="button"
          className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
          title="刪除項目"
          onClick={onDelete}
          disabled={disabled}
        >
          <MIcon name="delete" size={16} />
        </button>
      </div>

      <label className={styles.rubricField}>
        <span>主題</span>
        <input
          value={item.title}
          onChange={(e) => onChange({ ...item, title: e.target.value })}
          placeholder="評分項目名稱"
          disabled={disabled}
        />
      </label>

      <label className={styles.rubricField}>
        <span>說明</span>
        <input
          value={item.description}
          onChange={(e) => onChange({ ...item, description: e.target.value })}
          placeholder="評分說明"
          disabled={disabled}
        />
      </label>

      {(item.detection_method || item.fallback || checkSteps.length > 0) && (
        <div className={styles.detectInfo}>
          <div className={styles.detectInfoHead}>
            <MIcon name="security" size={14} />
            AI 偵測判斷（僅由 AI 更新）
          </div>
          <div className={styles.detectGrid}>
            {item.detection_method && (
              <div className={styles.detectItem}>
                <span>偵測方式</span>
                <p>{item.detection_method}</p>
              </div>
            )}
            {item.fallback && (
              <div className={styles.detectItem}>
                <span>替代建議</span>
                <p>{item.fallback}</p>
              </div>
            )}
          </div>
          {checkSteps.length > 0 && (
            <div className={styles.detectItem}>
              <span>評分計劃書（未執行）</span>
              <div className={styles.chipRow}>
                {checkSteps.map((step) => (
                  <span key={`${step.template_key}-${step.command_key}`} className={styles.chip}>
                    {getTemplateLabel(step.template_key)} /{" "}
                    {step.command_label ?? step.command_key}
                    <code>{step.command_key}</code>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── 上傳區 ─────────────────────────────────────────────── */

function RubricUploader({ onUpload, isLoading }) {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);

  function handleDrop(e) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext === "docx" || ext === "pdf") setSelectedFile(file);
  }

  return (
    <div className={styles.uploaderWrap}>
      <div
        className={`${styles.dropZone} ${isDragging ? styles.dropZoneDragging : ""} ${isLoading ? styles.dropZoneLoading : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setIsDragging(false);
        }}
        onDrop={handleDrop}
      >
        <input
          type="file"
          accept=".docx,.pdf"
          className={styles.dropZoneInput}
          disabled={isLoading}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) setSelectedFile(file);
          }}
        />
        {selectedFile ? (
          <div className={styles.selectedFile}>
            <MIcon name="description" size={36} />
            <div>
              <p className={styles.selectedFileName}>{selectedFile.name}</p>
              <p className={styles.selectedFileMeta}>
                {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
              </p>
            </div>
            <button
              type="button"
              className={styles.iconBtn}
              aria-label="清除選擇"
              disabled={isLoading}
              onClick={(e) => {
                e.stopPropagation();
                setSelectedFile(null);
              }}
            >
              <MIcon name="close" size={16} />
            </button>
          </div>
        ) : (
          <div className={styles.dropHint}>
            <MIcon name="upload" size={36} />
            <p className={styles.dropHintTitle}>拖放評分文件到這裡</p>
            <p className={styles.dropHintMeta}>或點擊選擇檔案（支援 .docx、.pdf）</p>
          </div>
        )}
      </div>

      {selectedFile && (
        <button
          type="button"
          className={`${styles.btnPrimary} ${styles.btnBlock}`}
          disabled={isLoading}
          onClick={() => onUpload(selectedFile)}
        >
          {isLoading ? (
            <>
              <Spinner />
              AI 分析中...
            </>
          ) : (
            <>
              <MIcon name="upload" size={16} />
              上傳並分析
            </>
          )}
        </button>
      )}
    </div>
  );
}

/* ── AI 對話面板 ────────────────────────────────────────── */

function ChatPanel({
  messages,
  onSendMessage,
  isLoading,
  disabled = false,
  hasRubric = false,
}) {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  function send() {
    const content = input.trim();
    if (!content || isLoading || disabled) return;
    onSendMessage(content);
    setInput("");
  }

  return (
    <div className={styles.chatPanel}>
      <div className={styles.chatMessages}>
        {messages.length === 0 ? (
          <div className={styles.chatEmpty}>
            <MIcon name="smart_toy" size={32} />
            <p>{hasRubric ? "與 AI 對話來精煉你的評分表" : "先和 AI 討論你的檢查需求"}</p>
            <p className={styles.chatEmptyMeta}>
              {hasRubric
                ? "可以詢問修改建議，或直接下達調整指令"
                : "不必先上傳文件；之後再上傳評分表即可接續這段對話"}
            </p>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div
              key={`${msg.role}-${i}`}
              className={`${styles.chatMsgRow} ${msg.role === "user" ? styles.chatMsgRow_user : ""}`}
            >
              {msg.role === "assistant" && (
                <span className={styles.chatAvatar}>
                  <MIcon name="smart_toy" size={16} />
                </span>
              )}
              <div
                className={`${styles.chatBubble} ${msg.role === "user" ? styles.chatBubble_user : ""}`}
              >
                {msg.content}
              </div>
              {msg.role === "user" && (
                <span className={`${styles.chatAvatar} ${styles.chatAvatar_user}`}>
                  <MIcon name="person" size={16} />
                </span>
              )}
            </div>
          ))
        )}

        {isLoading && (
          <div className={styles.chatMsgRow}>
            <span className={styles.chatAvatar}>
              <MIcon name="smart_toy" size={16} />
            </span>
            <div className={styles.chatBubble}>
              <span className={styles.typing}>
                <span />
                <span />
                <span />
              </span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className={styles.chatInputArea}>
        <button
          type="button"
          className={styles.btnSecondary}
          disabled={isLoading || disabled || !hasRubric}
          onClick={() => onSendMessage(RUBRIC_POLISH_PROMPT, true)}
        >
          <MIcon name="auto_fix_high" size={14} />
          潤飾評分表
        </button>
        <form
          className={styles.chatForm}
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={
              hasRubric
                ? "輸入訊息...（Shift+Enter 換行）"
                : "描述想檢查的環境或問題...（Shift+Enter 換行）"
            }
            rows={1}
            disabled={isLoading || disabled}
          />
          <button
            type="submit"
            className={styles.btnPrimary}
            disabled={isLoading || disabled || !input.trim()}
            aria-label="送出"
          >
            <MIcon name="send" size={16} />
          </button>
        </form>
        <p className={styles.chatHint}>
          {hasRubric
            ? "提示：詢問問題不會修改評估表，需明確指令（如「幫我改」「新增」）才會執行變更"
            : "提示：這是一般 AI 對話；上傳評分表後，AI 才會提出可套用的評分項目修改"}
        </p>
      </div>
    </div>
  );
}

/* ── 確認 Modal（覆蓋/副本、刪除） ──────────────────────── */

function ConfirmModal({ title, description, actions, onClose }) {
  return (
    <div className={styles.modalOverlay} onMouseDown={onClose}>
      <div className={styles.confirm} onMouseDown={(e) => e.stopPropagation()}>
        <div className={styles.confirmIcon}>
          <MIcon name="warning" size={24} />
        </div>
        <h2>{title}</h2>
        <p>{description}</p>
        <div className={styles.modalActions}>{actions}</div>
      </div>
    </div>
  );
}

function CreateCheckForm({
  classId,
  sourceOnly = false,
  embedded = false,
  initialMode = "",
  onClose,
  onCreated,
}) {
  const toast = useToast();
  const requestVersionRef = useRef(0);
  const [mode, setMode] = useState(initialMode);
  const [title, setTitle] = useState("");
  const [rubricName, setRubricName] = useState("");
  const [environmentKeys, setEnvironmentKeys] = useState([]);
  const [files, setFiles] = useState([]);
  const [selectedFileId, setSelectedFileId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [conflictFile, setConflictFile] = useState(null);

  useEffect(() => {
    const requestVersion = ++requestVersionRef.current;
    let cancelled = false;
    AiJudgeService.listFiles(classId)
      .then((rows) => {
        if (!cancelled && requestVersion === requestVersionRef.current) {
          setFiles(rows.filter((file) => file.status === "active"));
        }
      })
      .catch(() => {
        if (!cancelled && requestVersion === requestVersionRef.current) {
          setError("載入已保存評分表失敗，仍可上傳新文件。");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [classId]);

  function toggleEnvironment(key) {
    setEnvironmentKeys((current) => current.includes(key)
      ? current.filter((item) => item !== key)
      : [...current, key]);
  }

  async function uploadFile(file, conflictStrategy = null) {
    if (!file) return;
    const requestVersion = requestVersionRef.current;
    setUploading(true);
    setError("");
    try {
      const result = await AiJudgeService.uploadFile(classId, file, environmentKeys[0] ?? "linux", conflictStrategy);
      if (requestVersion !== requestVersionRef.current) return;
      const uploaded = result.file ?? { ...result, analysis_json: result.analysis };
      setFiles((current) => [uploaded, ...current.filter((item) => item.id !== uploaded.id)]);
      setSelectedFileId(uploaded.id);
      setEnvironmentKeys(uploaded.environment_keys?.length ? uploaded.environment_keys : [uploaded.template_key]);
      setConflictFile(null);
    } catch (uploadError) {
      if (requestVersion !== requestVersionRef.current) return;
      if (uploadError?.status === 409) {
        setConflictFile(file);
        setError("已有同名評分文件，請選擇覆蓋原本文件或建立副本。");
      } else {
        setError(uploadError?.message ?? "上傳評分文件失敗。");
      }
    } finally {
      if (requestVersion === requestVersionRef.current) setUploading(false);
    }
  }

  async function upload(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const suffix = file.name.split(".").pop()?.toLowerCase();
    if (!['docx', 'pdf'].includes(suffix)) {
      setError("只接受 .docx 或 .pdf 評分文件。");
      return;
    }
    await uploadFile(file);
  }

  async function submit(event) {
    event.preventDefault();
    if ((!sourceOnly && !title.trim()) || !mode) return;
    if (mode === "blank" && (!rubricName.trim() || !environmentKeys.length)) return;
    if (mode === "existing" && !selectedFileId) return;
    setCreating(true);
    setError("");
    try {
      if (sourceOnly) {
        const file = mode === "blank"
          ? await AiJudgeService.createBlankFile(classId, { displayName: rubricName, environmentKeys })
          : files.find((entry) => entry.id === selectedFileId);
        if (!file?.id) throw new Error("請選擇或建立一份評分表來源。");
         onCreated(file, sourceOnly && mode === "blank" ? "source-blank" : "source");
      } else {
        const created = await AiJudgeService.createSession(classId, {
          title,
          creationMode: mode,
          rubricName: mode === "blank" ? rubricName : undefined,
          environmentKeys: mode === "blank" ? environmentKeys : undefined,
          selectedFileId: mode === "existing" ? selectedFileId : null,
        });
        onCreated(created, mode);
      }
    } catch (createError) {
      setError(createError?.message ?? "建立檢查失敗，請確認欄位後重試。");
    } finally {
      setCreating(false);
    }
  }

  const form = (
      <section className={embedded ? styles.createCheckPanel : `${styles.confirm} ${styles.createCheckDialog}`} role={embedded ? undefined : "dialog"} aria-modal={embedded ? undefined : "true"} aria-labelledby="create-check-title">
        <div className={styles.modalHeader}><div>{embedded && <button type="button" className={styles.inlineBackButton} disabled={creating || uploading} onClick={onClose}><MIcon name="arrow_back" size={17} />返回建立方式</button>}<h2 id="create-check-title">{sourceOnly ? "新增評分表來源" : mode === "blank" ? "從零開始建立" : "使用已有評分文件"}</h2><p>{sourceOnly ? "建立或選用一份班級評分表，完成後會套用到目前檢查。" : mode === "blank" ? "建立空白評分表後，直接進入評分項目與 AI 助手編輯頁。" : "選擇已保存的評分表，或上傳文件交由 AI 分析。"}</p></div>{!embedded && <button type="button" className={styles.iconBtn} aria-label="關閉" disabled={creating || uploading} onClick={onClose}><MIcon name="close" size={18} /></button>}</div>
        <form onSubmit={submit}>
          {!sourceOnly && <label className={styles.dialogField}><span>檢查名稱</span><input autoFocus value={title} maxLength={255} placeholder="例如：期中 Python 環境檢查" onChange={(event) => setTitle(event.target.value)} /></label>}
          {!embedded && <fieldset className={styles.modeFieldset}><legend>如何建立評分表？</legend><div className={styles.modeChoices}><label className={mode === "blank" ? styles.modeChoiceActive : styles.modeChoice}><input type="radio" name="creation-mode" checked={mode === "blank"} onChange={() => setMode("blank")} /><span><b>從零開始建立</b><small>建立空白評分表，接著手動新增項目或請 AI 產生初稿。</small></span></label><label className={mode === "existing" ? styles.modeChoiceActive : styles.modeChoice}><input type="radio" name="creation-mode" checked={mode === "existing"} onChange={() => setMode("existing")} /><span><b>使用已有評分文件</b><small>選擇班級已保存的評分表，或上傳 .docx／.pdf。</small></span></label></div></fieldset>}
          {mode === "blank" && <div className={styles.modeFields}><label className={styles.dialogField}><span>評分表名稱</span><input autoFocus={sourceOnly} value={rubricName} maxLength={255} placeholder="例如：期中 Python 評分表" onChange={(event) => setRubricName(event.target.value)} /></label><fieldset className={styles.modeFieldset}><legend>評分環境（可複選）</legend><div className={styles.dialogChips}>{TEMPLATE_OPTIONS.map((option) => <label key={option.key} className={environmentKeys.includes(option.key) ? styles.dialogChipActive : styles.dialogChip}><input type="checkbox" checked={environmentKeys.includes(option.key)} onChange={() => toggleEnvironment(option.key)} />{option.label}</label>)}</div></fieldset></div>}
           {mode === "existing" && <div className={styles.existingPicker}><div className={styles.existingPickerHead}><div><span>已保存評分表</span><small>每份來源只能綁定一個檢查；若要重構，請使用「重構」。</small></div><label className={styles.uploadSourceButton}><input type="file" accept=".docx,.pdf" disabled={uploading} onChange={upload} />{uploading ? <><Spinner size={14} />分析中…</> : <><MIcon name="upload_file" size={15} />上傳評分文件</>}</label></div>{files.length ? <div className={styles.existingList}>{files.map((file) => <label key={file.id} className={selectedFileId === file.id ? styles.existingRowActive : styles.existingRow}><input type="radio" name="saved-rubric" checked={selectedFileId === file.id} onChange={() => setSelectedFileId(file.id)} /><span><b>{file.display_name ?? file.original_filename ?? "未命名評分表"}</b><small>{(file.environment_keys?.length ? file.environment_keys : [file.template_key]).map(getTemplateLabel).join("、")} · {file.analysis_json?.items?.length ?? 0} 項 · {formatDateTime(file.updated_at)}</small></span></label>)}</div> : <p className={styles.mutedText}>尚未有可用的評分表，請上傳評分文件。</p>}{conflictFile && <div className={styles.conflictActions} role="alert"><span>「{conflictFile.name}」已存在：</span><button type="button" className={styles.btnSecondary} disabled={uploading} onClick={() => uploadFile(conflictFile, "copy")}>建立副本</button><button type="button" className={styles.btnDanger} disabled={uploading} onClick={() => uploadFile(conflictFile, "overwrite")}>覆蓋原本</button><button type="button" className={styles.iconBtn} aria-label="取消同名處理" onClick={() => setConflictFile(null)}><MIcon name="close" size={16} /></button></div>}</div>}
          {error && <p className={styles.dialogError} role="alert">{error}</p>}
          <div className={styles.modalActions}>{!embedded && <button type="button" className={styles.btnSecondary} disabled={creating || uploading} onClick={onClose}>取消</button>}<button type="submit" className={styles.btnPrimary} disabled={(!sourceOnly && !title.trim()) || !mode || (mode === "blank" ? !rubricName.trim() || !environmentKeys.length : !selectedFileId) || creating || uploading}>{creating ? <><Spinner size={15} />建立中…</> : sourceOnly ? "新增來源" : mode === "blank" ? "建立並開始編輯" : "建立檢查"}</button></div>
        </form>
      </section>
  );

  if (embedded) return form;
  return <div className={styles.modalOverlay} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !creating && !uploading) onClose(); }}>{form}</div>;
}

export function CreateCheckChooser({ onChoose, onCancel, busy = false, error = "" }) {
  return (
    <section className={styles.createChooser} aria-labelledby="create-check-choice-title">
      <div className={styles.createChooserHeader}>
        <div className={styles.createChooserHeading}>
          <h2 id="create-check-choice-title">新增檢查</h2>
          <p>選擇後直接進入對應工作區；從零建立會立即開啟空白評分表。</p>
        </div>
        <button type="button" className={styles.btnSecondary} disabled={busy} onClick={onCancel}>返回目前檢查</button>
      </div>
      {error && <p className={styles.dialogError} role="alert">{error}</p>}
      <div className={styles.createChoiceGrid}>
        <button type="button" className={styles.createChoice} disabled={busy} onClick={() => onChoose("blank")}>
          <span className={styles.createChoiceIcon}><MIcon name="edit_note" size={30} /></span>
          <span className={styles.createChoiceCopy}><strong>從零開始建立</strong><small>立即開啟空白評分表，在同一頁填寫名稱、模板與評估項目，也可以請 AI 產生初稿。</small></span>
          <span className={styles.createChoiceAction}>{busy ? "正在開啟空白頁面…" : "開始設計"}<MIcon name={busy ? "sync" : "arrow_forward"} size={18} /></span>
        </button>
        <button type="button" className={styles.createChoice} disabled={busy} onClick={() => onChoose("existing")}>
          <span className={styles.createChoiceIcon}><MIcon name="upload_file" size={30} /></span>
          <span className={styles.createChoiceCopy}><strong>使用已有評分文件</strong><small>選用尚未綁定其他檢查的來源，或上傳 .docx／.pdf；已使用來源請選擇「重構」。</small></span>
          <span className={styles.createChoiceAction}>選擇文件<MIcon name="arrow_forward" size={18} /></span>
        </button>
      </div>
    </section>
  );
}

export function getSelectedRubricSource(files, selectedFileId) {
  if (!selectedFileId || !Array.isArray(files)) return null;
  return files.find((file) => file.status === "active" && file.id === selectedFileId) ?? null;
}

export function getVisibleRubricSources(files, selectedFileId, showOtherSources = false) {
  if (!selectedFileId || !Array.isArray(files)) return [];
  const activeFiles = files.filter((file) => file.status === "active");
  if (!activeFiles.some((file) => file.id === selectedFileId)) return [];
  if (showOtherSources) return activeFiles;
  return activeFiles.filter((file) => file.id === selectedFileId);
}

export function resolveActiveSessionId(currentId, sessions) {
  if (!currentId || !Array.isArray(sessions)) return null;
  return sessions.some((session) => session.id === currentId) ? currentId : null;
}

function RubricSourceRail({ classId, judgeSession, readOnly, onSessionUpdated, onAddSource }) {
  const toast = useToast();
  const sourceRailRef = useRef(null);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [showOtherSources, setShowOtherSources] = useState(false);
  const selectedFileId = judgeSession?.selected_file_id ?? null;

  const load = useCallback(async () => {
    if (!selectedFileId) {
      setFiles([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try { setFiles(await AiJudgeService.listFiles(classId)); }
    catch (error) { toast.error(error?.message ?? "載入評分表來源失敗"); }
    finally { setLoading(false); }
  }, [classId, selectedFileId, toast]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    setShowOtherSources(false);
    setOpenMenuId(null);
  }, [selectedFileId]);

  useEffect(() => {
    if (!openMenuId) return undefined;
    const menuSelector = `[aria-expanded="true"]`;
    const focusTimer = window.setTimeout(() => {
      sourceRailRef.current?.querySelector(`${menuSelector} + [role="menu"] [role="menuitem"]:not(:disabled)`)?.focus();
    }, 0);
    function closeMenuOnOutsideClick(event) {
      const target = event.target;
      if (target instanceof Element && (target.closest('[role="menu"]') || target.closest('[aria-expanded="true"]'))) return;
      setOpenMenuId(null);
    }
    function closeMenuOnEscape(event) {
      if (event.key === "Escape") setOpenMenuId(null);
    }
    function navigateSourceMenu(event) {
      if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
      const menu = sourceRailRef.current?.querySelector('[role="menu"]');
      const items = menu ? [...menu.querySelectorAll('[role="menuitem"]:not(:disabled)')] : [];
      const currentIndex = items.indexOf(document.activeElement);
      if (!items.length) return;
      event.preventDefault();
      const nextIndex = event.key === "ArrowDown"
        ? (currentIndex + 1) % items.length
        : (currentIndex - 1 + items.length) % items.length;
      items[nextIndex].focus();
    }
    document.addEventListener("mousedown", closeMenuOnOutsideClick);
    document.addEventListener("keydown", closeMenuOnEscape);
    document.addEventListener("keydown", navigateSourceMenu);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("mousedown", closeMenuOnOutsideClick);
      document.removeEventListener("keydown", closeMenuOnEscape);
      document.removeEventListener("keydown", navigateSourceMenu);
    };
  }, [openMenuId]);

  async function selectFile(file) {
    if (readOnly || busyId || file.id === selectedFileId) return;
    setBusyId(file.id);
    try {
      const updated = await AiJudgeService.updateSession(classId, judgeSession.id, { selected_file_id: file.id });
      onSessionUpdated(updated);
      setShowOtherSources(false);
    } catch (error) { toast.error(error?.message ?? "切換評分表來源失敗"); }
    finally { setBusyId(null); }
  }

  async function download(file) {
    try { const blob = await AiJudgeService.downloadFile(classId, file.id); downloadBlob(blob, file.original_filename ?? `${file.display_name}.pdf`); }
    catch (error) { toast.error(error?.message ?? "下載評分文件失敗"); }
    finally { setOpenMenuId(null); }
  }

  async function remove(file) {
    if (!window.confirm(`確定刪除「${file.display_name ?? file.original_filename}」？已建立的腳本不會受影響。`)) return;
    setBusyId(file.id);
    try {
      await AiJudgeService.deleteFile(classId, file.id);
      setFiles((current) => current.filter((entry) => entry.id !== file.id));
      if (file.id === judgeSession?.selected_file_id) onSessionUpdated(await AiJudgeService.getSession(classId, judgeSession.id));
      toast.success("評分表來源已刪除");
    } catch (error) { toast.error(error?.message ?? "刪除評分表來源失敗"); }
    finally { setBusyId(null); setOpenMenuId(null); }
  }

  const activeFiles = files.filter((file) => file.status === "active");
  const selectedFile = getSelectedRubricSource(files, selectedFileId);
  const visibleFiles = getVisibleRubricSources(files, selectedFileId, showOtherSources);
  return (
    <aside ref={sourceRailRef} className={styles.sourceRail} aria-label="評分表來源">
      <div className={styles.sourceRailHead}>
        <div>
          <h3>評分表來源</h3>
          <p>{loading ? "正在確認目前來源…" : selectedFile ? "目前檢查使用的來源" : "尚未選擇來源"}</p>
        </div>
        <div className={styles.sourceRailActions}>
          {!readOnly && selectedFile && activeFiles.length > 1 && <button type="button" className={styles.btnSecondary} aria-expanded={showOtherSources} onClick={() => setShowOtherSources((current) => !current)}>{showOtherSources ? "只看目前來源" : "切換來源"}</button>}
          {!readOnly && <button type="button" className={styles.iconBtn} aria-label="新增來源" title="新增來源" onClick={onAddSource}><MIcon name="add" size={19} /></button>}
        </div>
      </div>
      {loading ? <p className={styles.mutedText}>載入來源中…</p> : visibleFiles.length > 0 ? (
        <div className={styles.sourceList}>
          {visibleFiles.map((file) => <div key={file.id} className={`${styles.sourceRow} ${file.id === selectedFileId ? styles.sourceRowSelected : ""}`}><button type="button" className={styles.sourceSelect} disabled={readOnly || busyId === file.id} onClick={() => selectFile(file)}><span className={styles.sourceIndicator} aria-hidden="true"><MIcon name={file.id === selectedFileId ? "radio_button_checked" : "radio_button_unchecked"} size={17} /></span><span className={styles.sourceText}><b>{file.display_name ?? file.original_filename ?? "未命名評分表"}</b><small>{(file.environment_keys?.length ? file.environment_keys : [file.template_key]).map(getTemplateLabel).join("、")} · {file.analysis_json?.items?.length ?? 0} 項 · {formatDateTime(file.updated_at)} · {file.source_type === "created" ? "建立於系統" : "已上傳"}</small>{file.id === selectedFileId && <em>已選用</em>}</span></button>{(file.source_type !== "created" || !readOnly) && <div className={styles.sourceActions}><button type="button" className={styles.iconBtn} aria-label={`管理 ${file.display_name ?? "評分表"}`} title="管理評分表來源" aria-haspopup="menu" aria-expanded={openMenuId === file.id} onClick={(event) => { event.stopPropagation(); setOpenMenuId((current) => current === file.id ? null : file.id); }}><MIcon name="more_vert" size={18} /></button>{openMenuId === file.id && <div className={styles.sourceMenu} role="menu">{file.source_type !== "created" && <button type="button" role="menuitem" onClick={() => download(file)}><MIcon name="download" size={15} />下載原始文件</button>}{!readOnly && <button type="button" role="menuitem" className={styles.menuDanger} disabled={busyId === file.id} onClick={() => remove(file)}><MIcon name="delete" size={15} />刪除來源</button>}</div>}</div>}</div>)}
        </div>
      ) : <div className={styles.sourceEmpty}><MIcon name="description" size={24} /><p>{selectedFileId ? "目前來源已無法使用，請重新選擇。" : "這項檢查尚未選擇評分表來源。"}</p>{!readOnly && <button type="button" className={styles.btnSecondary} onClick={onAddSource}><MIcon name="add" size={15} />新增來源</button>}</div>}
    </aside>
  );
}

/* ── Tab 1：評分表 ──────────────────────────────────────── */

function RubricsTab({ classId, judgeSession, onSessionUpdated, onScriptCreated, onAddSource, showFileLibrary = true }) {
  const toast = useToast();

  const [files, setFiles] = useState([]);
  const [filesLoading, setFilesLoading] = useState(true);
  const [filesError, setFilesError] = useState(false);

  const [analysis, setAnalysis] = useState(null);
  const [messages, setMessages] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isChatting, setIsChatting] = useState(false);
  const [isReassessing, setIsReassessing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isCreatingScript, setIsCreatingScript] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState("rubric");
  const [sourceFileId, setSourceFileId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [pendingConflictFile, setPendingConflictFile] = useState(null);
  const [selectedTemplateKey, setSelectedTemplateKey] = useState("linux");
  const [analysisTemplateKey, setAnalysisTemplateKey] = useState("linux");
  const [pendingProposal, setPendingProposal] = useState(null);
  const [pendingProposalIsReassessment, setPendingProposalIsReassessment] = useState(false);
  const readOnly = judgeSession?.status === "archived";

  /** silent = true 時不觸發 loading / error state，供背景自動刷新使用 */
  const fetchFiles = useCallback(async (silent = false) => {
    if (!silent) {
      setFilesLoading(true);
      setFilesError(false);
    }
    try {
      setFiles(await AiJudgeService.listFiles(classId));
    } catch {
      if (!silent) setFilesError(true);
    } finally {
      if (!silent) setFilesLoading(false);
    }
  }, [classId]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);
  useAutoRefresh(() => fetchFiles(true));

  useEffect(() => {
    let cancelled = false;
    setMessages([]);
    setPendingProposal(null);
    setPendingProposalIsReassessment(false);
    if (!judgeSession?.id) return undefined;
    AiJudgeService.listSessionMessages(classId, judgeSession.id)
      .then((rows) => {
        if (!cancelled) setMessages(rows);
      })
      .catch(() => {
        if (!cancelled) toast.error("載入檢查對話失敗");
      });
    return () => {
      cancelled = true;
    };
  }, [classId, judgeSession?.id, toast]);

  useEffect(() => {
    if (!judgeSession?.selected_file_id || files.length === 0) return;
    const file = files.find((item) => item.id === judgeSession.selected_file_id);
    if (!file?.analysis_json) return;
    setAnalysis(file.analysis_json);
    setUploadedFileName(file.original_filename || "rubric");
    setSourceFileId(file.id);
    setAnalysisTemplateKey(file.template_key);
    setSelectedTemplateKey(file.template_key);
  }, [files, judgeSession?.selected_file_id]);

  /** 重算統計欄位後套用新的項目清單 */
  function applyItems(base, nextItems) {
    return {
      ...base,
      items: nextItems,
      total_items: nextItems.length,
      checked_count: nextItems.filter((item) => item.checked).length,
      auto_count: nextItems.filter((item) => item.detectable === "auto").length,
      partial_count: nextItems.filter((item) => item.detectable === "partial").length,
      manual_count: nextItems.filter((item) => item.detectable === "manual").length,
    };
  }

  /** 更新分析結果；persist 時同步寫回已保存的評分表 */
  async function applyAnalysis(
    nextAnalysis,
    { persist = false, detectabilityNeedsReview } = {},
  ) {
    const evaluatedAnalysis = typeof detectabilityNeedsReview === "boolean"
      ? { ...nextAnalysis, detectability_needs_review: detectabilityNeedsReview }
      : nextAnalysis;
    setAnalysis(evaluatedAnalysis);
    if (persist && sourceFileId) {
      try {
        const currentFile = files.find((item) => item.id === sourceFileId);
        const file = await AiJudgeService.updateFileAnalysis(
          classId,
          sourceFileId,
          evaluatedAnalysis,
          currentFile?.analysis_revision,
        );
        setFiles((current) => current.map((item) => (item.id === file.id ? file : item)));
      } catch (err) {
        toast.error(err?.message ?? "更新評分表失敗");
      }
    }
  }

  async function handleUpload(file, conflictStrategy) {
    setIsUploading(true);
    try {
      let response;
      try {
        response = await AiJudgeService.uploadFile(
          classId,
          file,
          selectedTemplateKey,
          conflictStrategy,
        );
      } catch (err) {
        if (err?.status === 409) {
          setPendingConflictFile(file);
        } else {
          toast.error(err?.message ?? "上傳失敗");
        }
        return;
      }
      const uploadedFile = {
        ...response.file,
        analysis_json: response.file.analysis_json ?? response.analysis,
      };
      setPendingConflictFile(null);
      if (judgeSession?.id) {
        try {
          const updated = await AiJudgeService.updateSession(classId, judgeSession.id, {
            selected_file_id: uploadedFile.id,
          });
          onSessionUpdated?.(updated);
        } catch (err) {
          toast.error(err?.message ?? "套用評分表來源失敗");
          await fetchFiles();
          return;
        }
      }
      setAnalysis(response.analysis);
      setUploadedFileName(file.name || "rubric");
      setSourceFileId(uploadedFile.id);
      setAnalysisTemplateKey(response.template_key ?? selectedTemplateKey);
      setFiles((current) => [
        uploadedFile,
        ...current.filter((item) => item.id !== uploadedFile.id),
      ]);
      toast.success(`分析完成：${response.analysis.items.length} 題評估項目`);
      fetchFiles();
    } catch (err) {
      toast.error(err?.message ?? "上傳失敗");
    } finally {
      setIsUploading(false);
    }
  }

  async function handleSelectFile(file) {
    if (!file.analysis_json) {
      toast.error("這份評分表尚未有可載入的分析結果");
      return;
    }
    if (judgeSession?.id) {
      try {
        const updated = await AiJudgeService.updateSession(classId, judgeSession.id, {
          selected_file_id: file.id,
        });
        onSessionUpdated?.(updated);
      } catch (err) {
        toast.error(err?.message ?? "更新檢查評分表失敗");
        return;
      }
    }
    setAnalysis(file.analysis_json);
    setUploadedFileName(file.original_filename || "rubric");
    setSourceFileId(file.id);
    setAnalysisTemplateKey(file.template_key);
    setSelectedTemplateKey(file.template_key);
    if (!judgeSession?.id) setMessages([]);
    toast.success(`已載入「${file.display_name ?? file.original_filename ?? "評分表"}」`);
  }

  async function handleDownloadFile(file) {
    if (file.source_type === "created") return;
    try {
      const blob = await AiJudgeService.downloadFile(classId, file.id);
      downloadBlob(blob, file.original_filename ?? `${file.display_name ?? "評分表"}.pdf`);
    } catch (err) {
      toast.error(err?.message ?? "下載評分表失敗");
    }
  }

  async function handleDeleteFile() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await AiJudgeService.deleteFile(classId, deleteTarget.id);
      toast.success("評分表已刪除");
      setFiles((current) => current.filter((file) => file.id !== deleteTarget.id));
      if (sourceFileId === deleteTarget.id) setSourceFileId(null);
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err?.message ?? "刪除評分表失敗");
    } finally {
      setDeleting(false);
    }
  }

  async function handleSendMessage(content, isRefine = false, isReassessment = false) {
    if (!judgeSession?.id && !analysis) return;
    if (judgeSession?.status === "archived") return;
    const newMessages = [...messages, { role: "user", content }];
    setMessages(newMessages);
    setIsChatting(true);
    try {
      if (judgeSession?.id) {
        const response = await AiJudgeService.sendSessionMessage(
          classId,
          judgeSession.id,
          content,
          files.find((file) => file.id === sourceFileId)?.analysis_revision,
          { isRefine },
        );
        setMessages((current) => {
          const withoutOptimistic = current.slice(0, -1);
          return [...withoutOptimistic, response.user_message, response.assistant_message];
        });
        setPendingProposal(response.rubric_proposal ?? null);
        setPendingProposalIsReassessment(Boolean(response.rubric_proposal && isReassessment));
        if (isReassessment && !response.rubric_proposal) {
          toast.error("AI 未回傳可套用的重新評估結果，原有百分比尚未更新，請稍後再試");
        }
        return;
      }
      const response = await AiJudgeService.chat({
        messages: newMessages,
        rubricContext: rubricToContext(analysis),
        isRefine,
        templateKey: analysisTemplateKey,
      });
      setMessages((prev) => [...prev, { role: "assistant", content: response.reply }]);
      if (response.updated_items) {
        await applyAnalysis(applyItems(analysis, response.updated_items), {
          persist: true,
          detectabilityNeedsReview: false,
        });
        toast.success(isReassessment ? "重新評估完成" : "評估表已更新");
      } else if (isReassessment) {
        toast.error("AI 未回傳可套用的重新評估結果，原有百分比尚未更新，請稍後再試");
      }
    } catch (err) {
      toast.error(err?.message ?? "對話失敗");
      setMessages(messages);
    } finally {
      setIsChatting(false);
    }
  }

  async function applyPendingProposal() {
    if (!pendingProposal) return;
    await applyAnalysis(applyItems(analysis, pendingProposal), {
      persist: true,
      detectabilityNeedsReview: false,
    });
    setPendingProposal(null);
    setPendingProposalIsReassessment(false);
    toast.success("已套用 AI 提出的評分項目修改");
  }

  function handleItemChange(index, updatedItem) {
    const nextItems = [...analysis.items];
    nextItems[index] = updatedItem;
    applyAnalysis(applyItems(analysis, nextItems), {
      persist: true,
      detectabilityNeedsReview: true,
    });
  }

  function handleItemDelete(index) {
    const nextItems = analysis.items.filter((_, i) => i !== index);
    applyAnalysis(applyItems(analysis, nextItems), {
      persist: true,
      detectabilityNeedsReview: true,
    });
  }

  function handleAddItem() {
    const newItem = {
      id: `item-${Date.now()}`,
      title: "新評估項目",
      description: "",
      checked: false,
      detectable: "manual",
      detection_method: null,
      fallback: null,
      check_steps: [],
    };
    applyAnalysis(applyItems(analysis, [...analysis.items, newItem]), {
      persist: true,
      detectabilityNeedsReview: true,
    });
  }

  async function handleReassess() {
    setIsReassessing(true);
    try {
      await handleSendMessage(RUBRIC_REASSESS_PROMPT, true, true);
    } finally {
      setIsReassessing(false);
    }
  }

  async function handleExport() {
    setIsExporting(true);
    try {
      const blob = await AiJudgeService.downloadExcel(analysis.items, analysis.summary);
      downloadBlob(blob, "rubric.xlsx");
      toast.success("Excel 下載成功");
    } catch (err) {
      toast.error(err?.message ?? "匯出失敗");
    } finally {
      setIsExporting(false);
    }
  }

  async function handleCreateScript() {
    setIsCreatingScript(true);
    try {
      const artifact = judgeSession?.id
        ? await AiJudgeService.createSessionScript(classId, judgeSession.id)
        : await AiJudgeService.createScript(classId, {
            name: uploadedFileName,
            templateKey: analysisTemplateKey,
            rubricSnapshot: analysis,
            sourceFileId,
          });
      toast.success(
        artifact.status === "reviewed"
          ? "檢查腳本已產生並通過審查"
          : "檢查腳本已產生，請查看審查結果",
      );
      onScriptCreated?.();
    } catch (err) {
      toast.error(err?.message ?? "製作檢查腳本失敗");
    } finally {
      setIsCreatingScript(false);
    }
  }

  const items = analysis?.items ?? [];

  return (
    <div className={styles.tabBody}>
      <div className={styles.sectionHead}>
        <div>
          <h3 className={styles.sectionTitle}>評分表</h3>
          <p className={styles.sectionDesc}>上傳評分文件，查看 AI 偵測判斷並調整評分項目</p>
        </div>
        {analysis && (
          <div className={styles.sectionActions}>
            <button
              type="button"
              className={styles.btnPrimary}
              onClick={handleCreateScript}
              disabled={isCreatingScript || isChatting || readOnly || items.length === 0}
              title={items.length === 0 ? "請先新增至少一個評估項目" : undefined}
            >
              {isCreatingScript ? <Spinner /> : <MIcon name="auto_fix_high" size={16} />}
              {isCreatingScript ? "製作中..." : "製作檢查腳本"}
            </button>
            <button
              type="button"
              className={styles.btnSecondary}
              onClick={handleExport}
              disabled={isExporting}
            >
              {isExporting ? <Spinner /> : <MIcon name="download" size={16} />}
              {isExporting ? "匯出中..." : "匯出 Excel"}
            </button>
          </div>
        )}
      </div>

      {isCreatingScript && (
        <div className={styles.noticeInfo}>
          <p>
             <strong>正在生成受管檢查腳本</strong>
          </p>
          <p>
            AI 正在依目前評分項目產生收集腳本，完成後系統會接著進行安全規則檢查與 AI 複核。
          </p>
        </div>
      )}

      {analysis && items.length === 0 && (
        <div className={styles.noticeInfo}>
          <p><strong>尚未新增評估項目</strong></p>
          <p>請先新增至少一個評估項目，才能製作檢查腳本。</p>
        </div>
      )}

      {showFileLibrary && <div className={styles.card}>
        <div className={styles.cardHead}>
          <h4 className={styles.cardTitle}>
            <MIcon name="description" size={18} />
            已保存評分表
          </h4>
        </div>
        {filesLoading ? (
          <LoadingState text="載入評分表中..." />
        ) : filesError ? (
          <p className={styles.dangerText}>載入評分表失敗，請稍後再試。</p>
        ) : files.length === 0 ? (
          <p className={styles.mutedText}>
            尚未保存評分表。上傳評分文件後會自動保存文件與分析結果。
          </p>
        ) : (
          <div className={styles.fileList}>
            {files.map((file) => (
              <div
                key={file.id}
                className={`${styles.fileRow} ${sourceFileId === file.id ? styles.fileRowActive : ""}`}
              >
                <button
                  type="button"
                  className={styles.fileMain}
                  onClick={() => handleSelectFile(file)}
                  disabled={readOnly}
                >
                  <span className={styles.fileName}>{file.display_name ?? file.original_filename ?? "未命名評分表"}</span>
                  <span className={styles.fileMeta}>
                    {getTemplateLabel(file.template_key)} · {formatDateTime(file.updated_at)}
                    {file.status === "replaced" ? " · 已取代" : ""}
                  </span>
                </button>
                <div className={styles.fileActions}>
                  {file.source_type !== "created" && <button
                    type="button"
                    className={styles.btnSecondary}
                    onClick={() => handleDownloadFile(file)}
                  >
                    <MIcon name="download" size={14} />
                    評分文件
                  </button>}
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    onClick={() => setDeleteTarget(file)}
                    disabled={deleting || readOnly}
                  >
                    <MIcon name="delete" size={14} />
                    刪除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>}

      <div className={styles.analysisGrid}>
        <div className={styles.analysisMain}>
          {showFileLibrary && <div className={styles.card}>
             <h4 className={styles.cardTitle}>
               <MIcon name="upload" size={18} />
               上傳評分文件（可選）
            </h4>
            <p className={styles.mutedText}>
              可以先聊天再上傳；上傳後會分析並自動綁定到目前這次檢查。
            </p>
            <div className={styles.templateRow}>
              <span className={styles.fieldLabel}>評分環境</span>
              <div className={styles.chipBtns}>
                {TEMPLATE_OPTIONS.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    className={
                      selectedTemplateKey === option.key ? styles.chipBtnActive : styles.chipBtn
                    }
                    onClick={() => setSelectedTemplateKey(option.key)}
                    disabled={isUploading || readOnly}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <RubricUploader onUpload={handleUpload} isLoading={isUploading || readOnly} />
           </div>}

           {analysis && (
            <>
              <div className={styles.card}>
                <RubricStats
                  items={items}
                  needsReview={Boolean(analysis.detectability_needs_review)}
                  isReassessing={isReassessing}
                  onReassess={handleReassess}
                  readOnly={readOnly}
                />
                <p className={styles.mutedText}>
                  主要評分情境：{getTemplateLabel(analysisTemplateKey)}
                </p>
                {analysis.summary && <p className={styles.summaryBox}>{analysis.summary}</p>}
              </div>

              <div className={styles.card}>
                <div className={styles.cardHead}>
                  <h4 className={styles.cardTitle}>評估項目（{items.length}）</h4>
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    onClick={handleAddItem}
                    disabled={readOnly}
                  >
                    <MIcon name="add" size={16} />
                    新增項目
                  </button>
                </div>
                <div className={styles.itemsList}>
                  {items.map((item, index) => (
                    <RubricCard
                      key={item.id}
                      item={item}
                      index={index}
                      onChange={(updated) => handleItemChange(index, updated)}
                      onDelete={() => handleItemDelete(index)}
                      disabled={isChatting || readOnly}
                    />
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        <div className={styles.analysisAside}>
          <div className={`${styles.card} ${styles.chatCard}`}>
            <h4 className={styles.cardTitle}>
              <MIcon name="smart_toy" size={18} />
              AI 聊天室
            </h4>
            <ChatPanel
              messages={messages}
              onSendMessage={handleSendMessage}
              isLoading={isChatting}
              disabled={readOnly}
              hasRubric={Boolean(analysis)}
            />
            {pendingProposal && analysis && (
              <div className={styles.proposalCard}>
                <div>
                  <strong>
                    {pendingProposalIsReassessment
                      ? `重新評估完成，共 ${pendingProposal.length} 個評分項目`
                      : `AI 提出 ${pendingProposal.length} 個評分項目`}
                  </strong>
                  <p>
                    {pendingProposalIsReassessment
                      ? "套用後才會更新可自動偵測比例與班級評分表。"
                      : "確認後才會寫回班級評分表。"}
                  </p>
                </div>
                <div className={styles.sectionActions}>
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    onClick={() => {
                      setPendingProposal(null);
                      setPendingProposalIsReassessment(false);
                    }}
                  >
                    略過
                  </button>
                  <button
                    type="button"
                    className={styles.btnPrimary}
                    onClick={applyPendingProposal}
                    disabled={readOnly}
                  >
                    {pendingProposalIsReassessment ? "套用評估結果" : "套用提案"}
                  </button>
                </div>
              </div>
            )}
          </div>
          {judgeSession?.id && onAddSource && (
            <RubricSourceRail
              classId={classId}
              judgeSession={judgeSession}
              readOnly={readOnly}
              onSessionUpdated={onSessionUpdated}
              onAddSource={onAddSource}
            />
          )}
        </div>
      </div>

      {pendingConflictFile && (
        <ConfirmModal
          title="已有同名評分表"
          description={`「${pendingConflictFile.name}」已存在。請選擇覆蓋原本文件，或建立一份副本後重新分析。`}
          onClose={() => {
            if (!isUploading) setPendingConflictFile(null);
          }}
          actions={
            <>
              <button
                type="button"
                className={styles.btnSecondary}
                disabled={isUploading}
                onClick={() => setPendingConflictFile(null)}
              >
                取消
              </button>
              <button
                type="button"
                className={styles.btnSecondary}
                disabled={isUploading}
                onClick={() => handleUpload(pendingConflictFile, "copy")}
              >
                建立副本
              </button>
              <button
                type="button"
                className={styles.btnPrimary}
                disabled={isUploading}
                onClick={() => handleUpload(pendingConflictFile, "overwrite")}
              >
                覆蓋原本
              </button>
            </>
          }
        />
      )}

      {deleteTarget && (
        <ConfirmModal
          title="確認刪除評分表？"
          description={`你即將刪除「${deleteTarget.original_filename}」的原始檔與保存分析。刪除後不會影響已建立的腳本。`}
          onClose={() => {
            if (!deleting) setDeleteTarget(null);
          }}
          actions={
            <>
              <button
                type="button"
                className={styles.btnSecondary}
                disabled={deleting}
                onClick={() => setDeleteTarget(null)}
              >
                取消
              </button>
              <button
                type="button"
                className={styles.btnDanger}
                disabled={deleting}
                onClick={handleDeleteFile}
              >
                {deleting ? "刪除中..." : "確認刪除"}
              </button>
            </>
          }
        />
      )}
    </div>
  );
}

/* ── Tab 2：檢查腳本 ────────────────────────────────────── */

const SCRIPT_STATUS_LABELS = {
  draft: "草稿",
  review_failed: "審查未通過",
  reviewed: "待老師核准",
  approved: "已核准",
  archived: "已停用",
};

function scriptStatusBadgeClass(status) {
  if (status === "approved") return styles.badge_success;
  if (status === "review_failed") return styles.badge_danger;
  if (status === "reviewed") return styles.badge_info;
  return styles.badge_muted;
}

function ReviewPanel({ title, result }) {
  const issues = Array.isArray(result?.issues) ? result.issues : [];
  return (
    <div className={styles.reviewPanel}>
      <div className={styles.reviewPanelHead}>
        <span>{title}</span>
        <span
          className={`${styles.badge} ${result?.approved ? styles.badge_success : styles.badge_danger}`}
        >
          {result?.approved ? "通過" : "阻擋"}
        </span>
      </div>
      {issues.length > 0 ? (
        <ul className={styles.reviewIssues}>
          {issues.map((issue, index) => (
            <li key={`${title}-${index}`}>{String(issue)}</li>
          ))}
        </ul>
      ) : (
        <p className={styles.mutedText}>沒有列出風險項目。</p>
      )}
      {result?.suggested_fix && (
        <p className={styles.mutedText}>建議：{String(result.suggested_fix)}</p>
      )}
    </div>
  );
}

function ScriptsTab({ classId, sessionId, readOnly = false, onScriptApproved }) {
  const toast = useToast();
  const [scripts, setScripts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [actionPending, setActionPending] = useState(null); // "approve" | "regenerate" | "delete"

  const fetchScripts = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      setScripts(await AiJudgeService.listScripts(classId, sessionId));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [classId, sessionId]);

  useEffect(() => {
    fetchScripts();
  }, [fetchScripts]);

  const selected = useMemo(() => {
    if (scripts.length === 0) return null;
    return scripts.find((script) => script.id === selectedId) ?? scripts[0];
  }, [scripts, selectedId]);

  async function handleApprove() {
    setActionPending("approve");
    try {
      await AiJudgeService.approveScript(classId, selected.id);
      toast.success("檢查腳本已核准");
      fetchScripts();
      onScriptApproved?.();
    } catch (err) {
      toast.error(err?.message ?? "核准失敗");
    } finally {
      setActionPending(null);
    }
  }

  async function handleRegenerate() {
    setActionPending("regenerate");
    try {
      const script = await AiJudgeService.regenerateScript(classId, selected.id);
      setSelectedId(script.id);
      toast.success("檢查腳本已重新生成");
      fetchScripts();
    } catch (err) {
      toast.error(err?.message ?? "重新生成失敗");
    } finally {
      setActionPending(null);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setActionPending("delete");
    try {
      await AiJudgeService.deleteScript(classId, deleteTarget.id);
      toast.success("檢查腳本已刪除");
      setSelectedId(null);
      setDeleteTarget(null);
      setScripts((current) => current.filter((script) => script.id !== deleteTarget.id));
    } catch (err) {
      toast.error(err?.message ?? "刪除失敗");
    } finally {
      setActionPending(null);
    }
  }

  return (
    <div className={styles.tabBody}>
      <div className={styles.sectionHead}>
        <div>
          <h3 className={styles.sectionTitle}>收集腳本</h3>
          <p className={styles.sectionDesc}>管理班級內由評分表產生的受管收集腳本。</p>
        </div>
      </div>

      {loading ? (
        <LoadingState text="載入腳本中..." />
      ) : error ? (
        <div className={styles.card}>
          <div className={styles.cardHead}>
            <span className={styles.dangerText}>載入檢查腳本失敗，請稍後再試。</span>
            <button type="button" className={styles.btnSecondary} onClick={fetchScripts}>
              重新載入
            </button>
          </div>
        </div>
      ) : scripts.length === 0 ? (
        <div className={styles.card}>
          <p className={styles.mutedText}>
            尚未建立檢查腳本。請先到「評分設定」上傳評分文件並製作檢查腳本。
          </p>
        </div>
      ) : (
        <div className={styles.scriptsGrid}>
          <div className={styles.scriptList}>
            {scripts.map((script) => (
              <button
                key={script.id}
                type="button"
                className={`${styles.scriptItem} ${selected?.id === script.id ? styles.scriptItemActive : ""}`}
                onClick={() => setSelectedId(script.id)}
              >
                <span className={styles.scriptItemHead}>
                  <span className={styles.scriptName}>{script.name}</span>
                  <span className={`${styles.badge} ${scriptStatusBadgeClass(script.status)}`}>
                    {SCRIPT_STATUS_LABELS[script.status] ?? script.status}
                  </span>
                </span>
                <span className={styles.fileMeta}>
                  v{script.version} · {getTemplateLabel(script.template_key)} · {formatDateTime(script.updated_at)}
                </span>
              </button>
            ))}
          </div>

          {selected && (
            <div className={styles.card}>
              <div className={styles.cardHead}>
                <h4 className={styles.cardTitle}>
                  <MIcon name="security" size={18} />
                  {selected.name} v{selected.version}
                </h4>
                <div className={styles.sectionActions}>
                  <button
                    type="button"
                    className={styles.btnPrimary}
                    onClick={handleApprove}
                    disabled={
                      readOnly || selected.status !== "reviewed" || actionPending !== null
                    }
                  >
                    <MIcon name="check_circle" size={16} />
                    {actionPending === "approve" ? "核准中..." : "核准"}
                  </button>
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    onClick={handleRegenerate}
                    disabled={
                      readOnly || selected.status === "archived" || actionPending !== null
                    }
                  >
                    {actionPending === "regenerate" ? <Spinner /> : <MIcon name="refresh" size={16} />}
                    {actionPending === "regenerate" ? "生成中..." : "重新生成"}
                  </button>
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    onClick={() => setDeleteTarget(selected)}
                    disabled={readOnly || actionPending !== null}
                  >
                    <MIcon name="delete" size={16} />
                    刪除腳本
                  </button>
                </div>
              </div>

              <div className={styles.reviewGrid}>
                <ReviewPanel title="規則檢查（靜態）" result={selected.policy_check_result_json} />
                <ReviewPanel title="AI 檢查" result={selected.ai_review_result_json} />
              </div>

              <pre className={styles.codeBlock}>{selected.script_content}</pre>
            </div>
          )}
        </div>
      )}

      {deleteTarget && (
        <ConfirmModal
          title="確認刪除檢查腳本？"
          description={`你即將永久刪除「${deleteTarget.name}」v${deleteTarget.version}。刪除後無法再查看、核准或重新生成。`}
          onClose={() => {
            if (actionPending !== "delete") setDeleteTarget(null);
          }}
          actions={
            <>
              <button
                type="button"
                className={styles.btnSecondary}
                disabled={actionPending === "delete"}
                onClick={() => setDeleteTarget(null)}
              >
                取消
              </button>
              <button
                type="button"
                className={styles.btnDanger}
                disabled={actionPending === "delete"}
                onClick={handleDelete}
              >
                {actionPending === "delete" ? "刪除中..." : "確認刪除"}
              </button>
            </>
          }
        />
      )}
    </div>
  );
}

/* ── Tab 3：執行與結果 ──────────────────────────────────── */

const REASON_LABELS = {
  success: "成功",
  not_running: "未運行",
  missing_ip: "缺少 IP",
  missing_ssh_key: "缺少 SSH 金鑰",
  owner_mismatch: "資源擁有者不一致",
  missing_db_resource: "找不到對應資源",
  invalid_resource_type: "類型不可執行",
  python_missing: "機器缺少腳本執行環境",
  execution_nonzero: "腳本執行失敗",
  result_too_large: "結果過大",
  invalid_json: "JSON 格式錯誤",
  executor_error: "執行器錯誤",
};

function reasonLabel(reasonCode) {
  if (!reasonCode) return null;
  return REASON_LABELS[reasonCode] ?? reasonCode;
}

function runIsTerminal(status) {
  return status === "completed" || status === "failed" || status === "cancelled";
}

const RUN_STATUS = {
  completed: { label: "已完成", className: styles.badge_success },
  running: { label: "執行中", className: styles.badge_info },
  failed: { label: "失敗", className: styles.badge_danger },
  cancelled: { label: "已取消", className: styles.badge_muted },
  pending: { label: "等待中", className: styles.badge_muted },
};

const TARGET_STATUS = {
  completed: { label: "完成", className: styles.badge_success },
  running: { label: "執行中", className: styles.badge_info },
  failed: { label: "失敗", className: styles.badge_danger },
  queued: { label: "排隊中", className: styles.badge_muted },
};

function StatusBadge({ map, status }) {
  const info = map[status] ?? { label: status ?? "—", className: styles.badge_muted };
  return <span className={`${styles.badge} ${info.className}`}>{info.label}</span>;
}

function AiJudgementBadge({ result }) {
  if (!result) return <span className={`${styles.badge} ${styles.badge_muted}`}>等待回收</span>;
  if (result.validation?.valid === false) {
    return <span className={`${styles.badge} ${styles.badge_danger}`}>JSON 格式錯誤</span>;
  }
  const judgement = result.ai_judgement;
  if (!judgement) return <span className={`${styles.badge} ${styles.badge_muted}`}>分析中</span>;
  if (judgement.status === "completed") {
    const score = typeof judgement.score === "number" ? judgement.score : null;
    const maxScore = typeof judgement.max_score === "number" ? judgement.max_score : 5;
    return (
      <span className={`${styles.badge} ${styles.badge_success}`}>
        {score === null ? "已分析" : `${score}/${maxScore}`}
      </span>
    );
  }
  if (judgement.status === "failed") {
    return <span className={`${styles.badge} ${styles.badge_danger}`}>AI 分析失敗</span>;
  }
  if (judgement.status === "skipped") {
    return <span className={`${styles.badge} ${styles.badge_muted}`}>略過</span>;
  }
  return <span className={`${styles.badge} ${styles.badge_info}`}>分析中</span>;
}

function aiJudgementSummary(result) {
  if (!result) return null;
  if (result.validation?.valid === false) {
    return result.validation.error ?? "JSON 驗證未通過，未進入 AI 分析。";
  }
  const judgement = result.ai_judgement;
  if (!judgement) return "AI 分析尚未完成。";
  return judgement.error ?? judgement.summary ?? null;
}

function formatUsage(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return "--";
  return `${Math.round(value)}%`;
}

function ExecutionTab({ classId, sessionId, readOnly = false, members }) {
  const toast = useToast();
  const [selectedVmids, setSelectedVmids] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedScriptId, setSelectedScriptId] = useState(null);
  const [creatingRun, setCreatingRun] = useState(false);
  const [activeRunRef, setActiveRunRef] = useState(null); // { scriptId, runId }
  const [activeRun, setActiveRun] = useState(null);
  const [scripts, setScripts] = useState([]);
  const [runHistory, setRunHistory] = useState([]);

  useEffect(() => {
    AiJudgeService.listScripts(classId, sessionId)
      .then(setScripts)
      .catch(() => {});
  }, [classId, sessionId]);

  useEffect(() => {
    let cancelled = false;
    setActiveRun(null);
    setActiveRunRef(null);
    setRunHistory([]);
    if (!sessionId) return undefined;
    AiJudgeService.listSessionRuns(classId, sessionId)
      .then(async (runs) => {
        if (cancelled) return;
        setRunHistory(runs);
        const latest = runs[0];
        if (latest) {
          const detail = await AiJudgeService.getSessionRun(classId, sessionId, latest.id);
          if (cancelled) return;
          setActiveRun(detail);
          if (!runIsTerminal(latest.status)) {
            setActiveRunRef({ scriptId: latest.artifact_id, runId: latest.id });
          }
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [classId, sessionId]);

  /* 執行任務輪詢：每 2 秒直到終態；失敗放慢到 5 秒重試 */
  useEffect(() => {
    if (!activeRunRef) return undefined;
    let cancelled = false;
    let timer = null;

    async function poll() {
      try {
        const run = await AiJudgeService.getScriptRun(
          classId,
          activeRunRef.scriptId,
          activeRunRef.runId,
        );
        if (cancelled) return;
        setActiveRun(run);
        if (!runIsTerminal(run.status)) timer = setTimeout(poll, 2000);
      } catch {
        if (!cancelled) timer = setTimeout(poll, 5000);
      }
    }

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [classId, activeRunRef]);

  const approvedScripts = useMemo(
    () => scripts.filter((script) => script.status === "approved"),
    [scripts],
  );
  const effectiveScriptId = selectedScriptId ?? approvedScripts[0]?.id ?? "";
  const effectiveScript = approvedScripts.find((script) => script.id === effectiveScriptId);

  const runningMembers = members.filter(
    (member) =>
      member.vmid &&
      member.vm_status === "running" &&
      (member.vm_type === "qemu" || member.vm_type === "lxc"),
  );
  const selectedSet = new Set(selectedVmids);

  const progressTargets = activeRun?.progress_json?.targets ?? [];
  const resultTargets = activeRun?.target_results_json?.targets ?? [];
  const resultByVmid = new Map(resultTargets.map((result) => [result.vmid, result]));

  function toggleVmid(vmid, checked) {
    setSelectedVmids((current) =>
      checked ? Array.from(new Set([...current, vmid])) : current.filter((item) => item !== vmid),
    );
  }

  async function handleCreateRun() {
    setCreatingRun(true);
    try {
      const run = sessionId
        ? await AiJudgeService.createSessionRun(
            classId,
            sessionId,
            effectiveScriptId,
            selectedVmids,
          )
        : await AiJudgeService.createScriptRun(classId, effectiveScriptId, selectedVmids);
      toast.success(
        `已建立腳本執行任務（${run.progress_json?.total ?? selectedVmids.length} 台）`,
      );
      setActiveRun(run);
      setRunHistory((current) => [run, ...current.filter((item) => item.id !== run.id)]);
      setActiveRunRef({ scriptId: effectiveScriptId, runId: run.id });
      setDialogOpen(false);
      setSelectedScriptId(null);
      setSelectedVmids([]);
    } catch (err) {
      toast.error(err?.message ?? "建立執行任務失敗");
    } finally {
      setCreatingRun(false);
    }
  }

  return (
    <div className={styles.tabBody}>
      <div className={styles.sectionHead}>
        <div>
          <h3 className={styles.sectionTitle}>執行與結果</h3>
          <p className={styles.sectionDesc}>
            選擇班級內運行中的 VM/LXC，套用已核准的檢查腳本。
          </p>
        </div>
        <button
          type="button"
          className={styles.btnPrimary}
          onClick={() => setDialogOpen(true)}
          disabled={
            readOnly || selectedVmids.length === 0 || approvedScripts.length === 0
          }
        >
          <MIcon name="play_circle_outline" size={16} />
          執行腳本
        </button>
      </div>

      <div className={styles.execToolbar}>
        <span className={styles.mutedText}>
          可執行 {runningMembers.length} / 全部 {members.length} 台，已選{" "}
          <strong>{selectedVmids.length}</strong> 台
        </span>
        <div className={styles.sectionActions}>
          <button
            type="button"
            className={styles.btnSecondary}
            onClick={() => setSelectedVmids(runningMembers.map((m) => m.vmid).filter(Boolean))}
            disabled={runningMembers.length === 0}
          >
            選取運行中
          </button>
          <button
            type="button"
            className={styles.btnSecondary}
            onClick={() => setSelectedVmids([])}
            disabled={selectedVmids.length === 0}
          >
            清除
          </button>
        </div>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.checkCol} />
              <th>機器編號</th>
              <th>成員</th>
              <th>類型</th>
              <th>狀態</th>
              <th>資源摘要</th>
            </tr>
          </thead>
          <tbody>
            {runningMembers.length === 0 ? (
              <tr>
                <td colSpan={6} className={styles.tableEmpty}>
                  目前沒有可執行的運行中 VM/LXC。
                </td>
              </tr>
            ) : (
              runningMembers.map((member) => (
                <tr key={member.user_id}>
                  <td>
                    <input
                      type="checkbox"
                      className={styles.checkbox}
                      checked={selectedSet.has(member.vmid)}
                      onChange={(e) => toggleVmid(member.vmid, e.target.checked)}
                    />
                  </td>
                  <td className={styles.monoCell}>{member.vmid ?? "-"}</td>
                  <td>
                    <div>{member.full_name ?? "-"}</div>
                    <div className={styles.fileMeta}>{member.email}</div>
                  </td>
                  <td className={styles.typeCell}>{member.vm_type ? (member.vm_type === "lxc" ? "LXC" : "VM") : "-"}</td>
                  <td>
                    <span className={`${styles.badge} ${styles.badge_success}`}>運行中</span>
                  </td>
                  <td className={styles.fileMeta}>
                    CPU {formatUsage(member.vm_cpu_usage_pct)} · RAM{" "}
                    {formatUsage(member.vm_ram_usage_pct)} · 碟{" "}
                    {formatUsage(member.vm_disk_usage_pct)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {activeRun && (
        <div className={styles.card}>
          <div className={styles.cardHead}>
            <div>
              <h4 className={styles.cardTitle}>
                最近一次執行結果
                <StatusBadge map={RUN_STATUS} status={activeRun.status} />
              </h4>
              <p className={styles.fileMeta}>
                進度 {activeRun.progress_json?.done ?? 0} /{" "}
                {activeRun.progress_json?.total ?? progressTargets.length} 台
              </p>
            </div>
            {!runIsTerminal(activeRun.status) && (
              <span className={styles.mutedText}>
                <Spinner size={14} /> 更新中...
              </span>
            )}
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>編號</th>
                  <th>成員</th>
                  <th>來源節點</th>
                  <th>執行狀態</th>
                  <th>AI 分析</th>
                </tr>
              </thead>
              <tbody>
                {progressTargets.map((target) => {
                  const result = resultByVmid.get(target.vmid);
                  const user = result?.user ?? target.user;
                  const proxmoxNode = result?.proxmox_node ?? target.proxmox_node;
                  const resourceType = result?.resource_type ?? target.resource_type;
                  const targetReason = reasonLabel(result?.reason_code ?? target.reason_code);
                  const summary = aiJudgementSummary(result);
                  const summaryIsError =
                    result?.validation?.valid === false ||
                    result?.ai_judgement?.status === "failed";
                  return (
                    <tr key={target.vmid}>
                      <td className={styles.monoCell}>{target.name ?? target.vmid}</td>
                      <td>
                        <div>{user?.full_name ?? "-"}</div>
                        {user?.email && <div className={styles.fileMeta}>{user.email}</div>}
                      </td>
                      <td>
                        <div className={styles.monoCell}>{proxmoxNode ?? "-"}</div>
                        <div className={`${styles.fileMeta} ${styles.typeCell}`}>
                          {resourceType ? (resourceType === "lxc" ? "LXC" : "VM") : "-"}
                        </div>
                      </td>
                      <td>
                        <StatusBadge map={TARGET_STATUS} status={target.status} />
                        {targetReason && targetReason !== "成功" && (
                          <div className={styles.fileMeta}>{targetReason}</div>
                        )}
                      </td>
                      <td>
                        <AiJudgementBadge result={result} />
                        {result ? (
                          <details className={styles.judgeDetails}>
                            <summary>查看心得</summary>
                            {summary && (
                              <p className={summaryIsError ? styles.dangerText : styles.mutedText}>
                                {summary}
                              </p>
                            )}
                            {(result.ai_judgement?.item_judgements ?? []).map((item, index) => (
                              <div key={`${item.item_id ?? "item"}-${index}`} className={styles.judgeItem}>
                                <div className={styles.judgeItemHead}>
                                  <span>{item.title ?? item.item_id ?? "評分項目"}</span>
                                  {typeof item.score === "number" && (
                                    <span className={`${styles.badge} ${styles.badge_muted}`}>
                                      {item.score}/{item.max_score ?? 1}
                                    </span>
                                  )}
                                </div>
                                {item.comment && <p>{item.comment}</p>}
                              </div>
                            ))}
                          </details>
                        ) : (
                          <div className={styles.fileMeta}>等待回收</div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {sessionId && runHistory.length > 0 && (
        <div className={styles.card}>
          <h4 className={styles.cardTitle}>歷次執行</h4>
          <div className={styles.runHistory}>
            {runHistory.map((run) => (
              <button
                key={run.id}
                type="button"
                className={styles.runHistoryItem}
                onClick={async () => {
                  try {
                    const detail = await AiJudgeService.getSessionRun(
                      classId,
                      sessionId,
                      run.id,
                    );
                    setActiveRun(detail);
                    setActiveRunRef(
                      runIsTerminal(run.status)
                        ? null
                        : { scriptId: run.artifact_id, runId: run.id },
                    );
                  } catch (err) {
                    toast.error(err?.message ?? "載入執行結果失敗");
                  }
                }}
              >
                <span>{formatDateTime(run.created_at)}</span>
                <StatusBadge map={RUN_STATUS} status={run.status} />
              </button>
            ))}
          </div>
        </div>
      )}

      {dialogOpen && (
        <div className={styles.modalOverlay} onMouseDown={() => setDialogOpen(false)}>
          <div className={styles.modal} onMouseDown={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <h2>確認執行腳本</h2>
                <p>後端會在送出時再次確認這些 VM/LXC 仍屬於此班級且正在運行。</p>
              </div>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={() => setDialogOpen(false)}
                aria-label="關閉"
              >
                <MIcon name="close" size={18} />
              </button>
            </div>

            <label className={styles.field}>
              <span>選擇腳本</span>
              <select
                value={effectiveScriptId}
                onChange={(e) => setSelectedScriptId(e.target.value)}
              >
                {approvedScripts.map((script) => (
                  <option key={script.id} value={script.id}>
                    {script.name} v{script.version}
                  </option>
                ))}
              </select>
              {approvedScripts.length === 0 && (
                <span className={styles.fileMeta}>
          目前沒有已核准的檢查腳本，請先到檢查腳本分頁核准。
                </span>
              )}
            </label>

            <div className={styles.vmidBox}>
              <span className={styles.fieldLabel}>執行機器（{selectedVmids.length} 台）</span>
              <div className={styles.chipRow}>
                {selectedVmids.map((vmid) => (
                  <span key={vmid} className={styles.chip}>
                    {vmid}
                  </span>
                ))}
              </div>
            </div>

            {effectiveScript && (
              <p className={styles.fileMeta}>
                即將使用：{effectiveScript.name} v{effectiveScript.version}（
                {getTemplateLabel(effectiveScript.template_key)}）
              </p>
            )}

            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={() => setDialogOpen(false)}
                disabled={creatingRun}
              >
                取消
              </button>
              <button
                type="button"
                className={styles.btnPrimary}
                onClick={handleCreateRun}
                disabled={creatingRun || selectedVmids.length === 0 || !effectiveScriptId}
              >
                {creatingRun ? "建立中..." : "確認執行"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── 主面板 ─────────────────────────────────────────────── */

const JUDGE_TABS = [
  { key: "rubrics", label: "評分表", icon: "description" },
  { key: "scripts", label: "檢查腳本", icon: "terminal" },
  { key: "execution", label: "執行與結果", icon: "play_circle_outline" },
];

function LegacyAiJudgePanel({ classId, members }) {
  const [activeTab, setActiveTab] = useState("rubrics");
  const [sessions, setSessions] = useState([]);
  const [sessionStatus, setSessionStatus] = useState("active");
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [newSessionTitle, setNewSessionTitle] = useState("");
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionAction, setSessionAction] = useState(false);
  const [deleteSessionTarget, setDeleteSessionTarget] = useState(null);
  const [deletingSession, setDeletingSession] = useState(false);
  const requestVersionRef = useRef(0);
  const toast = useToast();

  const activeSession = useMemo(
    () => sessions.find((item) => item.id === activeSessionId) ?? null,
    [activeSessionId, sessions],
  );

  const loadSessions = useCallback(async () => {
    const requestVersion = ++requestVersionRef.current;
    setSessionsLoading(true);
    try {
      const rows = await AiJudgeService.listSessions(classId, sessionStatus);
      if (requestVersion !== requestVersionRef.current) return;
      setSessions(rows);
      setActiveSessionId((current) =>
        rows.some((item) => item.id === current) ? current : (rows[0]?.id ?? null),
      );
    } catch (err) {
      if (requestVersion === requestVersionRef.current) {
        setSessions([]);
        setActiveSessionId(null);
        toast.error(err?.message ?? "載入檢查清單失敗");
      }
    } finally {
      if (requestVersion === requestVersionRef.current) setSessionsLoading(false);
    }
  }, [classId, sessionStatus, toast]);

  useEffect(() => {
    setActiveSessionId(null);
    setSessions([]);
    loadSessions();
    return () => {
      requestVersionRef.current += 1;
    };
  }, [loadSessions]);

  async function createJudgeSession(e) {
    e.preventDefault();
    const title = newSessionTitle.trim();
    if (!title) return;
    setSessionAction(true);
    try {
      const created = await AiJudgeService.createSession(classId, { title });
      if (sessionStatus !== "active") setSessionStatus("active");
      setSessions((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      setActiveSessionId(created.id);
      setNewSessionTitle("");
    } catch (err) {
      toast.error(err?.message ?? "建立檢查失敗");
    } finally {
      setSessionAction(false);
    }
  }

  async function archiveActiveSession() {
    if (!activeSession) return;
    setSessionAction(true);
    try {
      await AiJudgeService.archiveSession(classId, activeSession.id);
      setSessions((current) => current.filter((item) => item.id !== activeSession.id));
      setActiveSessionId(null);
      toast.success("檢查已封存");
    } catch (err) {
      toast.error(err?.message ?? "封存檢查失敗");
    } finally {
      setSessionAction(false);
    }
  }

  async function deleteJudgeSession() {
    if (!deleteSessionTarget) return;
    setDeletingSession(true);
    try {
      await AiJudgeService.deleteSession(classId, deleteSessionTarget.id);
      setSessions((current) =>
        current.filter((item) => item.id !== deleteSessionTarget.id),
      );
      setActiveSessionId((current) =>
        current === deleteSessionTarget.id ? null : current,
      );
      setDeleteSessionTarget(null);
      toast.success("檢查與相關資料已刪除");
    } catch (err) {
      toast.error(err?.message ?? "刪除檢查失敗");
    } finally {
      setDeletingSession(false);
    }
  }

  function updateSessionInList(updated) {
    setSessions((current) =>
      current.map((item) => (item.id === updated.id ? updated : item)),
    );
  }

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeading}>
        <h2 className={styles.panelTitle}>
          <MIcon name="checklist" size={20} />
          AI 檢查
        </h2>
          <p className={styles.panelDesc}>管理班級評分表、檢查腳本與執行結果。</p>
      </div>

      <div className={styles.sessionWorkspace}>
        <aside className={styles.sessionSidebar}>
          <form className={styles.sessionCreate} onSubmit={createJudgeSession}>
            <input
              value={newSessionTitle}
              onChange={(event) => setNewSessionTitle(event.target.value)}
              placeholder="新增檢查名稱"
              maxLength={255}
            />
            <button
              type="submit"
              className={styles.btnPrimary}
              disabled={sessionAction || !newSessionTitle.trim()}
            >
              <MIcon name="add" size={16} />
              新增
            </button>
          </form>
          <div className={styles.sessionFilters}>
            {["active", "archived"].map((status) => (
              <button
                key={status}
                type="button"
                className={sessionStatus === status ? styles.chipBtnActive : styles.chipBtn}
                onClick={() => setSessionStatus(status)}
              >
                {status === "active" ? "進行中" : "已封存"}
              </button>
            ))}
          </div>
          <div className={styles.sessionList}>
            {sessionsLoading ? (
              <LoadingState />
            ) : sessions.length === 0 ? (
              <p className={styles.mutedText}>目前沒有檢查紀錄。</p>
            ) : (
              sessions.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={
                    item.id === activeSessionId
                      ? styles.sessionItemActive
                      : styles.sessionItem
                  }
                  onClick={() => setActiveSessionId(item.id)}
                >
                  <strong>{item.title}</strong>
                  <span>{item.template_key ? getTemplateLabel(item.template_key) : "尚未選評分表"}</span>
                  <small>{formatDateTime(item.last_activity_at)}</small>
                </button>
              ))
            )}
          </div>
        </aside>

        <section className={styles.sessionMain}>
          {!activeSession ? (
            <div className={styles.card}>
              <p className={styles.mutedText}>
                {sessionStatus === "active"
                  ? "請新增或選擇一項檢查。"
                  : "請選擇已封存的檢查查看歷史。"}
              </p>
            </div>
          ) : (
            <>
              <div className={styles.sessionHeader}>
                <div>
                  <h3>{activeSession.title}</h3>
                  <p>
                    {activeSession.selected_file_name ?? "尚未選擇評分表"} · 對話{" "}
                    {activeSession.message_count} · 腳本 {activeSession.script_count} · 執行{" "}
                    {activeSession.run_count}
                  </p>
                </div>
                <div className={styles.sectionActions}>
                  {activeSession.status === "active" && (
                    <button
                      type="button"
                      className={styles.btnSecondary}
                      disabled={sessionAction || deletingSession}
                      onClick={archiveActiveSession}
                    >
                      <MIcon name="archive" size={16} />
                      封存
                    </button>
                  )}
                  <button
                    type="button"
                    className={styles.btnDanger}
                    disabled={sessionAction || deletingSession}
                    onClick={() => setDeleteSessionTarget(activeSession)}
                  >
                    <MIcon name="delete" size={16} />
                    刪除
                  </button>
                </div>
              </div>

              <div className={styles.subTabs}>
                {JUDGE_TABS.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    className={activeTab === tab.key ? styles.subTabActive : styles.subTab}
                    onClick={() => setActiveTab(tab.key)}
                  >
                    <MIcon name={tab.icon} size={16} />
                    {tab.label}
                  </button>
                ))}
              </div>

              {activeTab === "rubrics" && (
                <RubricsTab
                  key={activeSession.id}
                  classId={classId}
                  judgeSession={activeSession}
                  onSessionUpdated={updateSessionInList}
                  onScriptCreated={() => {
                    loadSessions();
                    setActiveTab("scripts");
                  }}
                />
              )}
              {activeTab === "scripts" && (
                <ScriptsTab
                  classId={classId}
                  sessionId={activeSession.id}
                  readOnly={activeSession.status === "archived"}
                  onScriptApproved={() => setActiveTab("execution")}
                />
              )}
              {activeTab === "execution" && (
                <ExecutionTab
                  classId={classId}
                  sessionId={activeSession.id}
                  readOnly={activeSession.status === "archived"}
                  members={members}
                />
              )}
            </>
          )}
        </section>
      </div>

      {deleteSessionTarget && (
        <ConfirmModal
          title="確認刪除檢查？"
          description={`「${deleteSessionTarget.title}」及其專屬評分表來源、對話、檢查腳本與執行紀錄將直接刪除，且無法復原；其他檢查不受影響。`}
          onClose={() => {
            if (!deletingSession) setDeleteSessionTarget(null);
          }}
          actions={
            <>
              <button
                type="button"
                className={styles.btnSecondary}
                disabled={deletingSession}
                onClick={() => setDeleteSessionTarget(null)}
              >
                取消
              </button>
              <button
                type="button"
                className={styles.btnDanger}
                disabled={deletingSession}
                onClick={deleteJudgeSession}
              >
                {deletingSession ? "刪除中..." : "確認刪除"}
              </button>
            </>
          }
        />
      )}
    </div>
  );
}

/* ── 導師工作區 ─────────────────────────────────────────── */

const TEACHER_JUDGE_TABS = [
  { key: "rubrics", label: "評分設定", icon: "description" },
  { key: "scripts", label: "檢查腳本", icon: "terminal" },
  { key: "execution", label: "執行與結果", icon: "play_circle_outline" },
];

function TeacherWorkspacePanel({ classId, members }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState("rubrics");
  const [sessions, setSessions] = useState([]);
  const [statusFilter, setStatusFilter] = useState("active");
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [creationView, setCreationView] = useState(null);
  const [blankCreationBusy, setBlankCreationBusy] = useState(false);
  const [blankCreationError, setBlankCreationError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [sourceOnly, setSourceOnly] = useState(false);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [busySessionIds, setBusySessionIds] = useState(() => new Set());
  const [renameTarget, setRenameTarget] = useState(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const requestVersionRef = useRef(0);
  const classIdRef = useRef(classId);

  const activeSession = useMemo(
    () => sessions.find((item) => item.id === activeSessionId) ?? null,
    [activeSessionId, sessions],
  );

  const loadSessions = useCallback(async () => {
    const requestVersion = ++requestVersionRef.current;
    const requestClassId = classId;
    setLoading(true);
    try {
      const rows = await AiJudgeService.listSessions(classId, statusFilter);
      if (requestVersion !== requestVersionRef.current || classIdRef.current !== requestClassId) return;
      setSessions(rows);
      setActiveSessionId((current) => resolveActiveSessionId(current, rows));
    } catch (error) {
      if (requestVersion === requestVersionRef.current && classIdRef.current === requestClassId) {
        setSessions([]);
        setActiveSessionId(null);
        toast.error(error?.message ?? "載入檢查失敗");
      }
    } finally {
      if (requestVersion === requestVersionRef.current && classIdRef.current === requestClassId) setLoading(false);
    }
  }, [classId, statusFilter, toast]);

  useEffect(() => {
    classIdRef.current = classId;
    setCreateOpen(false);
    setCreationView(null);
    setBlankCreationBusy(false);
    setBlankCreationError("");
    setSourceOnly(false);
    setRenameTarget(null);
    setDeleteTarget(null);
    setActiveSessionId(null);
    setOpenMenuId(null);
    loadSessions();
    return () => { requestVersionRef.current += 1; };
  }, [loadSessions]);

  useEffect(() => {
    setOpenMenuId(null);
  }, [activeSessionId, statusFilter]);

  useEffect(() => {
    if (!openMenuId) return undefined;
    const menuId = `check-menu-${openMenuId}`;
    const focusTimer = window.setTimeout(() => {
      document.getElementById(menuId)?.querySelector('[role="menuitem"]:not(:disabled)')?.focus();
    }, 0);
    function closeMenuOnOutsideClick(event) {
      const target = event.target;
      if (target instanceof Element && (target.closest(`#${menuId}`) || target.closest(`[aria-controls="${menuId}"]`))) return;
      setOpenMenuId(null);
    }
    function navigateMenu(event) {
      if (event.key === "Escape") {
        setOpenMenuId(null);
        return;
      }
      if (!event.key || !["ArrowDown", "ArrowUp"].includes(event.key)) return;
      const menu = document.getElementById(menuId);
      const items = menu ? [...menu.querySelectorAll('[role="menuitem"]:not(:disabled)')] : [];
      const currentIndex = items.indexOf(document.activeElement);
      if (!items.length) return;
      event.preventDefault();
      const nextIndex = event.key === "ArrowDown"
        ? (currentIndex + 1) % items.length
        : (currentIndex - 1 + items.length) % items.length;
      items[nextIndex].focus();
    }
    document.addEventListener("mousedown", closeMenuOnOutsideClick);
    document.addEventListener("keydown", navigateMenu);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("mousedown", closeMenuOnOutsideClick);
      document.removeEventListener("keydown", navigateMenu);
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.closest(`#${menuId}`)) {
        document.querySelector(`[aria-controls="${menuId}"]`)?.focus();
      }
    };
  }, [openMenuId]);

  function updateSessionInList(updated) {
    if (classIdRef.current !== classId) return;
    setSessions((current) => current.map((item) => item.id === updated.id ? updated : item));
  }

  async function handleCreationChoice(mode) {
    if (mode !== "blank") {
      setCreationView(mode);
      return;
    }
    if (blankCreationBusy) return;
    setBlankCreationBusy(true);
    setBlankCreationError("");
    try {
      const created = await AiJudgeService.createBlankSession(classId);
      handleCreated(created, "blank");
    } catch (error) {
      setBlankCreationError(error?.message ?? "無法開啟空白評分表，請稍後再試。");
    } finally {
      setBlankCreationBusy(false);
    }
  }

  function handleCreated(created, mode) {
    if (classIdRef.current !== classId) return;
    setCreateOpen(false);
    setCreationView(null);
    if (mode === "source" || mode === "source-blank") {
      if (!activeSession) return;
      const requestClassId = classId;
      AiJudgeService.updateSession(classId, activeSession.id, { selected_file_id: created.id })
         .then((updated) => {
           if (classIdRef.current !== requestClassId) return;
           updateSessionInList(updated);
           toast.success(`已選用「${created.display_name ?? created.original_filename ?? "評分表"}」。`);
           if (mode === "source-blank") {
             navigate(`/class-management/${classId}/ai/checks/${activeSession.id}/edit`);
           }
         })
        .catch((error) => {
          if (classIdRef.current === requestClassId) {
            toast.error(error?.message ?? "套用評分表來源失敗");
          }
        });
      setSourceOnly(false);
      return;
    }
    setStatusFilter("active");
    setSessions((current) => [created, ...current.filter((item) => item.id !== created.id)]);
    setActiveSessionId(created.id);
    setActiveTab("rubrics");
    toast.success(`已建立「${created.title}」`);
    if (mode === "blank") navigate(`/class-management/${classId}/ai/checks/${created.id}/edit`);
  }

  async function runSessionAction(item, action) {
    if (!item || busySessionIds.has(item.id)) return;
    const requestClassId = classId;
    setBusySessionIds((current) => new Set(current).add(item.id));
    setOpenMenuId(null);
    try {
      const updated = await action(item);
      if (classIdRef.current !== requestClassId) return null;
      if (updated) {
        if (updated.status !== statusFilter) {
          setSessions((current) => current.filter((entry) => entry.id !== item.id));
          if (item.id === activeSessionId) setActiveSessionId(null);
        } else {
          updateSessionInList(updated);
        }
      }
      return updated;
    } catch (error) {
      if (classIdRef.current === requestClassId) {
        toast.error(error?.message ?? "檢查操作失敗");
      }
      return null;
    } finally {
      setBusySessionIds((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
    }
  }

  async function pinSession(item) {
    await runSessionAction(item, (entry) => AiJudgeService.updateSession(classId, entry.id, { is_pinned: !entry.pinned_at }));
    loadSessions();
  }

  async function archiveSession(item) {
    const updated = await runSessionAction(item, (entry) => AiJudgeService.archiveSession(classId, entry.id));
    if (updated) toast.success(`「${item.title}」已移至已封存。`);
  }

  async function restoreSession(item) {
    const updated = await runSessionAction(item, (entry) => AiJudgeService.updateSession(classId, entry.id, { status: "active" }));
    if (updated) toast.success(`「${item.title}」已恢復至進行中。`);
  }

  async function forkSession(item) {
    const copy = await runSessionAction(item, (entry) => AiJudgeService.forkSession(classId, entry.id));
    if (!copy) return;
    setStatusFilter("active");
    setSessions((current) => [copy, ...current.filter((entry) => entry.id !== copy.id)]);
    setActiveSessionId(copy.id);
    setActiveTab("rubrics");
    toast.success(`已建立「${copy.title}」，可開始調整評分表。`);
  }

  async function renameSession(event) {
    event.preventDefault();
    if (!renameTarget || !renameTitle.trim()) return;
    const target = renameTarget;
    setRenameTarget(null);
    await runSessionAction(target, (entry) => AiJudgeService.updateSession(classId, entry.id, { title: renameTitle.trim() }));
  }

  async function deleteSession() {
    if (!deleteTarget) return;
    const requestClassId = classId;
    const targetId = deleteTarget.id;
    setDeleting(true);
    try {
      await AiJudgeService.deleteSession(requestClassId, targetId);
      if (classIdRef.current !== requestClassId) return;
      setSessions((current) => current.filter((item) => item.id !== deleteTarget.id));
      if (activeSessionId === deleteTarget.id) setActiveSessionId(null);
      setDeleteTarget(null);
      toast.success("檢查、專屬評分表來源、對話、腳本及執行紀錄已刪除。");
    } catch (error) {
      if (classIdRef.current === requestClassId) {
        toast.error(error?.message ?? "刪除檢查失敗");
      }
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeading}>
        <h2 className={styles.panelTitle}><MIcon name="checklist" size={20} />AI 檢查</h2>
        <p className={styles.panelDesc}>建立評分表、準備檢查腳本，並查看班級機器的執行結果。</p>
      </div>

      <div className={styles.sessionWorkspace}>
        <aside className={styles.sessionSidebar} aria-label="檢查清單">
           <button type="button" className={`${styles.btnPrimary} ${styles.newCheckButton}`} onClick={() => { setSourceOnly(false); setCreationView("choose"); }}><MIcon name="add" size={17} />新增檢查</button>
          <div className={styles.sessionFilters} role="tablist" aria-label="檢查狀態">
            {[["active", "進行中"], ["archived", "已封存"]].map(([status, label]) => <button key={status} type="button" role="tab" aria-selected={statusFilter === status} className={statusFilter === status ? styles.chipBtnActive : styles.chipBtn} onClick={() => { setCreationView(null); setStatusFilter(status); }}>{label}</button>)}
          </div>
          <div className={styles.sessionList} role="list">
            {loading ? <p className={styles.mutedText}>載入中…</p> : sessions.length === 0 ? <div className={styles.sidebarEmpty}><MIcon name="checklist" size={24} /><p>{statusFilter === "active" ? "尚未建立檢查。新增後可從零設計評分表，或使用已有文件。" : "目前沒有已封存的檢查。"}</p></div> : sessions.map((item) => {
              const selected = item.id === activeSessionId;
               const busy = busySessionIds.has(item.id);
               return (
                 <div key={item.id} className={`${styles.sessionRow} ${selected ? styles.sessionRowActive : ""}`} role="listitem">
                   <button type="button" className={selected ? styles.sessionItemActive : styles.sessionItem} aria-current={selected ? "true" : undefined} onClick={() => { setCreationView(null); setActiveSessionId(item.id); setOpenMenuId(null); }}>
                     <strong>{item.title}</strong>
                     <span>{item.selected_file_item_count === 0 ? "尚未新增評估項目" : item.selected_file_name ?? "尚未選擇評分表"} · {item.message_count ?? 0} 對話</span>
                     <small>{formatDateTime(item.last_activity_at)}</small>
                   </button>
                   <div className={styles.sessionRowActions}>
                     {statusFilter === "active" && <button type="button" className={`${styles.iconBtn} ${item.pinned_at ? styles.pinActive : ""}`} aria-label={item.pinned_at ? `取消釘選「${item.title}」` : `釘選「${item.title}」`} aria-pressed={Boolean(item.pinned_at)} title={item.pinned_at ? "取消釘選" : "釘選"} disabled={busy} onClick={(event) => { event.stopPropagation(); pinSession(item); }}><MIcon name="push_pin" filled={Boolean(item.pinned_at)} size={17} /></button>}
                     <button type="button" className={styles.iconBtn} aria-label={`更多「${item.title}」功能`} title="更多功能" aria-haspopup="menu" aria-expanded={openMenuId === item.id} aria-controls={`check-menu-${item.id}`} disabled={busy} onClick={(event) => { event.stopPropagation(); setOpenMenuId((current) => current === item.id ? null : item.id); }}><MIcon name="more_vert" size={18} /></button>
                     {openMenuId === item.id && <div id={`check-menu-${item.id}`} className={styles.sessionMenu} role="menu">
                       {item.status === "active" && <>
                         <button type="button" role="menuitem" disabled={busy} onClick={() => { setRenameTarget(item); setRenameTitle(item.title); setOpenMenuId(null); }}>重新命名</button>
                         <button type="button" role="menuitem" disabled={busy} onClick={() => pinSession(item)}>{item.pinned_at ? "取消釘選" : "釘選"}</button>
                       </>}
                       <button type="button" role="menuitem" disabled={busy} onClick={() => forkSession(item)}><MIcon name="fork_right" size={15} />重構</button>
                       <span className={styles.menuSeparator} />
                       {item.status === "active" ? <button type="button" role="menuitem" disabled={busy} onClick={() => archiveSession(item)}><MIcon name="archive" size={15} />封存</button> : <button type="button" role="menuitem" disabled={busy} onClick={() => restoreSession(item)}><MIcon name="unarchive" size={15} />還原至進行中</button>}
                       <button type="button" role="menuitem" className={styles.menuDanger} disabled={busy} onClick={() => { setDeleteTarget(item); setOpenMenuId(null); }}>刪除</button>
                     </div>}
                   </div>
                 </div>
               );
            })}
          </div>
        </aside>

        <section className={styles.sessionMain}>
          {creationView === "choose" ? <CreateCheckChooser onChoose={handleCreationChoice} busy={blankCreationBusy} error={blankCreationError} onCancel={() => { if (!blankCreationBusy) setCreationView(null); }} /> : creationView ? <CreateCheckForm key={creationView} classId={classId} embedded initialMode={creationView} onClose={() => setCreationView("choose")} onCreated={handleCreated} /> : !activeSession ? <div className={styles.card}><div className={styles.mainEmpty}><MIcon name="checklist" size={30} /><p>{statusFilter === "active" ? "請從左側選擇一項檢查，或新增檢查。" : "請選擇已封存的檢查查看內容與結果。"}</p><button type="button" className={styles.btnPrimary} onClick={() => statusFilter === "active" ? (setSourceOnly(false), setCreationView("choose")) : setStatusFilter("active")}>{statusFilter === "active" ? "新增檢查" : "查看進行中"}</button></div></div> : <>
            <div className={styles.sessionHeader}><div><h3>{activeSession.title}</h3><p>{activeSession.selected_file_name ?? "尚未選擇評分表"} · 對話 {activeSession.message_count ?? 0} · 腳本 {activeSession.script_count ?? 0} · 執行 {activeSession.run_count ?? 0}</p></div>{activeSession.status === "archived" && <span className={styles.archivedNotice}><MIcon name="lock" size={14} />這項檢查已封存，只能查看或複製</span>}</div>
            <div className={styles.subTabs} role="tablist" aria-label="檢查工作頁籤">{TEACHER_JUDGE_TABS.map((tab) => <button key={tab.key} type="button" role="tab" aria-selected={activeTab === tab.key} className={activeTab === tab.key ? styles.subTabActive : styles.subTab} onClick={() => setActiveTab(tab.key)}><MIcon name={tab.icon} size={16} />{tab.label}</button>)}</div>
            {activeTab === "rubrics" && <RubricsTab key={activeSession.id} classId={classId} judgeSession={activeSession} onSessionUpdated={updateSessionInList} onAddSource={() => { setSourceOnly(true); setCreateOpen(true); }} onScriptCreated={() => { loadSessions(); setActiveTab("scripts"); }} showFileLibrary={false} />}
            {activeTab === "scripts" && <ScriptsTab classId={classId} sessionId={activeSession.id} readOnly={activeSession.status === "archived"} onScriptApproved={() => setActiveTab("execution")} />}
            {activeTab === "execution" && <ExecutionTab classId={classId} sessionId={activeSession.id} readOnly={activeSession.status === "archived"} members={members} />}
          </>}
        </section>
      </div>

      {createOpen && <CreateCheckForm classId={classId} sourceOnly={sourceOnly} onClose={() => { setCreateOpen(false); setSourceOnly(false); }} onCreated={handleCreated} />}
       {renameTarget && <div className={styles.modalOverlay} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setRenameTarget(null); }}><form className={`${styles.confirm} ${styles.renameDialog}`} role="dialog" aria-modal="true" aria-labelledby="rename-check-title" onSubmit={renameSession}><div className={styles.modalHeader}><h2 id="rename-check-title">重新命名檢查</h2><button type="button" className={styles.iconBtn} aria-label="關閉" onClick={() => setRenameTarget(null)}><MIcon name="close" size={18} /></button></div><label className={styles.dialogField}><span>檢查名稱</span><input autoFocus value={renameTitle} maxLength={255} onChange={(event) => setRenameTitle(event.target.value)} /></label><div className={styles.modalActions}><button type="button" className={styles.btnSecondary} onClick={() => setRenameTarget(null)}>取消</button><button type="submit" className={styles.btnPrimary} disabled={!renameTitle.trim() || busySessionIds.has(renameTarget.id)}>儲存</button></div></form></div>}
      {deleteTarget && <ConfirmModal title="確認刪除檢查？" description={`「${deleteTarget.title}」及其專屬評分表來源、對話、檢查腳本與執行紀錄將直接刪除，且無法復原；其他檢查不受影響。`} onClose={() => { if (!deleting) setDeleteTarget(null); }} actions={<><button type="button" className={styles.btnSecondary} disabled={deleting} onClick={() => setDeleteTarget(null)}>取消</button><button type="button" className={styles.btnDanger} disabled={deleting} onClick={deleteSession}>{deleting ? "刪除中…" : "確認刪除"}</button></>} />}
    </div>
  );
}

export default function AiJudgePanel({ classId, members }) {
  return <TeacherWorkspacePanel classId={classId} members={members} />;
}
