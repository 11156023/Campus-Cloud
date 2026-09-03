import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import styles from "./AiJudgePanel.module.scss";
import LoadingState from "../../../components/LoadingState/LoadingState";
import MIcon from "../../../components/MIcon";
import { useToast } from "../../../hooks/useToast";
import useAutoRefresh from "../../../hooks/useAutoRefresh";
import useDialogPresence from "../../../hooks/useDialogPresence";
import { downloadBlob } from "../../../services/api";
import { focusInvalidField } from "../../../utils/focusField";
import { createRubricAnalysisAutosave } from "./rubricAnalysisAutosave";
import i18n from "../../../i18n";
import {
  AiJudgeService,
  RUBRIC_POLISH_PROMPT,
  RUBRIC_REASSESS_PROMPT,
  TEMPLATE_OPTIONS,
  getTemplateLabel,
  rubricToContext,
  shouldDisplayChatMessage,
} from "../../../services/aiJudge";

/* ── 共用小元件 ─────────────────────────────────────────── */

function Spinner({ size = 16 }) {
  return (
    <span className={styles.spinning}>
      <MIcon name="autorenew" size={size} />
    </span>
  );
}

/** 偵測方式標籤：auto=綠、partial=藍、manual=紅（不使用黃色警示色） */
const DETECTABLE_INFO_KEYS = {
  auto: { labelKey: "AiJudgePanel.detectableAuto", className: styles.detBadge_auto },
  partial: { labelKey: "AiJudgePanel.detectablePartial", className: styles.detBadge_partial },
  manual: { labelKey: "AiJudgePanel.detectableManual", className: styles.detBadge_manual },
};

function getDetectableInfo(detectable) {
  return DETECTABLE_INFO_KEYS[detectable] ?? DETECTABLE_INFO_KEYS.manual;
}

function formatDateTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("zh-TW");
}

const RUBRIC_FILE_EXTENSION = /\.(?:docx|pdf)$/i;

/**
 * 評分表的可讀名稱不應把匯入文件的副檔名帶進工作區標題；原始檔名仍
 * 保留在 `original_filename`，供衝突判斷與下載使用。
 */
export function getRubricDisplayName(file, fallback = i18n.t("AiJudgePanel.defaultRubricName", { ns: "teaching" })) {
  const rawName = typeof file === "string"
    ? file
    : [file?.name, file?.display_name, file?.original_filename]
      .find((value) => typeof value === "string" && value.trim());
  const title = String(rawName ?? "")
    .trim()
    .replace(RUBRIC_FILE_EXTENSION, "")
    .trim();
  return title || fallback;
}

export function getRubricCheckTitle(file) {
  return getRubricDisplayName(file, i18n.t("AiJudgePanel.unnamedCheckName", { ns: "teaching" })).slice(0, 255);
}

const SESSION_MENU_WIDTH = 220;
const SESSION_MENU_HEIGHT = 280;
const SESSION_MENU_MARGIN = 12;

/**
 * 將 session 的更多功能選單定位在觸發按鈕附近，同時限制在視窗可見範圍內。
 * 使用 fixed/portal 顯示時，這個位置不會受 session sidebar 的 overflow 影響。
 */
export function getSessionMenuPosition(anchorRect, options = {}) {
  const viewportWidth = options.width ?? (typeof window !== "undefined" ? window.innerWidth : 1024);
  const viewportHeight = options.height ?? (typeof window !== "undefined" ? window.innerHeight : 768);
  const menuWidth = options.menuWidth ?? SESSION_MENU_WIDTH;
  const menuHeight = options.menuHeight ?? SESSION_MENU_HEIGHT;
  const margin = options.margin ?? SESSION_MENU_MARGIN;
  const maxLeft = Math.max(margin, viewportWidth - menuWidth - margin);
  const preferredLeft = anchorRect.right - menuWidth;
  const left = Math.min(Math.max(margin, preferredLeft), maxLeft);
  const belowTop = anchorRect.bottom + margin;
  const aboveTop = anchorRect.top - menuHeight - margin;
  const fitsBelow = belowTop + menuHeight <= viewportHeight - margin;
  const fitsAbove = aboveTop >= margin;
  const preferredTop = fitsBelow ? belowTop : fitsAbove ? aboveTop : belowTop;
  const maxTop = Math.max(margin, viewportHeight - menuHeight - margin);
  const top = Math.min(Math.max(margin, preferredTop), maxTop);
  return { top: Math.round(top), left: Math.round(left) };
}

function proposalOperationLabel(item) {
  const operation = item.operation ?? item.action;
  if (operation === "delete" || operation === "remove") return i18n.t("AiJudgePanel.opDelete", { ns: "teaching" });
  if (operation === "update" || operation === "modify") return i18n.t("AiJudgePanel.opUpdate", { ns: "teaching" });
  return item.id ? i18n.t("AiJudgePanel.opUpdate", { ns: "teaching" }) : i18n.t("AiJudgePanel.opAdd", { ns: "teaching" });
}

function comparableItem(item) {
  return JSON.stringify({
    title: item.title ?? "",
    description: item.description ?? "",
    checked: Boolean(item.checked),
    detectable: item.detectable ?? "manual",
    detection_method: item.detection_method ?? null,
    fallback: item.fallback ?? null,
    check_steps: item.check_steps ?? [],
  });
}

/**
 * 將 AI 回傳的完整項目清單轉成可逐項確認的差異；未出現在回應中的
 * 既有項目保留，只有 AI 明確標示 delete/remove 才會刪除。
 */
export function buildProposalDiff(currentItems, proposedItems) {
  const currentById = new Map(currentItems.map((item) => [item.id, item]));
  const changes = [];
  (Array.isArray(proposedItems) ? proposedItems : []).forEach((rawItem) => {
    const item = { ...rawItem };
    const operation = item.operation ?? item.action;
    if (operation === "delete" || operation === "remove") {
      if (item.id && currentById.has(item.id)) changes.push({ ...item, operation: "delete" });
      return;
    }
    if (!item.id || !currentById.has(item.id)) {
      changes.push({ ...item, operation: "add" });
      return;
    }
    if (comparableItem(currentById.get(item.id)) !== comparableItem(item)) {
      changes.push({ ...item, operation: "update" });
    }
  });
  return changes;
}

function ProposalPanel({ proposal, selectedIds, onToggle, onApply, onSkip, disabled, isReassessment = false }) {
  const { t } = useTranslation("teaching");
  if (!proposal?.length) return null;
  return (
    <div className={styles.proposalCard}>
      <div className={styles.proposalHeading}>
        <div>
          <strong>{isReassessment ? t("AiJudgePanel.reassessCompleteTitle", { count: proposal.length }) : t("AiJudgePanel.aiProposalTitle")}</strong>
          <p>{isReassessment ? t("AiJudgePanel.reassessApplyHint") : t("AiJudgePanel.proposalApplyHint")}</p>
        </div>
        <span>{t("AiJudgePanel.selectedCountUnit", { selected: selectedIds.size, total: proposal.length })}</span>
      </div>
      <div className={styles.proposalList}>
        {proposal.map((item, index) => {
          const id = item.id ?? `proposal-${index}`;
          return (
            <label className={styles.proposalRow} key={id}>
              <input
                type="checkbox"
                checked={selectedIds.has(id)}
                disabled={disabled}
                onChange={() => onToggle(id)}
              />
              <span>
                <b>{item.title || t("AiJudgePanel.unnamedItemFallback")}</b>
                <small><em>{proposalOperationLabel(item)}</em>{item.description || t("AiJudgePanel.aiSuggestDefaultDesc")}</small>
              </span>
            </label>
          );
        })}
      </div>
      <div className={styles.proposalActions}>
        <button type="button" className={styles.btnSecondary} disabled={disabled} onClick={onSkip}>{t("AiJudgePanel.skipBtn")}</button>
        <button type="button" className={styles.btnPrimary} disabled={disabled || selectedIds.size === 0} onClick={onApply}>{t("AiJudgePanel.applySelectedBtn")}</button>
      </div>
    </div>
  );
}

/* ── 評分表統計 ─────────────────────────────────────────── */

export function RubricStats({
  items,
  needsReview = false,
  isReassessing = false,
  onReassess,
  readOnly = false,
}) {
  const { t } = useTranslation("teaching");
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
            <h4>{t("AiJudgePanel.autoDetectAvailability")}</h4>
            <span
              className={needsReview ? styles.assessmentStatus_stale : styles.assessmentStatus_current}
            >
              {needsReview ? t("AiJudgePanel.needsReassessLabel") : t("AiJudgePanel.resultsUpToDateLabel")}
            </span>
          </div>
          <p aria-live="polite">
            {needsReview
              ? t("AiJudgePanel.needsReassessDesc")
              : t("AiJudgePanel.currentDetectDesc")}
          </p>
        </div>
        {!readOnly && onReassess && (
          <button
            type="button"
            className={needsReview ? styles.btnPrimary : styles.btnSecondary}
            onClick={onReassess}
            disabled={isReassessing || total === 0}
            title={total === 0 ? t("AiJudgePanel.needAtLeastOneItem") : undefined}
          >
            {isReassessing ? <Spinner size={15} /> : <MIcon name="refresh" size={16} />}
            {isReassessing ? t("AiJudgePanel.reassessingLabel") : t("AiJudgePanel.reassessBtn")}
          </button>
        )}
      </div>
      <div
        className={styles.statsBar}
        role="img"
        aria-label={t("AiJudgePanel.statsBarAria", { total, autoPct: pct(autoCount), partialPct: pct(partialCount), manualPct: pct(manualCount) })}
      >
        {autoCount > 0 && <span className={styles.statsSeg_auto} style={{ flexGrow: autoCount }} />}
        {partialCount > 0 && <span className={styles.statsSeg_partial} style={{ flexGrow: partialCount }} />}
        {manualCount > 0 && <span className={styles.statsSeg_manual} style={{ flexGrow: manualCount }} />}
      </div>
      <div className={styles.statsLegend}>
        <span className={styles.legendItem}>
          <i className={styles.legendDot_auto} />
          {t("AiJudgePanel.legendAuto", { count: autoCount, pct: pct(autoCount) })}
        </span>
        <span className={styles.legendItem}>
          <i className={styles.legendDot_partial} />
          {t("AiJudgePanel.legendPartial", { count: partialCount, pct: pct(partialCount) })}
        </span>
        <span className={styles.legendItem}>
          <i className={styles.legendDot_manual} />
          {t("AiJudgePanel.legendManual", { count: manualCount, pct: pct(manualCount) })}
        </span>
        <span className={styles.legendTotal}>{t("AiJudgePanel.legendTotal", { total })}</span>
      </div>
    </div>
  );
}

/* ── 單一評分項目卡片 ───────────────────────────────────── */

function RubricCard({ item, index, onChange, onDelete, disabled }) {
  const { t } = useTranslation("teaching");
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
            {t(detectableInfo.labelKey)}
          </span>
        </div>
        <button
          type="button"
          className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
          title={t("AiJudgePanel.deleteItemTitle")}
          onClick={onDelete}
          disabled={disabled}
        >
          <MIcon name="delete" size={16} />
        </button>
      </div>

      <label className={styles.rubricField}>
        <span>{t("AiJudgePanel.fieldTopic")}</span>
        <input
          value={item.title}
          onChange={(e) => onChange({ ...item, title: e.target.value })}
          placeholder={t("AiJudgePanel.itemNamePlaceholder")}
          disabled={disabled}
        />
      </label>

      <label className={styles.rubricField}>
        <span>{t("AiJudgePanel.fieldDescription")}</span>
        <input
          value={item.description}
          onChange={(e) => onChange({ ...item, description: e.target.value })}
          placeholder={t("AiJudgePanel.descPlaceholder")}
          disabled={disabled}
        />
      </label>

      {(item.detection_method || item.fallback || checkSteps.length > 0) && (
        <div className={styles.detectInfo}>
          <div className={styles.detectInfoHead}>
            <MIcon name="security" size={14} />
            {t("AiJudgePanel.aiDetectJudgeHeader")}
          </div>
          <div className={styles.detectGrid}>
            {item.detection_method && (
              <div className={styles.detectItem}>
                <span>{t("AiJudgePanel.detectMethodLabel")}</span>
                <p>{item.detection_method}</p>
              </div>
            )}
            {item.fallback && (
              <div className={styles.detectItem}>
                <span>{t("AiJudgePanel.fallbackSuggestionLabel")}</span>
                <p>{item.fallback}</p>
              </div>
            )}
          </div>
          {checkSteps.length > 0 && (
            <div className={styles.detectItem}>
              <span>{t("AiJudgePanel.checkPlanLabel")}</span>
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

function RubricUploader({ onUpload, onInvalidFile, isLoading }) {
  const { t } = useTranslation("teaching");
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);

  function selectFile(file) {
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext !== "docx" && ext !== "pdf") {
      onInvalidFile?.(t("AiJudgePanel.onlyDocxPdfError"));
      return;
    }
    setSelectedFile(file);
  }

  function handleDrop(e) {
    e.preventDefault();
    setIsDragging(false);
    selectFile(e.dataTransfer.files?.[0]);
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
            selectFile(e.target.files?.[0]);
            e.target.value = "";
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
              aria-label={t("AiJudgePanel.clearSelectionAria")}
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
            <p className={styles.dropHintTitle}>{t("AiJudgePanel.dropHintTitle")}</p>
            <p className={styles.dropHintMeta}>{t("AiJudgePanel.dropHintMeta")}</p>
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
              {t("AiJudgePanel.aiAnalyzingLabel")}
            </>
          ) : (
            <>
              <MIcon name="upload" size={16} />
              {t("AiJudgePanel.uploadAndAnalyzeBtn")}
            </>
          )}
        </button>
      )}
    </div>
  );
}

/* ── AI 對話面板 ────────────────────────────────────────── */

export function ChatPanel({
  messages,
  onSendMessage,
  onClearMessages = () => {},
  isLoading,
  isClearing = false,
  disabled = false,
  hasRubric = false,
}) {
  const { t } = useTranslation("teaching");
  const [input, setInput] = useState("");
  const messagesEndRef = useRef(null);
  const visibleMessages = messages.filter(shouldDisplayChatMessage);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  function send() {
    const content = input.trim();
    if (!content || isLoading || isClearing || disabled) return;
    onSendMessage(content);
    setInput("");
  }

  return (
    <div className={styles.chatPanel}>
      <div className={styles.chatMessages}>
        {visibleMessages.length === 0 ? (
          <div className={styles.chatEmpty}>
            <MIcon name="smart_toy" size={32} />
            <p>{hasRubric ? t("AiJudgePanel.chatEmptyWithRubric") : t("AiJudgePanel.chatEmptyNoRubric")}</p>
            <p className={styles.chatEmptyMeta}>
              {hasRubric
                ? t("AiJudgePanel.chatEmptyMetaWithRubric")
                : t("AiJudgePanel.chatEmptyMetaNoRubric")}
            </p>
          </div>
        ) : (
          visibleMessages.map((msg, i) => (
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
        <div className={styles.chatActions}>
          <button
            type="button"
            className={styles.btnSecondary}
            disabled={isLoading || isClearing || disabled || !hasRubric}
            onClick={() => onSendMessage(RUBRIC_POLISH_PROMPT, true)}
          >
            {isLoading ? <Spinner size={14} /> : <MIcon name="auto_fix_high" size={14} />}
            {t("AiJudgePanel.polishRubricBtn")}
          </button>
          <button
            type="button"
            className={styles.btnSecondary}
            disabled={isLoading || isClearing || disabled || messages.length === 0}
            onClick={onClearMessages}
          >
            {isClearing ? <Spinner size={14} /> : <MIcon name="delete_sweep" size={14} />}
            {t("AiJudgePanel.clearContentBtn")}
          </button>
        </div>
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
                ? t("AiJudgePanel.chatInputPlaceholderWithRubric")
                : t("AiJudgePanel.chatInputPlaceholderNoRubric")
            }
            rows={1}
            disabled={isLoading || isClearing || disabled}
          />
          <button
            type="submit"
            className={styles.btnPrimary}
            disabled={isLoading || isClearing || disabled || !input.trim()}
            aria-label={t("AiJudgePanel.sendAria")}
          >
            <MIcon name="send" size={16} />
          </button>
        </form>
        <p className={styles.chatHint}>
          {hasRubric
            ? t("AiJudgePanel.chatHintWithRubric")
            : t("AiJudgePanel.chatHintNoRubric")}
        </p>
      </div>
    </div>
  );
}

/* ── 確認 Modal（覆蓋/副本、刪除） ──────────────────────── */

function ConfirmModal({ title, description, actions, closing = false, onClose }) {
  return (
    <div
      className={`${styles.modalOverlay} ${closing ? styles.modalOverlayOut : ""}`}
      onMouseDown={onClose}
    >
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
  weeks = [],
  sourceOnly = false,
  embedded = false,
  initialMode = "",
  closing = false,
  onClose,
  onCreated,
}) {
  const { t } = useTranslation("teaching");
  const toast = useToast();
  const requestVersionRef = useRef(0);
  const availableWeeks = weeks.filter((week) => week.title?.trim());
  const [selectedWeekId, setSelectedWeekId] = useState(
    availableWeeks[0]?.id ?? "",
  );
  const [mode, setMode] = useState(initialMode);
  const [rubricName, setRubricName] = useState("");
  const [environmentKeys, setEnvironmentKeys] = useState(() => (
    initialMode === "existing" ? ["linux"] : []
  ));
  const [files, setFiles] = useState([]);
  const [selectedFileId, setSelectedFileId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [conflictFile, setConflictFile] = useState(null);
  const [invalid, setInvalid] = useState({});
  const weekSelectRef = useRef(null);
  const modeGroupRef = useRef(null);
  const rubricNameRef = useRef(null);
  const envGroupRef = useRef(null);
  const existingListRef = useRef(null);

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
          setError(t("AiJudgePanel.loadSavedRubricsFailed"));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [classId, t]);

  function toggleEnvironment(key) {
    setEnvironmentKeys((current) => current.includes(key)
      ? current.filter((item) => item !== key)
      : [...current, key]);
    setInvalid((v) => ({ ...v, envKeys: false }));
  }

  function handleModeChange(nextMode) {
    setMode(nextMode);
    setInvalid((v) => ({ ...v, mode: false }));
    if (nextMode === "existing") {
      setEnvironmentKeys((current) => current.length ? current : ["linux"]);
    }
  }

  async function uploadFile(file, conflictStrategy = null) {
    if (!file) return;
    if (!sourceOnly && !selectedWeekId) {
      setError(t("AiJudgePanel.selectWeekFirst"));
      setInvalid((v) => ({ ...v, week: true }));
      focusInvalidField(weekSelectRef.current);
      return;
    }
    const requestVersion = requestVersionRef.current;
    setUploading(true);
    setError("");
    try {
      const result = await AiJudgeService.uploadFile(
        classId,
        file,
        environmentKeys[0] ?? "linux",
        conflictStrategy,
        environmentKeys,
      );
      if (requestVersion !== requestVersionRef.current) return;
      const uploaded = result.file ?? { ...result, analysis_json: result.analysis };
      setFiles((current) => [uploaded, ...current.filter((item) => item.id !== uploaded.id)]);
      setSelectedFileId(uploaded.id);
      setEnvironmentKeys(uploaded.environment_keys?.length ? uploaded.environment_keys : [uploaded.template_key]);
      setConflictFile(null);
      if (!sourceOnly) {
        setCreating(true);
        try {
          const created = await AiJudgeService.createSession(classId, {
            title: getRubricCheckTitle({
              name: file.name,
              original_filename: uploaded.original_filename,
              display_name: uploaded.display_name,
            }),
            creationMode: "existing",
            selectedFileId: uploaded.id,
            teachingClassWeekId: selectedWeekId,
          });
          if (requestVersion === requestVersionRef.current) onCreated(created, "uploaded");
        } catch (createError) {
          setError(t("AiJudgePanel.analysisDoneCreateFailed", { message: createError?.message ?? t("AiJudgePanel.tryAgainLaterFallback") }));
        } finally {
          setCreating(false);
        }
      }
    } catch (uploadError) {
      if (requestVersion !== requestVersionRef.current) return;
      if (uploadError?.status === 409) {
        setConflictFile(file);
        setError(t("AiJudgePanel.duplicateFileConfirm"));
      } else {
        setError(uploadError?.message ?? t("AiJudgePanel.uploadRubricFailed"));
      }
    } finally {
      if (requestVersion === requestVersionRef.current) setUploading(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    const missing = {
      week: !sourceOnly && !selectedWeekId,
      mode: !mode,
      rubricName: mode === "blank" && !rubricName.trim(),
      envKeys: mode === "blank" && !environmentKeys.length,
      file: mode === "existing" && !selectedFileId,
    };
    if (Object.values(missing).some(Boolean)) {
      setInvalid(missing);
      if (missing.week) focusInvalidField(weekSelectRef.current);
      else if (missing.mode) focusInvalidField(modeGroupRef.current?.querySelector("input"));
      else if (missing.rubricName) focusInvalidField(rubricNameRef.current);
      else if (missing.envKeys) focusInvalidField(envGroupRef.current?.querySelector("input"));
      else focusInvalidField(existingListRef.current?.querySelector("input"));
      return;
    }
    setCreating(true);
    setError("");
    try {
      if (sourceOnly) {
        const file = mode === "blank"
          ? await AiJudgeService.createBlankFile(classId, { displayName: rubricName, environmentKeys })
          : files.find((entry) => entry.id === selectedFileId);
        if (!file?.id) throw new Error(t("AiJudgePanel.selectOrCreateSourceError"));
         onCreated(file, sourceOnly && mode === "blank" ? "source-blank" : "source");
      } else {
        const created = await AiJudgeService.createSession(classId, {
          title: mode === "blank"
            ? getRubricCheckTitle({ name: rubricName })
            : getRubricCheckTitle(files.find((entry) => entry.id === selectedFileId)),
          creationMode: mode,
          rubricName: mode === "blank" ? rubricName : undefined,
          environmentKeys: mode === "blank" ? environmentKeys : undefined,
          selectedFileId: mode === "existing" ? selectedFileId : null,
          teachingClassWeekId: selectedWeekId,
        });
        onCreated(created, mode);
      }
    } catch (createError) {
      setError(createError?.message ?? t("AiJudgePanel.createCheckFailedGeneric"));
    } finally {
      setCreating(false);
    }
  }

  const form = (
      <section className={embedded ? styles.createCheckPanel : `${styles.confirm} ${styles.createCheckDialog}`} role={embedded ? undefined : "dialog"} aria-modal={embedded ? undefined : "true"} aria-labelledby="create-check-title">
        <div className={styles.modalHeader}><div>{embedded && <button type="button" className={styles.inlineBackButton} disabled={creating || uploading} onClick={onClose}><MIcon name="arrow_back" size={17} />{t("AiJudgePanel.backToCreateMode")}</button>}<h2 id="create-check-title">{sourceOnly ? t("AiJudgePanel.addSourceTitle") : mode === "blank" ? t("AiJudgePanel.fromScratchTitle") : t("AiJudgePanel.useExistingFileTitle")}</h2><p>{sourceOnly ? t("AiJudgePanel.addSourceDesc") : mode === "blank" ? t("AiJudgePanel.blankCreatedDesc") : t("AiJudgePanel.existingFileDesc")}</p></div>{!embedded && <button type="button" className={styles.iconBtn} aria-label={t("AiJudgePanel.closeAria")} disabled={creating || uploading} onClick={onClose}><MIcon name="close" size={18} /></button>}</div>
        <form onSubmit={submit}>
          {!sourceOnly && <label className={styles.dialogField}><span>{t("AiJudgePanel.whichWeekLabel")}</span><select ref={weekSelectRef} className={invalid.week ? styles.fieldInvalid : undefined} value={selectedWeekId} onChange={(event) => { setSelectedWeekId(event.target.value); setInvalid((v) => ({ ...v, week: false })); }}><option value="" disabled>{availableWeeks.length ? t("AiJudgePanel.selectWeekOption") : t("AiJudgePanel.needNamedWeekFirst")}</option>{availableWeeks.map((week) => <option key={week.id} value={week.id}>{t("AiJudgePanel.weekOptionLabel", { week: week.week ?? week.week_number, title: week.title })}{["published", "completed"].includes(week.status) ? "" : t("AiJudgePanel.draftSuffix")}</option>)}</select><small>{t("AiJudgePanel.checkpointVisibilityHint")}</small></label>}
          {!embedded && <fieldset className={styles.modeFieldset}><legend>{t("AiJudgePanel.howToCreateRubricLegend")}</legend><div ref={modeGroupRef} className={`${styles.modeChoices} ${invalid.mode ? styles.groupInvalid : ""}`}><label className={mode === "blank" ? styles.modeChoiceActive : styles.modeChoice}><input type="radio" name="creation-mode" checked={mode === "blank"} onChange={() => handleModeChange("blank")} /><span><b>{t("AiJudgePanel.fromScratchTitle")}</b><small>{t("AiJudgePanel.fromScratchDesc")}</small></span></label><label className={mode === "existing" ? styles.modeChoiceActive : styles.modeChoice}><input type="radio" name="creation-mode" checked={mode === "existing"} onChange={() => handleModeChange("existing")} /><span><b>{t("AiJudgePanel.useExistingFileTitle")}</b><small>{t("AiJudgePanel.useExistingFileDesc")}</small></span></label></div></fieldset>}
           {mode === "blank" && <div className={styles.modeFields}><label className={styles.dialogField}><span>{t("AiJudgePanel.rubricNameLabel")}</span><input ref={rubricNameRef} className={invalid.rubricName ? styles.fieldInvalid : undefined} autoFocus={sourceOnly} value={rubricName} maxLength={255} placeholder={t("AiJudgePanel.rubricNamePlaceholder")} onChange={(event) => { setRubricName(event.target.value); setInvalid((v) => ({ ...v, rubricName: false })); }} /></label><fieldset className={styles.modeFieldset}><legend>{t("AiJudgePanel.envMultiSelectLegend")}</legend><div ref={envGroupRef} className={`${styles.dialogChips} ${invalid.envKeys ? styles.groupInvalid : ""}`}>{TEMPLATE_OPTIONS.map((option) => <label key={option.key} className={environmentKeys.includes(option.key) ? styles.dialogChipActive : styles.dialogChip}><input type="checkbox" checked={environmentKeys.includes(option.key)} onChange={() => toggleEnvironment(option.key)} />{option.label}</label>)}</div></fieldset></div>}
           {mode === "existing" && <div className={styles.existingPicker}>
             <div className={styles.uploadSourceBlock}>
               <div className={styles.existingPickerHead}><div><span>{t("AiJudgePanel.uploadNewFileLabel")}</span><small>{t("AiJudgePanel.uploadNewFileHint")}</small></div></div>
               <fieldset className={styles.modeFieldset}>
                 <legend>{t("AiJudgePanel.envMultiSelectLegend")}</legend>
                 <p className={styles.uploadEnvironmentHint}>{t("AiJudgePanel.primaryEnvHint")}</p>
                 <div className={styles.dialogChips}>{TEMPLATE_OPTIONS.map((option) => <label key={option.key} className={environmentKeys.includes(option.key) ? styles.dialogChipActive : styles.dialogChip}><input type="checkbox" checked={environmentKeys.includes(option.key)} onChange={() => toggleEnvironment(option.key)} disabled={uploading || creating} />{option.label}</label>)}</div>
               </fieldset>
               <RubricUploader onUpload={(file) => uploadFile(file)} onInvalidFile={setError} isLoading={uploading || creating || (!sourceOnly && !selectedWeekId)} />
             </div>
              <div className={styles.savedRubricBlock}><div className={styles.existingPickerHead}><div><span>{t("AiJudgePanel.orSelectSavedLabel")}</span><small>{t("AiJudgePanel.oneSourcePerCheckHint")}</small></div></div>{files.length ? <div ref={existingListRef} className={`${styles.existingList} ${invalid.file ? styles.groupInvalid : ""}`}>{files.map((file) => <label key={file.id} className={selectedFileId === file.id ? styles.existingRowActive : styles.existingRow}><input type="radio" name="saved-rubric" checked={selectedFileId === file.id} onChange={() => { setSelectedFileId(file.id); setInvalid((v) => ({ ...v, file: false })); }} /><span><b>{getRubricDisplayName(file, t("AiJudgePanel.unnamedRubricFallback"))}</b><small>{(file.environment_keys?.length ? file.environment_keys : [file.template_key]).map(getTemplateLabel).join("、")} · {t("AiJudgePanel.itemsCountUnit", { count: file.analysis_json?.items?.length ?? 0 })} · {formatDateTime(file.updated_at)}</small></span></label>)}</div> : <p className={styles.mutedText}>{t("AiJudgePanel.noSavedRubricsText")}</p>}</div>
             {conflictFile && <div className={styles.conflictActions} role="alert"><span>{t("AiJudgePanel.alreadyExistsLabel", { name: conflictFile.name })}</span><button type="button" className={styles.btnSecondary} disabled={uploading || creating} onClick={() => uploadFile(conflictFile, "copy")}>{t("AiJudgePanel.createCopyBtn")}</button><button type="button" className={styles.btnDanger} disabled={uploading || creating} onClick={() => uploadFile(conflictFile, "overwrite")}>{t("AiJudgePanel.overwriteBtn")}</button><button type="button" className={styles.iconBtn} aria-label={t("AiJudgePanel.cancelConflictAria")} onClick={() => setConflictFile(null)}><MIcon name="close" size={16} /></button></div>}
           </div>}
          {error && <p className={styles.dialogError} role="alert">{error}</p>}
          <div className={styles.modalActions}>{!embedded && <button type="button" className={styles.btnSecondary} disabled={creating || uploading} onClick={onClose}>{t("AiJudgePanel.cancelBtn")}</button>}{mode !== "existing" || sourceOnly ? <button type="submit" className={styles.btnPrimary} disabled={creating || uploading}>{creating ? <><Spinner size={15} />{t("AiJudgePanel.creatingEllipsis2")}</> : sourceOnly ? t("AiJudgePanel.addSourceBtn") : mode === "blank" ? t("AiJudgePanel.createCheckBtn") : t("AiJudgePanel.useThisRubricBtn")}</button> : <p className={styles.uploadAutoHint}>{t("AiJudgePanel.selectFileThenUploadHint")}</p>}</div>
        </form>
      </section>
  );

  if (embedded) return form;
  return <div className={`${styles.modalOverlay} ${closing ? styles.modalOverlayOut : ""}`} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !creating && !uploading) onClose(); }}>{form}</div>;
}

export function CreateCheckChooser({ onChoose, onCancel, busy = false, error = "" }) {
  const { t } = useTranslation("teaching");
  return (
    <section className={styles.createChooser} aria-labelledby="create-check-choice-title">
      <div className={styles.createChooserHeader}>
        <div className={styles.createChooserHeading}>
          <h2 id="create-check-choice-title">{t("AiJudgePanel.addCheckTitle")}</h2>
          <p>{t("AiJudgePanel.chooseModeDesc")}</p>
        </div>
        <button type="button" className={styles.btnSecondary} disabled={busy} onClick={onCancel}>{t("AiJudgePanel.backToCurrentCheckBtn")}</button>
      </div>
      {error && <p className={styles.dialogError} role="alert">{error}</p>}
      <div className={styles.createChoiceGrid}>
        <button type="button" className={styles.createChoice} disabled={busy} onClick={() => onChoose("blank")}>
          <span className={styles.createChoiceIcon}><MIcon name="edit_note" size={30} /></span>
          <span className={styles.createChoiceCopy}><strong>{t("AiJudgePanel.fromScratchTitle")}</strong><small>{t("AiJudgePanel.fromScratchLongDesc")}</small></span>
          <span className={styles.createChoiceAction}>{busy ? t("AiJudgePanel.openingBlankPage") : t("AiJudgePanel.startDesigningBtn")}<MIcon name={busy ? "sync" : "arrow_forward"} size={18} /></span>
        </button>
        <button type="button" className={styles.createChoice} disabled={busy} onClick={() => onChoose("existing")}>
          <span className={styles.createChoiceIcon}><MIcon name="upload_file" size={30} /></span>
          <span className={styles.createChoiceCopy}><strong>{t("AiJudgePanel.useExistingFileTitle")}</strong><small>{t("AiJudgePanel.useExistingLongDesc")}</small></span>
          <span className={styles.createChoiceAction}>{t("AiJudgePanel.chooseFileBtn")}<MIcon name="arrow_forward" size={18} /></span>
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
  const { t } = useTranslation("teaching");
  const toast = useToast();
  const sourceRailRef = useRef(null);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  // 來源選單離場動畫：關閉時保留最後開啟的列 130ms
  const sourceMenuKeep = useDialogPresence(openMenuId, 130);
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
    catch (error) { toast.error(error?.message ?? t("AiJudgePanel.loadSourcesFailed")); }
    finally { setLoading(false); }
  }, [classId, selectedFileId, toast, t]);
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
    } catch (error) { toast.error(error?.message ?? t("AiJudgePanel.switchSourceFailed")); }
    finally { setBusyId(null); }
  }

  async function download(file) {
    try { const blob = await AiJudgeService.downloadFile(classId, file.id); downloadBlob(blob, file.original_filename ?? `${getRubricDisplayName(file)}.pdf`); }
    catch (error) { toast.error(error?.message ?? t("AiJudgePanel.downloadRubricFailed")); }
    finally { setOpenMenuId(null); }
  }

  async function remove(file) {
    if (!window.confirm(t("AiJudgePanel.confirmDeleteSourceMsg", { name: getRubricDisplayName(file) }))) return;
    setBusyId(file.id);
    try {
      await AiJudgeService.deleteFile(classId, file.id);
      setFiles((current) => current.filter((entry) => entry.id !== file.id));
      if (file.id === judgeSession?.selected_file_id) onSessionUpdated(await AiJudgeService.getSession(classId, judgeSession.id));
      toast.success(t("AiJudgePanel.sourceDeletedToast"));
    } catch (error) { toast.error(error?.message ?? t("AiJudgePanel.deleteSourceFailed")); }
    finally { setBusyId(null); setOpenMenuId(null); }
  }

  const activeFiles = files.filter((file) => file.status === "active");
  const selectedFile = getSelectedRubricSource(files, selectedFileId);
  const visibleFiles = getVisibleRubricSources(files, selectedFileId, showOtherSources);
  return (
    <aside ref={sourceRailRef} className={styles.sourceRail} aria-label={t("AiJudgePanel.rubricSourcesLabel")}>
      <div className={styles.sourceRailHead}>
        <div>
          <h3>{t("AiJudgePanel.rubricSourcesLabel")}</h3>
          <p>{loading ? t("AiJudgePanel.confirmingSourceText") : selectedFile ? t("AiJudgePanel.currentSourceUsedText") : t("AiJudgePanel.noSourceSelectedText")}</p>
        </div>
        <div className={styles.sourceRailActions}>
          {!readOnly && selectedFile && activeFiles.length > 1 && <button type="button" className={styles.btnSecondary} aria-expanded={showOtherSources} onClick={() => setShowOtherSources((current) => !current)}>{showOtherSources ? t("AiJudgePanel.onlyCurrentSourceBtn") : t("AiJudgePanel.switchSourceBtn")}</button>}
          {!readOnly && <button type="button" className={styles.iconBtn} aria-label={t("AiJudgePanel.addSourceAria")} title={t("AiJudgePanel.addSourceAria")} onClick={onAddSource}><MIcon name="add" size={19} /></button>}
        </div>
      </div>
      {loading ? <p className={styles.mutedText}>{t("AiJudgePanel.loadingSourcesText")}</p> : visibleFiles.length > 0 ? (
        <div className={styles.sourceList}>
           {visibleFiles.map((file) => <div key={file.id} className={`${styles.sourceRow} ${file.id === selectedFileId ? styles.sourceRowSelected : ""}`}><button type="button" className={styles.sourceSelect} disabled={readOnly || busyId === file.id} onClick={() => selectFile(file)}><span className={styles.sourceIndicator} aria-hidden="true"><MIcon name={file.id === selectedFileId ? "radio_button_checked" : "radio_button_unchecked"} size={17} /></span><span className={styles.sourceText}><b>{getRubricDisplayName(file, t("AiJudgePanel.unnamedRubricFallback"))}</b><small>{(file.environment_keys?.length ? file.environment_keys : [file.template_key]).map(getTemplateLabel).join("、")} · {t("AiJudgePanel.itemsCountUnit", { count: file.analysis_json?.items?.length ?? 0 })} · {formatDateTime(file.updated_at)} · {file.source_type === "created" ? t("AiJudgePanel.createdInSystemLabel") : t("AiJudgePanel.uploadedLabel")}</small>{file.id === selectedFileId && <em>{t("AiJudgePanel.selectedInUseLabel")}</em>}</span></button>{(file.source_type !== "created" || !readOnly) && <div className={styles.sourceActions}><button type="button" className={styles.iconBtn} aria-label={t("AiJudgePanel.manageSourceAria", { name: getRubricDisplayName(file) })} title={t("AiJudgePanel.manageSourceTitle")} aria-haspopup="menu" aria-expanded={openMenuId === file.id} onClick={(event) => { event.stopPropagation(); setOpenMenuId((current) => current === file.id ? null : file.id); }}><MIcon name="more_vert" size={18} /></button>{sourceMenuKeep.item === file.id && <div className={`${styles.sourceMenu} ${sourceMenuKeep.closing ? styles.sessionMenuOut : ""}`} role="menu">{file.source_type !== "created" && <button type="button" role="menuitem" onClick={() => download(file)}><MIcon name="download" size={15} />{t("AiJudgePanel.downloadOriginalBtn")}</button>}{!readOnly && <button type="button" role="menuitem" className={styles.menuDanger} disabled={busyId === file.id} onClick={() => remove(file)}><MIcon name="delete" size={15} />{t("AiJudgePanel.deleteSourceBtn")}</button>}</div>}</div>}</div>)}
        </div>
      ) : <div className={styles.sourceEmpty}><MIcon name="description" size={24} /><p>{selectedFileId ? t("AiJudgePanel.sourceUnavailableText") : t("AiJudgePanel.noSourceForCheckText")}</p>{!readOnly && <button type="button" className={styles.btnSecondary} onClick={onAddSource}><MIcon name="add" size={15} />{t("AiJudgePanel.addSourceAria")}</button>}</div>}
    </aside>
  );
}

/* ── Tab 1：評分表 ──────────────────────────────────────── */

function RubricsTab({ classId, judgeSession, onSessionUpdated, onScriptCreated, onAddSource, showFileLibrary = true }) {
  const { t } = useTranslation("teaching");
  const toast = useToast();

  const [files, setFiles] = useState([]);
  const [filesLoading, setFilesLoading] = useState(true);
  const [filesError, setFilesError] = useState(false);

  const [analysis, setAnalysis] = useState(null);
  const [messages, setMessages] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isChatting, setIsChatting] = useState(false);
  const [isClearingMessages, setIsClearingMessages] = useState(false);
  const [isReassessing, setIsReassessing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isCreatingScript, setIsCreatingScript] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState("rubric");
  const [sourceFileId, setSourceFileId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const deleteDialog = useDialogPresence(deleteTarget);
  const [pendingConflictFile, setPendingConflictFile] = useState(null);
  const conflictDialog = useDialogPresence(pendingConflictFile);
  const [selectedTemplateKey, setSelectedTemplateKey] = useState("linux");
  const [analysisTemplateKey, setAnalysisTemplateKey] = useState("linux");
  const [pendingProposal, setPendingProposal] = useState(null);
  const [pendingProposalIsReassessment, setPendingProposalIsReassessment] = useState(false);
  const [selectedProposalIds, setSelectedProposalIds] = useState(() => new Set());
  const [pendingProposalMeta, setPendingProposalMeta] = useState(null);
  const [rubricName, setRubricName] = useState("");
  const [environmentKeys, setEnvironmentKeys] = useState([]);
  const [isSavingMetadata, setIsSavingMetadata] = useState(false);
  const [metaInvalid, setMetaInvalid] = useState({});
  const metaNameRef = useRef(null);
  const metaEnvRef = useRef(null);
  const analysisRevisionsRef = useRef(new Map());
  const autosaveRef = useRef(null);
  const classIdRef = useRef(classId);
  const toastRef = useRef(toast);
  classIdRef.current = classId;
  toastRef.current = toast;
  const readOnly = judgeSession?.status === "archived";

  useEffect(() => {
    const autosave = createRubricAnalysisAutosave({
      async save({ fileId, analysis: nextAnalysis }) {
        const updated = await AiJudgeService.updateFileAnalysis(
          classIdRef.current,
          fileId,
          nextAnalysis,
          analysisRevisionsRef.current.get(fileId),
        );
        analysisRevisionsRef.current.set(fileId, updated.analysis_revision);
        setFiles((current) => current.map((entry) => (
          entry.id === updated.id ? updated : entry
        )));
      },
      onError(error) {
        toastRef.current.error(error?.message ?? i18n.t("AiJudgePanel.updateRubricFailed", { ns: "teaching" }));
      },
    });
    autosaveRef.current = autosave;
    return () => {
      if (autosaveRef.current === autosave) autosaveRef.current = null;
      if (autosave.isPending()) {
        void autosave.flush().finally(() => autosave.dispose());
      } else {
        autosave.dispose();
      }
    };
  }, []);

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
  }, [fetchFiles, judgeSession?.selected_file_id]);
  useAutoRefresh(() => fetchFiles(true));

  useEffect(() => {
    let cancelled = false;
    setMessages([]);
    setPendingProposal(null);
    setSelectedProposalIds(new Set());
    setPendingProposalMeta(null);
    setPendingProposalIsReassessment(false);
    if (!judgeSession?.id) return undefined;
    AiJudgeService.listSessionMessages(classId, judgeSession.id)
      .then((rows) => {
        if (!cancelled) setMessages(rows);
      })
      .catch(() => {
        if (!cancelled) toast.error(t("AiJudgePanel.loadChatFailed"));
      });
    return () => {
      cancelled = true;
    };
  }, [classId, judgeSession?.id, toast, t]);

  useEffect(() => {
    if (!judgeSession?.selected_file_id || files.length === 0) return;
    const file = files.find((item) => item.id === judgeSession.selected_file_id);
    if (!file?.analysis_json) return;
    if (sourceFileId === file.id && autosaveRef.current?.isPending()) return;
    setAnalysis(file.analysis_json);
    setUploadedFileName(file.original_filename || "rubric");
    setSourceFileId(file.id);
    setRubricName(getRubricDisplayName(file));
    setEnvironmentKeys(file.environment_keys?.length ? file.environment_keys : [file.template_key]);
    analysisRevisionsRef.current.set(file.id, file.analysis_revision);
    setAnalysisTemplateKey(file.template_key);
    setSelectedTemplateKey(file.template_key);
  }, [files, judgeSession?.selected_file_id, sourceFileId]);

  async function saveRubricMetadata() {
    if (!sourceFileId || readOnly || isSavingMetadata) return;
    const missing = { name: !rubricName.trim(), envKeys: !environmentKeys.length };
    if (missing.name || missing.envKeys) {
      setMetaInvalid(missing);
      focusInvalidField(missing.name ? metaNameRef.current : metaEnvRef.current?.querySelector("button"));
      return;
    }
    setIsSavingMetadata(true);
    try {
      const updated = await AiJudgeService.updateFileMetadata(classId, sourceFileId, {
        display_name: rubricName.trim(),
        environment_keys: environmentKeys,
        template_key: environmentKeys[0],
      });
      setFiles((current) => current.map((entry) => entry.id === updated.id ? updated : entry));
      setRubricName(updated.display_name ?? rubricName.trim());
      setEnvironmentKeys(updated.environment_keys?.length ? updated.environment_keys : environmentKeys);
      setAnalysisTemplateKey(updated.template_key ?? environmentKeys[0]);
      setSelectedTemplateKey(updated.template_key ?? environmentKeys[0]);
      toast.success(t("AiJudgePanel.rubricSettingsSavedToast"));
    } catch (error) {
      toast.error(error?.message ?? t("AiJudgePanel.rubricSettingsSaveFailed"));
    } finally {
      setIsSavingMetadata(false);
    }
  }

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
  function applyAnalysis(
    nextAnalysis,
    { persist = false, immediate = false, detectabilityNeedsReview } = {},
  ) {
    const evaluatedAnalysis = typeof detectabilityNeedsReview === "boolean"
      ? { ...nextAnalysis, detectability_needs_review: detectabilityNeedsReview }
      : nextAnalysis;
    setAnalysis(evaluatedAnalysis);
    if (persist && sourceFileId) {
      autosaveRef.current?.schedule({ fileId: sourceFileId, analysis: evaluatedAnalysis });
      if (immediate) return autosaveRef.current?.flush() ?? Promise.resolve(false);
    }
    return Promise.resolve(true);
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
          toast.error(err?.message ?? t("AiJudgePanel.uploadFailedGeneric"));
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
          toast.error(err?.message ?? t("AiJudgePanel.applySourceFailed"));
          await fetchFiles();
          return;
        }
      }
      setAnalysis(response.analysis);
      setUploadedFileName(file.name || "rubric");
      setSourceFileId(uploadedFile.id);
      setRubricName(getRubricDisplayName(uploadedFile, getRubricDisplayName(file)));
      setEnvironmentKeys(uploadedFile.environment_keys?.length ? uploadedFile.environment_keys : [uploadedFile.template_key]);
      analysisRevisionsRef.current.set(uploadedFile.id, uploadedFile.analysis_revision);
      setAnalysisTemplateKey(response.template_key ?? selectedTemplateKey);
      setFiles((current) => [
        uploadedFile,
        ...current.filter((item) => item.id !== uploadedFile.id),
      ]);
      toast.success(t("AiJudgePanel.analysisCompleteToast", { count: response.analysis.items.length }));
      fetchFiles();
    } catch (err) {
      toast.error(err?.message ?? t("AiJudgePanel.uploadFailedGeneric"));
    } finally {
      setIsUploading(false);
    }
  }

  async function handleSelectFile(file) {
    if (!file.analysis_json) {
      toast.error(t("AiJudgePanel.noAnalysisYetError"));
      return;
    }
    if (judgeSession?.id) {
      try {
        const updated = await AiJudgeService.updateSession(classId, judgeSession.id, {
          selected_file_id: file.id,
        });
        onSessionUpdated?.(updated);
      } catch (err) {
        toast.error(err?.message ?? t("AiJudgePanel.updateCheckRubricFailed"));
        return;
      }
    }
    setAnalysis(file.analysis_json);
    setUploadedFileName(file.original_filename || "rubric");
    setSourceFileId(file.id);
    setRubricName(getRubricDisplayName(file));
    setEnvironmentKeys(file.environment_keys?.length ? file.environment_keys : [file.template_key]);
    analysisRevisionsRef.current.set(file.id, file.analysis_revision);
    setAnalysisTemplateKey(file.template_key);
    setSelectedTemplateKey(file.template_key);
    if (!judgeSession?.id) setMessages([]);
    toast.success(t("AiJudgePanel.loadedRubricToast", { name: getRubricDisplayName(file) }));
  }

  async function handleDownloadFile(file) {
    if (file.source_type === "created") return;
    try {
      const blob = await AiJudgeService.downloadFile(classId, file.id);
      downloadBlob(blob, file.original_filename ?? `${file.display_name ?? t("AiJudgePanel.defaultRubricName")}.pdf`);
    } catch (err) {
      toast.error(err?.message ?? t("AiJudgePanel.downloadRubricGenericFailed"));
    }
  }

  async function handleDeleteFile() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await AiJudgeService.deleteFile(classId, deleteTarget.id);
      toast.success(t("AiJudgePanel.rubricDeletedToast"));
      setFiles((current) => current.filter((file) => file.id !== deleteTarget.id));
      if (sourceFileId === deleteTarget.id) setSourceFileId(null);
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err?.message ?? t("AiJudgePanel.deleteRubricFailed"));
    } finally {
      setDeleting(false);
    }
  }

  async function handleSendMessage(content, isRefine = false, isReassessment = false) {
    if (!judgeSession?.id && !analysis) return;
    if (judgeSession?.status === "archived") return;
    if (autosaveRef.current && !(await autosaveRef.current.flush())) return;
    const requestMessages = [...messages, { role: "user", content }];
    const newMessages = isRefine ? messages : requestMessages;
    setMessages(newMessages);
    setIsChatting(true);
    try {
      if (judgeSession?.id) {
        const response = await AiJudgeService.sendSessionMessage(
          classId,
          judgeSession.id,
          content,
          analysisRevisionsRef.current.get(sourceFileId),
          { isRefine },
        );
        setMessages((current) => {
          const baseMessages = isRefine ? current : current.slice(0, -1);
          return [
            ...baseMessages,
            response.user_message,
            response.assistant_message,
          ].filter(shouldDisplayChatMessage);
        });
        const proposal = buildProposalDiff(analysis?.items ?? [], response.rubric_proposal);
        setPendingProposal(proposal.length ? proposal : null);
        setSelectedProposalIds(new Set(proposal.map((item, index) => item.id ?? `proposal-${index}`)));
        setPendingProposalMeta(proposal.length ? { baseRevision: response.base_revision ?? analysisRevisionsRef.current.get(sourceFileId) } : null);
        setPendingProposalIsReassessment(Boolean(proposal.length && isReassessment));
        if (isReassessment && !response.rubric_proposal) {
          toast.error(t("AiJudgePanel.noReassessResultError"));
        }
        return;
      }
      const response = await AiJudgeService.chat({
        messages: requestMessages,
        rubricContext: rubricToContext(analysis),
        isRefine,
        templateKey: analysisTemplateKey,
      });
      setMessages((prev) => [...prev, { role: "assistant", content: response.reply }]);
      if (response.updated_items) {
        const saved = await applyAnalysis(applyItems(analysis, response.updated_items), {
          persist: true,
          immediate: true,
          detectabilityNeedsReview: false,
        });
        if (!saved) return;
        toast.success(isReassessment ? t("AiJudgePanel.reassessCompleteToast") : t("AiJudgePanel.rubricUpdatedToast"));
      } else if (isReassessment) {
        toast.error(t("AiJudgePanel.noReassessResultError"));
      }
    } catch (err) {
      toast.error(err?.message ?? t("AiJudgePanel.chatFailedError"));
      setMessages(messages);
    } finally {
      setIsChatting(false);
    }
  }

  async function applyPendingProposal() {
    if (!pendingProposal) return;
    if (autosaveRef.current && !(await autosaveRef.current.flush())) return;
    const currentRevision = sourceFileId ? analysisRevisionsRef.current.get(sourceFileId) : null;
    if (pendingProposalMeta?.baseRevision && currentRevision !== pendingProposalMeta.baseRevision) {
      setPendingProposal(null);
      setSelectedProposalIds(new Set());
      setPendingProposalIsReassessment(false);
      setPendingProposalMeta(null);
      toast.error(t("AiJudgePanel.rubricChangedConflict"));
      return;
    }
    const selected = pendingProposal.filter((item, index) => selectedProposalIds.has(item.id ?? `proposal-${index}`));
    const byId = new Map((analysis?.items ?? []).map((item) => [item.id, item]));
    selected.forEach((item) => {
      const operation = item.operation ?? item.action;
      const cleanItem = { ...item };
      delete cleanItem.operation;
      delete cleanItem.action;
      if (operation === "delete" || operation === "remove") {
        byId.delete(item.id);
      } else if (item.id && byId.has(item.id)) {
        byId.set(item.id, { ...byId.get(item.id), ...cleanItem });
      } else {
        const id = item.id ?? `item-${Date.now()}-${byId.size}`;
        byId.set(id, { ...cleanItem, id });
      }
    });
    const saved = await applyAnalysis(applyItems(analysis, [...byId.values()]), {
      persist: true,
      immediate: true,
      detectabilityNeedsReview: false,
    });
    if (!saved) return;
    setPendingProposal(null);
    setSelectedProposalIds(new Set());
    setPendingProposalIsReassessment(false);
    setPendingProposalMeta(null);
    toast.success(t("AiJudgePanel.proposalAppliedToast"));
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
      title: t("AiJudgePanel.newItemDefaultTitle"),
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

  async function handleClearMessages() {
    if (isClearingMessages || isChatting || !messages.length || readOnly) return;
    setIsClearingMessages(true);
    try {
      if (judgeSession?.id) {
        const updated = await AiJudgeService.clearSessionMessages(classId, judgeSession.id);
        onSessionUpdated?.(updated);
      }
      setMessages([]);
      setPendingProposal(null);
      setSelectedProposalIds(new Set());
      setPendingProposalMeta(null);
      setPendingProposalIsReassessment(false);
      toast.success(t("AiJudgePanel.chatClearedToast"));
    } catch (err) {
      toast.error(err?.message ?? t("AiJudgePanel.clearChatFailed"));
    } finally {
      setIsClearingMessages(false);
    }
  }

  async function handleExport() {
    setIsExporting(true);
    try {
      const blob = await AiJudgeService.downloadExcel(analysis.items, analysis.summary);
      downloadBlob(blob, "rubric.xlsx");
      toast.success(t("AiJudgePanel.excelDownloadedToast"));
    } catch (err) {
      toast.error(err?.message ?? t("AiJudgePanel.exportFailedError"));
    } finally {
      setIsExporting(false);
    }
  }

  async function handleCreateScript() {
    setIsCreatingScript(true);
    try {
      if (autosaveRef.current && !(await autosaveRef.current.flush())) return;
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
          ? t("AiJudgePanel.scriptGeneratedApprovedToast")
          : t("AiJudgePanel.scriptGeneratedReviewToast"),
      );
      onScriptCreated?.();
    } catch (err) {
      toast.error(err?.message ?? t("AiJudgePanel.createScriptFailedError"));
    } finally {
      setIsCreatingScript(false);
    }
  }

  const items = analysis?.items ?? [];

  return (
    <div className={styles.tabBody}>
      {analysis && (
        <div className={styles.tabToolbar}>
          <button
            type="button"
            className={styles.btnSecondary}
            onClick={handleExport}
            disabled={isExporting}
          >
            {isExporting ? <Spinner /> : <MIcon name="download" size={16} />}
            {isExporting ? t("AiJudgePanel.exportingLabel") : t("AiJudgePanel.exportExcelBtn")}
          </button>
          <button
            type="button"
            className={styles.btnPrimary}
            onClick={handleCreateScript}
            disabled={isCreatingScript || isChatting || readOnly || items.length === 0}
            title={items.length === 0 ? t("AiJudgePanel.needAtLeastOneItem") : undefined}
          >
            {isCreatingScript ? <Spinner /> : <MIcon name="auto_fix_high" size={16} />}
            {isCreatingScript ? t("AiJudgePanel.creatingScriptLabel") : t("AiJudgePanel.makeScriptBtn")}
          </button>
        </div>
      )}

      {isCreatingScript && (
        <div className={styles.noticeInfo}>
          <p>
             <strong>{t("AiJudgePanel.generatingScriptTitle")}</strong>
          </p>
          <p>
            {t("AiJudgePanel.generatingScriptDesc")}
          </p>
        </div>
      )}

      {analysis && items.length === 0 && (
        <div className={styles.noticeInfo}>
          <p><strong>{t("AiJudgePanel.noItemsYetTitle")}</strong></p>
          <p>{t("AiJudgePanel.needItemForScriptDesc")}</p>
        </div>
      )}

      {showFileLibrary && <div className={styles.card}>
        <div className={styles.cardHead}>
          <h4 className={styles.cardTitle}>
            <MIcon name="description" size={18} />
            {t("AiJudgePanel.savedRubricsHeader")}
          </h4>
        </div>
        {filesLoading ? (
          <LoadingState text={t("AiJudgePanel.loadingRubricsText")} />
        ) : filesError ? (
          <p className={styles.dangerText}>{t("AiJudgePanel.loadRubricsFailedText")}</p>
        ) : files.length === 0 ? (
          <p className={styles.mutedText}>
            {t("AiJudgePanel.noSavedRubricsYetText")}
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
                  <span className={styles.fileName}>{getRubricDisplayName(file, t("AiJudgePanel.unnamedRubricFallback"))}</span>
                  <span className={styles.fileMeta}>
                    {getTemplateLabel(file.template_key)} · {formatDateTime(file.updated_at)}
                    {file.status === "replaced" ? t("AiJudgePanel.replacedSuffix") : ""}
                  </span>
                </button>
                <div className={styles.fileActions}>
                  {file.source_type !== "created" && <button
                    type="button"
                    className={styles.btnSecondary}
                    onClick={() => handleDownloadFile(file)}
                  >
                    <MIcon name="download" size={14} />
                    {t("AiJudgePanel.downloadFileLabel")}
                  </button>}
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    onClick={() => setDeleteTarget(file)}
                    disabled={deleting || readOnly}
                  >
                    <MIcon name="delete" size={14} />
                    {t("AiJudgePanel.deleteLabel")}
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
               {t("AiJudgePanel.uploadRubricOptionalHeader")}
            </h4>
            <p className={styles.mutedText}>
              {t("AiJudgePanel.uploadRubricOptionalDesc")}
            </p>
            <div className={styles.templateRow}>
              <span className={styles.fieldLabel}>{t("AiJudgePanel.envSingleLabel")}</span>
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

           {analysis && sourceFileId && (
             <div className={styles.card}>
               <div className={styles.cardHead}>
                 <h4 className={styles.cardTitle}><MIcon name="tune" size={18} />{t("AiJudgePanel.rubricSettingsHeader")}</h4>
                 <button type="button" className={styles.btnSecondary} onClick={saveRubricMetadata} disabled={readOnly || isSavingMetadata}>
                   {isSavingMetadata ? <Spinner size={14} /> : <MIcon name="save" size={14} />}
                   {isSavingMetadata ? t("AiJudgePanel.savingEllipsis") : t("AiJudgePanel.saveSettingsBtn")}
                 </button>
               </div>
               <div className={styles.metadataGrid}>
                 <label className={styles.rubricField}><span>{t("AiJudgePanel.rubricNameLabel")}</span><input ref={metaNameRef} className={metaInvalid.name ? styles.fieldInvalid : undefined} value={rubricName} maxLength={255} disabled={readOnly || isSavingMetadata} onChange={(event) => { setRubricName(event.target.value); setMetaInvalid((v) => ({ ...v, name: false })); }} /></label>
                 <div className={styles.templateRow}>
                   <span className={styles.fieldLabel}>{t("AiJudgePanel.envMultiSelectLegend")}</span>
                   <div ref={metaEnvRef} className={`${styles.chipBtns} ${metaInvalid.envKeys ? styles.groupInvalid : ""}`}>
                     {TEMPLATE_OPTIONS.map((option) => <button key={option.key} type="button" className={environmentKeys.includes(option.key) ? styles.chipBtnActive : styles.chipBtn} disabled={readOnly || isSavingMetadata} onClick={() => { setEnvironmentKeys((current) => current.includes(option.key) ? current.filter((entry) => entry !== option.key) : [...current, option.key]); setMetaInvalid((v) => ({ ...v, envKeys: false })); }}>{option.label}</button>)}
                   </div>
                 </div>
               </div>
             </div>
           )}

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
                  {t("AiJudgePanel.primaryScenarioLabel", { label: getTemplateLabel(analysisTemplateKey) })}
                </p>
                {analysis.summary && (
                  <details className={styles.summaryDetails}>
                    <summary>{t("AiJudgePanel.aiSummaryLabel")}</summary>
                    <p>{analysis.summary}</p>
                  </details>
                )}
              </div>

              <div className={styles.card}>
                <div className={styles.cardHead}>
                  <h4 className={styles.cardTitle}>{t("AiJudgePanel.itemsHeader", { count: items.length })}</h4>
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    onClick={handleAddItem}
                    disabled={readOnly}
                  >
                    <MIcon name="add" size={16} />
                    {t("AiJudgePanel.addItemBtn")}
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
          {judgeSession?.id && onAddSource && (
            <RubricSourceRail
              classId={classId}
              judgeSession={judgeSession}
              readOnly={readOnly}
              onSessionUpdated={onSessionUpdated}
              onAddSource={onAddSource}
            />
          )}
          <div className={`${styles.card} ${styles.chatCard}`}>
            <h4 className={styles.cardTitle}>
              <MIcon name="smart_toy" size={18} />
              {t("AiJudgePanel.aiChatRoomHeader")}
            </h4>
            <ChatPanel
              messages={messages}
              onSendMessage={handleSendMessage}
              onClearMessages={handleClearMessages}
              isLoading={isChatting}
              isClearing={isClearingMessages}
              disabled={readOnly}
              hasRubric={Boolean(analysis)}
            />
            {pendingProposal && analysis && <ProposalPanel
              proposal={pendingProposal}
              selectedIds={selectedProposalIds}
              onToggle={(id) => setSelectedProposalIds((current) => {
                const next = new Set(current);
                if (next.has(id)) next.delete(id); else next.add(id);
                return next;
              })}
              onApply={applyPendingProposal}
              isReassessment={pendingProposalIsReassessment}
              onSkip={() => {
                setPendingProposal(null);
                setSelectedProposalIds(new Set());
                setPendingProposalIsReassessment(false);
                setPendingProposalMeta(null);
              }}
              disabled={readOnly || isChatting || isClearingMessages}
            />}
          </div>
        </div>
      </div>

      {conflictDialog.open && (
        <ConfirmModal
          title={t("AiJudgePanel.duplicateRubricTitle")}
          description={t("AiJudgePanel.duplicateRubricDesc", { name: conflictDialog.item.name })}
          closing={conflictDialog.closing}
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
                {t("AiJudgePanel.cancelBtn")}
              </button>
              <button
                type="button"
                className={styles.btnSecondary}
                disabled={isUploading}
                onClick={() => handleUpload(conflictDialog.item, "copy")}
              >
                {t("AiJudgePanel.createCopyBtn")}
              </button>
              <button
                type="button"
                className={styles.btnPrimary}
                disabled={isUploading}
                onClick={() => handleUpload(conflictDialog.item, "overwrite")}
              >
                {t("AiJudgePanel.overwriteBtn")}
              </button>
            </>
          }
        />
      )}

      {deleteDialog.open && (
        <ConfirmModal
          title={t("AiJudgePanel.confirmDeleteRubricTitle")}
          description={t("AiJudgePanel.confirmDeleteRubricDesc", { name: deleteDialog.item.original_filename })}
          closing={deleteDialog.closing}
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
                {t("AiJudgePanel.cancelBtn")}
              </button>
              <button
                type="button"
                className={styles.btnDanger}
                disabled={deleting}
                onClick={handleDeleteFile}
              >
                {deleting ? t("AiJudgePanel.deletingEllipsis") : t("AiJudgePanel.confirmDeleteBtn")}
              </button>
            </>
          }
        />
      )}
    </div>
  );
}

/* ── Tab 2：檢查腳本 ────────────────────────────────────── */

const SCRIPT_STATUS_LABEL_KEYS = {
  draft: "AiJudgePanel.scriptStatusDraft",
  review_failed: "AiJudgePanel.scriptStatusReviewFailed",
  reviewed: "AiJudgePanel.scriptStatusReviewed",
  approved: "AiJudgePanel.scriptStatusApproved",
  archived: "AiJudgePanel.scriptStatusArchived",
};

function scriptStatusBadgeClass(status) {
  if (status === "approved") return styles.badge_success;
  if (status === "review_failed") return styles.badge_danger;
  if (status === "reviewed") return styles.badge_info;
  return styles.badge_muted;
}

function ReviewPanel({ title, result }) {
  const { t } = useTranslation("teaching");
  const issues = Array.isArray(result?.issues) ? result.issues : [];
  return (
    <div className={styles.reviewPanel}>
      <div className={styles.reviewPanelHead}>
        <span>{title}</span>
        <span
          className={`${styles.badge} ${result?.approved ? styles.badge_success : styles.badge_danger}`}
        >
          {result?.approved ? t("AiJudgePanel.reviewPassLabel") : t("AiJudgePanel.reviewBlockLabel")}
        </span>
      </div>
      {issues.length > 0 ? (
        <ul className={styles.reviewIssues}>
          {issues.map((issue, index) => (
            <li key={`${title}-${index}`}>{String(issue)}</li>
          ))}
        </ul>
      ) : (
        <p className={styles.mutedText}>{t("AiJudgePanel.noRiskItemsText")}</p>
      )}
      {result?.suggested_fix && (
        <p className={styles.mutedText}>{t("AiJudgePanel.suggestedFixLabel", { fix: String(result.suggested_fix) })}</p>
      )}
    </div>
  );
}

function ScriptsTab({ classId, sessionId, readOnly = false, onScriptApproved }) {
  const { t } = useTranslation("teaching");
  const toast = useToast();
  const [scripts, setScripts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [actionPending, setActionPending] = useState(null);
  const deleteScriptDialog = useDialogPresence(deleteTarget); // "approve" | "regenerate" | "delete"

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
      toast.success(t("AiJudgePanel.scriptApprovedToast"));
      fetchScripts();
      onScriptApproved?.();
    } catch (err) {
      toast.error(err?.message ?? t("AiJudgePanel.approveFailed"));
    } finally {
      setActionPending(null);
    }
  }

  async function handleRegenerate() {
    setActionPending("regenerate");
    try {
      const script = await AiJudgeService.regenerateScript(classId, selected.id);
      setSelectedId(script.id);
      toast.success(t("AiJudgePanel.scriptRegeneratedToast"));
      fetchScripts();
    } catch (err) {
      toast.error(err?.message ?? t("AiJudgePanel.regenerateFailed"));
    } finally {
      setActionPending(null);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setActionPending("delete");
    try {
      await AiJudgeService.deleteScript(classId, deleteTarget.id);
      toast.success(t("AiJudgePanel.scriptDeletedToast"));
      setSelectedId(null);
      setDeleteTarget(null);
      setScripts((current) => current.filter((script) => script.id !== deleteTarget.id));
    } catch (err) {
      toast.error(err?.message ?? t("AiJudgePanel.deleteFailedGeneric"));
    } finally {
      setActionPending(null);
    }
  }

  return (
    <div className={styles.tabBody}>
      {loading ? (
        <LoadingState text={t("AiJudgePanel.loadingScriptsText")} />
      ) : error ? (
        <div className={styles.card}>
          <div className={styles.cardHead}>
            <span className={styles.dangerText}>{t("AiJudgePanel.loadScriptsFailedText")}</span>
            <button type="button" className={styles.btnSecondary} onClick={fetchScripts}>
              {t("AiJudgePanel.reloadBtn")}
            </button>
          </div>
        </div>
      ) : scripts.length === 0 ? (
        <div className={styles.card}>
          <p className={styles.mutedText}>
            {t("AiJudgePanel.noScriptsYetText")}
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
                    {SCRIPT_STATUS_LABEL_KEYS[script.status] ? t(SCRIPT_STATUS_LABEL_KEYS[script.status]) : script.status}
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
                    {actionPending === "approve" ? t("AiJudgePanel.approvingLabel") : t("AiJudgePanel.approveBtn")}
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
                    {actionPending === "regenerate" ? t("AiJudgePanel.regeneratingLabel") : t("AiJudgePanel.regenerateBtn")}
                  </button>
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    onClick={() => setDeleteTarget(selected)}
                    disabled={readOnly || actionPending !== null}
                  >
                    <MIcon name="delete" size={16} />
                    {t("AiJudgePanel.deleteScriptBtn")}
                  </button>
                </div>
              </div>

              <div className={styles.reviewGrid}>
                <ReviewPanel title={t("AiJudgePanel.ruleCheckStaticLabel")} result={selected.policy_check_result_json} />
                <ReviewPanel title={t("AiJudgePanel.aiReviewLabel")} result={selected.ai_review_result_json} />
              </div>

              <pre className={styles.codeBlock}>{selected.script_content}</pre>
            </div>
          )}
        </div>
      )}

      {deleteScriptDialog.open && (
        <ConfirmModal
          title={t("AiJudgePanel.confirmDeleteScriptTitle")}
          description={t("AiJudgePanel.confirmDeleteScriptDesc", { name: deleteScriptDialog.item.name, version: deleteScriptDialog.item.version })}
          closing={deleteScriptDialog.closing}
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
                {t("AiJudgePanel.cancelBtn")}
              </button>
              <button
                type="button"
                className={styles.btnDanger}
                disabled={actionPending === "delete"}
                onClick={handleDelete}
              >
                {actionPending === "delete" ? t("AiJudgePanel.deletingEllipsis") : t("AiJudgePanel.confirmDeleteBtn")}
              </button>
            </>
          }
        />
      )}
    </div>
  );
}

/* ── Tab 3：執行與結果 ──────────────────────────────────── */

const REASON_LABEL_KEYS = {
  success: "AiJudgePanel.reasonSuccess",
  not_running: "AiJudgePanel.reasonNotRunning",
  missing_ip: "AiJudgePanel.reasonMissingIp",
  missing_ssh_key: "AiJudgePanel.reasonMissingSshKey",
  owner_mismatch: "AiJudgePanel.reasonOwnerMismatch",
  missing_db_resource: "AiJudgePanel.reasonMissingDbResource",
  invalid_resource_type: "AiJudgePanel.reasonInvalidResourceType",
  python_missing: "AiJudgePanel.reasonPythonMissing",
  execution_nonzero: "AiJudgePanel.reasonExecutionNonzero",
  result_too_large: "AiJudgePanel.reasonResultTooLarge",
  invalid_json: "AiJudgePanel.reasonInvalidJson",
  executor_error: "AiJudgePanel.reasonExecutorError",
};

function reasonLabel(reasonCode) {
  if (!reasonCode) return null;
  return REASON_LABEL_KEYS[reasonCode] ? i18n.t(REASON_LABEL_KEYS[reasonCode], { ns: "teaching" }) : reasonCode;
}

function runIsTerminal(status) {
  return status === "completed" || status === "failed" || status === "cancelled";
}

const RUN_STATUS_KEYS = {
  completed: { labelKey: "AiJudgePanel.runStatusCompleted", className: styles.badge_success },
  running: { labelKey: "AiJudgePanel.runStatusRunning", className: styles.badge_info },
  failed: { labelKey: "AiJudgePanel.runStatusFailed", className: styles.badge_danger },
  cancelled: { labelKey: "AiJudgePanel.runStatusCancelled", className: styles.badge_muted },
  pending: { labelKey: "AiJudgePanel.runStatusPending", className: styles.badge_muted },
};

const TARGET_STATUS_KEYS = {
  completed: { labelKey: "AiJudgePanel.targetStatusCompleted", className: styles.badge_success },
  running: { labelKey: "AiJudgePanel.targetStatusRunning", className: styles.badge_info },
  failed: { labelKey: "AiJudgePanel.targetStatusFailed", className: styles.badge_danger },
  queued: { labelKey: "AiJudgePanel.targetStatusQueued", className: styles.badge_muted },
};

function StatusBadge({ map, status }) {
  const { t } = useTranslation("teaching");
  const info = map[status];
  if (!info) return <span className={`${styles.badge} ${styles.badge_muted}`}>{status ?? "—"}</span>;
  return <span className={`${styles.badge} ${info.className}`}>{t(info.labelKey)}</span>;
}

function AiJudgementBadge({ result }) {
  const { t } = useTranslation("teaching");
  if (!result) return <span className={`${styles.badge} ${styles.badge_muted}`}>{t("AiJudgePanel.waitingCollectionLabel")}</span>;
  if (result.validation?.valid === false) {
    return <span className={`${styles.badge} ${styles.badge_danger}`}>{t("AiJudgePanel.reasonInvalidJson")}</span>;
  }
  const judgement = result.ai_judgement;
  if (!judgement) return <span className={`${styles.badge} ${styles.badge_muted}`}>{t("AiJudgePanel.analyzingLabel")}</span>;
  if (judgement.status === "completed") {
    const score = typeof judgement.score === "number" ? judgement.score : null;
    const maxScore = typeof judgement.max_score === "number" ? judgement.max_score : 5;
    return (
      <span className={`${styles.badge} ${styles.badge_success}`}>
        {score === null ? t("AiJudgePanel.analyzedLabel") : `${score}/${maxScore}`}
      </span>
    );
  }
  if (judgement.status === "failed") {
    return <span className={`${styles.badge} ${styles.badge_danger}`}>{t("AiJudgePanel.aiAnalysisFailedLabel")}</span>;
  }
  if (judgement.status === "skipped") {
    return <span className={`${styles.badge} ${styles.badge_muted}`}>{t("AiJudgePanel.skippedLabel")}</span>;
  }
  return <span className={`${styles.badge} ${styles.badge_info}`}>{t("AiJudgePanel.analyzingLabel")}</span>;
}

function aiJudgementSummary(result) {
  if (!result) return null;
  if (result.validation?.valid === false) {
    return result.validation.error ?? i18n.t("AiJudgePanel.jsonValidationFailedText", { ns: "teaching" });
  }
  const judgement = result.ai_judgement;
  if (!judgement) return i18n.t("AiJudgePanel.aiNotDoneText", { ns: "teaching" });
  return judgement.error ?? judgement.summary ?? null;
}

function formatUsage(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return "--";
  return `${Math.round(value)}%`;
}

function ExecutionTab({ classId, sessionId, readOnly = false, members }) {
  const { t } = useTranslation("teaching");
  const toast = useToast();
  const [selectedVmids, setSelectedVmids] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const runDialog = useDialogPresence(dialogOpen);
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
        t("AiJudgePanel.runCreatedToast", { count: run.progress_json?.total ?? selectedVmids.length }),
      );
      setActiveRun(run);
      setRunHistory((current) => [run, ...current.filter((item) => item.id !== run.id)]);
      setActiveRunRef({ scriptId: effectiveScriptId, runId: run.id });
      setDialogOpen(false);
      setSelectedScriptId(null);
      setSelectedVmids([]);
    } catch (err) {
      toast.error(err?.message ?? t("AiJudgePanel.createRunFailed"));
    } finally {
      setCreatingRun(false);
    }
  }

  return (
    <div className={styles.tabBody}>
      <div className={styles.execToolbar}>
        <span className={styles.mutedText}>
          {t("AiJudgePanel.execToolbarSummary", { running: runningMembers.length, total: members.length })}{" "}
          <strong>{selectedVmids.length}</strong> {t("AiJudgePanel.machinesUnitSuffix")}
        </span>
        <div className={styles.sectionActions}>
          <button
            type="button"
            className={styles.btnSecondary}
            onClick={() => setSelectedVmids(runningMembers.map((m) => m.vmid).filter(Boolean))}
            disabled={runningMembers.length === 0}
          >
            {t("AiJudgePanel.selectRunningBtn")}
          </button>
          <button
            type="button"
            className={styles.btnSecondary}
            onClick={() => setSelectedVmids([])}
            disabled={selectedVmids.length === 0}
          >
            {t("AiJudgePanel.clearBtn")}
          </button>
          <button
            type="button"
            className={styles.btnPrimary}
            onClick={() => setDialogOpen(true)}
            disabled={
              readOnly || selectedVmids.length === 0 || approvedScripts.length === 0
            }
          >
            <MIcon name="play_circle_outline" size={16} />
            {t("AiJudgePanel.runScriptBtn")}
          </button>
        </div>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.checkCol} />
              <th>{t("AiJudgePanel.thVmid")}</th>
              <th>{t("AiJudgePanel.thMember")}</th>
              <th>{t("AiJudgePanel.thType")}</th>
              <th>{t("AiJudgePanel.thStatus")}</th>
              <th>{t("AiJudgePanel.thResourceSummary")}</th>
            </tr>
          </thead>
          <tbody>
            {runningMembers.length === 0 ? (
              <tr>
                <td colSpan={6} className={styles.tableEmpty}>
                  {t("AiJudgePanel.noRunnableVmText")}
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
                    <span className={`${styles.badge} ${styles.badge_success}`}>{t("AiJudgePanel.runningBadgeLabel")}</span>
                  </td>
                  <td className={styles.fileMeta}>
                    {t("AiJudgePanel.resourceSummaryLabel", { cpu: formatUsage(member.vm_cpu_usage_pct), ram: formatUsage(member.vm_ram_usage_pct), disk: formatUsage(member.vm_disk_usage_pct) })}
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
                {t("AiJudgePanel.lastRunResultTitle")}
                <StatusBadge map={RUN_STATUS_KEYS} status={activeRun.status} />
              </h4>
              <p className={styles.fileMeta}>
                {t("AiJudgePanel.progressLabel", { done: activeRun.progress_json?.done ?? 0, total: activeRun.progress_json?.total ?? progressTargets.length })}
              </p>
            </div>
            {!runIsTerminal(activeRun.status) && (
              <span className={styles.mutedText}>
                <Spinner size={14} /> {t("AiJudgePanel.updatingLabel")}
              </span>
            )}
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t("AiJudgePanel.thId")}</th>
                  <th>{t("AiJudgePanel.thMember")}</th>
                  <th>{t("AiJudgePanel.thSourceNode")}</th>
                  <th>{t("AiJudgePanel.thExecStatus")}</th>
                  <th>{t("AiJudgePanel.thAiAnalysis")}</th>
                </tr>
              </thead>
              <tbody>
                {progressTargets.map((target) => {
                  const result = resultByVmid.get(target.vmid);
                  const user = result?.user ?? target.user;
                  const proxmoxNode = result?.proxmox_node ?? target.proxmox_node;
                  const resourceType = result?.resource_type ?? target.resource_type;
                  const reasonCode = result?.reason_code ?? target.reason_code;
                  const targetReason = reasonLabel(reasonCode);
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
                        <StatusBadge map={TARGET_STATUS_KEYS} status={target.status} />
                        {targetReason && reasonCode !== "success" && (
                          <div className={styles.fileMeta}>{targetReason}</div>
                        )}
                      </td>
                      <td>
                        <AiJudgementBadge result={result} />
                        {result ? (
                          <details className={styles.judgeDetails}>
                            <summary>{t("AiJudgePanel.viewNotesSummary")}</summary>
                            {summary && (
                              <p className={summaryIsError ? styles.dangerText : styles.mutedText}>
                                {summary}
                              </p>
                            )}
                            {(result.ai_judgement?.item_judgements ?? []).map((item, index) => (
                              <div key={`${item.item_id ?? "item"}-${index}`} className={styles.judgeItem}>
                                <div className={styles.judgeItemHead}>
                                  <span>{item.title ?? item.item_id ?? t("AiJudgePanel.ruleItemFallback")}</span>
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
                          <div className={styles.fileMeta}>{t("AiJudgePanel.waitingCollectionLabel")}</div>
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
          <h4 className={styles.cardTitle}>{t("AiJudgePanel.runHistoryTitle")}</h4>
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
                    toast.error(err?.message ?? t("AiJudgePanel.loadRunResultFailed"));
                  }
                }}
              >
                <span>{formatDateTime(run.created_at)}</span>
                <StatusBadge map={RUN_STATUS_KEYS} status={run.status} />
              </button>
            ))}
          </div>
        </div>
      )}

      {runDialog.open && (
        <div
          className={`${styles.modalOverlay} ${runDialog.closing ? styles.modalOverlayOut : ""}`}
          onMouseDown={() => setDialogOpen(false)}
        >
          <div className={styles.modal} onMouseDown={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <h2>{t("AiJudgePanel.confirmRunScriptTitle")}</h2>
                <p>{t("AiJudgePanel.confirmRunScriptDesc")}</p>
              </div>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={() => setDialogOpen(false)}
                aria-label={t("AiJudgePanel.closeAria")}
              >
                <MIcon name="close" size={18} />
              </button>
            </div>

            <label className={styles.field}>
              <span>{t("AiJudgePanel.selectScriptLabel")}</span>
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
          {t("AiJudgePanel.noApprovedScriptsText")}
                </span>
              )}
            </label>

            <div className={styles.vmidBox}>
              <span className={styles.fieldLabel}>{t("AiJudgePanel.execMachinesLabel", { count: selectedVmids.length })}</span>
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
                {t("AiJudgePanel.aboutToUseLabel", { name: effectiveScript.name, version: effectiveScript.version, template: getTemplateLabel(effectiveScript.template_key) })}
              </p>
            )}

            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={() => setDialogOpen(false)}
                disabled={creatingRun}
              >
                {t("AiJudgePanel.cancelBtn")}
              </button>
              <button
                type="button"
                className={styles.btnPrimary}
                onClick={handleCreateRun}
                disabled={creatingRun || selectedVmids.length === 0 || !effectiveScriptId}
              >
                {creatingRun ? t("AiJudgePanel.creatingEllipsis") : t("AiJudgePanel.confirmRunBtn")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── 導師工作區 ─────────────────────────────────────────── */

const TEACHER_JUDGE_TABS = [
  { key: "rubrics", labelKey: "AiJudgePanel.tabRubricsLabel", icon: "description" },
  { key: "scripts", labelKey: "AiJudgePanel.tabScriptsLabel", icon: "terminal" },
  { key: "execution", labelKey: "AiJudgePanel.tabExecutionLabel", icon: "play_circle_outline" },
];

function TeacherWorkspacePanel({ classId, members, weeks = [] }) {
  const { t } = useTranslation("teaching");
  const toast = useToast();
  const [searchParams] = useSearchParams();
  const requestedSessionId = searchParams.get("check");
  const [activeTab, setActiveTab] = useState("rubrics");
  const [sessions, setSessions] = useState([]);
  const [statusFilter, setStatusFilter] = useState("active");
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [creationView, setCreationView] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const createDialog = useDialogPresence(createOpen);
  const [sourceOnly, setSourceOnly] = useState(false);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [sessionMenuPosition, setSessionMenuPosition] = useState(null);
  // 選單離場動畫：關閉時保留最後的目標與位置 130ms
  const sessionMenuPos = useDialogPresence(sessionMenuPosition, 130);
  const [busySessionIds, setBusySessionIds] = useState(() => new Set());
  const [renameTarget, setRenameTarget] = useState(null);
  const renameDialog = useDialogPresence(renameTarget);
  const [renameTitle, setRenameTitle] = useState("");
  const [renameInvalid, setRenameInvalid] = useState(false);
  const renameInputRef = useRef(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const deleteCheckDialog = useDialogPresence(deleteTarget);
  const requestVersionRef = useRef(0);
  const classIdRef = useRef(classId);
  const closeSessionMenu = useCallback(() => {
    setOpenMenuId(null);
    setSessionMenuPosition(null);
  }, []);

  const activeSession = useMemo(
    () => sessions.find((item) => item.id === activeSessionId) ?? null,
    [activeSessionId, sessions],
  );
  const openSessionMenuItem = useMemo(
    () => sessions.find((item) => item.id === openMenuId) ?? null,
    [openMenuId, sessions],
  );
  // 檢查名稱多半直接沿用評分表檔名；相同時 meta 列不再重複顯示一次
  const activeSessionFilePrefix = useMemo(() => {
    if (!activeSession) return "";
    const fileLabel = getRubricDisplayName(activeSession.selected_file_name, t("AiJudgePanel.noRubricSelectedFallback"));
    return fileLabel === getRubricDisplayName(activeSession.title) ? "" : `${fileLabel} · `;
  }, [activeSession]);
  const sessionMenuItemKeep = useDialogPresence(openSessionMenuItem, 130);

  const loadSessions = useCallback(async () => {
    const requestVersion = ++requestVersionRef.current;
    const requestClassId = classId;
    setLoading(true);
    try {
      const rows = await AiJudgeService.listSessions(classId, statusFilter);
      if (requestVersion !== requestVersionRef.current || classIdRef.current !== requestClassId) return;
      setSessions(rows);
      setActiveSessionId((current) => {
        const existing = resolveActiveSessionId(current, rows);
        if (existing) return existing;
        return resolveActiveSessionId(requestedSessionId, rows);
      });
    } catch (error) {
      if (requestVersion === requestVersionRef.current && classIdRef.current === requestClassId) {
        setSessions([]);
        setActiveSessionId(null);
        toast.error(error?.message ?? t("AiJudgePanel.loadSessionsFailed"));
      }
    } finally {
      if (requestVersion === requestVersionRef.current && classIdRef.current === requestClassId) setLoading(false);
    }
  }, [classId, requestedSessionId, statusFilter, toast, t]);

  useEffect(() => {
    classIdRef.current = classId;
    setCreateOpen(false);
    setCreationView(null);
    setSourceOnly(false);
    setRenameTarget(null);
    setDeleteTarget(null);
    setActiveSessionId(null);
    closeSessionMenu();
    loadSessions();
    return () => { requestVersionRef.current += 1; };
  }, [closeSessionMenu, loadSessions]);

  useEffect(() => {
    closeSessionMenu();
  }, [activeSessionId, closeSessionMenu, statusFilter]);

  useEffect(() => {
    if (!openMenuId) return undefined;
    const menuId = `check-menu-${openMenuId}`;
    function updateMenuPosition() {
      const trigger = document.querySelector(`[aria-controls="${menuId}"]`);
      if (!(trigger instanceof HTMLElement)) return;
      setSessionMenuPosition(getSessionMenuPosition(trigger.getBoundingClientRect()));
    }
    updateMenuPosition();
    const focusTimer = window.setTimeout(() => {
      document.getElementById(menuId)?.querySelector('[role="menuitem"]:not(:disabled)')?.focus();
    }, 0);
    function closeMenuOnOutsideClick(event) {
      const target = event.target;
      if (target instanceof Element && (target.closest(`#${menuId}`) || target.closest(`[aria-controls="${menuId}"]`))) return;
      closeSessionMenu();
    }
    function navigateMenu(event) {
      if (event.key === "Escape") {
        closeSessionMenu();
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
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("mousedown", closeMenuOnOutsideClick);
      document.removeEventListener("keydown", navigateMenu);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.closest(`#${menuId}`)) {
        document.querySelector(`[aria-controls="${menuId}"]`)?.focus();
      }
    };
  }, [closeSessionMenu, openMenuId]);

  function updateSessionInList(updated) {
    if (classIdRef.current !== classId) return;
    setSessions((current) => current.map((item) => item.id === updated.id ? updated : item));
  }

  async function handleCreationChoice(mode) {
    setCreationView(mode);
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
           toast.success(t("AiJudgePanel.sourceSelectedToast", { name: getRubricDisplayName(created) }));
         })
        .catch((error) => {
          if (classIdRef.current === requestClassId) {
            toast.error(error?.message ?? t("AiJudgePanel.applySourceFailed"));
          }
        });
      setSourceOnly(false);
      return;
    }
    setStatusFilter("active");
    setSessions((current) => [created, ...current.filter((item) => item.id !== created.id)]);
    setActiveSessionId(created.id);
    setActiveTab("rubrics");
    toast.success(t("AiJudgePanel.sessionCreatedToast", { title: created.title }));
  }

  async function runSessionAction(item, action) {
    if (!item || busySessionIds.has(item.id)) return;
    const requestClassId = classId;
    setBusySessionIds((current) => new Set(current).add(item.id));
    closeSessionMenu();
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
        toast.error(error?.message ?? t("AiJudgePanel.sessionActionFailed"));
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
    if (updated) toast.success(t("AiJudgePanel.archivedToast", { title: item.title }));
  }

  async function restoreSession(item) {
    const updated = await runSessionAction(item, (entry) => AiJudgeService.updateSession(classId, entry.id, { status: "active" }));
    if (updated) toast.success(t("AiJudgePanel.restoredToast", { title: item.title }));
  }

  async function forkSession(item) {
    const copy = await runSessionAction(item, (entry) => AiJudgeService.forkSession(classId, entry.id));
    if (!copy) return;
    setStatusFilter("active");
    setSessions((current) => [copy, ...current.filter((entry) => entry.id !== copy.id)]);
    setActiveSessionId(copy.id);
    setActiveTab("rubrics");
    toast.success(t("AiJudgePanel.forkedToast", { title: copy.title }));
  }

  async function renameSession(event) {
    event.preventDefault();
    if (!renameTarget) return;
    if (!renameTitle.trim()) {
      setRenameInvalid(true);
      focusInvalidField(renameInputRef.current);
      return;
    }
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
      toast.success(t("AiJudgePanel.sessionDeletedToast"));
    } catch (error) {
      if (classIdRef.current === requestClassId) {
        toast.error(error?.message ?? t("AiJudgePanel.deleteSessionFailed"));
      }
    } finally {
      setDeleting(false);
    }
  }

  function toggleSessionMenu(event, sessionId) {
    event.stopPropagation();
    if (openMenuId === sessionId) {
      closeSessionMenu();
      return;
    }
    setSessionMenuPosition(getSessionMenuPosition(event.currentTarget.getBoundingClientRect()));
    setOpenMenuId(sessionId);
  }

  function renderSessionMenu(item) {
    const menuPos = sessionMenuPos.item;
    if (!item || !menuPos) return null;
    const busy = busySessionIds.has(item.id);
    return (
      <div
        id={`check-menu-${item.id}`}
        className={`${styles.sessionMenu} ${sessionMenuPos.closing ? styles.sessionMenuOut : ""}`}
        role="menu"
        aria-label={t("AiJudgePanel.moreOptionsAria", { title: item.title })}
        style={{ top: `${menuPos.top}px`, left: `${menuPos.left}px` }}
      >
        {item.status === "active" && <>
          <button type="button" role="menuitem" disabled={busy} onClick={() => { setRenameTarget(item); setRenameTitle(item.title); setRenameInvalid(false); closeSessionMenu(); }}><MIcon name="edit" size={16} />{t("AiJudgePanel.renameLabel")}</button>
          <button type="button" role="menuitem" disabled={busy} onClick={() => pinSession(item)}><MIcon name="push_pin" filled={Boolean(item.pinned_at)} size={16} />{item.pinned_at ? t("AiJudgePanel.unpinLabel") : t("AiJudgePanel.pinLabel")}</button>
        </>}
        <button type="button" role="menuitem" disabled={busy} onClick={() => forkSession(item)}><MIcon name="fork_right" size={16} />{t("AiJudgePanel.forkLabel")}</button>
        <span className={styles.menuSeparator} />
        {item.status === "active" ? <button type="button" role="menuitem" disabled={busy} onClick={() => archiveSession(item)}><MIcon name="archive" size={16} />{t("AiJudgePanel.archiveLabel")}</button> : <button type="button" role="menuitem" disabled={busy} onClick={() => restoreSession(item)}><MIcon name="unarchive" size={16} />{t("AiJudgePanel.restoreLabel")}</button>}
        <button type="button" role="menuitem" className={styles.menuDanger} disabled={busy} onClick={() => { setDeleteTarget(item); closeSessionMenu(); }}><MIcon name="delete" size={16} />{t("AiJudgePanel.deleteLabel")}</button>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeading}>
        <h2 className={styles.panelTitle}><MIcon name="checklist" size={20} />{t("AiJudgePanel.aiCheckPageTitle")}</h2>
        <p className={styles.panelDesc}>{t("AiJudgePanel.aiCheckPageDesc")}</p>
      </div>

      <div className={styles.sessionWorkspace}>
        <aside className={styles.sessionSidebar} aria-label={t("AiJudgePanel.checkListAria")}>
           <button type="button" className={`${styles.btnPrimary} ${styles.newCheckButton}`} onClick={() => { setSourceOnly(false); setCreationView("choose"); }}><MIcon name="add" size={17} />{t("AiJudgePanel.addCheckTitle")}</button>
          <div className={styles.sessionFilters} role="tablist" aria-label={t("AiJudgePanel.checkStatusAria")}>
            {[["active", t("AiJudgePanel.inProgressLabel")], ["archived", t("AiJudgePanel.archivedFilterLabel")]].map(([status, label]) => <button key={status} type="button" role="tab" aria-selected={statusFilter === status} className={statusFilter === status ? styles.chipBtnActive : styles.chipBtn} onClick={() => { setCreationView(null); setStatusFilter(status); }}>{label}</button>)}
          </div>
          <div className={styles.sessionList} role="list">
            {loading ? <p className={styles.mutedText}>{t("AiJudgePanel.loadingEllipsisGeneric")}</p> : sessions.length === 0 ? <div className={styles.sidebarEmpty}><MIcon name="checklist" size={24} /><p>{statusFilter === "active" ? t("AiJudgePanel.noActiveChecksText") : t("AiJudgePanel.noArchivedChecksText")}</p></div> : sessions.map((item) => {
              const selected = item.id === activeSessionId;
               const busy = busySessionIds.has(item.id);
               return (
                 <div key={item.id} className={`${styles.sessionRow} ${selected ? styles.sessionRowActive : ""}`} role="listitem">
                   <button type="button" className={selected ? styles.sessionItemActive : styles.sessionItem} aria-current={selected ? "true" : undefined} onClick={() => { setCreationView(null); setActiveSessionId(item.id); closeSessionMenu(); }}>
                     <strong>{item.title}</strong>
                   </button>
                   <div className={styles.sessionRowActions}>
                     {statusFilter === "active" && <button type="button" className={`${styles.iconBtn} ${item.pinned_at ? styles.pinActive : ""}`} aria-label={item.pinned_at ? t("AiJudgePanel.unpinAria", { title: item.title }) : t("AiJudgePanel.pinAria", { title: item.title })} aria-pressed={Boolean(item.pinned_at)} title={item.pinned_at ? t("AiJudgePanel.unpinLabel") : t("AiJudgePanel.pinLabel")} disabled={busy} onClick={(event) => { event.stopPropagation(); pinSession(item); }}><MIcon name="push_pin" filled={Boolean(item.pinned_at)} size={17} /></button>}
                     <button type="button" className={styles.iconBtn} aria-label={t("AiJudgePanel.moreFunctionsAria", { title: item.title })} title={t("AiJudgePanel.moreFunctionsTitle")} aria-haspopup="menu" aria-expanded={openMenuId === item.id} aria-controls={`check-menu-${item.id}`} disabled={busy} onClick={(event) => toggleSessionMenu(event, item.id)}><MIcon name="more_vert" size={18} /></button>
                   </div>
                 </div>
               );
            })}
          </div>
        </aside>

        <section className={styles.sessionMain}>
          {creationView === "choose" ? <CreateCheckChooser onChoose={handleCreationChoice} onCancel={() => setCreationView(null)} /> : creationView ? <CreateCheckForm key={creationView} classId={classId} weeks={weeks} embedded initialMode={creationView} onClose={() => setCreationView("choose")} onCreated={handleCreated} /> : !activeSession ? <div className={styles.card}><div className={styles.mainEmpty}><MIcon name="checklist" size={30} /><p>{statusFilter === "active" ? t("AiJudgePanel.selectCheckFromLeftText") : t("AiJudgePanel.selectArchivedCheckText")}</p><button type="button" className={styles.btnPrimary} onClick={() => statusFilter === "active" ? (setSourceOnly(false), setCreationView("choose")) : setStatusFilter("active")}>{statusFilter === "active" ? t("AiJudgePanel.addCheckTitle") : t("AiJudgePanel.viewActiveBtn")}</button></div></div> : <>
            <div className={styles.sessionHeader}><div><h3>{activeSession.title}</h3><p>{t("AiJudgePanel.sessionMetaLabel", { prefix: activeSessionFilePrefix, msgCount: activeSession.message_count ?? 0, scriptCount: activeSession.script_count ?? 0, runCount: activeSession.run_count ?? 0 })}</p></div>{activeSession.status === "archived" && <span className={styles.archivedNotice}><MIcon name="lock" size={14} />{t("AiJudgePanel.archivedCheckNotice")}</span>}</div>
            <div className={styles.subTabs} role="tablist" aria-label={t("AiJudgePanel.checkTabsAria")}>{TEACHER_JUDGE_TABS.map((tab) => <button key={tab.key} type="button" role="tab" aria-selected={activeTab === tab.key} className={activeTab === tab.key ? styles.subTabActive : styles.subTab} onClick={() => setActiveTab(tab.key)}><MIcon name={tab.icon} size={16} />{t(tab.labelKey)}</button>)}</div>
            {activeTab === "rubrics" && <RubricsTab key={activeSession.id} classId={classId} judgeSession={activeSession} onSessionUpdated={updateSessionInList} onAddSource={() => { setSourceOnly(true); setCreateOpen(true); }} onScriptCreated={() => { loadSessions(); setActiveTab("scripts"); }} showFileLibrary={false} />}
            {activeTab === "scripts" && <ScriptsTab classId={classId} sessionId={activeSession.id} readOnly={activeSession.status === "archived"} onScriptApproved={() => setActiveTab("execution")} />}
            {activeTab === "execution" && <ExecutionTab classId={classId} sessionId={activeSession.id} readOnly={activeSession.status === "archived"} members={members} />}
          </>}
        </section>
      </div>

      {typeof document !== "undefined" && sessionMenuItemKeep.open && sessionMenuPos.item && createPortal(renderSessionMenu(sessionMenuItemKeep.item), document.body)}

      {createDialog.open && <CreateCheckForm classId={classId} weeks={weeks} sourceOnly={sourceOnly} closing={createDialog.closing} onClose={() => { setCreateOpen(false); setSourceOnly(false); }} onCreated={handleCreated} />}
       {renameDialog.open && <div className={`${styles.modalOverlay} ${renameDialog.closing ? styles.modalOverlayOut : ""}`} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setRenameTarget(null); }}><form className={`${styles.confirm} ${styles.renameDialog}`} role="dialog" aria-modal="true" aria-labelledby="rename-check-title" onSubmit={renameSession}><div className={styles.modalHeader}><h2 id="rename-check-title">{t("AiJudgePanel.renameCheckTitle")}</h2><button type="button" className={styles.iconBtn} aria-label={t("AiJudgePanel.closeAria")} onClick={() => setRenameTarget(null)}><MIcon name="close" size={18} /></button></div><label className={styles.dialogField}><span>{t("AiJudgePanel.checkNameLabel")}</span><input ref={renameInputRef} className={renameInvalid ? styles.fieldInvalid : undefined} autoFocus value={renameTitle} maxLength={255} onChange={(event) => { setRenameTitle(event.target.value); setRenameInvalid(false); }} /></label><div className={styles.modalActions}><button type="button" className={styles.btnSecondary} onClick={() => setRenameTarget(null)}>{t("AiJudgePanel.cancelBtn")}</button><button type="submit" className={styles.btnPrimary} disabled={busySessionIds.has(renameDialog.item.id)}>{t("AiJudgePanel.saveBtn")}</button></div></form></div>}
      {deleteCheckDialog.open && <ConfirmModal title={t("AiJudgePanel.confirmDeleteCheckTitle")} description={t("AiJudgePanel.confirmDeleteCheckDesc", { title: deleteCheckDialog.item.title })} closing={deleteCheckDialog.closing} onClose={() => { if (!deleting) setDeleteTarget(null); }} actions={<><button type="button" className={styles.btnSecondary} disabled={deleting} onClick={() => setDeleteTarget(null)}>{t("AiJudgePanel.cancelBtn")}</button><button type="button" className={styles.btnDanger} disabled={deleting} onClick={deleteSession}>{deleting ? t("AiJudgePanel.deletingEllipsis2") : t("AiJudgePanel.confirmDeleteBtn")}</button></>} />}
    </div>
  );
}

export default function AiJudgePanel({ classId, members, weeks = [] }) {
  return <TeacherWorkspacePanel classId={classId} members={members} weeks={weeks} />;
}
