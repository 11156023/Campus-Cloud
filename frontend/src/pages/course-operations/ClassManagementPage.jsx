import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import MIcon from "../../components/MIcon";
import { TeachingClassesService } from "../../services/teachingClasses";
import ClassCreateDialog from "./ClassCreatePage";
import styles from "./CourseOperations.module.scss";

const STATUS = {
  planning: "準備中",
  pending_review: "等待審核",
  provisioning: "正在建立",
  partial_failed: "需要處理",
  active: "可以上課",
  archived: "已結束",
};

const FILTERS = [
  ["all", "全部"],
  ["planning", "準備中"],
  ["pending_review", "待審核"],
  ["provisioning", "建立中"],
  ["partial_failed", "需處理"],
  ["active", "可上課"],
];

function normalizeClass(item) {
  return {
    ...item,
    id: String(item.id),
    startDate: item.start_date,
    endDate: item.end_date,
    startTime: String(item.start_time ?? "").slice(0, 5),
    endTime: String(item.end_time ?? "").slice(0, 5),
    bootLeadMinutes: item.boot_lead_minutes,
    students: item.member_count ?? item.students?.length ?? 0,
    weeks: item.weeks ?? [],
    nodes: item.machine_nodes ?? [],
    readyMachines: item.ready_machines ?? 0,
    totalMachines: item.total_machines ?? 0,
  };
}

function nextStep(item) {
  if (!item.students) return ["加入學生", "students"];
  if (!item.nodes.length) return ["設定上課環境", "machines"];
  if (item.status === "planning") return ["確認並送出建機", "overview"];
  if (item.status === "partial_failed") return ["查看失敗項目", "overview"];
  if (item.status === "active") return ["進入班級", "overview"];
  return ["查看建機進度", "overview"];
}

export default function ClassManagementPage({ openCreate = false }) {
  const navigate = useNavigate();
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [createOpen, setCreateOpen] = useState(openCreate);

  useEffect(() => {
    let active = true;
    TeachingClassesService.list()
      .then((rows) => active && setClasses((rows?.data ?? rows ?? []).map(normalizeClass)))
      .catch((reason) => active && setError(reason?.message ?? "無法讀取班級資料"))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  const rows = useMemo(
    () => classes.filter((item) => (status === "all" || item.status === status)
      && `${item.name} ${item.code}`.toLowerCase().includes(query.toLowerCase())),
    [classes, query, status],
  );

  return <div className={styles.page}>
    <header className={styles.pageHeader}>
      <div className={styles.pageHeading}>
        <h1 className={styles.pageTitle}>我的班級</h1>
        <p className={styles.pageSubtitle}>從尚未完成的班級繼續準備，或進入已就緒的班級開始上課。</p>
      </div>
      <button type="button" className={styles.btnPrimary} onClick={() => setCreateOpen(true)}>
        <MIcon name="add" size={17} />建立班級
      </button>
    </header>

    {error && <p className={styles.errorMessage}>{error}</p>}

    <div className={styles.classToolbar}>
      <label className={styles.searchInput}><MIcon name="search" size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋班級" /></label>
      <div className={styles.pillTabs}>{FILTERS.map(([key, label]) => <button type="button" key={key} className={status === key ? styles.pillActive : ""} onClick={() => setStatus(key)}>{label}</button>)}</div>
    </div>

    {loading ? <div className={styles.classLoading}><span />正在讀取班級…</div> : rows.length ? <section className={styles.classCardGrid}>
      {rows.map((item) => {
        const setupReady = [item.students > 0, item.nodes.length > 0].filter(Boolean).length;
        const progress = item.status === "planning" ? setupReady / 2 * 100 : item.totalMachines ? item.readyMachines / item.totalMachines * 100 : 0;
        const [action, target] = nextStep(item);
        return <article className={styles.classCard} key={item.id}>
          <button type="button" className={styles.classCardMain} onClick={() => navigate(`/class-management/${item.id}`)}>
            <div className={styles.classCardTop}>
              <div><span>{item.code} · {item.term}</span><h2>{item.name}</h2></div>
              <span className={`${styles.statusBadge} ${styles[`status_${item.status}`]}`}>{STATUS[item.status] ?? item.status}</span>
            </div>
            <div className={styles.classSchedule}><MIcon name="calendar_today" size={17} /><div><strong>每週{["一", "二", "三", "四", "五", "六", "日"][item.weekday]} {item.startTime}–{item.endTime}</strong><small>{item.startDate} 至 {item.endDate} · 提前 {item.bootLeadMinutes} 分鐘開機</small></div></div>
            <div className={styles.classProgress}><div><span>{item.status === "planning" ? "建機準備" : "機器建立"}</span><strong>{item.status === "planning" ? `${setupReady}/2` : `${item.readyMachines}/${item.totalMachines}`}</strong></div><i><b style={{ width: `${progress}%` }} /></i></div>
          </button>
          <div className={styles.classInfoLine}><span>{item.students} 位學生</span><span>{item.weeks.length} 個課次</span><span>每位 {item.nodes.length} 台機器</span></div>
          <div className={styles.classCardAction}><span>{item.status === "active" ? "環境已準備完成" : action}</span><button type="button" onClick={() => navigate(target === "overview" ? `/class-management/${item.id}` : `/class-management/${item.id}/${target}`)}>{action}<MIcon name="arrow_forward" size={17} /></button></div>
        </article>;
      })}
    </section> : <div className={styles.emptyState}><MIcon name="school" size={32} /><p>目前沒有符合條件的班級。</p></div>}
    {createOpen && <ClassCreateDialog onClose={() => { setCreateOpen(false); if (openCreate) navigate("/class-management", { replace: true }); }} onCreated={(created) => navigate(`/class-management/${created.id}/students`)} />}
  </div>;
}
