import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import MIcon from "../../components/MIcon";
import { GroupsService } from "../../services/groups";
import { classCatalog, templateCatalog } from "./courseOperationsMock";
import styles from "./CourseOperations.module.scss";

function normalizeGroup(group) {
  return {
    id: String(group.id), name: group.name, code: group.code ?? `GROUP-${String(group.id).slice(0, 8).toUpperCase()}`,
    term: group.term ?? "目前學期", teacher: group.owner_name ?? "授課老師", students: group.member_count ?? group.members?.length ?? 0,
    templateId: group.template_id ?? null, templateVersion: group.template_version ?? null, machinesPerStudent: group.machines_per_student ?? 0,
    status: group.class_status ?? "planning", startDate: group.start_date ?? "尚未設定", endDate: group.end_date ?? "尚未設定",
    readyMachines: group.ready_machines ?? 0, totalMachines: group.total_machines ?? 0, realGroup: true,
  };
}

export default function ClassManagementPage() {
  const navigate = useNavigate();
  const [classes, setClasses] = useState(classCatalog);
  const [source, setSource] = useState("loading");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  useEffect(() => { let active = true; GroupsService.list().then((result) => { const rows = result?.data ?? result ?? []; if (!active) return; if (rows.length) { setClasses(rows.map(normalizeGroup)); setSource("groups"); } else setSource("preview"); }).catch(() => active && setSource("preview")); return () => { active = false; }; }, []);
  const rows = useMemo(() => classes.filter((item) => (status === "all" || item.status === status) && `${item.name} ${item.code}`.toLowerCase().includes(query.toLowerCase())), [classes, query, status]);
  return <div className={styles.page}>
    <div className={styles.pageHeader}><div className={styles.pageHeading}><div className={styles.titleLine}><h1 className={styles.pageTitle}>班級管理</h1><span className={styles.devBadge}>待開發</span></div><p className={styles.pageSubtitle}>先完成學生、上課機器與每週任務設計；班級啟用後才進入正式上課與進度管理。</p></div><button type="button" className={styles.btnPrimary} onClick={() => navigate("/class-management/new")}><MIcon name="add" size={16} />建立班級</button></div>
    <div className={styles.integrationStrip}><MIcon name="groups" size={19} /><div><strong>{source === "groups" ? "已讀取既有學生群組" : source === "loading" ? "正在讀取既有學生群組" : "目前顯示整合預覽資料"}</strong><span>群組只作為學生來源；班級仍是獨立的上課容器。</span></div><span className={styles.devBadge}>班級資料模型待開發</span></div>
    <section className={styles.card}>
      <div className={styles.toolbar}><label className={styles.searchInput}><MIcon name="search" size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋班級名稱或代碼" /></label><div className={styles.pillTabs}>{[["all", "全部"], ["active", "上課中"], ["planning", "設計中"], ["archived", "已封存"]].map(([key, label]) => <button type="button" key={key} className={status === key ? styles.pillActive : ""} onClick={() => setStatus(key)}>{label}</button>)}</div></div>
      <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>班級</th><th>學生</th><th>上課機器</th><th>開課準備</th><th>目前週次</th><th>狀態</th><th /></tr></thead><tbody>{rows.map((item) => { const template = templateCatalog.find((candidate) => candidate.id === item.templateId); return <tr key={item.id} className={styles.rowLink} onClick={() => navigate(`/class-management/${item.id}`, { state: { classItem: item } })}><td><strong>{item.name}</strong><small>{item.code} · {item.term}</small></td><td><strong>{item.students} 人</strong><small>班級學生名單</small></td><td>{template ? <><strong>{template.name}</strong><small>v{item.templateVersion} · 每人 {item.machinesPerStudent} 台</small></> : <span className={styles.needsSetup}>待選擇</span>}</td><td><strong>{item.status === "planning" ? "設計中" : `${item.readyMachines}/${item.totalMachines} 台就緒`}</strong><small>{item.status === "planning" ? "尚未開始上課" : "固定環境"}</small></td><td><strong>{item.status === "active" ? "第 3 週" : "—"}</strong><small>{item.status === "active" ? "上課中" : "未開課"}</small></td><td><span className={`${styles.statusBadge} ${styles[`status_${item.status}`]}`}>{item.status === "active" ? "上課中" : item.status === "planning" ? "設計中" : "已封存"}</span></td><td><button type="button" className={styles.iconBtn} aria-label="開啟班級"><MIcon name="chevron_right" size={19} /></button></td></tr>; })}</tbody></table></div>
    </section>
  </div>;
}
