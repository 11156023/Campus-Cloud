import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import styles from "./TemplatePicker.module.scss";
import MIcon from "../../../components/MIcon";
import EmptyState from "../../../components/EmptyState/EmptyState";
import LoadingState from "../../../components/LoadingState/LoadingState";
import { useAuth } from "../../../contexts/AuthContext";
import { TemplatesService } from "../../../services/templates";
import { useToast } from "../../../hooks/useToast";
import useDialogPresence from "../../../hooks/useDialogPresence";
import TemplateCloneDialog from "../../resource/templates/TemplateCloneDialog";

/**
 * 「我的申請 › 範本開通」
 * 列出老師公開且已就緒的機器範本，一鍵克隆成自己的機器（不走審核）。
 * 後端 /templates/ 已依角色過濾：學生只拿得到 ready 且「全部可見」的範本。
 * 使用手冊不在這裡看，克隆出來的機器在「我的資源 › 詳細內容」會列出來源範本的手冊。
 */
export default function TemplatePicker() {
  const toast = useToast();
  const { user } = useAuth();
  const canBatch =
    user?.role === "admin" || user?.role === "teacher" || user?.is_superuser === true;

  const [templates, setTemplates] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [cloneTarget, setCloneTarget] = useState(null);
  const cloneDialog = useDialogPresence(cloneTarget);
  const [searchParams, setSearchParams] = useSearchParams();

  const load = useCallback(async () => {
    try {
      const res = await TemplatesService.list();
      const ready = (res?.data ?? []).filter((t) => t.status === "ready");
      setTemplates(ready);
      return ready;
    } catch (e) {
      toast.error(e?.message ?? "載入範本失敗");
      setTemplates((prev) => prev ?? []);
      return [];
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  // 深連結：/my-requests?tab=templates&clone=<templateId> 直接打開克隆視窗
  useEffect(() => {
    const cloneId = searchParams.get("clone");
    if (!cloneId || templates === null) return;
    const target = templates.find((t) => t.id === cloneId);
    if (target) setCloneTarget(target);
    const next = new URLSearchParams(searchParams);
    next.delete("clone");
    setSearchParams(next, { replace: true });
  }, [templates, searchParams, setSearchParams]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (templates === null) return <LoadingState text="載入範本中…" />;

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <p className={styles.hint}>
          老師公開的範本會列在這裡。克隆完成後機器會出現在「我的資源」，
          使用手冊請到該機器的詳細內容查看。
        </p>
        <button
          type="button"
          className={styles.btnSecondary}
          onClick={refresh}
          disabled={refreshing}
        >
          <MIcon name="sync" size={16} />
          {refreshing ? "載入中…" : "重新整理"}
        </button>
      </div>

      {templates.length === 0 ? (
        <div className={styles.card}>
          <EmptyState
            icon="widgets"
            title="目前沒有可用的範本"
            description="老師公開範本後就會顯示在這裡。"
          />
        </div>
      ) : (
        <div className={styles.grid}>
          {templates.map((template) => (
            <div key={template.id} className={styles.tplCard}>
              <div className={styles.head}>
                <MIcon name="library_books" size={18} />
                <span className={styles.name}>{template.name}</span>
              </div>
              {template.description && (
                <p className={styles.desc}>{template.description}</p>
              )}
              <div className={styles.chips}>
                <span className={styles.chip}>{template.resource_type}</span>
                {template.default_cores && (
                  <span className={styles.chip}>{template.default_cores} 核</span>
                )}
                {template.default_memory && (
                  <span className={styles.chip}>
                    {Math.round(template.default_memory / 1024)} GB RAM
                  </span>
                )}
                {template.default_disk && (
                  <span className={styles.chip}>{template.default_disk} GB 磁碟</span>
                )}
                <span className={styles.chip}>v{template.version}</span>
                {template.requires_gpu && (
                  <span className={styles.chip}>需要 GPU</span>
                )}
                {template.allow_password_change === false && (
                  <span className={styles.chip}>固定帳密</span>
                )}
                {template.attachment_count > 0 && (
                  <span className={styles.chip}>附使用手冊</span>
                )}
              </div>
              <button
                type="button"
                className={`${styles.btnPrimary} ${styles.cloneBtn}`}
                onClick={() => setCloneTarget(template)}
              >
                <MIcon name="content_copy" size={14} />
                一鍵克隆
              </button>
            </div>
          ))}
        </div>
      )}

      {cloneDialog.open && (
        <TemplateCloneDialog
          template={cloneDialog.item}
          canBatch={canBatch}
          closing={cloneDialog.closing}
          onClose={() => setCloneTarget(null)}
        />
      )}
    </div>
  );
}
