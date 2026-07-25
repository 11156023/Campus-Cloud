import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import MIcon from "../../components/MIcon";
import { templateCatalog } from "./courseOperationsMock";
import styles from "./CourseOperations.module.scss";

const STATUS_LABEL = { published: "已發布", draft: "草稿", archived: "已封存" };

export default function CourseTemplateManagementPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const rows = useMemo(() => templateCatalog.filter((template) => {
    const matchesQuery = `${template.name} ${template.code}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (status === "all" || template.status === status);
  }), [query, status]);

  return <div className={styles.page}>
    <div className={styles.pageHeader}>
      <div className={styles.pageHeading}>
        <div className={styles.titleLine}><h1 className={styles.pageTitle}>上課機器模板</h1><span className={styles.devBadge}>待開發</span></div>
        <p className={styles.pageSubtitle}>只管理學生上課需要的固定機器組合、規格與網路，不包含任務或進度。</p>
      </div>
      <button type="button" className={styles.btnPrimary} onClick={() => navigate("/course-template-management/new")}><MIcon name="add" size={16} />建立機器模板</button>
    </div>

    <div className={styles.integrationStrip}>
      <MIcon name="hub" size={19} />
      <div><strong>機器來源沿用既有 PVE 範本</strong><span>此功能只負責把一台或多台 PVE 範本組成可重複使用的上課環境。</span></div>
      <button type="button" className={styles.btnSecondary} onClick={() => navigate("/templates")}>查看 PVE 範本</button>
    </div>

    <section className={styles.card}>
      <div className={styles.toolbar}>
        <label className={styles.searchInput}><MIcon name="search" size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋模板名稱或代碼" /></label>
        <div className={styles.pillTabs}>{[["all", "全部"], ["published", "已發布"], ["draft", "草稿"]].map(([key, label]) => <button type="button" key={key} className={status === key ? styles.pillActive : ""} onClick={() => setStatus(key)}>{label}</button>)}</div>
      </div>
      <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>模板名稱</th><th>每位學生的機器</th><th>資源合計</th><th>版本</th><th>使用班級</th><th>狀態</th><th /></tr></thead><tbody>{rows.map((template) => <tr key={template.id} className={styles.rowLink} onClick={() => navigate(`/course-template-management/${template.id}`)}>
        <td><strong>{template.name}</strong><small>{template.code}<br />{template.description}</small></td>
        <td><strong>{template.nodes.length} 台／每位學生</strong><small>{template.nodes.map((node) => node.name).join("、")}</small></td>
        <td>{template.nodes.reduce((sum, node) => sum + node.cpu, 0)} CPU · {template.nodes.reduce((sum, node) => sum + node.memory, 0)} GB RAM</td><td>v{template.version}</td><td>{template.classes} 個班級</td>
        <td><span className={`${styles.statusBadge} ${styles[`status_${template.status}`]}`}>{STATUS_LABEL[template.status]}</span></td>
        <td><button type="button" className={styles.iconBtn} aria-label="開啟模板"><MIcon name="chevron_right" size={19} /></button></td>
      </tr>)}</tbody></table></div>
      {!rows.length && <div className={styles.emptyState}><MIcon name="view_quilt" size={32} /><p>沒有符合條件的上課機器模板。</p></div>}
    </section>
  </div>;
}
