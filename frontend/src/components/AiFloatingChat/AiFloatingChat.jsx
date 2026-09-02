import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import { useAuth } from "../../contexts/AuthContext";
import { AiNavigationService } from "../../services/aiNavigation";
import { AiTemplateRecommendationApi } from "../../services/aiTemplateRecommendation";
import MIcon from "../MIcon";
import useDialogPresence from "../../hooks/useDialogPresence";
import styles from "./AiFloatingChat.module.scss";

const PAGE_CONTEXTS = [
  { match: /^\/dashboard/, title: "首頁", suggestions: ["推薦適合我的機器規格", "我要申請一台機器", "帶我到我的資源"] },
  { match: /^\/my-resources/, title: "我的資源", suggestions: ["說明資源可以進行哪些操作", "帶我到我的申請", "如何公開 Web 服務？"] },
  { match: /^\/my-requests/, title: "我的申請", suggestions: ["推薦適合我的機器規格", "我該申請 LXC 還是 VM？", "申請機器的完整流程"] },
  { match: /^\/resource-mgmt/, title: "資源管理", suggestions: ["帶我到申請審核", "如何選擇 GPU？", "帶我到資源監控"] },
  { match: /^\/request-review/, title: "申請審核", suggestions: ["帶我到資源管理", "說明 LXC 與 VM 的差異", "帶我到背景任務"] },
  { match: /^\/ip-management/, title: "IP 管理", suggestions: ["說明 IP 管理的用途", "帶我到閘道 VM", "如何公開 Web 服務？"] },
  { match: /^\/reverse-proxy/, title: "反向代理", suggestions: ["如何公開 Web 服務？", "帶我到網域管理", "帶我到防火牆"] },
  { match: /^\/firewall/, title: "防火牆", suggestions: ["說明防火牆規則的用途", "帶我到反向代理", "帶我到 IP 管理"] },
  { match: /^\/domain/, title: "網域管理", suggestions: ["如何公開 Web 服務？", "帶我到反向代理", "帶我到 IP 管理"] },
  { match: /^\/gateway/, title: "閘道 VM", suggestions: ["說明閘道 VM 的用途", "帶我到 IP 管理", "帶我到防火牆"] },
  { match: /^\/ai-api-review/, title: "AI API 申請審核", suggestions: ["帶我到金鑰管理", "帶我到使用監控", "說明 AI API 申請流程"] },
  { match: /^\/ai-api-keys/, title: "AI API 金鑰管理", suggestions: ["帶我到使用監控", "帶我到申請審核", "說明 API 金鑰安全原則"] },
  { match: /^\/ai-monitoring/, title: "AI API 使用監控", suggestions: ["帶我到金鑰管理", "帶我到申請審核", "如何管理 AI API 配額？"] },
  { match: /^\/ai-pve/, title: "AI PVE 維運助手", suggestions: ["查看節點狀態", "檢查 VM 資源用量", "說明安全指令確認流程"] },
  { match: /^\/ai-api/, title: "AI API", suggestions: ["說明 AI API 申請流程", "如何保護 API 金鑰？", "我適合使用哪種 AI 服務？"] },
  { match: /^\/templates/, title: "模板管理", suggestions: ["說明 LXC 與 VM 模板差異", "帶我到資源管理", "如何選擇 GPU？"] },
  { match: /^\/gpu-mgmt/, title: "GPU 管理", suggestions: ["如何選擇 GPU？", "帶我到資源管理", "帶我到申請審核"] },
  { match: /^\/monitoring/, title: "資源監控", suggestions: ["帶我到資源管理", "帶我到背景任務", "說明資源監控用途"] },
];

const DEFAULT_CONTEXT = {
  title: "SkyLab",
  suggestions: ["推薦適合我的機器規格", "我要申請一台機器", "有哪些功能可以使用？"],
};

/* 同一個對話框背後有三種能力，開場就講清楚，使用者才會用到後面兩個。 */
const CAPABILITIES = [
  { icon: "explore", title: "找功能", detail: "說出你要做的事，我直接帶你到那一頁" },
  { icon: "checklist", title: "帶你走流程", detail: "多步驟的任務會列成清單，跟著你的進度前進" },
  { icon: "auto_fix_high", title: "推薦規格並填好申請單", detail: "描述用途，我規劃配置並把申請表單填好" },
];

const NAVIGATION_PATTERN = /(帶我|前往|打開|開啟|跳到|導航|在哪|哪裡|頁面)/i;
/* 「我要申請一台機器」這種整件事的描述沒有導覽關鍵字，但正是流程導覽要接的。 */
const GUIDE_PATTERN = /(怎麼|怎樣|如何|步驟|流程|我要|我想|幫我)/i;
/* 問規格、問選哪個 → 交給推薦規劃，回來的是一份可以直接填進申請單的配置。 */
const RECOMMEND_PATTERN =
  /(推薦|建議|規格|配置|幾核|多少核|記憶體|多大|硬碟|該用|適合|還是|哪個|哪種|比較|差別|差異)/i;

/**
 * 一句話該交給哪個能力：推薦配置、導覽（含流程）、或一般問答。
 * 三者共用同一個對話框，使用者不需要知道背後是不同的服務。
 */
export function routeQuestion(text) {
  if (RECOMMEND_PATTERN.test(text)) return "recommend";
  if (NAVIGATION_PATTERN.test(text) || GUIDE_PATTERN.test(text)) return "navigate";
  return "chat";
}

/** 把推薦出來的 form_prefill 講成人看得懂的幾行。 */
export function describePlan(prefill = {}) {
  const lines = [];
  if (prefill.resource_type) {
    lines.push(`類型：${prefill.resource_type === "vm" ? "虛擬機" : "LXC 容器"}`);
  }
  const spec = [
    prefill.cores ? `${prefill.cores} 核心` : "",
    prefill.memory_mb ? `${(prefill.memory_mb / 1024).toFixed(1)} GB RAM` : "",
    prefill.disk_gb ? `${prefill.disk_gb} GB 硬碟` : "",
  ].filter(Boolean);
  if (spec.length) lines.push(`規格：${spec.join(" · ")}`);
  if (prefill.gpu_mapping_id) lines.push(`GPU：${prefill.gpu_mapping_id}`);
  if (prefill.start_at && prefill.end_at) {
    const day = (value) => new Date(value).toLocaleDateString("zh-TW");
    lines.push(`時段：${day(prefill.start_at)} ～ ${day(prefill.end_at)}`);
  } else if (prefill.mode === "immediate") {
    lines.push("時段：立即使用");
  }
  return lines;
}

function stripThinkTags(text) {
  return String(text || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

function pageContextFor(pathname) {
  return PAGE_CONTEXTS.find((item) => item.match.test(pathname)) ?? DEFAULT_CONTEXT;
}

function newSessionId() {
  return globalThis.crypto?.randomUUID?.() ?? `nav-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function displayName(user) {
  return user?.full_name?.trim() || user?.email?.split("@")[0] || "你好";
}

function TypingIndicator() {
  return (
    <div className={styles.typing} aria-label="AI 正在回覆">
      <span /><span /><span />
    </div>
  );
}

const STEP_ICON = { done: "check_circle", current: "play_circle", todo: "radio_button_unchecked" };

/* 步驟狀態以「使用者現在在哪一頁」為準，所以他一邊照做、清單就一邊往前推。
   找不到對應頁面時才退回後端算好的狀態。 */
export function stepStatuses(steps, currentPath, floor = 0) {
  // floor 之前的步驟已經做完（例如配置已經產生），不能因為還停在同一頁就倒退回去
  const byPath = steps.findIndex((step, index) => index >= floor && step.path === currentPath);
  const marked = steps.findIndex((step) => step.status === "current");
  // 沒有 floor 也沒人標記時就原樣顯示，不要憑空發明一個進度
  const fallback = marked >= 0 ? Math.max(floor, marked) : (floor > 0 ? floor : -1);
  const active = byPath >= 0 ? byPath : fallback;
  if (active < 0) return steps.map((step) => step.status);
  return steps.map((_, index) => (index < active ? "done" : index === active ? "current" : "todo"));
}

function StepList({ steps, currentPath, floor = 0, onNavigate, onRecommend }) {
  const statuses = stepStatuses(steps, currentPath, floor);
  return (
    <ol className={styles.stepList}>
      {steps.map((step, index) => (
        <li key={`${step.path}-${index}`} className={styles[`step_${statuses[index]}`]}>
          {/* action 步驟由助手就地完成，不換頁 */}
          <button
            type="button"
            onClick={() => (step.action === "recommend"
              ? onRecommend()
              : onNavigate(step.path, step.state))}
          >
            <MIcon
              name={step.action === "recommend" && statuses[index] !== "done"
                ? "auto_fix_high"
                : (STEP_ICON[statuses[index]] ?? STEP_ICON.todo)}
              size={17}
            />
            <span>
              <strong>{index + 1}. {step.title}</strong>
              {/* 做完的步驟只留標題，說明文字佔掉的版面留給還沒做的 */}
              {step.detail && statuses[index] !== "done" && <small>{step.detail}</small>}
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

function PlanCard({ plan, onNavigate }) {
  const lines = describePlan(plan.prefill);
  return (
    <div className={styles.planCard}>
      {lines.length > 0 && (
        <ul className={styles.planSpec}>
          {lines.map((line) => <li key={line}>{line}</li>)}
        </ul>
      )}
      <button type="button" onClick={() => onNavigate("/my-requests", { create: true, prefill: plan.prefill })}>
        <MIcon name="edit_note" size={17} />
        <span>
          <strong>帶我去填好的申請單</strong>
          <small>會直接開啟申請表單並填入這份配置，帳號密碼仍由你輸入</small>
        </span>
      </button>
    </div>
  );
}

/* 配置模式的答案晶片：點一下就等於打了那句話 */
function ChoiceRow({ choices, progress, onAnswer, onPlanNow }) {
  return (
    <div className={styles.choiceBlock}>
      {progress && <span className={styles.choiceProgress}>{progress}</span>}
      <div className={styles.choiceRow}>
        {choices.map((choice) => (
          <button key={choice} type="button" onClick={() => onAnswer(choice)}>
            {choice}
          </button>
        ))}
        <button type="button" className={styles.choiceSkip} onClick={onPlanNow}>
          直接產生配置
        </button>
      </div>
    </div>
  );
}

function Message({ message, currentPath, onNavigate, onRecommend, onAnswer, onPlanNow }) {
  const isUser = message.role === "user";
  return (
    <div className={`${styles.message} ${isUser ? styles.messageUser : styles.messageAssistant}`}>
      {!isUser && (
        <span className={styles.messageAvatar}>
          <MIcon name="smart_toy" size={17} />
        </span>
      )}
      <div className={styles.messageContent}>
        {/* 模型回的是 markdown（清單、粗體、程式碼），直接印出來會看到一堆星號 */}
        {isUser ? (
          <div className={styles.messageText}>{message.content}</div>
        ) : (
          <div className={`${styles.messageText} ${styles.markdown}`}>
            <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{message.content}</ReactMarkdown>
          </div>
        )}
        {/* 先給結果（配置），再給接下來要做的事（流程），最後才是選項 */}
        {message.plan && <PlanCard plan={message.plan} onNavigate={onNavigate} />}
        {message.steps?.length > 0 && (
          <StepList
            steps={message.steps}
            currentPath={currentPath}
            floor={message.stepsFloor ?? 0}
            onNavigate={onNavigate}
            onRecommend={onRecommend}
          />
        )}
        {message.choices?.length > 0 && (
          <ChoiceRow
            choices={message.choices}
            progress={message.progress}
            onAnswer={onAnswer}
            onPlanNow={onPlanNow}
          />
        )}
        {message.targets?.length > 0 && (
          <div className={styles.actionList}>
            {message.targets.map((target) => (
              <button key={target.path} type="button" onClick={() => onNavigate(target.path, target.state)}>
                <span>
                  <strong>{target.title}</strong>
                  {target.reason && <small>{target.reason}</small>}
                </span>
                <MIcon name="arrow_forward" size={17} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AiFloatingChat({ open = false, onOpenChange = () => {} }) {
  // 關閉時先播放離場動畫再卸載面板
  const presence = useDialogPresence(open, 180);
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [history, setHistory] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  // 只用來把同一段對話的用量記錄串起來；按「建立新對話」就換一個
  const sessionIdRef = useRef(newSessionId());
  // 配置模式：{ answered, total }，null 代表沒在配置模式
  const [intake, setIntake] = useState(null);
  // 問過哪幾格。問句由推薦 AI 生成，字面對不上，只能自己記
  const askedRef = useRef([]);
  // 正在進行的流程，配置產生後要接回它的下一步，不能斷在配置卡片
  const flowRef = useRef(null);
  const pageContext = useMemo(() => pageContextFor(location.pathname), [location.pathname]);

  useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.focus(), 120);
  }, [open]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading]);

  function close() {
    onOpenChange(false);
  }

  function clearChat() {
    setMessages([]);
    setHistory([]);
    setInput("");
    setIntake(null);
    askedRef.current = [];
    flowRef.current = null;
    sessionIdRef.current = newSessionId();
    inputRef.current?.focus();
  }

  function handleNavigate(path, state) {
    if (!path) return;
    navigate(path, state ? { state } : undefined);
    if (window.matchMedia("(max-width: 1439px)").matches) close();
  }

  async function sendNavigation(text, nextHistory) {
    const data = await AiNavigationService.resolve(text, {
      // 送出前的前文（不含這一輪），讓「然後呢」這種追問有東西可以指
      history: nextHistory.slice(0, -1),
      currentPath: location.pathname,
      sessionId: sessionIdRef.current,
    });
    const steps = data.steps ?? [];

    if (data.action === "guide" && steps.length) {
      flowRef.current = { title: data.flow_title, steps };
      const content = `${data.flow_title ?? "操作流程"}：照著下面的步驟走，我會跟著你目前的頁面標記進度。`;
      const assistantMessage = { role: "assistant", content, steps };
      setMessages((previous) => [...previous, assistantMessage]);
      setHistory((previous) => [...previous, {
        role: "assistant",
        content: `${content}（${steps.map((step) => step.title).join("→")}）`,
      }]);
      return true;
    }

    const targets = [...(data.primary ? [data.primary] : []), ...(data.suggestions ?? [])]
      .filter((target, index, all) => all.findIndex((item) => item.path === target.path) === index);

    // 導覽答不出東西時，交給一般問答回答，不要用「找不到頁面」把使用者擋掉。
    if (!targets.length) return false;

    const content = data.action === "clarify"
      ? (data.clarification_question || "你想前往哪一類功能？")
      : "我找到以下可能符合需求的功能：";
    const assistantMessage = { role: "assistant", content, targets };
    setMessages((previous) => [...previous, assistantMessage]);
    setHistory((previous) => [...previous, { role: "assistant", content }]);
    return true;
  }

  /* 推薦配置：規劃出一份可以直接送出的申請內容。資源候選（作業系統、GPU、時段）
     由後端自己補，所以助手不在申請頁也能規劃。 */
  async function sendRecommendation(text, nextHistory) {
    let data;
    try {
      data = await AiTemplateRecommendationApi.recommend({
        messages: nextHistory,
        top_k: 5,
        device_nodes: [],
        form_context: null,
      });
    } catch {
      // 規劃是三個能力裡最重的一個，失敗就讓一般問答接手，不要整段對話中斷。
      return false;
    }
    const plan = data?.final_plan;
    const prefill = plan?.form_prefill;
    if (!prefill?.resource_type) return false;

    const content = stripThinkTags(plan.summary) || "依你的需求，我建議這樣的配置：";

    /* 配置只是流程的一步，產生完要把剩下的步驟接回來，不能停在配置卡片。
       規劃那一步標記為完成，下一步（填申請單）變成目前進度。 */
    const flow = flowRef.current;
    const recommendIndex = flow
      ? flow.steps.findIndex((step) => step.action === "recommend")
      : -1;
    const followUp = flow && recommendIndex >= 0
      ? { steps: flow.steps, stepsFloor: recommendIndex + 1 }
      : {};

    const assistantMessage = { role: "assistant", content, plan: { prefill }, ...followUp };
    setMessages((previous) => [...previous, assistantMessage]);
    setHistory((previous) => [...previous, {
      role: "assistant",
      content: `${content}（${describePlan(prefill).join("；")}）`,
    }]);
    return true;
  }

  /* 配置模式的一輪：先看還缺什麼，缺就問（問句交給推薦 AI 用顧問語氣講），
     問齊了才規劃。這樣使用者是被一題一題帶著走，而不是一句話就收到一份猜的配置。 */
  async function advanceIntake(nextHistory) {
    const state = await AiNavigationService.intake(nextHistory, askedRef.current);
    /* 直接問「推薦規格」進來的人沒有走過流程，這裡把流程補上，
       配置產生後才有下一步可以接。 */
    if (state.steps?.length && !flowRef.current) {
      flowRef.current = { title: state.flow_title, steps: state.steps };
    }

    if (state.ready || !state.question) {
      setIntake(null);
      askedRef.current = [];
      return await sendRecommendation("", nextHistory);
    }

    askedRef.current = [...new Set([...askedRef.current, state.question.key])];
    setIntake({ answered: state.answered, total: state.total });

    // 問句由推薦 AI 產生；它掛掉時就用伺服器端那句制式問法，不要卡住對話。
    let question = state.question.text;
    try {
      const reply = await AiTemplateRecommendationApi.chat({
        messages: nextHistory,
        top_k: 5,
        device_nodes: [],
        form_context: null,
        focus_hint: state.question.text,
      });
      question = stripThinkTags(reply.reply) || question;
    } catch {
      /* 用制式問法 */
    }

    const assistantMessage = {
      role: "assistant",
      content: question,
      choices: state.question.options,
      progress: `已掌握 ${state.answered}/${state.total}`,
    };
    setMessages((previous) => [...previous, assistantMessage]);
    setHistory((previous) => [...previous, { role: "assistant", content: question }]);
    return true;
  }

  /* 流程裡的「讓 AI 規劃配置」那一步：從這裡進配置模式。 */
  async function runRecommendation() {
    if (loading) return;
    const nextHistory = history.length
      ? history
      : [{ role: "user", content: "我想申請一台機器，請幫我規劃配置。" }];
    setLoading(true);
    try {
      await advanceIntake(nextHistory);
    } catch {
      setMessages((previous) => [...previous, {
        role: "assistant",
        content: "我還需要知道這台機器要做什麼，例如「跑深度學習訓練」或「架一個網站」。",
      }]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  /* 不想被問完的人可以直接跳到結果 */
  async function planNow() {
    if (loading) return;
    setIntake(null);
    askedRef.current = [];
    setLoading(true);
    try {
      const planned = await sendRecommendation("", history);
      if (!planned) {
        setMessages((previous) => [...previous, {
          role: "assistant",
          content: "我還需要知道這台機器要做什麼，例如「跑深度學習訓練」或「架一個網站」。",
        }]);
      }
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  async function sendChat(text, nextHistory) {
    const contextualHistory = nextHistory.map((message, index) => {
      if (index !== nextHistory.length - 1 || message.role !== "user") return message;
      return {
        ...message,
        content: `目前所在頁面：${pageContext.title}。使用者問題：${message.content}`,
      };
    });
    const data = await AiTemplateRecommendationApi.chat({
      messages: contextualHistory,
      top_k: 5,
      device_nodes: [],
      form_context: null,
    });
    const assistantMessage = {
      role: "assistant",
      content: stripThinkTags(data.reply) || "目前無法產生回覆，請稍後再試。",
    };
    setMessages((previous) => [...previous, assistantMessage]);
    setHistory((previous) => [...previous, assistantMessage]);
  }

  async function send(value = input) {
    const text = value.trim();
    if (!text || loading) return;

    const userMessage = { role: "user", content: text };
    const nextHistory = [...history, userMessage];
    setInput("");
    setMessages((previous) => [...previous, userMessage]);
    setHistory(nextHistory);
    setLoading(true);

    try {
      // 每個能力答不出來就往下一個退，最後一定有一般問答接住。
      const route = routeQuestion(text);
      // 配置模式進行中就繼續問，除非使用者明講要去別的地方
      const stayInIntake = intake && !NAVIGATION_PATTERN.test(text);
      if (!stayInIntake && intake) {
        setIntake(null);
        askedRef.current = [];
      }

      let handled = false;
      if (stayInIntake || route === "recommend") handled = await advanceIntake(nextHistory);
      else if (route === "navigate") handled = await sendNavigation(text, nextHistory);
      if (!handled) await sendChat(text, nextHistory);
    } catch (error) {
      setMessages((previous) => [...previous, {
        role: "assistant",
        content: error?.message || "AI 目前無法回覆，請稍後再試。",
      }]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  }

  return (
    <div className={`${styles.root} ${presence.open ? styles.rootOpen : ""}`}>
      {presence.open && (
        <button
          type="button"
          className={`${styles.backdrop} ${presence.closing ? styles.backdropOut : ""}`}
          onClick={close}
          aria-label="關閉 AI 助手"
        />
      )}

      {presence.open && (
        <aside className={`${styles.panel} ${presence.closing ? styles.panelOut : ""}`} aria-label="AI 助手">
          <header className={styles.header}>
            <span className={styles.brandIcon}><MIcon name="auto_awesome" size={19} /></span>
            <div className={styles.headerText}>
              <strong>AI 助手</strong>
              <span>SkyLab 智慧協作</span>
            </div>
            <button type="button" onClick={clearChat} title="建立新對話" aria-label="建立新對話">
              <MIcon name="refresh" size={19} />
            </button>
            <button type="button" onClick={close} title="關閉" aria-label="關閉">
              <MIcon name="close" size={21} />
            </button>
          </header>

          <div className={styles.contextBar}>
            {intake ? (
              <>
                <MIcon name="auto_fix_high" size={16} />
                <span>配置模式 · 已掌握 {intake.answered}/{intake.total}，問完就產生配置</span>
              </>
            ) : (
              <>
                <MIcon name="web_asset" size={16} />
                <span>正在查看「{pageContext.title}」</span>
              </>
            )}
          </div>

          <div className={styles.messages} ref={scrollRef}>
            {messages.length === 0 ? (
              <div className={styles.emptyState}>
                <span className={styles.emptyIcon}><MIcon name="auto_awesome" size={30} /></span>
                <h2>{displayName(user)}，你好！</h2>
                <p>有什麼我可以幫上忙的嗎？</p>
                {/* 能力要講出來，不然沒有人知道可以叫它推薦規格、幫忙填表 */}
                <ul className={styles.capabilities}>
                  {CAPABILITIES.map((item) => (
                    <li key={item.title}>
                      <MIcon name={item.icon} size={17} />
                      <span>
                        <strong>{item.title}</strong>
                        <small>{item.detail}</small>
                      </span>
                    </li>
                  ))}
                </ul>
                <div className={styles.suggestions}>
                  {pageContext.suggestions.map((suggestion) => (
                    <button key={suggestion} type="button" onClick={() => send(suggestion)}>
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((message, index) => (
                <Message
                  key={`${message.role}-${index}`}
                  message={message}
                  currentPath={location.pathname}
                  onNavigate={handleNavigate}
                  onRecommend={runRecommendation}
                  onAnswer={(choice) => send(choice)}
                  onPlanNow={planNow}
                />
              ))
            )}
            {loading && (
              <div className={`${styles.message} ${styles.messageAssistant}`}>
                <span className={styles.messageAvatar}><MIcon name="smart_toy" size={17} /></span>
                <TypingIndicator />
              </div>
            )}
          </div>

          <footer className={styles.composerWrap}>
            <div className={styles.composer}>
              <textarea
                ref={inputRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="詢問 SkyLab 或尋找功能"
                rows={2}
                disabled={loading}
              />
              <button type="button" onClick={() => send()} disabled={loading || !input.trim()} aria-label="送出訊息">
                <MIcon name="arrow_upward" size={20} />
              </button>
            </div>
            <small>AI 可能會產生錯誤，重要操作仍需由你確認。</small>
          </footer>
        </aside>
      )}

      {!presence.open && (
        <button type="button" className={styles.fab} onClick={() => onOpenChange(true)} aria-label="開啟 AI 助手">
          <MIcon name="auto_awesome" size={21} />
          <span>AI 助手</span>
        </button>
      )}
    </div>
  );
}
