import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./GatewayPage.module.scss";
import MIcon from "../../../components/MIcon";
import LoadingState from "../../../components/LoadingState/LoadingState";
import ConfigCodeEditor from "./ConfigCodeEditor";
import { useConfirm } from "../../../components/ConfirmDialog/ConfirmProvider";
import { useToast } from "../../../hooks/useToast";
import { GatewayService } from "../../../services/gateway";

const TABS = [
  { key: "connection", label: "連線設定" },
  { key: "haproxy",    label: "haproxy"  },
  { key: "traefik",    label: "Traefik"  },
  { key: "frps",       label: "frps"     },
  { key: "frpc",       label: "frpc"     },
];

const SERVICE_FILES = {
  haproxy: { path: "/etc/haproxy/haproxy.cfg", language: "haproxy" },
  traefik: { path: "/etc/traefik/traefik.yml", language: "yaml" },
  frps:    { path: "/etc/frp/frps.toml",       language: "toml" },
  frpc:    { path: "/etc/frp/frpc.toml",       language: "toml" },
};

const SERVICE_ACTIONS = [
  { action: "start",   label: "啟動",   icon: "play_arrow" },
  { action: "stop",    label: "停止",   icon: "stop" },
  { action: "restart", label: "重啟",   icon: "restart_alt" },
  { action: "reload",  label: "Reload", icon: "refresh" },
];

/* ── 連線設定 Tab ───────────────────────────────────── */
function ConnectionTab({ config, onConfigChange }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [form, setForm] = useState({
    host: config?.host ?? "",
    ssh_port: config?.ssh_port ?? 22,
    ssh_user: config?.ssh_user ?? "root",
  });
  const [formDirty, setFormDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [resetting, setResetting] = useState(false);

  // 表單編輯中不跟著 config 重置，避免產生 Keypair 等操作吃掉未儲存的輸入
  useEffect(() => {
    if (formDirty) return;
    setForm({
      host: config?.host ?? "",
      ssh_port: config?.ssh_port ?? 22,
      ssh_user: config?.ssh_user ?? "root",
    });
  }, [config, formDirty]);

  function set(name, value) {
    setFormDirty(true);
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const updated = await GatewayService.updateConfig({
        host: form.host.trim(),
        ssh_port: Number(form.ssh_port) || 22,
        ssh_user: form.ssh_user.trim() || "root",
      });
      setFormDirty(false);
      onConfigChange(updated);
      toast.success("連線設定已儲存");
    } catch (err) {
      toast.error(err?.message ?? "儲存失敗");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    try {
      const res = await GatewayService.testConnection();
      if (res.success) toast.success(res.message || "SSH 連線成功");
      else toast.error(res.message || "SSH 連線失敗");
    } catch (err) {
      toast.error(err?.message ?? "連線測試失敗");
    } finally {
      setTesting(false);
    }
  }

  async function handleGenerateKeypair() {
    if (config?.public_key) {
      const ok = await confirm({
        title: "重新產生 Keypair",
        message:
          "重新產生後舊 Keypair 會立即失效，平台將無法透過 SSH 連線 Gateway VM，直到新公鑰加入 ~/.ssh/authorized_keys。確定繼續？",
        confirmText: "重新產生",
        danger: true,
      });
      if (!ok) return;
    }
    setGenerating(true);
    try {
      const updated = await GatewayService.generateKeypair();
      onConfigChange(updated);
      toast.success("已產生新的 SSH Keypair，請將公鑰加到 Gateway VM");
    } catch (err) {
      toast.error(err?.message ?? "產生 Keypair 失敗");
    } finally {
      setGenerating(false);
    }
  }

  async function handleResetHostKey() {
    const ok = await confirm({
      title: "重設 Host Key",
      message:
        "將清除平台記錄的 Gateway VM SSH host key，下次連線會重新記錄。僅在 Gateway VM 重灌或更換機器後使用；若 host key 並非因你預期的變更而不符，可能代表中間人攻擊，請先查明原因。確定重設？",
      confirmText: "重設",
      danger: true,
    });
    if (!ok) return;
    setResetting(true);
    try {
      const res = await GatewayService.resetHostKey();
      toast.success(res.message || "已重設 host key");
    } catch (err) {
      toast.error(err?.message ?? "重設 host key 失敗");
    } finally {
      setResetting(false);
    }
  }

  function copyPublicKey() {
    if (!config?.public_key) return;
    navigator.clipboard.writeText(config.public_key).then(
      () => toast.success("公鑰已複製"),
      () => toast.error("複製失敗"),
    );
  }

  return (
    <div className={styles.panelStack}>
      <form className={styles.card} onSubmit={handleSave}>
        <h2 className={styles.cardTitle}>SSH 連線設定</h2>
        <div className={styles.formGrid}>
          <label className={styles.field}>
            <span>Host / IP *</span>
            <input
              value={form.host}
              onChange={(e) => set("host", e.target.value)}
              placeholder="例：192.168.100.143"
              required
            />
          </label>
          <label className={styles.field}>
            <span>SSH Port</span>
            <input
              type="number"
              min={1}
              max={65535}
              value={form.ssh_port}
              onChange={(e) => set("ssh_port", e.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span>SSH 使用者</span>
            <input
              value={form.ssh_user}
              onChange={(e) => set("ssh_user", e.target.value)}
              placeholder="root"
            />
          </label>
        </div>
        <div className={styles.cardActions}>
          <button type="button" className={styles.btnSecondary} onClick={handleTest} disabled={testing || !config?.is_configured}>
            <MIcon name="wifi_tethering" size={16} />
            {testing ? "測試中..." : "測試連線"}
          </button>
          <button
            type="button"
            className={styles.btnSecondary}
            onClick={handleResetHostKey}
            disabled={resetting || !config?.host}
            title="Gateway VM 重灌後 host key 變更導致連線被拒時使用"
          >
            <MIcon name="key_off" size={16} />
            {resetting ? "重設中..." : "重設 Host Key"}
          </button>
          <button type="submit" className={styles.btnPrimary} disabled={saving}>
            {saving ? "儲存中..." : "儲存設定"}
          </button>
        </div>
      </form>

      <div className={styles.card}>
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>SSH 公鑰</h2>
          <div className={styles.cardHeadActions}>
            <button type="button" className={styles.btnSecondary} onClick={copyPublicKey} disabled={!config?.public_key}>
              <MIcon name="content_copy" size={16} />
              複製
            </button>
            <button type="button" className={styles.btnSecondary} onClick={handleGenerateKeypair} disabled={generating}>
              <MIcon name="key" size={16} />
              {generating ? "產生中..." : "重新產生 Keypair"}
            </button>
          </div>
        </div>
        <p className={styles.cardHint}>
          將此公鑰加入 Gateway VM 的 ~/.ssh/authorized_keys，平台才能透過 SSH 管理服務。
        </p>
        <pre className={styles.keyBlock}>
          {config?.public_key || "尚未產生 Keypair"}
        </pre>
      </div>
    </div>
  );
}

/* ── 服務管理 Tab ───────────────────────────────────── */
function ServiceTab({ service, gatewayReady, host, onDirtyChange }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [status, setStatus] = useState(null);
  const [configText, setConfigText] = useState("");
  const [savedText, setSavedText] = useState("");
  const [configLoadFailed, setConfigLoadFailed] = useState(false);
  const [logs, setLogs] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [acting, setActing] = useState(null);
  const [loadingLogs, setLoadingLogs] = useState(false);

  const file = SERVICE_FILES[service];
  const dirty = configText !== savedText;

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, configRes, logsRes] = await Promise.all([
        GatewayService.getServiceStatus(service).catch(() => null),
        GatewayService.readServiceConfig(service).catch(() => null),
        GatewayService.getServiceLogs(service, 100).catch(() => null),
      ]);
      setStatus(statusRes);
      setLogs(logsRes);
      // 讀取失敗（configRes 為 null）不可與「檔案是空的」混為一談，
      // 否則空白編輯器會顯示「已同步」，寫入時直接覆蓋遠端設定檔
      const failed = configRes === null;
      setConfigLoadFailed(failed);
      setConfigText(configRes?.content ?? "");
      setSavedText(configRes?.content ?? "");
      if (failed) toast.error(`讀取 ${service} 設定檔失敗，請重新載入再編輯`);
    } finally {
      setLoading(false);
    }
  }, [service, toast]);

  useEffect(() => {
    if (gatewayReady) fetchAll();
    else setLoading(false);
  }, [gatewayReady, fetchAll]);

  // 把 dirty 回報給 GatewayPage，讓分頁切換能攔截未寫入變更
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  // dirty 時擋瀏覽器重新整理 / 關閉
  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  async function handleAction(action) {
    setActing(action);
    try {
      const res = await GatewayService.controlService(service, action);
      if (res.success) toast.success(`${service} ${action} 成功`);
      else toast.error(res.output || `${service} ${action} 失敗`);
      const statusRes = await GatewayService.getServiceStatus(service).catch(() => null);
      setStatus(statusRes);
    } catch (err) {
      toast.error(err?.message ?? `${action} 失敗`);
    } finally {
      setActing(null);
    }
  }

  async function handleSaveConfig() {
    if (configLoadFailed) return;
    setSaving(true);
    try {
      await GatewayService.writeServiceConfig(service, configText);
      setSavedText(configText);
      toast.success("設定檔已寫入，記得 reload / restart 服務以套用");
    } catch (err) {
      toast.error(err?.message ?? "寫入設定檔失敗");
    } finally {
      setSaving(false);
    }
  }

  async function handleReload() {
    if (dirty) {
      const ok = await confirm({
        title: "重新載入設定檔",
        message: "目前有尚未寫入的變更，重新載入將捨棄這些變更。確定繼續？",
        confirmText: "捨棄並重新載入",
        danger: true,
      });
      if (!ok) return;
    }
    fetchAll();
  }

  async function handleRefreshLogs() {
    setLoadingLogs(true);
    try {
      setLogs(await GatewayService.getServiceLogs(service, 100));
    } catch (err) {
      toast.error(err?.message ?? "載入日誌失敗");
    } finally {
      setLoadingLogs(false);
    }
  }

  if (!gatewayReady) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyIcon}>
          <MIcon name="dns" size={40} />
        </div>
        <h2 className={styles.emptyTitle}>尚未設定 Gateway 連線</h2>
        <p className={styles.emptyDesc}>請先到「連線設定」完成 SSH 連線設定並測試成功</p>
      </div>
    );
  }

  if (loading) {
    return <LoadingState text={`載入 ${service} 狀態...`} />;
  }

  return (
    <div className={styles.serviceLayout}>
      <div className={`${styles.card} ${styles.areaStatus}`}>
        <div className={styles.cardHead}>
          <div className={styles.statusRow}>
            <h2 className={styles.cardTitle}>{service}</h2>
            {status ? (
              <span className={`${styles.badge} ${status.active ? styles.badge_success : styles.badge_muted}`}>
                <MIcon name={status.active ? "check_circle" : "cancel"} size={13} />
                {status.active ? "運行中" : "已停止"}
              </span>
            ) : (
              <span className={`${styles.badge} ${styles.badge_danger}`}>無法取得狀態</span>
            )}
          </div>
          <div className={styles.cardHeadActions}>
            {SERVICE_ACTIONS.map(({ action, label, icon }) => (
              <button
                key={action}
                type="button"
                className={styles.btnSecondary}
                disabled={acting !== null}
                onClick={() => handleAction(action)}
              >
                <MIcon name={icon} size={16} />
                {acting === action ? "..." : label}
              </button>
            ))}
          </div>
        </div>
        {status?.status_text && (
          <pre className={styles.statusBlock}>{status.status_text}</pre>
        )}
      </div>

      <div className={styles.areaEditor}>
        <ConfigCodeEditor
          fileName={file.path.split("/").pop()}
          filePath={file.path}
          language={file.language}
          value={configText}
          onChange={setConfigText}
          dirty={dirty}
          saving={saving}
          busy={acting !== null}
          loadFailed={configLoadFailed}
          host={host}
          onSave={handleSaveConfig}
          onReload={handleReload}
        />
      </div>

      <div className={`${styles.card} ${styles.areaLogs}`}>
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>服務日誌（最近 100 行）</h2>
          <button type="button" className={styles.btnSecondary} onClick={handleRefreshLogs} disabled={loadingLogs}>
            <MIcon name="refresh" size={16} />
            {loadingLogs ? "載入中..." : "重新整理"}
          </button>
        </div>
        <pre className={styles.logBlock}>
          {loadingLogs
            ? "載入中..."
            : logs === null
              ? "（無法載入日誌）"
              : logs || "（無日誌輸出）"}
        </pre>
      </div>
    </div>
  );
}

/* ── Page ──────────────────────────────────────────── */
export default function GatewayPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [activeTab, setActiveTab] = useState("connection");
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const dirtyRef = useRef(false);

  const handleDirtyChange = useCallback((dirty) => {
    dirtyRef.current = dirty;
  }, []);

  async function handleTabSelect(key) {
    if (key === activeTab) return;
    if (dirtyRef.current) {
      const ok = await confirm({
        title: "切換分頁",
        message: "目前有尚未寫入的設定檔變更，切換分頁將捨棄這些變更。確定繼續？",
        confirmText: "捨棄變更",
        danger: true,
      });
      if (!ok) return;
    }
    setActiveTab(key);
  }

  useEffect(() => {
    GatewayService.getConfig()
      .then(setConfig)
      .catch((err) => toast.error(err?.message ?? "載入 Gateway 設定失敗"))
      .finally(() => setLoading(false));
  }, [toast]);

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div className={styles.pageHeading}>
          <h1 className={styles.pageTitle}>Gateway VM 管理</h1>
          <p className={styles.pageSubtitle}>管理 haproxy、Traefik、frp 服務設定與狀態</p>
        </div>

        <div className={styles.tabs}>
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`${styles.tab} ${activeTab === tab.key ? styles.tabActive : ""}`}
              onClick={() => handleTabSelect(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.content}>
        {loading ? (
          <LoadingState fullPage text="載入 Gateway 設定..." />
        ) : activeTab === "connection" ? (
          <ConnectionTab config={config} onConfigChange={setConfig} />
        ) : (
          <ServiceTab
            key={activeTab}
            service={activeTab}
            gatewayReady={Boolean(config?.is_configured)}
            host={config?.host}
            onDirtyChange={handleDirtyChange}
          />
        )}
      </div>
    </div>
  );
}
