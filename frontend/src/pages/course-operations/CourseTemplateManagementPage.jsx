import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import MIcon from "../../components/MIcon";
import { listCourseTemplates } from "./courseOperationsStore";
import styles from "./CourseOperations.module.scss";

const STATUS_LABEL = { published: "已發布", draft: "草稿", archived: "已封存" };

export default function CourseTemplateManagementPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const templates = useMemo(() => listCourseTemplates(), [location.key]);
  const rows = useMemo(() => templates.filter((template) => {
    const matchesQuery = `${template.name} ${template.code}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (status === "all" || template.status === status);
  }), [query, status, templates]);

  return <div className={styles.page}>
    <div className={styles.pageHeader}>
      <div className={styles.pageHeading}>
        <div className={styles.titleLine}><h1 className={styles.pageTitle}>環境模板</h1></div>
        <p className={styles.pageSubtitle}>定義每位學生需要的機器組合，再重複套用到不同班級。</p>
      </div>
      <button type="button" className={styles.btnPrimary} onClick={() => navigate("/course-template-management/new")}><MIcon name="add" size={16} />建立環境模板</button>
    </div>

    <section className={styles.card}>
      <div className={styles.toolbar}>
        <label className={styles.searchInput}><MIcon name="search" size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋模板名稱或代碼" /></label>
        <div className={styles.pillTabs}>{[["all", "全部"], ["published", "已發布"], ["draft", "草稿"]].map(([key, label]) => <button type="button" key={key} className={status === key ? styles.pillActive : ""} onClick={() => setStatus(key)}>{label}</button>)}</div>
      </div>
      <div className={styles.listSummary}><span>顯示 {rows.length} 個可重複使用模板</span><span>模板只定義機器，不包含上課內容</span></div><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>模板名稱</th><th>每位學生的機器</th><th>資源合計</th><th>版本</th><th>使用班級</th><th>狀態</th><th /></tr></thead><tbody>{rows.map((template) => <tr key={template.id} className={styles.rowLink} onClick={() => navigate(`/course-template-management/${template.id}`)}>
        <td><strong>{template.name}</strong><small>{template.code}<br />{template.description}</small></td>
        <td><strong>{template.nodes.length} 台／每位學生</strong><small>{template.nodes.map((node) => node.name).join("、")}</small></td>
        <td>{template.nodes.reduce((sum, node) => sum + node.cpu, 0)} CPU · {template.nodes.reduce((sum, node) => sum + node.memory, 0)} GB RAM</td><td>v{template.version}</td><td>{template.classes} 個班級</td>
        <td><span className={`${styles.statusBadge} ${styles[`status_${template.status}`]}`}>{STATUS_LABEL[template.status]}</span></td>
        <td><button type="button" className={styles.iconBtn} aria-label="開啟模板"><MIcon name="chevron_right" size={19} /></button></td>
      </tr>)}</tbody></table></div>
      {!rows.length && <div className={styles.emptyState}><MIcon name="view_quilt" size={32} /><p>沒有符合條件的環境模板。</p></div>}
    </section>
  </div>;
}
