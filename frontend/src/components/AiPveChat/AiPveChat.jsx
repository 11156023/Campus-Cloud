import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import MIcon from "../MIcon";
import { useToast } from "../../hooks/useToast";
import { AiPveLogService } from "../../services/aiPveLog";
import styles from "./AiPveChat.module.scss";

/** 清除模型殘留的 tool call 與思考標記，避免原始標記顯示在對話框中。 */
export function sanitizeAiPveContent(value) {
  return String(value ?? "")
    .replace(/<\|?tool_call\|?>[\s\S]*?<\|?\/?tool_call\|?>/g, "")
    .replace(/<\|?tool_call\|?>\s*call:[a-zA-Z0-9_]+\s*\{[\s\S]+\}/g, "")
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/<\|[^>]*\|>/g, "")
    .trim();
}

/** 將 AI 回覆以安全的 Markdown 呈現，避免格式標記以原始文字顯示。 */
export function AiPveMarkdownContent({ content }) {
  return (
    <div className={`${styles.msgContent} ${styles.msgMarkdown}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
        {sanitizeAiPveContent(content)}
      </ReactMarkdown>
    </div>
  );
}

export default function AiPveChat({ initialPrompt = "", compact = false, fill = false }) {
  const toast = useToast();
  const initialPromptRef = useRef(String(initialPrompt ?? "").trim());
  const initialPromptHandledRef = useRef(false);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content: "我是 AI PVE 維運助手。你可以詢問全站節點資源、VM/LXC 狀態、儲存空間使用率等資訊。",
    },
  ]);
  const [chatHistory, setChatHistory] = useState([]);
  const [pendingTool, setPendingTool] = useState(null);
  const [pendingCommand, setPendingCommand] = useState("");
  const logEndRef = useRef(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isSending, pendingTool]);

  const canSend = input.trim().length > 0 && !isSending && !pendingTool;

  function handleChatResponse(response) {
    if (response.error) toast.error(response.error);
    setChatHistory(response.messages || []);
    setMessages((previous) => [
      ...previous,
      {
        role: "assistant",
        content: response.reply || response.error || "指令執行完畢",
        tools: response.tools_called,
      },
    ]);

    if (response.needs_confirmation) {
      const sshTool = response.tools_called?.find(
        (tool) => tool.name === "ssh_exec" && tool.result?.pending,
      );
      if (sshTool?.result?.confirm_token) {
        const command = sshTool.args?.command || "";
        setPendingTool({
          token: sshTool.result.confirm_token,
          command,
          reason: sshTool.args?.reason || "執行系統指令",
        });
        setPendingCommand(command);
      }
    }
  }

  async function sendMessage(rawMessage) {
    const message = String(rawMessage ?? "").trim();
    if (!message || isSending || pendingTool) return;

    setInput("");
    setIsSending(true);
    setMessages((previous) => [...previous, { role: "user", content: message }]);

    const newHistory = [...chatHistory];
    if (newHistory.length > 0) newHistory.push({ role: "user", content: message });

    try {
      const response = await AiPveLogService.chat(
        newHistory.length > 0 ? { messages: newHistory } : { message },
      );
      handleChatResponse(response);
    } catch (error) {
      const detail = error?.message ?? "AI-PVE 對話失敗";
      toast.error(detail);
      setMessages((previous) => [
        ...previous,
        { role: "assistant", content: `發生錯誤：${detail}` },
      ]);
    } finally {
      setIsSending(false);
    }
  }

  useEffect(() => {
    const prompt = initialPromptRef.current;
    if (!prompt || initialPromptHandledRef.current) return;
    initialPromptHandledRef.current = true;
    sendMessage(prompt);
  }, []);

  function handleSubmit(event) {
    event.preventDefault();
    sendMessage(input);
  }

  async function handleConfirm(approved) {
    if (!pendingTool) return;
    const command = pendingCommand.trim();
    if (approved && !command) {
      toast.error("請先輸入要執行的指令");
      return;
    }
    setIsSending(true);

    try {
      const result = await AiPveLogService.confirmSsh({
        token: pendingTool.token,
        approved,
        command: approved ? command : undefined,
      });
      const currentToken = pendingTool.token;
      setPendingTool(null);
      setPendingCommand("");

      if (!approved) {
        setMessages((previous) => [
          ...previous,
          { role: "assistant", content: "已取消執行指令。" },
        ]);
        setIsSending(false);
        return;
      }

      const updatedHistory = [...chatHistory];
      const targetIndex = updatedHistory.findIndex(
        (message) => message.role === "tool"
          && typeof message.content === "string"
          && message.content.includes(currentToken),
      );
      if (targetIndex !== -1) {
        updatedHistory[targetIndex] = {
          ...updatedHistory[targetIndex],
          content: JSON.stringify(result),
        };
      }

      const response = await AiPveLogService.chat({ messages: updatedHistory });
      handleChatResponse(response);
    } catch (error) {
      toast.error(error?.message ?? "確認失敗");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div className={`${styles.chatCard} ${compact ? styles.compact : ""} ${fill ? styles.fill : ""}`}>
      <div className={styles.chatLog} aria-live="polite">
        {messages.map((message, index) => (
          <div
            key={`${message.role}-${index}`}
            className={`${styles.msg} ${message.role === "user" ? styles.msg_user : styles.msg_assistant}`}
          >
            <div className={styles.msgHead}>
              <MIcon name={message.role === "assistant" ? "smart_toy" : "person"} size={16} />
              <span>{message.role === "assistant" ? "AI-PVE" : "你"}</span>
            </div>
            {message.role === "assistant" ? (
              <AiPveMarkdownContent content={message.content} />
            ) : (
              <p className={`${styles.msgContent} ${styles.msgPlain}`}>
                {sanitizeAiPveContent(message.content)}
              </p>
            )}
            {message.tools?.length > 0 && (
              <div className={styles.toolRow}>
                <span className={styles.toolLabel}>
                  <MIcon name="terminal" size={14} />
                  系統呼叫：
                </span>
                {message.tools.map((tool, toolIndex) => (
                  <span key={`${tool.name}-${toolIndex}`} className={styles.toolBadge}>
                    {tool.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}

        {pendingTool && (
          <div className={styles.pendingBox}>
            <div className={styles.pendingHead}>
              <MIcon name="warning" size={18} />
              AI 請求執行安全指令
            </div>
            <p className={styles.pendingReason}>
              <strong>目的：</strong>
              {pendingTool.reason}
            </p>
            <textarea
              value={pendingCommand}
              onChange={(event) => setPendingCommand(event.target.value)}
              placeholder="可在此修改後再允許執行"
              disabled={isSending}
            />
            <p className={styles.pendingHint}>為保護伺服器安全，請確認指令內容後再允許執行。</p>
            <div className={styles.pendingActions}>
              <button
                type="button"
                className={styles.btnAllow}
                onClick={() => handleConfirm(true)}
                disabled={isSending || pendingCommand.trim().length === 0}
              >
                <MIcon name="check" size={16} />
                允許執行
              </button>
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={() => handleConfirm(false)}
                disabled={isSending}
              >
                <MIcon name="close" size={16} />
                拒絕
              </button>
            </div>
          </div>
        )}

        {isSending && (
          <div className={styles.thinking}>
            <span className={styles.pulse} />
            AI-PVE 思考中...
          </div>
        )}
        <div ref={logEndRef} />
      </div>

      <form className={styles.composer} onSubmit={handleSubmit}>
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="繼續描述問題，或請 AI 進一步確認節點與機器狀態"
          disabled={isSending || Boolean(pendingTool)}
        />
        <div className={styles.composerActions}>
          <button type="submit" className={styles.btnPrimary} disabled={!canSend}>
            <MIcon name="send" size={16} />
            發送訊息
          </button>
        </div>
      </form>
    </div>
  );
}
