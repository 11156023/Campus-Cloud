import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import LoadingState from "../../components/LoadingState/LoadingState";
import MIcon from "../../components/MIcon";
import EmptyState from "../../components/EmptyState/EmptyState";
import { TeachingClassesService } from "../../services/teachingClasses";
import styles from "./CourseOperations.module.scss";
import PageHeader from "../../components/PageHeader/PageHeader";

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

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

const STATUS_HINT = {
  planning: "建置尚未完成",
  pending_review: "已送審，等待管理員核准",
  provisioning: "機器正在建立中",
  partial_failed: "部分機器建立失敗",
  active: "環境已準備完成",
  archived: "課程已結束",
};

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

export function classSetupResumeStep(item) {
  if (!item.students) return 2;
  if (!item.nodes?.length) return 3;
  if (!(item.weeks ?? []).some((week) => String(week.title ?? "").trim())) return 4;
  return 5;
}

function nextAction(item) {
  if (item.status === "planning") {
    const step = classSetupResumeStep(item);
    const labels = { 2: "繼續加入學生", 3: "繼續設定上課環境", 4: "繼續安排任務", 5: "確認並送出建機" };
    return [labels[step], `/class-setup?classId=${item.id}&step=${step}`];
  }
  if (item.status === "partial_failed") return ["查看失敗項目", `/class-management/${item.id}`];
  if (item.status === "active") return ["進入班級", `/class-management/${item.id}`];
  return ["查看建機進度", `/class-management/${item.id}`];
}

export default function ClassManagementPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");

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

  const statusCounts = useMemo(() => {
    const counts = { all: classes.length };
    classes.forEach((item) => { counts[item.status] = (counts[item.status] ?? 0) + 1; });
    return counts;
  }, [classes]);

  return <div className={`${styles.page} ${styles.listPage}`}>
    <PageHeader title="我的班級" subtitle="從尚未完成的班級繼續準備，或進入已就緒的班級開始上課。">
      <button type="button" className={styles.btnPrimary} onClick={() => navigate("/class-setup")}>
        <MIcon name="add" size={17} />一鍵建立班級
      </button>
    </PageHeader>

    {error && <p className={styles.errorMessage}>{error}</p>}
    {location.state?.message && <p className={styles.persistentFeedback}><MIcon name="cloud_done" size={17} />{location.state.message}</p>}

    <div className={styles.classToolbar}>
      <label className={styles.searchInput}><MIcon name="search" size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋班級" /></label>
      <div className={styles.pillTabs}>{FILTERS.map(([key, label]) => <button type="button" key={key} className={status === key ? styles.pillActive : ""} onClick={() => setStatus(key)}>{label}<i>{statusCounts[key] ?? 0}</i></button>)}</div>
    </div>

    {loading ? <LoadingState fullPage text="正在讀取班級…" /> : rows.length ? <section className={styles.classCardGrid}>
      {rows.map((item) => {
        const setupReady = [item.students > 0, item.nodes.length > 0].filter(Boolean).length;
        const progress = item.status === "planning" ? setupReady / 2 * 100 : item.totalMachines ? item.readyMachines / item.totalMachines * 100 : 0;
        const [action, target] = nextAction(item);
        return <article className={`${styles.classCard}${item.status === "partial_failed" ? ` ${styles.classCardAlert}` : ""}`} key={item.id}>
          <button type="button" className={styles.classCardMain} onClick={() => navigate(`/class-management/${item.id}`)}>
            <div className={styles.classCardTop}>
              <div><span>{item.code} · {item.term}</span><h2>{item.name}</h2></div>
              <span className={`${styles.statusBadge} ${styles[`status_${item.status}`]}`}>{STATUS[item.status] ?? item.status}</span>
            </div>
            <div className={styles.classMeta}>
              <strong><MIcon name="schedule" size={16} />每週{WEEKDAYS[item.weekday]} {item.startTime}–{item.endTime}</strong>
              <span><MIcon name="calendar_today" size={15} />{item.startDate} 至 {item.endDate}</span>
              <span><MIcon name="power_settings_new" size={15} />提前 {item.bootLeadMinutes} 分鐘開機</span>
            </div>
            <div className={styles.classProgress}><div><span>{item.status === "planning" ? "建機準備" : "機器建立"}</span><strong>{item.status === "planning" ? `${setupReady}/2` : `${item.readyMachines}/${item.totalMachines}`}</strong></div><i><b style={{ width: `${progress}%` }} /></i></div>
          </button>
          <div className={styles.classStats}>
            <div><strong>{item.students}</strong><span>位學生</span></div>
            <div><strong>{item.weeks.length}</strong><span>個課次</span></div>
            <div><strong>{item.nodes.length}</strong><span>台機器／每人</span></div>
          </div>
          <div className={styles.classCardAction}><span>{STATUS_HINT[item.status] ?? ""}</span><button type="button" onClick={() => navigate(target)}>{action}<MIcon name="arrow_forward" size={16} /></button></div>
        </article>;
      })}
    </section> : <EmptyState
      icon="school"
      title={classes.length ? "沒有符合搜尋或篩選條件的班級。" : "還沒有任何班級。"}
      description={classes.length ? undefined : "建立班級後，SkyLab 會替每位學生準備好上課機器。"}
      action={classes.length ? undefined : <button type="button" className={styles.btnSecondary} onClick={() => navigate("/class-setup")}><MIcon name="add" size={17} />一鍵建立班級</button>}
    />}
  </div>;
}
