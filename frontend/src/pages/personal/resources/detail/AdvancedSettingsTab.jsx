import { useCallback, useEffect, useState } from "react";
import styles from "./ResourceDetailPage.module.scss";
import MIcon from "../../../../components/MIcon";
import LoadingState from "../../../../components/LoadingState/LoadingState";
import ReverseProxyRuleModal from "../../../../components/ReverseProxyRuleModal/ReverseProxyRuleModal";
import { useAuth } from "../../../../contexts/AuthContext";
import { useToast } from "../../../../hooks/useToast";
import { ReverseProxyService } from "../../../../services/reverseProxy";
import { ResourcesService } from "../../../../services/resources";

export default function AdvancedSettingsTab({ vmid }) {
  const { user } = useAuth();
  const toast = useToast();
  const isAdmin = user?.role === "admin" || user?.is_superuser === true;

  const [resource, setResource] = useState(null);
  const [rules, setRules] = useState([]);
  const [setupContext, setSetupContext] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modal, setModal] = useState(null); // { kind: "rule", rule? } | { kind: "delete", rule }

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [resourceRes, rulesRes, ctxRes] = await Promise.all([
        ResourcesService.get(vmid).catch(() => null),
        ReverseProxyService.listRules(),
        ReverseProxyService.setupContext().catch(() => null),
      ]);
      setResource(resourceRes);
      setRules((rulesRes ?? []).filter((r) => r.vmid === vmid));
      if (ctxRes) setSetupContext(ctxRes);
    } catch (err) {
      toast.error(err?.message ?? "載入反向代理規則失敗");
    } finally {
      setLoading(false);
    }
  }, [vmid, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const setupBlocked = setupContext?.enabled === false;
  const running = resource?.status === "running";
  const createDisabled = setupBlocked || !running;
  const createHint = setupBlocked
    ? setupContext?.reasons?.[0] ?? "這個功能目前暫時無法使用"
    : !running
      ? "VM 要先開機，才能新增網址"
      : "";

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
      toast.error(err?.message ?? "儲存網域規則失敗");
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
      toast.error(err?.message ?? "刪除網域規則失敗");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.tabStack}>
      {/* 反向代理 */}
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h2 className={styles.cardTitle}>
              <MIcon name="swap_horiz" size={18} />
              對外網址
            </h2>
            <p className={styles.cardDesc}>
              幫這台 VM 裡的網站或服務取一個好記的網址，別人直接輸入網址就能打開
            </p>
          </div>
          <div className={styles.headerActions}>
            <button
              type="button"
              className={styles.btnPrimary}
              disabled={createDisabled}
              title={createHint}
              onClick={() => setModal({ kind: "rule" })}
            >
              <MIcon name="add" size={16} />
              新增網址
            </button>
          </div>
        </div>
        <div className={styles.cardBody}>
          {loading ? (
            <LoadingState text="載入網域規則..." />
          ) : (
            <>
              {createHint && (
                <p className={styles.rpHint}>
                  <MIcon name="info" size={14} />
                  {createHint}
                </p>
              )}
              {rules.length === 0 ? (
                <p className={styles.mutedText}>
                  這台 VM 還沒有對外網址。設定之後，別人不用記一長串數字，
                  直接輸入網址就能打開你 VM 裡的網站或服務。
                </p>
              ) : (
                <div className={styles.rpList}>
                  {rules.map((rule) => (
                    <div key={rule.id} className={styles.rpItem}>
                      <div className={styles.rpMain}>
                        <span className={styles.rpDomain}>{rule.domain}</span>
                        <span className={styles.rpMeta}>
                          Port {rule.internal_port}
                          {rule.enable_https && (
                            <span className={`${styles.badge} ${styles.badge_ok}`}>
                              <MIcon name="lock" size={11} /> HTTPS
                            </span>
                          )}
                        </span>
                      </div>
                      <a
                        className={styles.rpOpen}
                        href={`${rule.enable_https ? "https" : "http"}://${rule.domain}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <MIcon name="open_in_new" size={14} />
                        開啟
                      </a>
                      <div className={styles.rpActions}>
                        <button
                          type="button"
                          className={styles.rpIconBtn}
                          title="編輯"
                          onClick={() => setModal({ kind: "rule", rule })}
                        >
                          <MIcon name="edit" size={16} />
                        </button>
                        <button
                          type="button"
                          className={`${styles.rpIconBtn} ${styles.rpIconBtnDanger}`}
                          title="刪除"
                          onClick={() => setModal({ kind: "delete", rule })}
                        >
                          <MIcon name="delete" size={16} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* 其他進階功能 */}
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h2 className={styles.cardTitle}>更多進階設定</h2>
            <p className={styles.cardDesc}>更多資源層級的進階選項</p>
          </div>
        </div>
        <div className={`${styles.cardBody} ${styles.comingSoon}`}>
          <MIcon name="construction" size={32} />
          <p>即將推出</p>
          <span className={styles.mutedText}>開機順序等進階功能規劃中</span>
        </div>
      </div>

      {modal?.kind === "rule" && (
        <ReverseProxyRuleModal
          rule={modal.rule}
          setupContext={setupContext}
          isAdmin={isAdmin}
          fixedResource={{ vmid, name: resource?.name }}
          loading={saving}
          onClose={() => setModal(null)}
          onSubmit={handleSubmitRule}
        />
      )}
      {modal?.kind === "delete" && (
        <div className={styles.modalOverlay} onMouseDown={() => setModal(null)}>
          <div className={styles.modal} onMouseDown={(e) => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>刪除網址</h2>
            <p className={styles.modalDesc}>
              確定要刪除 <strong>{modal.rule.domain}</strong> 嗎？刪除後這個網址會立刻失效，
              相關設定也會一併清除。
            </p>
            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={() => setModal(null)}
              >
                取消
              </button>
              <button
                type="button"
                className={styles.btnDanger}
                disabled={saving}
                onClick={handleDeleteRule}
              >
                {saving ? "刪除中..." : "刪除"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
