import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AiPveChat from "../../../components/AiPveChat/AiPveChat";
import MIcon from "../../../components/MIcon";
import { useAuth } from "../../../contexts/AuthContext";
import { AiApiService } from "../../../services/aiApi";
import { BatchProvisionService } from "../../../services/batchProvision";
import { JobsService } from "../../../services/jobs";
import { MonitoringService } from "../../../services/monitoring";
import { SpecChangeRequestsService } from "../../../services/specChangeRequests";
import { VmRequestsService } from "../../../services/vmRequests";
import styles from "./AdminDashboardPage.module.scss";
import PageHeader from "../../../components/PageHeader/PageHeader";

export function countRows(response) {
  if (Array.isArray(response)) return response.length;
  if (Number.isFinite(response?.count)) return response.count;
  if (Number.isFinite(response?.total)) return response.total;
  if (Array.isArray(response?.data)) return response.data.length;
  if (Array.isArray(response?.items)) return response.items.length;
  return 0;
}

export function buildAdminIssues(checks) {
  const issues = [];
  if (checks.alerts > 0) issues.push({ key: "alerts", tone: "danger", icon: "error", title: "系統有尚未解除的警告", description: "前往資源監控確認節點或容量問題", count: checks.alerts, path: "/monitoring" });
  if (checks.failedJobs > 0) issues.push({ key: "jobs", tone: "danger", icon: "error_outline", title: "背景任務失敗或受阻", description: "查看失敗原因與相關執行紀錄", count: checks.failedJobs, path: "/jobs" });
  if (checks.requests > 0) issues.push({ key: "requests", tone: "info", icon: "pending_actions", title: "有申請等待審核", description: "處理 VM、規格調整或刪除申請", count: checks.requests, path: "/request-review" });
  if (checks.batches > 0) issues.push({ key: "batches", tone: "info", icon: "library_add_check", title: "有班級批量建機等待審核", description: "確認教師提交的機器與排程", count: checks.batches, path: "/batch-review" });
  if (checks.aiRequests > 0) issues.push({ key: "ai", tone: "info", icon: "rate_review", title: "有 AI API 申請等待審核", description: "確認用途、期限與金鑰設定", count: checks.aiRequests, path: "/ai-api-review" });
  if (checks.unavailable > 0) issues.push({ key: "unavailable", tone: "muted", icon: "cloud_off", title: "部分系統狀態暫時無法確認", description: "可先到監控頁檢查服務連線", count: checks.unavailable, path: "/monitoring" });
  return issues;
}

export function normalizeAssistantPrompt(value) {
  return String(value ?? "").trim();
}

export default function AdminDashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [assistantPrompt, setAssistantPrompt] = useState("");
  const [conversationPrompt, setConversationPrompt] = useState("");
  const [checks, setChecks] = useState({ alerts: 0, failedJobs: 0, requests: 0, batches: 0, aiRequests: 0, unavailable: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function loadChecks() {
      setLoading(true);
      const settled = await Promise.allSettled([
        VmRequestsService.listAll("pending"),
        SpecChangeRequestsService.listAll({ status: "pending" }),
        BatchProvisionService.listPending(),
        AiApiService.listAllRequests(),
        JobsService.list({ statuses: ["failed", "blocked"], historyDays: 7, limit: 50 }),
        MonitoringService.listAlerts({ active: true, limit: 100 }),
      ]);
      if (!active) return;
      const value = (index) => settled[index].status === "fulfilled" ? settled[index].value : null;
      const unavailable = settled.filter((result) => result.status === "rejected").length;
      const aiPending = value(3)?.data?.filter((request) => request.status === "pending").length ?? 0;
      setChecks({
        requests: countRows(value(0)) + countRows(value(1)),
        batches: countRows(value(2)),
        aiRequests: aiPending,
        failedJobs: countRows(value(4)),
        alerts: countRows(value(5)),
        unavailable,
      });
      setLoading(false);
    }
    loadChecks();
    return () => { active = false; };
  }, []);

  const issues = useMemo(() => buildAdminIssues(checks), [checks]);
  const name = user?.full_name?.trim() || user?.email?.split("@")[0] || "管理員";

  function openAssistant(event) {
    event.preventDefault();
    const prompt = normalizeAssistantPrompt(assistantPrompt);
    if (!prompt) return;
    setConversationPrompt(prompt);
  }

  return <div className={styles.page}>
    <PageHeader title={`${name}，要處理哪一件事？`} subtitle="直接詢問維運助手，或查看目前需要優先確認的問題。" />

    <section className={styles.attention} aria-labelledby="admin-attention-title">
      <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>優先處理</span><h2 id="admin-attention-title">需要前往確認</h2></div><button type="button" onClick={() => navigate("/monitoring")}>開啟系統監控<MIcon name="arrow_forward" size={16} /></button></div>
      {loading ? <div className={styles.checking}><MIcon name="sync" size={20} />正在確認需要處理的項目…</div> : issues.length ? <div className={styles.issueList}>{issues.map((issue) => <button type="button" key={issue.key} className={styles[`issue_${issue.tone}`]} onClick={() => navigate(issue.path)}><span className={styles.issueIcon}><MIcon name={issue.icon} size={20} /></span><span><strong>{issue.title}</strong><small>{issue.description}</small></span><em>{issue.count}</em><MIcon name="arrow_forward" size={18} /></button>)}</div> : <div className={styles.allClear}><span><MIcon name="check_circle" size={21} /></span><div><strong>目前沒有需要立即處理的項目</strong><p>待審核申請、失敗任務與系統警告都已清空。</p></div></div>}
    </section>

    <section className={`${styles.assistantSection} ${conversationPrompt ? styles.assistantSectionExpanded : ""}`} aria-labelledby="admin-assistant-title">
      <div className={styles.assistantHero}>
        <div className={styles.assistantIntro}>
          <span className={styles.assistantIcon}><MIcon name="support_agent" size={28} /></span>
          <div><span className={styles.assistantLabel}>AI PVE 維運助手</span><h2 id="admin-assistant-title">直接描述你遇到的問題</h2><p>可查詢節點、VM／LXC、資源用量與儲存狀態；需要執行指令時仍會要求你確認。</p></div>
        </div>
        {!conversationPrompt && <form className={styles.assistantForm} onSubmit={openAssistant}>
          <div className={styles.assistantInput}>
            <MIcon name="terminal" size={21} />
            <textarea value={assistantPrompt} onChange={(event) => setAssistantPrompt(event.target.value)} placeholder="例如：幫我找出目前 CPU 使用率最高的 5 台 VM，並檢查是否有異常" rows={2} autoComplete="off" />
            <button type="submit" disabled={!assistantPrompt.trim()}><span>開始詢問</span><MIcon name="arrow_downward" size={18} /></button>
          </div>
          <div className={styles.assistantFooter}>
            <span>你也可以問：</span>
            {["目前有哪些節點或 VM 異常？", "檢查儲存空間是否快滿了", "列出 CPU 使用率最高的 VM"].map((suggestion) => <button type="button" key={suggestion} onClick={() => setAssistantPrompt(suggestion)}>{suggestion}</button>)}
          </div>
        </form>}
      </div>
      {conversationPrompt && <AiPveChat initialPrompt={conversationPrompt} compact />}
    </section>

  </div>;
}
