import { useContext, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import MIcon from "../../../components/MIcon";
import LoadingState from "../../../components/LoadingState/LoadingState";
import { useToast } from "../../../hooks/useToast";
import { LayoutContext } from "../../../layout/DashboardLayout";
import { QuickPracticeService } from "../../../services/quickPractice";
import AiSidePanel from "../requests/AiSidePanel";
import PageHeader from "../../../components/PageHeader/PageHeader";
import styles from "./QuickTemplateFormPage.module.scss";

export default function QuickTemplateFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { setCompactFooter } = useContext(LayoutContext);
  const [template, setTemplate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const submitLockRef = useRef(false);

  useEffect(() => {
    setCompactFooter(true);
    return () => setCompactFooter(false);
  }, [setCompactFooter]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    QuickPracticeService.getTemplate(id)
      .then((result) => active && setTemplate(result))
      .catch(() => active && setTemplate(null))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [id]);

  const onBack = () => navigate(location.state?.from ?? "/dashboard");

  async function launch() {
    if (submitLockRef.current || !template) return;
    submitLockRef.current = true;
    setSubmitting(true);
    try {
      await QuickPracticeService.launch(template.id);
      toast.success(`「${template.name}」已整組送出，系統正在建立 ${template.nodes.length} 台機器。`);
      navigate("/my-resources");
    } catch (error) {
      toast.error(error?.message ?? "快速練習環境建立失敗，請稍後再試。");
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className={styles.page}>
        <LoadingState fullPage text="載入快速練習環境中…" />
      </div>
    );
  }

  if (!template) {
    return <div className={styles.page}><div className={styles.notFound}><MIcon name="error_outline" size={40} /><h2>找不到快速練習環境</h2><p>此環境不存在、尚未發布，或沒有開放快速練習。</p><button type="button" className={styles.btnSecondary} onClick={onBack}><MIcon name="arrow_back" size={16} />返回首頁</button></div></div>;
  }

  const totalCpu = template.nodes.reduce((sum, node) => sum + Number(node.cpu || 0), 0);
  const totalMemory = template.nodes.reduce((sum, node) => sum + Number(node.memory || 0), 0);
  const totalDisk = template.nodes.reduce((sum, node) => sum + Number(node.disk || 0), 0);

  return <div className={styles.page}>
    <PageHeader title="啟動快速練習" subtitle="固定配置、免人工審核；送出後會一次建立整組機器">
      <button type="button" className={styles.backBtn} onClick={onBack}><MIcon name="arrow_back" size={18} />返回</button>
    </PageHeader>

    <div className={styles.body}>
      <div className={styles.formScroll}>
        <div className={styles.form}>
          <section className={styles.templateHeader}>
            <div className={styles.templateLogo}><MIcon name="account_tree" size={28} /></div>
            <div className={styles.templateMeta}>
              <div className={styles.templateTitleRow}><h2 className={styles.templateName}>{template.name}</h2></div>
              {template.description && <p className={styles.templateDesc}>{template.description}</p>}
              <div className={styles.templateChips}><span className={styles.portChip}><MIcon name="dns" size={12} />{template.nodes.length} 台機器</span><span className={styles.portChip}><MIcon name="schedule" size={12} />{template.duration_hours} 小時</span><span className={styles.portChip}>v{template.version}</span></div>
              <p className={styles.templateStatus}><MIcon name="bolt" size={13} />整組自動核准；學生不能修改 CPU、記憶體、磁碟或機器數量。</p>
            </div>
          </section>

          <section className={`${styles.section} ${styles.sectionPadded}`}>
            <h3 className={styles.sectionTitle}>本次會建立的機器</h3>
            <div className={styles.machineList}>
              {template.nodes.map((node, index) => <article key={node.id}>
                <span className={styles.machineIndex}>{index + 1}</span>
                <span className={styles.machineIcon}><MIcon name={node.type === "lxc" ? "terminal" : "desktop_windows"} size={19} /></span>
                <div><strong>{node.name}</strong><small>{node.role} · {String(node.type).toUpperCase()}</small></div>
                <span className={styles.machineSpec}>{node.cpu} CPU · {node.memory} GB RAM · {node.disk} GB</span>
              </article>)}
            </div>
            <div className={styles.environmentTotal}><span>環境合計</span><strong>{totalCpu} CPU · {totalMemory} GB RAM · {totalDisk} GB Disk</strong></div>
          </section>

          <section className={`${styles.section} ${styles.sectionPadded}`}>
            <h3 className={styles.sectionTitle}>使用規則</h3>
            <div className={styles.ruleList}>
              <p><MIcon name="verified" size={17} /><span><strong>不用等待審核</strong>送出後立即排入建立流程。</span></p>
              <p><MIcon name="tune" size={17} /><span><strong>固定配置</strong>套用老師發布的完整環境，不提供規格選擇。</span></p>
              <p><MIcon name="timer" size={17} /><span><strong>{template.duration_hours} 小時限制</strong>時間到由系統依練習政策停止環境。</span></p>
            </div>
          </section>
        </div>

        <div className={styles.actions}>
          <button type="button" className={styles.btnSecondary} onClick={onBack}>取消</button>
          <button type="button" className={styles.btnPrimary} disabled={submitting} onClick={launch}><MIcon name={submitting ? "hourglass_empty" : "bolt"} size={16} />{submitting ? "整組建立中…" : `啟動 ${template.nodes.length} 台機器`}</button>
        </div>
      </div>
      <aside className={styles.aside}><AiSidePanel className={styles.aiPanel} /></aside>
    </div>
  </div>;
}
