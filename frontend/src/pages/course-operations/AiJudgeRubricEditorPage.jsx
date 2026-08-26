import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import MIcon from "../../components/MIcon";
import { useToast } from "../../hooks/useToast";
import {
  AiJudgeService,
  TEMPLATE_OPTIONS,
  getTemplateLabel,
} from "../../services/aiJudge";
import styles from "./AiJudgeRubricEditorPage.module.scss";

const EMPTY_ANALYSIS = {
  items: [],
  total_items: 0,
  checked_count: 0,
  auto_count: 0,
  partial_count: 0,
  manual_count: 0,
  summary: "",
  raw_text: "",
};

const EMPTY_ITEM = () => ({
  id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  title: "新評估項目",
  description: "",
  checked: false,
  detectable: "manual",
  detection_method: null,
  fallback: null,
  check_steps: [],
});

function normalizeAnalysis(value) {
  const analysis = value && typeof value === "object" ? value : {};
  const items = Array.isArray(analysis.items) ? analysis.items : [];
  return {
    ...EMPTY_ANALYSIS,
    ...analysis,
    items,
    total_items: items.length,
    checked_count: items.filter((item) => item.checked).length,
    auto_count: items.filter((item) => item.detectable === "auto").length,
    partial_count: items.filter((item) => item.detectable === "partial").length,
    manual_count: items.filter((item) => item.detectable === "manual").length,
  };
}

function detectionLabel(value) {
  return {
    auto: "可自動偵測",
    partial: "部分可偵測",
    manual: "需人工評閱",
  }[value] ?? "需人工評閱";
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
 * The backend returns a complete list for an AI edit. Turn that list into a
 * small, reviewable diff so the teacher can see additions, edits, and deletes
 * before anything is written back to the rubric.
 */
function buildProposalDiff(currentItems, proposedItems) {
  const currentById = new Map(currentItems.map((item) => [item.id, item]));
  const seenIds = new Set();
  const changes = [];

  proposedItems.forEach((rawItem) => {
    const item = { ...rawItem };
    const operation = item.operation ?? item.action;
    if (operation === "delete" || operation === "remove") {
      if (item.id) {
        seenIds.add(item.id);
        changes.push({ ...item, operation: "delete" });
      }
      return;
    }

    if (!item.id || !currentById.has(item.id)) {
      changes.push({ ...item, operation: "add" });
      if (item.id) seenIds.add(item.id);
      return;
    }

    seenIds.add(item.id);
    if (comparableItem(currentById.get(item.id)) !== comparableItem(item)) {
      changes.push({ ...item, operation: "update" });
    }
  });

  currentItems.forEach((item) => {
    if (!seenIds.has(item.id)) {
      changes.push({
        ...item,
        operation: "delete",
        description: item.description || "AI 建議移除此評估項目",
      });
    }
  });

  return changes;
}

function ItemEditor({ item, index, disabled, assistantDisabled, onChange, onDelete, onAssist }) {
  return (
    <article className={styles.itemCard}>
      <header className={styles.itemHeader}>
        <div className={styles.itemTitleLine}>
          <span className={styles.itemNumber}>#{index + 1}</span>
          <span className={`${styles.detectionBadge} ${styles[`detection_${item.detectable}`]}`}>
            {detectionLabel(item.detectable)}
          </span>
        </div>
        <button
          type="button"
          className={styles.iconButton}
          aria-label={`刪除第 ${index + 1} 項`}
          title="刪除項目"
          disabled={disabled}
          onClick={onDelete}
        >
          <MIcon name="delete" size={18} />
        </button>
      </header>
      <label className={styles.field}>
        <span>主題</span>
        <input
          value={item.title ?? ""}
          placeholder="例如：Python 版本符合課程要求"
          disabled={disabled}
          onChange={(event) => onChange({ ...item, title: event.target.value })}
        />
      </label>
      <label className={styles.field}>
        <span>說明</span>
        <textarea
          rows={3}
          value={item.description ?? ""}
          placeholder="描述導師要確認的條件與判定方式"
          disabled={disabled}
          onChange={(event) => onChange({ ...item, description: event.target.value })}
        />
      </label>
      {(item.detection_method || item.fallback || item.check_steps?.length > 0) && (
        <div className={styles.aiReadOnly}>
          <div className={styles.aiReadOnlyHeading}>
            <MIcon name="smart_toy" size={16} />
            <span>AI 偵測判斷</span>
            <small>僅由 AI 提案更新</small>
          </div>
          {item.detection_method && <p><b>偵測方式：</b>{item.detection_method}</p>}
          {item.fallback && <p><b>替代建議：</b>{item.fallback}</p>}
          {item.check_steps?.length > 0 && (
            <p><b>檢查步驟：</b>{item.check_steps.map((step) => step.command_label ?? step.command_key).join("、")}</p>
          )}
        </div>
      )}
      <button type="button" className={styles.itemAssistButton} disabled={disabled || assistantDisabled} onClick={onAssist}>
        <MIcon name="smart_toy" size={15} />
        {assistantDisabled ? "AI 整理中…" : "請 AI 協助這一項"}
      </button>
    </article>
  );
}

function ProposalPanel({ proposal, selectedIds, onToggle, onApply, onSkip, disabled }) {
  if (!proposal) return null;
  return (
    <section className={styles.proposal} aria-live="polite">
      <div className={styles.proposalHeader}>
        <div>
          <strong>AI 評分表提案</strong>
          <p>逐項確認後才會套用到目前的評分表。</p>
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
                <small><em className={styles.proposalOperation}>{proposalOperationLabel(item)}</em>{item.description || "AI 建議新增或調整此評估項目"}</small>
              </span>
            </label>
          );
        })}
      </div>
      <div className={styles.proposalActions}>
        <button type="button" className={styles.secondaryButton} disabled={disabled} onClick={onSkip}>略過</button>
        <button type="button" className={styles.primaryButton} disabled={disabled || selectedIds.size === 0} onClick={onApply}>套用選取</button>
      </div>
    </section>
  );
}

export default function AiJudgeRubricEditorPage() {
  const { classId, sessionId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [session, setSession] = useState(null);
  const [file, setFile] = useState(null);
  const [analysis, setAnalysis] = useState(EMPTY_ANALYSIS);
  const [title, setTitle] = useState("");
  const [rubricName, setRubricName] = useState("");
  const [environmentKeys, setEnvironmentKeys] = useState([]);
  const [messages, setMessages] = useState([]);
  const [proposal, setProposal] = useState(null);
  const [proposalMeta, setProposalMeta] = useState(null);
  const [selectedProposalIds, setSelectedProposalIds] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [saveState, setSaveState] = useState("saved");
  const [dirty, setDirty] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [assistantOpen, setAssistantOpen] = useState(false);
  const revisionRef = useRef(1);
  const saveTimerRef = useRef(null);
  const pendingRef = useRef(null);
  const saveSequenceRef = useRef(0);
  const editVersionRef = useRef(0);
  const persistingRef = useRef(false);
  const mountedRef = useRef(true);
  const assistantCardRef = useRef(null);
  const assistantPreviousFocusRef = useRef(null);
  const readOnly = session?.status === "archived";

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    Promise.all([
      AiJudgeService.getSession(classId, sessionId),
      AiJudgeService.listFiles(classId),
      AiJudgeService.listSessionMessages(classId, sessionId),
    ])
      .then(([sessionValue, files, messageRows]) => {
        if (cancelled) return;
        const selected = files.find((entry) => entry.id === sessionValue.selected_file_id);
        setSession(sessionValue);
        setFile(selected ?? null);
        setTitle(sessionValue.title ?? "");
        setRubricName(selected?.display_name ?? selected?.original_filename ?? "");
        setEnvironmentKeys(selected?.environment_keys?.length ? selected.environment_keys : selected?.template_key ? [selected.template_key] : []);
        setAnalysis(normalizeAnalysis(selected?.analysis_json));
        revisionRef.current = selected?.analysis_revision ?? 1;
        editVersionRef.current = 0;
        pendingRef.current = null;
        setMessages(messageRows ?? []);
        setDirty(false);
        setSaveState("saved");
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error?.message ?? "無法載入評分表編輯頁。");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [classId, sessionId]);

  const persist = useCallback(async () => {
    const pending = pendingRef.current;
    if (!pending || !file?.id || readOnly) return true;
    if (persistingRef.current) return false;
    persistingRef.current = true;
    const sequence = ++saveSequenceRef.current;
    const version = pending.version;
    setSaveState("saving");
    try {
      const updatedFile = await AiJudgeService.updateFileAnalysis(
        classId,
        file.id,
        pending.analysis,
        revisionRef.current,
      );
      revisionRef.current = updatedFile.analysis_revision ?? revisionRef.current + 1;
      const metadata = await AiJudgeService.updateFileMetadata(classId, file.id, {
        display_name: pending.rubricName,
        environment_keys: pending.environmentKeys,
        template_key: pending.environmentKeys[0],
      });
      const updatedSession = await AiJudgeService.updateSession(classId, sessionId, {
        title: pending.title,
      });
      if (!mountedRef.current || sequence !== saveSequenceRef.current) return false;
      revisionRef.current = metadata.analysis_revision ?? revisionRef.current;
      setFile(metadata);
      setSession(updatedSession);
      if (version !== editVersionRef.current) {
        setDirty(true);
        setSaveState("saving");
        return false;
      }
      pendingRef.current = null;
      setDirty(false);
      setSaveState("saved");
      return true;
    } catch (error) {
      if (!mountedRef.current || sequence !== saveSequenceRef.current) return false;
      setSaveState("error");
      toast.error(error?.message ?? "評分表儲存失敗，請重試");
      return false;
    } finally {
      persistingRef.current = false;
      if (
        mountedRef.current
        && pendingRef.current?.version !== version
        && !saveTimerRef.current
      ) {
        saveTimerRef.current = setTimeout(() => {
          saveTimerRef.current = null;
          persist();
        }, 650);
      }
    }
  }, [classId, file, readOnly, sessionId, toast]);

  const scheduleSave = useCallback((nextAnalysis, overrides = {}) => {
    if (readOnly || !file?.id) return;
    const pending = {
      analysis: normalizeAnalysis(nextAnalysis),
      title: overrides.title ?? title,
      rubricName: overrides.rubricName ?? rubricName,
      environmentKeys: overrides.environmentKeys ?? environmentKeys,
      version: ++editVersionRef.current,
    };
    pendingRef.current = pending;
    setDirty(true);
    setSaveState("saving");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      persist();
    }, 650);
  }, [environmentKeys, file, persist, readOnly, rubricName, title]);

  useEffect(() => {
    function guardBeforeUnload(event) {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", guardBeforeUnload);
    return () => window.removeEventListener("beforeunload", guardBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (!assistantOpen) return undefined;
    assistantPreviousFocusRef.current = document.activeElement;
    const focusTimer = window.setTimeout(() => {
      assistantCardRef.current?.querySelector(
        "button:not(:disabled), textarea:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex=\"-1\"])",
      )?.focus();
    }, 0);
    function handleAssistantKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        setAssistantOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusables = assistantCardRef.current
        ? [...assistantCardRef.current.querySelectorAll(
          "button:not(:disabled), textarea:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex=\"-1\"])",
        )]
        : [];
      if (!focusables.length) return;
      const currentIndex = focusables.indexOf(document.activeElement);
      const nextIndex = event.shiftKey
        ? (currentIndex <= 0 ? focusables.length - 1 : currentIndex - 1)
        : (currentIndex === focusables.length - 1 ? 0 : currentIndex + 1);
      event.preventDefault();
      focusables[nextIndex].focus();
    }
    document.addEventListener("keydown", handleAssistantKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleAssistantKeyDown);
      const previous = assistantPreviousFocusRef.current;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [assistantOpen]);

  function updateTitle(value) {
    setTitle(value);
    scheduleSave(analysis, { title: value });
  }

  function updateRubricName(value) {
    setRubricName(value);
    scheduleSave(analysis, { rubricName: value });
  }

  function toggleEnvironment(key) {
    const next = environmentKeys.includes(key)
      ? environmentKeys.filter((entry) => entry !== key)
      : [...environmentKeys, key];
    setEnvironmentKeys(next);
    scheduleSave(analysis, { environmentKeys: next });
  }

  function updateItem(index, item) {
    const next = normalizeAnalysis({ ...analysis, items: analysis.items.map((entry, itemIndex) => itemIndex === index ? item : entry) });
    setAnalysis(next);
    scheduleSave(next);
  }

  function addItem() {
    const next = normalizeAnalysis({ ...analysis, items: [...analysis.items, EMPTY_ITEM()] });
    setAnalysis(next);
    scheduleSave(next);
  }

  function deleteItem(index) {
    const item = analysis.items[index];
    if (item?.check_steps?.length && !window.confirm("這個項目已有 AI 檢查步驟，確定要刪除嗎？")) return;
    const next = normalizeAnalysis({ ...analysis, items: analysis.items.filter((_, itemIndex) => itemIndex !== index) });
    setAnalysis(next);
    scheduleSave(next);
  }

  async function sendAssistant(content) {
    if (!content.trim() || assistantBusy || readOnly || !sessionId) return;
    const requestEditVersion = editVersionRef.current;
    const requestHadPendingLocalChanges = Boolean(pendingRef.current);
    setAssistantBusy(true);
    try {
      const response = await AiJudgeService.sendSessionMessage(classId, sessionId, content, revisionRef.current);
      setMessages((current) => [...current, response.user_message, response.assistant_message]);
      const rawProposal = response.rubric_proposal ?? null;
      const diff = rawProposal
        ? buildProposalDiff(analysis.items, rawProposal)
        : [];
      const nextProposal = diff.length ? diff : null;
      setProposal(nextProposal);
      setProposalMeta(nextProposal ? {
        baseRevision: response.base_revision ?? revisionRef.current,
        baseEditVersion: requestEditVersion,
        baseHadPendingLocalChanges: requestHadPendingLocalChanges,
      } : null);
      setSelectedProposalIds(new Set((nextProposal ?? []).map((item, index) => item.id ?? `proposal-${index}`)));
    } catch (error) {
      toast.error(error?.message ?? "AI 協助失敗，請稍後再試");
    } finally {
      setAssistantBusy(false);
    }
  }

  function applyProposal() {
    if (!proposal) return;
    if (
      proposalMeta
      && (
        proposalMeta.baseRevision !== revisionRef.current
        || proposalMeta.baseEditVersion !== editVersionRef.current
        || proposalMeta.baseHadPendingLocalChanges
      )
    ) {
      setProposal(null);
      setProposalMeta(null);
      toast.error("評分表已經有新的修改，請重新請 AI 產生提案。");
      return;
    }
    const selected = proposal.filter((item, index) => selectedProposalIds.has(item.id ?? `proposal-${index}`));
    const byId = new Map(analysis.items.map((item) => [item.id, item]));
    selected.forEach((item) => {
      const operation = item.operation ?? item.action;
      if (operation === "delete" || operation === "remove") byId.delete(item.id);
      else if (item.id) byId.set(item.id, { ...byId.get(item.id), ...item });
      else {
        const id = item.id ?? `item-${Date.now()}-${byId.size}`;
        byId.set(id, { ...item, id });
      }
    });
    const next = normalizeAnalysis({ ...analysis, items: [...byId.values()] });
    setAnalysis(next);
    scheduleSave(next);
    setProposal(null);
    setProposalMeta(null);
    toast.success("已套用選取的 AI 變更");
  }

  async function completeAndReturn() {
    if (readOnly) {
      navigate(`/class-management/${classId}/ai`);
      return;
    }
    if (!title.trim() || !rubricName.trim()) {
      toast.error("請填寫檢查名稱與評分表名稱");
      return;
    }
    if (!environmentKeys.length) {
      toast.error("請至少選擇一個評分環境");
      return;
    }
    if (!analysis.items.some((item) => item.title?.trim())) {
      toast.error("請至少新增一個評估項目");
      return;
    }
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      const saved = await persist();
      if (!saved) return;
    } else if (dirty) {
      const saved = await persist();
      if (!saved) return;
    }
    navigate(`/class-management/${classId}/ai`);
  }

  function goBack() {
    if (dirty && !window.confirm("仍有尚未儲存的修改，確定離開嗎？")) return;
    navigate(`/class-management/${classId}/ai`);
  }

  if (loading) {
    return <main className={styles.page}><div className={styles.loading}><span className={styles.spinner} />正在載入評分表…</div></main>;
  }
  if (loadError || !file) {
    return (
      <main className={styles.page}>
        <button type="button" className={styles.backLink} onClick={goBack}><MIcon name="arrow_back" size={18} />返回 AI 檢查</button>
        <section className={styles.errorState}><MIcon name="error_outline" size={30} /><h1>無法載入評分表</h1><p>{loadError || "這項檢查目前沒有可編輯的評分表來源。"}</p></section>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerIdentity}>
          <button type="button" className={styles.backLink} onClick={goBack}><MIcon name="arrow_back" size={18} />返回 AI 檢查</button>
          <div>
            <h1>從零建立評分表</h1>
            <p>{session?.title} · {rubricName || "未命名評分表"}</p>
          </div>
        </div>
        <div className={styles.headerActions}>
          <span className={`${styles.saveState} ${styles[`save_${saveState}`]}`} aria-live="polite">
            <MIcon name={saveState === "saved" ? "cloud_done" : saveState === "error" ? "cloud_off" : "sync"} size={16} />
            {saveState === "saved" ? "已儲存" : saveState === "error" ? "儲存失敗，重試" : "正在儲存"}
          </span>
          {saveState === "error" && <button type="button" className={styles.secondaryButton} onClick={() => persist()} disabled={readOnly}>重試儲存</button>}
          <button type="button" className={styles.primaryButton} onClick={completeAndReturn} disabled={saveState === "saving" && !dirty}>
            <MIcon name="check" size={17} />{readOnly ? "返回檢查" : "完成並返回"}
          </button>
        </div>
      </header>

      {readOnly && <div className={styles.readOnlyNotice}><MIcon name="lock" size={17} />這項檢查已封存，只能查看內容與複製成新檢查。</div>}

      <div className={styles.layout}>
        <section className={styles.mainColumn}>
          <section className={styles.card}>
            <div className={styles.cardHeading}><div><h2>基本資料</h2><p>先定義這次檢查的名稱與適用環境。</p></div><span className={styles.stepHint}>必要設定</span></div>
            <div className={styles.formGrid}>
              <label className={styles.field}><span>檢查名稱</span><input value={title} maxLength={255} disabled={readOnly} onChange={(event) => updateTitle(event.target.value)} /></label>
              <label className={styles.field}><span>評分表名稱</span><input value={rubricName} maxLength={255} disabled={readOnly} onChange={(event) => updateRubricName(event.target.value)} /></label>
            </div>
            <fieldset className={styles.environmentFieldset}>
              <legend>評分環境（可複選）</legend>
              <div className={styles.environmentGrid}>
                {TEMPLATE_OPTIONS.map((option) => {
                  const checked = environmentKeys.includes(option.key);
                  return <label key={option.key} className={`${styles.environmentOption} ${checked ? styles.environmentOptionSelected : ""}`}><input type="checkbox" checked={checked} disabled={readOnly} onChange={() => toggleEnvironment(option.key)} /><span className={styles.checkVisual}><MIcon name={checked ? "check" : "add"} size={16} /></span><span><b>{option.label}</b><small>{option.key === "linux" ? "常見 Linux 指令與服務" : option.key === "python" ? "Python 執行環境與套件" : "n8n 工作流程服務"}</small></span></label>;
                })}
              </div>
              <p className={styles.helperText}>{environmentKeys.length ? `目前以「${getTemplateLabel(environmentKeys[0])}」產生 AI 偵測建議；其他環境會保留在候選清單。` : "請至少選擇一個環境。"}</p>
            </fieldset>
            <div className={styles.backendStatus}><MIcon name="dns" size={18} /><div><b>後端環境判斷：尚未啟用</b><span>目前只保存你選擇的候選環境，尚未連線探測班級機器。</span></div><span className={styles.statusTag}>預留串接位置</span></div>
          </section>

          <section className={styles.card}>
            <div className={styles.cardHeading}><div><h2>評估項目（{analysis.items.length}）</h2><p>每一項都會成為腳本與執行結果的判定依據。</p></div><button type="button" className={styles.secondaryButton} disabled={readOnly} onClick={addItem}><MIcon name="add" size={17} />新增項目</button></div>
            {!analysis.items.length ? <div className={styles.emptyItems}><MIcon name="playlist_add" size={28} /><strong>尚未新增評估項目</strong><p>可手動新增第一項，或請右側 AI 評分表助手產生初稿。</p><button type="button" className={styles.primaryButton} disabled={readOnly || assistantBusy} onClick={() => sendAssistant("請依目前檢查名稱與評分環境，產生評估項目初稿")}>產生評估項目初稿</button></div> : <div className={styles.itemsList}>{analysis.items.map((item, index) => <ItemEditor key={item.id ?? index} item={item} index={index} disabled={readOnly} assistantDisabled={assistantBusy} onChange={(next) => updateItem(index, next)} onDelete={() => deleteItem(index)} onAssist={() => sendAssistant(`請協助改善第 ${index + 1} 項「${item.title ?? "未命名項目"}」的說明、可偵測性與檢查步驟，只提出可供我確認的評分表提案。`)} />)}</div>}
            {analysis.items.length > 0 && <div className={styles.itemsFooter}><span>{analysis.items.filter((item) => item.detectable === "auto").length} 項可自動偵測 · {analysis.items.filter((item) => item.detectable === "partial").length} 項部分可偵測 · {analysis.items.filter((item) => item.detectable === "manual").length} 項需人工評閱</span><button type="button" className={styles.secondaryButton} disabled={readOnly || assistantBusy} onClick={() => sendAssistant("請檢查目前評分表，指出缺漏並提出可套用的修改建議")}>檢查目前評分表</button></div>}
          </section>
        </section>

        <aside className={`${styles.assistantColumn} ${assistantOpen ? styles.assistantColumnOpen : ""}`} aria-label="AI 評分表助手">
          <button
            type="button"
            className={styles.assistantToggle}
            aria-expanded={assistantOpen}
            aria-controls="rubric-assistant"
            onClick={() => setAssistantOpen(true)}
          >
            <MIcon name="smart_toy" size={17} />開啟 AI 評分表助手
          </button>
          {assistantOpen && <button type="button" className={styles.assistantBackdrop} aria-label="關閉 AI 評分表助手" onClick={() => setAssistantOpen(false)} />}
          <div id="rubric-assistant" ref={assistantCardRef} className={styles.assistantCard}>
            <div className={styles.assistantHeading}><span className={styles.assistantIcon}><MIcon name="smart_toy" size={20} /></span><div><h2>AI 評分表助手</h2><p>提案會先送給你確認，不會直接改內容。</p></div><button type="button" className={styles.assistantClose} aria-label="關閉 AI 評分表助手" onClick={() => setAssistantOpen(false)}><MIcon name="close" size={18} /></button></div>
            <div className={styles.assistantMessages}>
              {!messages.length ? <div className={styles.assistantEmpty}><MIcon name="lightbulb" size={24} /><p>你可以請 AI 產生初稿、補缺漏，或改寫單一項目的說明。</p><button type="button" className={styles.assistantAction} disabled={readOnly || assistantBusy} onClick={() => sendAssistant(analysis.items.length ? "請檢查目前評分表，提出改善建議" : "請依目前檢查名稱與評分環境，產生評估項目初稿")}><MIcon name="auto_awesome" size={16} />{analysis.items.length ? "檢查目前評分表" : "產生評估項目初稿"}</button></div> : messages.map((message) => <div key={message.id ?? `${message.role}-${message.created_at}`} className={`${styles.message} ${message.role === "user" ? styles.messageUser : ""}`}><span>{message.role === "user" ? "你" : "AI"}</span><p>{message.content}</p></div>)}
              {assistantBusy && <div className={styles.typing}><span /><span /><span />AI 正在整理提案…</div>}
            </div>
            <form className={styles.assistantForm} onSubmit={(event) => { event.preventDefault(); const input = event.currentTarget.elements.namedItem("assistant"); if (input.value.trim()) { sendAssistant(input.value); input.value = ""; } }}><textarea name="assistant" rows={2} placeholder="例如：補充 Python 套件版本檢查" disabled={readOnly || assistantBusy} /><button type="submit" className={styles.primaryButton} disabled={readOnly || assistantBusy}><MIcon name="send" size={16} />送出</button></form>
            <ProposalPanel proposal={proposal} selectedIds={selectedProposalIds} onToggle={(id) => setSelectedProposalIds((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; })} onApply={applyProposal} onSkip={() => { setProposal(null); setProposalMeta(null); }} disabled={readOnly || assistantBusy} />
          </div>
        </aside>
      </div>
    </main>
  );
}
