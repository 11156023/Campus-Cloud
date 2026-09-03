import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import styles from "./AiJudgePanel.module.scss";
import LoadingState from "../../../components/LoadingState/LoadingState";
import MIcon from "../../../components/MIcon";
import { useToast } from "../../../hooks/useToast";
import useAutoRefresh from "../../../hooks/useAutoRefresh";
import useDialogPresence from "../../../hooks/useDialogPresence";
import { downloadBlob } from "../../../services/api";
import { createRubricAnalysisAutosave } from "./rubricAnalysisAutosave";
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

/** 偵測方式標籤：auto=綠、partial=琥珀、manual=紅。 */
const DETECTABLE_INFO = {
  auto: { label: "可自動偵測", icon: "check", className: styles.detBadge_auto },
  partial: { label: "部分可偵測", icon: "change_history", className: styles.detBadge_partial },
  manual: { label: "需人工確認", icon: "close", className: styles.detBadge_manual },
};

function getDetectableInfo(detectable) {
  return DETECTABLE_INFO[detectable] ?? DETECTABLE_INFO.manual;
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
export function getRubricDisplayName(file, fallback = "評分表") {
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
  return getRubricDisplayName(file, "未命名檢查").slice(0, 255);
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
  if (operation === "delete" || operation === "remove") return "刪除";
  if (operation === "update" || operation === "modify") return "修改";
  return item.id ? "修改" : "新增";
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
  if (!proposal?.length) return null;
  return (
    <div className={styles.proposalCard}>
      <div className={styles.proposalHeading}>
        <div>
          <strong>{isReassessment ? `重新評估完成，共 ${proposal.length} 個評分項目` : "AI 評分表提案"}</strong>
          <p>{isReassessment ? "套用後才會更新可自動偵測比例與班級評分表。" : "逐項確認後才會套用到目前的評分表。"}</p>
        </div>
        <span>{selectedIds.size}/{proposal.length} 項</span>
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
                <b>{item.title || "未命名項目"}</b>
                <small><em>{proposalOperationLabel(item)}</em>{item.description || "AI 建議新增或調整此評估項目"}</small>
              </span>
            </label>
          );
        })}
      </div>
      <div className={styles.proposalActions}>
        <button type="button" className={styles.btnSecondary} disabled={disabled} onClick={onSkip}>略過</button>
        <button type="button" className={styles.btnPrimary} disabled={disabled || selectedIds.size === 0} onClick={onApply}>套用選取</button>
      </div>
    </div>
  );
}

/* ── 評分表統計 ─────────────────────────────────────────── */

export function RubricStats({ items, needsReview = false, isReassessing = false, onReassess, onClose, readOnly = false }) {
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
            <span className={needsReview ? styles.assessmentStatus_stale : styles.assessmentStatus_current}>
              {needsReview ? "待重新評估" : "結果已更新"}
            </span>
          </div>
          <p aria-live="polite">{needsReview ? "評分項目已變更，請重新評估自動檢查適用程度。" : "依目前評分項目的 AI 偵測判斷，協助確認自動檢查的適用程度。"}</p>
        </div>
        <div className={styles.assessmentHeadActions}>
          {!readOnly && onReassess && (
            <button type="button" className={needsReview ? styles.btnPrimary : styles.btnSecondary} onClick={onReassess} disabled={isReassessing || total === 0} title={total === 0 ? "至少需要一個評估項目" : undefined}>
              {isReassessing ? <Spinner size={15} /> : <MIcon name="refresh" size={16} />}
              {isReassessing ? "重新評估中..." : "重新評估"}
            </button>
          )}
          {onClose && <button type="button" className={styles.iconBtn} aria-label="關閉自動偵測可用性" title="關閉" onClick={onClose}><MIcon name="close" size={18} /></button>}
        </div>
      </div>
      <div className={styles.statsBar} role="img" aria-label={`共 ${total} 題：可自動偵測 ${pct(autoCount)}%、部分可偵測 ${pct(partialCount)}%、需人工評閱 ${pct(manualCount)}%`}>
        {autoCount > 0 && <span className={styles.statsSeg_auto} style={{ flexGrow: autoCount }} />}
        {partialCount > 0 && <span className={styles.statsSeg_partial} style={{ flexGrow: partialCount }} />}
        {manualCount > 0 && <span className={styles.statsSeg_manual} style={{ flexGrow: manualCount }} />}
      </div>
      <div className={styles.statsLegend}>
        <span className={styles.legendItem}><i className={styles.legendDot_auto} />可自動偵測 {autoCount}（{pct(autoCount)}%）</span>
        <span className={styles.legendItem}><i className={styles.legendDot_partial} />部分可偵測 {partialCount}（{pct(partialCount)}%）</span>
        <span className={styles.legendItem}><i className={styles.legendDot_manual} />需人工評閱 {manualCount}（{pct(manualCount)}%）</span>
        <span className={styles.legendTotal}>共 {total} 題</span>
      </div>
    </div>
  );
}

/* ── 可編輯評分項目表格 ───────────────────────────────── */

function DetectabilityBadge({ detectable, needsReview = false }) {
  const detectableInfo = getDetectableInfo(detectable);
  return (
    <span
      className={`${styles.detBadge} ${detectableInfo.className} ${needsReview ? styles.detBadge_stale : ""}`}
      title={needsReview ? `${detectableInfo.label}（待重新評估）` : detectableInfo.label}
    >
      <MIcon name={detectableInfo.icon} size={16} aria-hidden="true" />
      <span>{detectableInfo.label}</span>
      {needsReview && <em>待更新</em>}
    </span>
  );
}

function RubricTableRow({ item, index, onChange, onDelete, disabled, needsReview }) {
  const [expanded, setExpanded] = useState(false);
  const checkSteps = item.check_steps ?? [];
  const detailId = `rubric-detail-${index}`;
  const hasDetails = Boolean(item.detection_method || item.fallback || checkSteps.length);

  return (
    <>
      <tr className={`${styles.rubricTableRow} ${expanded ? styles.rubricTableRowExpanded : ""}`}>
        <td className={styles.rubricDetailToggleCell}>
          <button
            type="button"
            className={styles.detailToggle}
            aria-expanded={expanded}
            aria-controls={detailId}
            aria-label={`${expanded ? "收合" : "展開"}第 ${index + 1} 項檢查設定`}
            title={expanded ? "收合檢查設定" : "展開檢查設定"}
            onClick={() => setExpanded((current) => !current)}
          >
            <MIcon name={expanded ? "expand_less" : "expand_more"} size={17} aria-hidden="true" />
          </button>
        </td>
        <td className={styles.rubricNumberCell}>{index + 1}</td>
        <td className={styles.rubricTitleCell}>
          <label className={styles.tableField}>
            <span className={styles.srOnly}>第 {index + 1} 項檢查點</span>
            <input
              value={item.title}
              onChange={(event) => onChange({ ...item, title: event.target.value })}
              placeholder="例如：Python 版本檢查"
              disabled={disabled}
            />
          </label>
        </td>
        <td className={styles.rubricDescriptionCell}>
          <label className={styles.tableField}>
            <span className={styles.srOnly}>第 {index + 1} 項評分標準</span>
            <textarea
              value={item.description}
              onChange={(event) => onChange({ ...item, description: event.target.value })}
              placeholder="寫下學生需要符合的條件"
              rows={2}
              disabled={disabled}
            />
          </label>
        </td>
        <td className={styles.rubricDetectabilityCell}>
          <DetectabilityBadge detectable={item.detectable} needsReview={needsReview} />
        </td>
        <td className={styles.rubricActionsCell}>
          <div className={styles.tableActions}>
            <button
              type="button"
              className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
              title="刪除項目"
              aria-label={`刪除第 ${index + 1} 項：${item.title || "未命名項目"}`}
              onClick={onDelete}
              disabled={disabled}
            >
              <MIcon name="delete" size={16} />
            </button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className={styles.rubricDetailRow}>
          <td id={detailId} colSpan={6}>
            <div className={styles.rubricDetail}>
              <div className={styles.rubricDetailHead}>
                <div>
                  <strong>詳細檢查設定</strong>
                  <span>由 AI 產生，僅供檢視；套用前仍需老師確認。</span>
                </div>
              </div>
              {!hasDetails ? (
                <p className={styles.rubricDetailEmpty}>AI 尚未提供偵測方式，這一項會以人工確認為主。</p>
              ) : (
                <div className={styles.detectGrid}>
                  {item.detection_method && (
                    <div className={styles.detectItem}>
                      <span>偵測方式</span>
                      <p>{item.detection_method}</p>
                    </div>
                  )}
                  {item.fallback && (
                    <div className={styles.detectItem}>
                      <span>無法自動檢查時</span>
                      <p>{item.fallback}</p>
                    </div>
                  )}
                  {checkSteps.length > 0 && (
                    <div className={`${styles.detectItem} ${styles.detectItemWide}`}>
                      <span>預計檢查步驟（尚未執行）</span>
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
          </td>
        </tr>
      )}
    </>
  );
}

export function RubricTable({ items, onChange, onDelete, disabled, needsReview }) {
  return (
    <div className={styles.rubricTableWrap}>
      <table className={styles.rubricTable}>
        <caption className={styles.srOnly}>可編輯的 AI 檢查評分表</caption>
        <thead>
          <tr>
            <th scope="col" className={styles.rubricDetailToggleHeader}>
              <span className={styles.srOnly}>詳細設定</span>
            </th>
            <th scope="col">#</th>
            <th scope="col">檢查點</th>
            <th scope="col">評分標準</th>
            <th scope="col">自動偵測</th>
            <th scope="col"><span className={styles.srOnly}>操作</span></th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <RubricTableRow
              key={item.id}
              item={item}
              index={index}
              onChange={(updated) => onChange(index, updated)}
              onDelete={() => onDelete(index)}
              disabled={disabled}
              needsReview={needsReview}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── 上傳區 ─────────────────────────────────────────────── */

function RubricUploader({ onUpload, onInvalidFile, isLoading }) {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);

  function selectFile(file) {
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext !== "docx" && ext !== "pdf") {
      onInvalidFile?.("只接受 .docx 或 .pdf 評分文件。");
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

export function ChatPanel({
  messages,
  onSendMessage,
  onClearMessages = () => {},
  isLoading,
  isClearing = false,
  disabled = false,
  hasRubric = false,
  onOpenDetectability,
  onOpenSources,
}) {
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
            <p>{hasRubric ? "與 AI 對話來精煉你的評分表" : "先和 AI 討論你的檢查需求"}</p>
            <p className={styles.chatEmptyMeta}>
              {hasRubric
                ? "可以詢問修改建議，或直接下達調整指令"
                : "不必先上傳文件；之後再上傳評分表即可接續這段對話"}
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
            潤飾評分表
          </button>
          {onOpenDetectability && <button
            type="button"
            className={styles.btnSecondary}
            disabled={isLoading || isClearing || !hasRubric}
            onClick={onOpenDetectability}
            title={!hasRubric ? "請先選擇或建立評分表" : undefined}
            aria-haspopup="dialog"
          >
            <MIcon name="monitoring" size={14} />
            自動偵測可用性
          </button>}
          {onOpenSources && <button
            type="button"
            className={styles.btnSecondary}
            disabled={isLoading || isClearing}
            onClick={onOpenSources}
            aria-haspopup="dialog"
          >
            <MIcon name="description" size={14} />
            評分表來源
          </button>}
          <button
            type="button"
            className={styles.btnSecondary}
            disabled={isLoading || isClearing || disabled || messages.length === 0}
            onClick={onClearMessages}
          >
            {isClearing ? <Spinner size={14} /> : <MIcon name="delete_sweep" size={14} />}
            清除內容
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
                ? "輸入訊息...（Shift+Enter 換行）"
                : "描述想檢查的環境或問題...（Shift+Enter 換行）"
            }
            rows={1}
            disabled={isLoading || isClearing || disabled}
          />
          <button
            type="submit"
            className={styles.btnPrimary}
            disabled={isLoading || isClearing || disabled || !input.trim()}
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

function InsightDialog({ label, children, onClose }) {
  return (
    <div
      className={styles.modalOverlay}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className={`${styles.modal} ${styles.insightModal}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children}
      </section>
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

  function handleModeChange(nextMode) {
    setMode(nextMode);
    if (nextMode === "existing") {
      setEnvironmentKeys((current) => current.length ? current : ["linux"]);
    }
  }

  async function uploadFile(file, conflictStrategy = null) {
    if (!file) return;
    if (!sourceOnly && !selectedWeekId) {
      setError("請先選擇這份檢查要放入的週任務。");
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
          setError(`AI 分析完成，但建立檢查失敗：${createError?.message ?? "請稍後再試"}`);
        } finally {
          setCreating(false);
        }
      }
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

  async function submit(event) {
    event.preventDefault();
    if (!mode) return;
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
      setError(createError?.message ?? "建立檢查失敗，請確認欄位後重試。");
    } finally {
      setCreating(false);
    }
  }

  const form = (
      <section className={embedded ? styles.createCheckPanel : `${styles.confirm} ${styles.createCheckDialog}`} role={embedded ? undefined : "dialog"} aria-modal={embedded ? undefined : "true"} aria-labelledby="create-check-title">
        <div className={styles.modalHeader}><div>{embedded && <button type="button" className={styles.inlineBackButton} disabled={creating || uploading} onClick={onClose}><MIcon name="arrow_back" size={17} />返回建立方式</button>}<h2 id="create-check-title">{sourceOnly ? "新增評分表來源" : mode === "blank" ? "從零開始建立" : "使用已有評分文件"}</h2><p>{sourceOnly ? "建立或選用一份班級評分表，完成後會套用到目前檢查。" : mode === "blank" ? "建立空白評分表後，會留在 AI 檢查主頁編輯評分項目與 AI 提案。" : "選擇已保存的評分表，或上傳文件交由 AI 分析；完成後會回到 AI 檢查主頁。"}</p></div>{!embedded && <button type="button" className={styles.iconBtn} aria-label="關閉" disabled={creating || uploading} onClick={onClose}><MIcon name="close" size={18} /></button>}</div>
        <form onSubmit={submit}>
          {!sourceOnly && <label className={styles.dialogField}><span>放到哪一週任務？</span><select value={selectedWeekId} onChange={(event) => setSelectedWeekId(event.target.value)} required><option value="" disabled>{availableWeeks.length ? "請選擇週任務" : "請先建立有名稱的週任務"}</option>{availableWeeks.map((week) => <option key={week.id} value={week.id}>第 {week.week ?? week.week_number} 週 · {week.title}{["published", "completed"].includes(week.status) ? "" : "（草稿）"}</option>)}</select><small>AI 檢查核准後，Checkpoint 才會顯示在學生端；草稿週次發布後才會讓學生看到。</small></label>}
          {!embedded && <fieldset className={styles.modeFieldset}><legend>如何建立評分表？</legend><div className={styles.modeChoices}><label className={mode === "blank" ? styles.modeChoiceActive : styles.modeChoice}><input type="radio" name="creation-mode" checked={mode === "blank"} onChange={() => handleModeChange("blank")} /><span><b>從零開始建立</b><small>建立空白評分表，接著手動新增項目或請 AI 產生初稿。</small></span></label><label className={mode === "existing" ? styles.modeChoiceActive : styles.modeChoice}><input type="radio" name="creation-mode" checked={mode === "existing"} onChange={() => handleModeChange("existing")} /><span><b>使用已有評分文件</b><small>選擇班級已保存的評分表，或上傳 .docx／.pdf；檢查名稱會使用文件名稱。</small></span></label></div></fieldset>}
           {mode === "blank" && <div className={styles.modeFields}><label className={styles.dialogField}><span>評分表名稱</span><input autoFocus={sourceOnly} value={rubricName} maxLength={255} placeholder="例如：期中 Python 評分表" onChange={(event) => setRubricName(event.target.value)} /></label><fieldset className={styles.modeFieldset}><legend>評分環境（可複選）</legend><div className={styles.dialogChips}>{TEMPLATE_OPTIONS.map((option) => <label key={option.key} className={environmentKeys.includes(option.key) ? styles.dialogChipActive : styles.dialogChip}><input type="checkbox" checked={environmentKeys.includes(option.key)} onChange={() => toggleEnvironment(option.key)} />{option.label}</label>)}</div></fieldset></div>}
           {mode === "existing" && <div className={styles.existingPicker}>
             <div className={styles.uploadSourceBlock}>
               <div className={styles.existingPickerHead}><div><span>上傳新的評分文件</span><small>支援 .docx／.pdf；分析完成後會以文件名稱建立檢查。</small></div></div>
               <fieldset className={styles.modeFieldset}>
                 <legend>評分環境（可複選）</legend>
                 <p className={styles.uploadEnvironmentHint}>第一個選擇會作為 AI 分析的主要情境，其餘環境可提供跨環境檢查能力。</p>
                 <div className={styles.dialogChips}>{TEMPLATE_OPTIONS.map((option) => <label key={option.key} className={environmentKeys.includes(option.key) ? styles.dialogChipActive : styles.dialogChip}><input type="checkbox" checked={environmentKeys.includes(option.key)} onChange={() => toggleEnvironment(option.key)} disabled={uploading || creating} />{option.label}</label>)}</div>
               </fieldset>
               <RubricUploader onUpload={(file) => uploadFile(file)} onInvalidFile={setError} isLoading={uploading || creating || (!sourceOnly && !selectedWeekId)} />
             </div>
              <div className={styles.savedRubricBlock}><div className={styles.existingPickerHead}><div><span>或選擇已保存評分表</span><small>每份來源只能綁定一個檢查；若要重構，請使用「重構」。</small></div></div>{files.length ? <div className={styles.existingList}>{files.map((file) => <label key={file.id} className={selectedFileId === file.id ? styles.existingRowActive : styles.existingRow}><input type="radio" name="saved-rubric" checked={selectedFileId === file.id} onChange={() => setSelectedFileId(file.id)} /><span><b>{getRubricDisplayName(file, "未命名評分表")}</b><small>{(file.environment_keys?.length ? file.environment_keys : [file.template_key]).map(getTemplateLabel).join("、")} · {file.analysis_json?.items?.length ?? 0} 項 · {formatDateTime(file.updated_at)}</small></span></label>)}</div> : <p className={styles.mutedText}>尚未有可用的評分表。</p>}</div>
             {conflictFile && <div className={styles.conflictActions} role="alert"><span>「{conflictFile.name}」已存在：</span><button type="button" className={styles.btnSecondary} disabled={uploading || creating} onClick={() => uploadFile(conflictFile, "copy")}>建立副本</button><button type="button" className={styles.btnDanger} disabled={uploading || creating} onClick={() => uploadFile(conflictFile, "overwrite")}>覆蓋原本</button><button type="button" className={styles.iconBtn} aria-label="取消同名處理" onClick={() => setConflictFile(null)}><MIcon name="close" size={16} /></button></div>}
           </div>}
          {error && <p className={styles.dialogError} role="alert">{error}</p>}
          <div className={styles.modalActions}>{!embedded && <button type="button" className={styles.btnSecondary} disabled={creating || uploading} onClick={onClose}>取消</button>}{mode !== "existing" || sourceOnly ? <button type="submit" className={styles.btnPrimary} disabled={!mode || (!sourceOnly && !selectedWeekId) || (mode === "blank" ? !rubricName.trim() || !environmentKeys.length : !selectedFileId) || creating || uploading}>{creating ? <><Spinner size={15} />建立中…</> : sourceOnly ? "新增來源" : mode === "blank" ? "建立檢查" : "使用這份評分表"}</button> : <p className={styles.uploadAutoHint}>選擇檔案後按「上傳並分析」，完成後會回到 AI 檢查主頁。</p>}</div>
        </form>
      </section>
  );

  if (embedded) return form;
  return <div className={`${styles.modalOverlay} ${closing ? styles.modalOverlayOut : ""}`} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !creating && !uploading) onClose(); }}>{form}</div>;
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

function RubricSourceRail({ classId, judgeSession, readOnly, onSessionUpdated, onAddSource, onClose, embedded = false }) {
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
    try { const blob = await AiJudgeService.downloadFile(classId, file.id); downloadBlob(blob, file.original_filename ?? `${getRubricDisplayName(file)}.pdf`); }
    catch (error) { toast.error(error?.message ?? "下載評分文件失敗"); }
    finally { setOpenMenuId(null); }
  }

  async function remove(file) {
    if (!window.confirm(`確定刪除「${getRubricDisplayName(file)}」？已建立的腳本不會受影響。`)) return;
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
    <aside ref={sourceRailRef} className={`${styles.sourceRail} ${embedded ? styles.sourceRailEmbedded : ""}`} aria-label="評分表來源">
      <div className={styles.sourceRailHead}>
        <div>
          <h3>評分表來源</h3>
          <p>{loading ? "正在確認目前來源…" : selectedFile ? "目前檢查使用的來源" : "尚未選擇來源"}</p>
        </div>
        <div className={styles.sourceRailActions}>
          {!readOnly && selectedFile && activeFiles.length > 1 && <button type="button" className={styles.btnSecondary} aria-expanded={showOtherSources} onClick={() => setShowOtherSources((current) => !current)}>{showOtherSources ? "只看目前來源" : "切換來源"}</button>}
          {!readOnly && <button type="button" className={styles.iconBtn} aria-label="新增來源" title="新增來源" onClick={onAddSource}><MIcon name="add" size={19} /></button>}
          {onClose && <button type="button" className={styles.iconBtn} aria-label="關閉評分表來源" title="關閉" onClick={onClose}><MIcon name="close" size={18} /></button>}
        </div>
      </div>
      {loading ? <p className={styles.mutedText}>載入來源中…</p> : visibleFiles.length > 0 ? (
        <div className={styles.sourceList}>
           {visibleFiles.map((file) => <div key={file.id} className={`${styles.sourceRow} ${file.id === selectedFileId ? styles.sourceRowSelected : ""}`}><button type="button" className={styles.sourceSelect} disabled={readOnly || busyId === file.id} onClick={() => selectFile(file)}><span className={styles.sourceIndicator} aria-hidden="true"><MIcon name={file.id === selectedFileId ? "radio_button_checked" : "radio_button_unchecked"} size={17} /></span><span className={styles.sourceText}><b>{getRubricDisplayName(file, "未命名評分表")}</b><small>{(file.environment_keys?.length ? file.environment_keys : [file.template_key]).map(getTemplateLabel).join("、")} · {file.analysis_json?.items?.length ?? 0} 項 · {formatDateTime(file.updated_at)} · {file.source_type === "created" ? "建立於系統" : "已上傳"}</small>{file.id === selectedFileId && <em>已選用</em>}</span></button>{(file.source_type !== "created" || !readOnly) && <div className={styles.sourceActions}><button type="button" className={styles.iconBtn} aria-label={`管理 ${getRubricDisplayName(file)}`} title="管理評分表來源" aria-haspopup="menu" aria-expanded={openMenuId === file.id} onClick={(event) => { event.stopPropagation(); setOpenMenuId((current) => current === file.id ? null : file.id); }}><MIcon name="more_vert" size={18} /></button>{sourceMenuKeep.item === file.id && <div className={`${styles.sourceMenu} ${sourceMenuKeep.closing ? styles.sessionMenuOut : ""}`} role="menu">{file.source_type !== "created" && <button type="button" role="menuitem" onClick={() => download(file)}><MIcon name="download" size={15} />下載原始文件</button>}{!readOnly && <button type="button" role="menuitem" className={styles.menuDanger} disabled={busyId === file.id} onClick={() => remove(file)}><MIcon name="delete" size={15} />刪除來源</button>}</div>}</div>}</div>)}
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
  const [isClearingMessages, setIsClearingMessages] = useState(false);
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
  const [selectedProposalIds, setSelectedProposalIds] = useState(() => new Set());
  const [isAssistantOpen, setIsAssistantOpen] = useState(true);
  const [openInsight, setOpenInsight] = useState(null);
  const [pendingProposalMeta, setPendingProposalMeta] = useState(null);
  const [isReassessing, setIsReassessing] = useState(false);
  const [pendingProposalIsReassessment, setPendingProposalIsReassessment] = useState(false);
  const [rubricName, setRubricName] = useState("");
  const [environmentKeys, setEnvironmentKeys] = useState([]);
  const [isSavingMetadata, setIsSavingMetadata] = useState(false);
  const analysisRevisionsRef = useRef(new Map());
  const autosaveRef = useRef(null);
  const classIdRef = useRef(classId);
  const toastRef = useRef(toast);
  classIdRef.current = classId;
  toastRef.current = toast;
  const readOnly = judgeSession?.status === "archived";

  useEffect(() => {
    if (!openInsight) return undefined;
    function closeOnEscape(event) {
      if (event.key === "Escape") setOpenInsight(null);
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [openInsight]);

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
        toastRef.current.error(error?.message ?? "更新評分表失敗");
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
    if (!sourceFileId || readOnly || !rubricName.trim() || !environmentKeys.length || isSavingMetadata) return;
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
      toast.success("評分表設定已儲存");
    } catch (error) {
      toast.error(error?.message ?? "評分表設定儲存失敗");
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
          environmentKeys,
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
      setRubricName(getRubricDisplayName(uploadedFile, getRubricDisplayName(file)));
      setEnvironmentKeys(uploadedFile.environment_keys?.length ? uploadedFile.environment_keys : [uploadedFile.template_key]);
      analysisRevisionsRef.current.set(uploadedFile.id, uploadedFile.analysis_revision);
      setAnalysisTemplateKey(response.template_key ?? selectedTemplateKey);
      setSelectedTemplateKey(response.template_key ?? selectedTemplateKey);
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
    setRubricName(getRubricDisplayName(file));
    setEnvironmentKeys(file.environment_keys?.length ? file.environment_keys : [file.template_key]);
    analysisRevisionsRef.current.set(file.id, file.analysis_revision);
    setAnalysisTemplateKey(file.template_key);
    setSelectedTemplateKey(file.template_key);
    if (!judgeSession?.id) setMessages([]);
    toast.success(`已載入「${getRubricDisplayName(file)}」`);
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
        if (proposal.length) setIsAssistantOpen(true);
        setPendingProposalIsReassessment(Boolean(proposal.length && isReassessment));
        if (isReassessment && !response.rubric_proposal) {
          toast.error("AI 未回傳可套用的重新評估結果，原有百分比尚未更新，請稍後再試");
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
    if (autosaveRef.current && !(await autosaveRef.current.flush())) return;
    const currentRevision = sourceFileId ? analysisRevisionsRef.current.get(sourceFileId) : null;
    if (pendingProposalMeta?.baseRevision && currentRevision !== pendingProposalMeta.baseRevision) {
      setPendingProposal(null);
      setSelectedProposalIds(new Set());
      setPendingProposalMeta(null);
      setPendingProposalIsReassessment(false);
      toast.error("評分表已經有新的修改，請重新請 AI 產生提案。");
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
    setPendingProposalMeta(null);
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
      toast.success("對話內容已清除");
    } catch (err) {
      toast.error(err?.message ?? "清除對話內容失敗");
    } finally {
      setIsClearingMessages(false);
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
      {(analysis || judgeSession?.id) && (
        <div className={styles.tabToolbar}>
          {judgeSession?.id && (
            <button
              type="button"
              className={isAssistantOpen ? styles.btnAssistantActive : styles.btnAssistant}
              aria-expanded={isAssistantOpen}
              aria-controls="ai-assistant-panel"
              onClick={() => setIsAssistantOpen((current) => !current)}
            >
              <MIcon name="smart_toy" size={16} />
              {isAssistantOpen ? "收合 AI 協助" : "AI 協助"}
              {pendingProposal && <span className={styles.assistantPending}>有新建議</span>}
            </button>
          )}
          <button
            hidden={!analysis}
            type="button"
            className={styles.btnSecondary}
            onClick={handleExport}
            disabled={isExporting}
          >
            {isExporting ? <Spinner /> : <MIcon name="download" size={16} />}
            {isExporting ? "匯出中..." : "匯出 Excel"}
          </button>
          <button
            hidden={!analysis}
            type="button"
            className={styles.btnPrimary}
            onClick={handleCreateScript}
            disabled={isCreatingScript || isChatting || readOnly || items.length === 0}
            title={items.length === 0 ? "請先新增至少一個評估項目" : undefined}
          >
            {isCreatingScript ? <Spinner /> : <MIcon name="auto_fix_high" size={16} />}
            {isCreatingScript ? "製作中..." : "製作檢查腳本"}
          </button>
        </div>
      )}

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
                  <span className={styles.fileName}>{getRubricDisplayName(file, "未命名評分表")}</span>
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

      <div className={`${styles.analysisGrid} ${isAssistantOpen ? styles.analysisGridAssistantOpen : ""}`}>
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

           {analysis && sourceFileId && (
             <div className={`${styles.card} ${styles.settingsCard}`}>
               <div className={styles.settingsBody}>
                 <div className={styles.cardHead}>
                   <h4 className={styles.cardTitle}><MIcon name="tune" size={18} />評分表設定</h4>
                    <button type="button" className={styles.btnSecondary} onClick={saveRubricMetadata} disabled={readOnly || isSavingMetadata || !rubricName.trim() || !environmentKeys.length}>
                     {isSavingMetadata ? <Spinner size={14} /> : <MIcon name="save" size={14} />}
                     {isSavingMetadata ? "儲存中…" : "儲存設定"}
                   </button>
                  </div>
                  <label className={styles.rubricField}><span>評分表名稱</span><input value={rubricName} maxLength={255} disabled={readOnly || isSavingMetadata} onChange={(event) => setRubricName(event.target.value)} /></label>
                  <div className={styles.templateRow}>
                    <span className={styles.fieldLabel}>評分環境（可複選）</span>
                    <div className={styles.chipBtns}>
                      {TEMPLATE_OPTIONS.map((option) => <button key={option.key} type="button" className={environmentKeys.includes(option.key) ? styles.chipBtnActive : styles.chipBtn} disabled={readOnly || isSavingMetadata} onClick={() => setEnvironmentKeys((current) => current.includes(option.key) ? current.filter((entry) => entry !== option.key) : [...current, option.key])}>{option.label}</button>)}
                    </div>
                  </div>
               </div>
             </div>
           )}

           {analysis && (
            <>
              <p className={styles.mutedText}>主要評分情境：{getTemplateLabel(analysisTemplateKey)}</p>
              {analysis.summary && (
                <div className={styles.summaryDetails}>
                  <strong>AI 評估摘要</strong>
                  <p>{analysis.summary}</p>
                </div>
              )}
              <div className={`${styles.card} ${styles.rubricTableCard}`}>
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
                <RubricTable
                  items={items}
                  onChange={handleItemChange}
                  onDelete={handleItemDelete}
                  disabled={isChatting || readOnly}
                  needsReview={Boolean(analysis.detectability_needs_review)}
                />
              </div>
            </>
          )}
        </div>

        {isAssistantOpen && <div id="ai-assistant-panel" className={styles.analysisAside}>
          <div className={`${styles.card} ${styles.chatCard}`}>
            <h4 className={styles.cardTitle}>
              <MIcon name="smart_toy" size={18} />
              AI 聊天室
            </h4>
            <ChatPanel
              messages={messages}
              onSendMessage={handleSendMessage}
              onClearMessages={handleClearMessages}
              isLoading={isChatting}
              isClearing={isClearingMessages}
              disabled={readOnly}
              hasRubric={Boolean(analysis)}
              onOpenDetectability={() => setOpenInsight("detectability")}
              onOpenSources={judgeSession?.id && onAddSource ? () => setOpenInsight("sources") : undefined}
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
              onSkip={() => {
               setPendingProposal(null);
               setSelectedProposalIds(new Set());
               setPendingProposalMeta(null);
                setPendingProposalIsReassessment(false);
              }}
              isReassessment={pendingProposalIsReassessment}
              disabled={readOnly || isChatting || isClearingMessages}
            />}
          </div>
        </div>}
      </div>

      {openInsight === "detectability" && analysis && (
        <InsightDialog label="自動偵測可用性" onClose={() => setOpenInsight(null)}>
          <RubricStats
            items={items}
            needsReview={Boolean(analysis.detectability_needs_review)}
            isReassessing={isReassessing}
            onReassess={handleReassess}
            onClose={() => setOpenInsight(null)}
            readOnly={readOnly}
          />
        </InsightDialog>
      )}

      {openInsight === "sources" && judgeSession?.id && onAddSource && (
        <InsightDialog label="評分表來源" onClose={() => setOpenInsight(null)}>
          <RubricSourceRail
            classId={classId}
            judgeSession={judgeSession}
            readOnly={readOnly}
            onSessionUpdated={onSessionUpdated}
            onAddSource={onAddSource}
            onClose={() => setOpenInsight(null)}
            embedded
          />
        </InsightDialog>
      )}

      {conflictDialog.open && (
        <ConfirmModal
          title="已有同名評分表"
          description={`「${conflictDialog.item.name}」已存在。請選擇覆蓋原本文件，或建立一份副本後重新分析。`}
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
                取消
              </button>
              <button
                type="button"
                className={styles.btnSecondary}
                disabled={isUploading}
                onClick={() => handleUpload(conflictDialog.item, "copy")}
              >
                建立副本
              </button>
              <button
                type="button"
                className={styles.btnPrimary}
                disabled={isUploading}
                onClick={() => handleUpload(conflictDialog.item, "overwrite")}
              >
                覆蓋原本
              </button>
            </>
          }
        />
      )}

      {deleteDialog.open && (
        <ConfirmModal
          title="確認刪除評分表？"
          description={`你即將刪除「${deleteDialog.item.original_filename}」的原始檔與保存分析。刪除後不會影響已建立的腳本。`}
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

      {deleteScriptDialog.open && (
        <ConfirmModal
          title="確認刪除檢查腳本？"
          description={`你即將永久刪除「${deleteScriptDialog.item.name}」v${deleteScriptDialog.item.version}。刪除後無法再查看、核准或重新生成。`}
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

      {runDialog.open && (
        <div
          className={`${styles.modalOverlay} ${runDialog.closing ? styles.modalOverlayOut : ""}`}
          onMouseDown={() => setDialogOpen(false)}
        >
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

/* ── 導師工作區 ─────────────────────────────────────────── */

const TEACHER_JUDGE_TABS = [
  { key: "rubrics", label: "評分設定", icon: "description" },
  { key: "scripts", label: "檢查腳本", icon: "terminal" },
  { key: "execution", label: "執行與結果", icon: "play_circle_outline" },
];

function TeacherWorkspacePanel({ classId, members, weeks = [] }) {
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
    const fileLabel = getRubricDisplayName(activeSession.selected_file_name, "尚未選擇評分表");
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
        toast.error(error?.message ?? "載入檢查失敗");
      }
    } finally {
      if (requestVersion === requestVersionRef.current && classIdRef.current === requestClassId) setLoading(false);
    }
  }, [classId, requestedSessionId, statusFilter, toast]);

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
           toast.success(`已選用「${getRubricDisplayName(created)}」。`);
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
        aria-label={`「${item.title}」更多功能`}
        style={{ top: `${menuPos.top}px`, left: `${menuPos.left}px` }}
      >
        {item.status === "active" && <>
          <button type="button" role="menuitem" disabled={busy} onClick={() => { setRenameTarget(item); setRenameTitle(item.title); closeSessionMenu(); }}><MIcon name="edit" size={16} />重新命名</button>
          <button type="button" role="menuitem" disabled={busy} onClick={() => pinSession(item)}><MIcon name="push_pin" filled={Boolean(item.pinned_at)} size={16} />{item.pinned_at ? "取消釘選" : "釘選"}</button>
        </>}
        <button type="button" role="menuitem" disabled={busy} onClick={() => forkSession(item)}><MIcon name="fork_right" size={16} />重構</button>
        <span className={styles.menuSeparator} />
        {item.status === "active" ? <button type="button" role="menuitem" disabled={busy} onClick={() => archiveSession(item)}><MIcon name="archive" size={16} />封存</button> : <button type="button" role="menuitem" disabled={busy} onClick={() => restoreSession(item)}><MIcon name="unarchive" size={16} />還原至進行中</button>}
        <button type="button" role="menuitem" className={styles.menuDanger} disabled={busy} onClick={() => { setDeleteTarget(item); closeSessionMenu(); }}><MIcon name="delete" size={16} />刪除</button>
      </div>
    );
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
                   <button type="button" className={selected ? styles.sessionItemActive : styles.sessionItem} aria-current={selected ? "true" : undefined} onClick={() => { setCreationView(null); setActiveSessionId(item.id); closeSessionMenu(); }}>
                     <strong>{item.title}</strong>
                   </button>
                   <div className={styles.sessionRowActions}>
                     {statusFilter === "active" && <button type="button" className={`${styles.iconBtn} ${item.pinned_at ? styles.pinActive : ""}`} aria-label={item.pinned_at ? `取消釘選「${item.title}」` : `釘選「${item.title}」`} aria-pressed={Boolean(item.pinned_at)} title={item.pinned_at ? "取消釘選" : "釘選"} disabled={busy} onClick={(event) => { event.stopPropagation(); pinSession(item); }}><MIcon name="push_pin" filled={Boolean(item.pinned_at)} size={17} /></button>}
                     <button type="button" className={styles.iconBtn} aria-label={`更多「${item.title}」功能`} title="更多功能" aria-haspopup="menu" aria-expanded={openMenuId === item.id} aria-controls={`check-menu-${item.id}`} disabled={busy} onClick={(event) => toggleSessionMenu(event, item.id)}><MIcon name="more_vert" size={18} /></button>
                   </div>
                 </div>
               );
            })}
          </div>
        </aside>

        <section className={styles.sessionMain}>
          {creationView === "choose" ? <CreateCheckChooser onChoose={handleCreationChoice} onCancel={() => setCreationView(null)} /> : creationView ? <CreateCheckForm key={creationView} classId={classId} weeks={weeks} embedded initialMode={creationView} onClose={() => setCreationView("choose")} onCreated={handleCreated} /> : !activeSession ? <div className={styles.card}><div className={styles.mainEmpty}><MIcon name="checklist" size={30} /><p>{statusFilter === "active" ? "請從左側選擇一項檢查，或新增檢查。" : "請選擇已封存的檢查查看內容與結果。"}</p><button type="button" className={styles.btnPrimary} onClick={() => statusFilter === "active" ? (setSourceOnly(false), setCreationView("choose")) : setStatusFilter("active")}>{statusFilter === "active" ? "新增檢查" : "查看進行中"}</button></div></div> : <>
            <div className={styles.sessionHeader}><div><h3>{activeSession.title}</h3><p>{activeSessionFilePrefix}對話 {activeSession.message_count ?? 0} · 腳本 {activeSession.script_count ?? 0} · 執行 {activeSession.run_count ?? 0}</p></div>{activeSession.status === "archived" && <span className={styles.archivedNotice}><MIcon name="lock" size={14} />這項檢查已封存，只能查看或複製</span>}</div>
            <div className={styles.subTabs} role="tablist" aria-label="檢查工作頁籤">{TEACHER_JUDGE_TABS.map((tab) => <button key={tab.key} type="button" role="tab" aria-selected={activeTab === tab.key} className={activeTab === tab.key ? styles.subTabActive : styles.subTab} onClick={() => setActiveTab(tab.key)}><MIcon name={tab.icon} size={16} />{tab.label}</button>)}</div>
            {activeTab === "rubrics" && <RubricsTab key={activeSession.id} classId={classId} judgeSession={activeSession} onSessionUpdated={updateSessionInList} onAddSource={() => { setSourceOnly(true); setCreateOpen(true); }} onScriptCreated={() => { loadSessions(); setActiveTab("scripts"); }} showFileLibrary={false} />}
            {activeTab === "scripts" && <ScriptsTab classId={classId} sessionId={activeSession.id} readOnly={activeSession.status === "archived"} onScriptApproved={() => setActiveTab("execution")} />}
            {activeTab === "execution" && <ExecutionTab classId={classId} sessionId={activeSession.id} readOnly={activeSession.status === "archived"} members={members} />}
          </>}
        </section>
      </div>

      {typeof document !== "undefined" && sessionMenuItemKeep.open && sessionMenuPos.item && createPortal(renderSessionMenu(sessionMenuItemKeep.item), document.body)}

      {createDialog.open && <CreateCheckForm classId={classId} weeks={weeks} sourceOnly={sourceOnly} closing={createDialog.closing} onClose={() => { setCreateOpen(false); setSourceOnly(false); }} onCreated={handleCreated} />}
       {renameDialog.open && <div className={`${styles.modalOverlay} ${renameDialog.closing ? styles.modalOverlayOut : ""}`} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setRenameTarget(null); }}><form className={`${styles.confirm} ${styles.renameDialog}`} role="dialog" aria-modal="true" aria-labelledby="rename-check-title" onSubmit={renameSession}><div className={styles.modalHeader}><h2 id="rename-check-title">重新命名檢查</h2><button type="button" className={styles.iconBtn} aria-label="關閉" onClick={() => setRenameTarget(null)}><MIcon name="close" size={18} /></button></div><label className={styles.dialogField}><span>檢查名稱</span><input autoFocus value={renameTitle} maxLength={255} onChange={(event) => setRenameTitle(event.target.value)} /></label><div className={styles.modalActions}><button type="button" className={styles.btnSecondary} onClick={() => setRenameTarget(null)}>取消</button><button type="submit" className={styles.btnPrimary} disabled={!renameTitle.trim() || busySessionIds.has(renameDialog.item.id)}>儲存</button></div></form></div>}
      {deleteCheckDialog.open && <ConfirmModal title="確認刪除檢查？" description={`「${deleteCheckDialog.item.title}」及其專屬評分表來源、對話、檢查腳本與執行紀錄將直接刪除，且無法復原；其他檢查不受影響。`} closing={deleteCheckDialog.closing} onClose={() => { if (!deleting) setDeleteTarget(null); }} actions={<><button type="button" className={styles.btnSecondary} disabled={deleting} onClick={() => setDeleteTarget(null)}>取消</button><button type="button" className={styles.btnDanger} disabled={deleting} onClick={deleteSession}>{deleting ? "刪除中…" : "確認刪除"}</button></>} />}
    </div>
  );
}

export default function AiJudgePanel({ classId, members, weeks = [] }) {
  return <TeacherWorkspacePanel classId={classId} members={members} weeks={weeks} />;
}
