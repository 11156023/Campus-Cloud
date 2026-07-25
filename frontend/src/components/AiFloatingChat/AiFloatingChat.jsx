import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { AiNavigationService } from "../../services/aiNavigation";
import { AiTemplateRecommendationApi } from "../../services/aiTemplateRecommendation";
import MIcon from "../MIcon";
import styles from "./AiFloatingChat.module.scss";

const PAGE_CONTEXTS = [
  { match: /^\/dashboard/, title: "首頁", suggestions: ["我該申請 LXC 還是 VM？", "帶我到我的資源", "如何申請 GPU？"] },
  { match: /^\/my-resources/, title: "我的資源", suggestions: ["說明資源可以進行哪些操作", "帶我到我的申請", "如何公開 Web 服務？"] },
  { match: /^\/my-requests/, title: "我的申請", suggestions: ["我該申請 LXC 還是 VM？", "如何選擇資源規格？", "帶我到我的資源"] },
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
  { match: /^\/ai-api/, title: "AI API", suggestions: ["說明 AI API 申請流程", "如何保護 API 金鑰？", "我適合使用哪種 AI 服務？"] },
  { match: /^\/templates/, title: "模板管理", suggestions: ["說明 LXC 與 VM 模板差異", "帶我到資源管理", "如何選擇 GPU？"] },
  { match: /^\/gpu-mgmt/, title: "GPU 管理", suggestions: ["如何選擇 GPU？", "帶我到資源管理", "帶我到申請審核"] },
  { match: /^\/monitoring/, title: "資源監控", suggestions: ["帶我到資源管理", "帶我到背景任務", "說明資源監控用途"] },
];

const DEFAULT_CONTEXT = {
  title: "SkyLab",
  suggestions: ["我該申請 LXC 還是 VM？", "帶我到我的資源", "有哪些功能可以使用？"],
};

const NAVIGATION_PATTERN = /(帶我|前往|打開|開啟|跳到|導航|在哪|哪裡|頁面)/i;

function stripThinkTags(text) {
  return String(text || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

function pageContextFor(pathname) {
  return PAGE_CONTEXTS.find((item) => item.match.test(pathname)) ?? DEFAULT_CONTEXT;
}

// The navigation service still returns a few legacy paths. Keep the mapping
// here so the assistant always opens a route that exists in the current UI.
const PATH_MAP = {
  "/": "/dashboard",
  "/resources": "/resource-mgmt",
  "/resources-create": "/my-requests",
  "/approvals": "/request-review",
  "/gpu-management": "/gpu-mgmt",
  "/ai-api-approvals": "/ai-api-review",
  "/ai-api-credentials": "/ai-api-keys",
  "/admin/audit-logs": "/audit",
  "/admin/domains": "/domain",
  "/admin/gateway": "/gateway",
  "/admin/ip-management": "/ip-management",
  "/admin/configuration": "/settings",
  "/admin/batch-provision-review": "/batch-review",
  "/admin/ai-management": "/ai-monitoring",
  "/admin/ai-monitoring": "/ai-monitoring",
};

function mapPath(path) {
  if (!path) return null;
  const [clean, query] = path.split("?");
  const target = PATH_MAP[clean] ?? clean;
  return query ? `${target}?${query}` : target;
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

function Message({ message, onNavigate }) {
  const isUser = message.role === "user";
  return (
    <div className={`${styles.message} ${isUser ? styles.messageUser : styles.messageAssistant}`}>
      {!isUser && (
        <span className={styles.messageAvatar}>
          <MIcon name="smart_toy" size={17} />
        </span>
      )}
      <div className={styles.messageContent}>
        <div className={styles.messageText}>{message.content}</div>
        {message.targets?.length > 0 && (
          <div className={styles.actionList}>
            {message.targets.map((target) => (
              <button key={target.path} type="button" onClick={() => onNavigate(target.path)}>
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
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [history, setHistory] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
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
    inputRef.current?.focus();
  }

  function handleNavigate(path) {
    const target = mapPath(path);
    if (!target) return;
    navigate(target);
    if (window.matchMedia("(max-width: 1439px)").matches) close();
  }

  async function sendNavigation(text) {
    const data = await AiNavigationService.resolve(text);
    const targets = [...(data.primary ? [data.primary] : []), ...(data.suggestions ?? [])]
      .filter((target, index, all) => all.findIndex((item) => item.path === target.path) === index);

    const content = data.action === "clarify"
      ? (data.clarification_question || "你想前往哪一類功能？")
      : targets.length
        ? "我找到以下可能符合需求的功能："
        : "目前找不到符合的頁面，請換個方式描述。";
    const assistantMessage = { role: "assistant", content, targets };
    setMessages((previous) => [...previous, assistantMessage]);
    setHistory((previous) => [...previous, { role: "assistant", content }]);
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
      if (NAVIGATION_PATTERN.test(text)) await sendNavigation(text);
      else await sendChat(text, nextHistory);
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
    <div className={`${styles.root} ${open ? styles.rootOpen : ""}`}>
      {open && <button type="button" className={styles.backdrop} onClick={close} aria-label="關閉 AI 助手" />}

      {open && (
        <aside className={styles.panel} aria-label="AI 助手">
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
            <MIcon name="web_asset" size={16} />
            <span>正在查看「{pageContext.title}」</span>
          </div>

          <div className={styles.messages} ref={scrollRef}>
            {messages.length === 0 ? (
              <div className={styles.emptyState}>
                <span className={styles.emptyIcon}><MIcon name="auto_awesome" size={30} /></span>
                <h2>{displayName(user)}，你好！</h2>
                <p>有什麼我可以幫上忙的嗎？</p>
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
                <Message key={`${message.role}-${index}`} message={message} onNavigate={handleNavigate} />
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

      {!open && (
        <button type="button" className={styles.fab} onClick={() => onOpenChange(true)} aria-label="開啟 AI 助手">
          <MIcon name="auto_awesome" size={21} />
          <span>AI 助手</span>
        </button>
      )}
    </div>
  );
}
