import { useCallback, useEffect, useState } from "react";
import styles from "./ReverseProxyPage.module.scss";
import MIcon from "../../../components/MIcon";
import LoadingState from "../../../components/LoadingState/LoadingState";
import EmptyState from "../../../components/EmptyState/EmptyState";
import { useAuth } from "../../../contexts/AuthContext";
import { useToast } from "../../../hooks/useToast";
import { ReverseProxyService } from "../../../services/reverseProxy";
import ReverseProxyRuleModal from "../../../components/ReverseProxyRuleModal/ReverseProxyRuleModal";
import PageHeader from "../../../components/PageHeader/PageHeader";

function isAdminUser(user) {
  return user?.role === "admin" || user?.is_superuser === true;
}

/* ── How it works（靜態說明） ───────────────────────── */
function HowItWorks() {
  const [open, setOpen] = useState(false);

  const STEPS = [
    {
      num: "1",
      title: "設定網址",
      desc: "幫網址取個開頭、選一個結尾，並指定要綁定的 VM 和服務的 Port。",
    },
    {
      num: "2",
      title: "系統自動設定",
      desc: "剩下的交給系統自動完成，開啟安全連線（https）時還會自動申請免費憑證。",
    },
    {
      num: "3",
      title: "直接訪問",
      desc: "任何人都可以透過這個網址直接訪問你 VM 裡跑的網站或 API。",
    },
  ];

  const PREREQS = [
    "你的 VM 裡需要有一個正在執行的網站或 API 服務",
    "你需要知道服務跑在哪個 Port（Node.js 預設 3000、Flask 預設 5000、Nginx 預設 80）",
    "管理員需要先在 Cloudflare 域名管理設定預設 A/CNAME 指向與可用 Zone",
  ];

  return (
    <div className={styles.infoCard}>
      <button
        type="button"
        className={styles.infoToggle}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-guide="proxy-help"
      >
        <span className={styles.infoToggleLeft}>
          <MIcon name="help_outline" size={16} />
          這是什麼？反向代理怎麼運作？
        </span>
        <span className={`${styles.infoChevron} ${open ? styles.open : ""}`}>
          <MIcon name="expand_more" size={18} />
        </span>
      </button>

      {open && (
        <div className={styles.infoBody}>
          <div className={styles.steps}>
            {STEPS.map((s) => (
              <div key={s.num} className={styles.step}>
                <div className={styles.stepNum}>{s.num}</div>
                <div className={styles.stepContent}>
                  <span className={styles.stepTitle}>{s.title}</span>
                  <span className={styles.stepDesc}>{s.desc}</span>
                </div>
              </div>
            ))}
          </div>

          <div className={styles.prereqBox}>
            <span className={styles.prereqTitle}>
              <MIcon name="checklist" size={15} />
              前置作業
            </span>
            <ul className={styles.prereqList}>
              {PREREQS.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Traefik Runtime（Admin） ───────────────────────── */
function TraefikPanel() {
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || snapshot) return;
    setLoading(true);
    ReverseProxyService.runtime()
      .then(setSnapshot)
      .catch(() => setSnapshot({ runtime_error: "無法連線 Traefik API" }))
      .finally(() => setLoading(false));
  }, [open, snapshot]);

  const sections = snapshot
    ? [
        { label: "HTTP", data: snapshot.http },
        { label: "TCP", data: snapshot.tcp },
        { label: "UDP", data: snapshot.udp },
      ]
    : [];

  return (
    <div className={styles.adminCard}>
      <button
        type="button"
        className={styles.adminToggle}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className={styles.adminToggleLeft}>
          <MIcon name="security" size={16} />
          管理員工具 — Traefik Runtime
          <span className={styles.adminBadge}>Admin</span>
        </span>
        <span className={`${styles.infoChevron} ${open ? styles.open : ""}`}>
          <MIcon name="expand_more" size={18} />
        </span>
      </button>

      {open && (
        <div className={styles.adminBody}>
          {loading ? (
            <LoadingState text="載入 Traefik 狀態..." />
          ) : snapshot?.runtime_error ? (
            <div className={styles.adminMeta}>
              <span className={`${styles.statusPill} ${styles.unknown}`}>
                {snapshot.runtime_error}
              </span>
            </div>
          ) : snapshot ? (
            <>
              <div className={styles.adminMeta}>
                <span className={`${styles.statusPill} ${styles.running}`}>
                  Traefik {snapshot.version?.Version ?? "running"}
                </span>
                <span className={styles.statusPill}>
                  {(snapshot.entrypoints ?? []).length} entrypoints
                </span>
              </div>

              <div className={styles.statsGrid}>
                {sections.map(({ label, data }) => (
                  <div key={label} className={styles.statCard}>
                    <span className={styles.statLabel}>{label}</span>
                    <dl className={styles.statList}>
                      <div>
                        <dt>Routers</dt>
                        <dd className={data?.routers?.length ? styles.numActive : styles.numZero}>
                          {data?.routers?.length ?? 0}
                        </dd>
                      </div>
                      <div>
                        <dt>Services</dt>
                        <dd className={data?.services?.length ? styles.numActive : styles.numZero}>
                          {data?.services?.length ?? 0}
                        </dd>
                      </div>
                      <div>
                        <dt>Middlewares</dt>
                        <dd className={data?.middlewares?.length ? styles.numActive : styles.numZero}>
                          {data?.middlewares?.length ?? 0}
                        </dd>
                      </div>
                    </dl>
                  </div>
                ))}
              </div>

              <div className={styles.entrySection}>
                <span className={styles.entrySectionLabel}>Entrypoints</span>
                <div className={styles.entryList}>
                  {(snapshot.entrypoints ?? []).map((ep) => (
                    <code key={ep.name ?? JSON.stringify(ep)} className={styles.entryChip}>
                      {ep.name} ({ep.address ?? ep.addr ?? "?"})
                    </code>
                  ))}
                </div>
              </div>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

/* ── Page ──────────────────────────────────────────── */
export default function ReverseProxyPage() {
  const { user } = useAuth();
  const toast = useToast();
  const isAdmin = isAdminUser(user);

  const [rules, setRules] = useState([]);
  const [setupContext, setSetupContext] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [modal, setModal] = useState(null); // { kind: "rule", rule? } | { kind: "delete", rule }

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [rulesRes, ctxRes] = await Promise.all([
        ReverseProxyService.listRules(),
        ReverseProxyService.setupContext().catch(() => null),
      ]);
      setRules(rulesRes ?? []);
      if (ctxRes) setSetupContext(ctxRes);
    } catch (err) {
      toast.error(err?.message ?? "載入網址清單失敗");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const setupBlocked = setupContext?.enabled === false;
  async function handleSubmitRule(payload) {
    setSaving(true);
    try {
      if (modal?.rule) {
        await ReverseProxyService.updateRule(modal.rule.id, payload);
        toast.success("網址已更新，系統會自動同步相關設定");
      } else {
        await ReverseProxyService.createRule(payload);
        toast.success("網址建立成功，系統正在自動完成設定");
      }
      setModal(null);
      fetchData();
    } catch (err) {
      toast.error(err?.message ?? "儲存網址失敗");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteRule() {
    if (!modal?.rule) return;
    setSaving(true);
    try {
      await ReverseProxyService.deleteRule(modal.rule.id);
      toast.success("網址已刪除");
      setModal(null);
      fetchData();
    } catch (err) {
      toast.error(err?.message ?? "刪除失敗");
    } finally {
      setSaving(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await ReverseProxyService.syncRules();
      toast.success(res?.message ?? "已重新同步路由");
    } catch (err) {
      toast.error(err?.message ?? "同步失敗");
    } finally {
      setSyncing(false);
    }
  }

  function openCreate() {
    if (setupBlocked) {
      toast.error(setupContext?.reasons?.[0] ?? "這個功能目前暫時無法使用");
      return;
    }
    setModal({ kind: "rule" });
  }

  return (
    <div className={styles.page}>
      {/* Header */}
      <PageHeader title="反向代理" subtitle="讓別人透過一個好記的網址來訪問你 VM 裡的網站或服務">
        <div className={styles.headerActions}>
          {isAdmin && (
            <button type="button" className={styles.btnSecondary} onClick={handleSync} disabled={syncing}>
              <MIcon name="sync" size={16} />
              {syncing ? "同步中..." : "重新同步"}
            </button>
          )}
          <button type="button" className={styles.btnPrimary} onClick={openCreate} data-guide="proxy-create">
            <MIcon name="add" size={16} />
            新增網址
          </button>
        </div>
      </PageHeader>

      {setupBlocked && (
        <div className={styles.noticeDanger}>
          <p><strong>這個功能目前暫時無法使用</strong></p>
          <p>{(setupContext?.reasons ?? []).join("；") || "請先完成必要設定"}</p>
        </div>
      )}

      {/* How it works */}
      <HowItWorks />

      {/* Route list / empty */}
      <div className={styles.content} data-guide="proxy-list">
        {loading ? (
          <LoadingState text="載入網址清單..." />
        ) : rules.length === 0 ? (
          <EmptyState
            icon="swap_horiz"
            title="還沒有任何網址"
            description="幫 VM 裡的網站或服務取一個好記的網址，別人不用記一長串數字，直接輸入網址就能打開。"
          />
        ) : (
          <>
            <div className={styles.list}>
              {rules.map((rule) => (
                <div key={rule.id} className={styles.row}>
                <div className={styles.rowIcon}>
                  <MIcon name="swap_horiz" size={20} />
                </div>
                <div className={styles.rowMain}>
                  <span className={styles.rowName}>{rule.domain}</span>
                  <span className={styles.rowMeta}>
                    VM {rule.vmid}（{rule.vm_ip}）· Port {rule.internal_port}
                    {rule.enable_https && (
                      <span className={styles.badge}>
                        <MIcon name="lock" size={11} /> HTTPS
                      </span>
                    )}
                  </span>
                </div>
                <a
                  className={styles.rowStatus}
                  href={`${rule.enable_https ? "https" : "http"}://${rule.domain}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <MIcon name="open_in_new" size={14} />
                  開啟
                </a>
                <div className={styles.rowActions}>
                  <button
                    type="button"
                    className={styles.actionBtn}
                    title="編輯"
                    onClick={() => setModal({ kind: "rule", rule })}
                  >
                    <MIcon name="edit" size={16} />
                  </button>
                  <button
                    type="button"
                    className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                    title="刪除"
                    onClick={() => setModal({ kind: "delete", rule })}
                  >
                    <MIcon name="delete" size={16} />
                  </button>
                </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Admin: Traefik */}
      {isAdmin && <TraefikPanel />}

      {modal?.kind === "rule" && (
        <ReverseProxyRuleModal
          rule={modal.rule}
          setupContext={setupContext}
          isAdmin={isAdmin}
          loading={saving}
          onClose={() => setModal(null)}
          onSubmit={handleSubmitRule}
        />
      )}
      {modal?.kind === "delete" && (
        <div className={styles.modalOverlay} onMouseDown={() => setModal(null)}>
          <div className={styles.confirm} onMouseDown={(e) => e.stopPropagation()}>
            <div className={styles.confirmIcon}>
              <MIcon name="warning" size={24} />
            </div>
            <h2>刪除網址</h2>
            <p>
              確定要刪除 <strong>{modal.rule.domain}</strong> 嗎？刪除後這個網址會立刻失效，
              相關設定也會一併清除。
            </p>
            <div className={styles.modalActions}>
              <button type="button" className={styles.btnSecondary} onClick={() => setModal(null)}>
                取消
              </button>
              <button type="button" className={styles.btnDanger} disabled={saving} onClick={handleDeleteRule}>
                {saving ? "刪除中..." : "刪除"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
