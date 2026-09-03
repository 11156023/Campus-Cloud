import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import LoadingState from "../../../components/LoadingState/LoadingState";
import MIcon from "../../../components/MIcon";
import EmptyState from "../../../components/EmptyState/EmptyState";
import { TeachingClassesService } from "../../../services/teachingClasses";
import styles from "../CourseOperations.module.scss";
import PageHeader from "../../../components/PageHeader/PageHeader";

const STATUS_KEYS = {
  planning: "ClassManagementPage.statusPlanning",
  pending_review: "ClassManagementPage.statusPendingReview",
  provisioning: "ClassManagementPage.statusProvisioning",
  partial_failed: "ClassManagementPage.statusPartialFailed",
  active: "ClassManagementPage.statusActive",
  archived: "ClassManagementPage.statusArchived",
};

const FILTER_KEYS = [
  ["all", "ClassManagementPage.filterAll"],
  ["planning", "ClassManagementPage.filterPlanning"],
  ["pending_review", "ClassManagementPage.filterPendingReview"],
  ["provisioning", "ClassManagementPage.filterProvisioning"],
  ["partial_failed", "ClassManagementPage.filterPartialFailed"],
  ["active", "ClassManagementPage.filterActive"],
];

const WEEKDAY_KEYS = [
  "ClassManagementPage.weekdayMon",
  "ClassManagementPage.weekdayTue",
  "ClassManagementPage.weekdayWed",
  "ClassManagementPage.weekdayThu",
  "ClassManagementPage.weekdayFri",
  "ClassManagementPage.weekdaySat",
  "ClassManagementPage.weekdaySun",
];

const STATUS_HINT_KEYS = {
  planning: "ClassManagementPage.hintPlanning",
  pending_review: "ClassManagementPage.hintPendingReview",
  provisioning: "ClassManagementPage.hintProvisioning",
  partial_failed: "ClassManagementPage.hintPartialFailed",
  active: "ClassManagementPage.hintActive",
  archived: "ClassManagementPage.hintArchived",
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

function nextAction(item, t) {
  if (item.status === "planning") {
    const step = classSetupResumeStep(item);
    const labels = {
      2: t("ClassManagementPage.actionContinueStudents"),
      3: t("ClassManagementPage.actionContinueEnv"),
      4: t("ClassManagementPage.actionContinueTasks"),
      5: t("ClassManagementPage.actionConfirmSubmit"),
    };
    return [labels[step], `/class-setup?classId=${item.id}&step=${step}`];
  }
  if (item.status === "partial_failed") return [t("ClassManagementPage.actionViewFailed"), `/class-management/${item.id}`];
  if (item.status === "active") return [t("ClassManagementPage.actionEnterClass"), `/class-management/${item.id}`];
  return [t("ClassManagementPage.actionViewProgress"), `/class-management/${item.id}`];
}

export default function ClassManagementPage() {
  const { t } = useTranslation("teaching");
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
      .catch((reason) => active && setError(reason?.message ?? t("ClassManagementPage.loadFailed")))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [t]);

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
    <PageHeader title={t("ClassManagementPage.title")} subtitle={t("ClassManagementPage.subtitle")}>
      <button type="button" className={styles.btnPrimary} onClick={() => navigate("/class-setup")}>
        <MIcon name="add" size={17} />{t("ClassManagementPage.createClass")}
      </button>
    </PageHeader>

    {error && <p className={styles.errorMessage}>{error}</p>}
    {location.state?.message && <p className={styles.persistentFeedback}><MIcon name="cloud_done" size={17} />{location.state.message}</p>}

    <div className={styles.classToolbar}>
      <label className={styles.searchInput}><MIcon name="search" size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("ClassManagementPage.searchPlaceholder")} /></label>
      <div className={styles.pillTabs}>{FILTER_KEYS.map(([key, labelKey]) => <button type="button" key={key} className={status === key ? styles.pillActive : ""} onClick={() => setStatus(key)}>{t(labelKey)}<i>{statusCounts[key] ?? 0}</i></button>)}</div>
    </div>

    {loading ? <LoadingState fullPage text={t("ClassManagementPage.loadingText")} /> : rows.length ? <section className={styles.classCardGrid}>
      {rows.map((item) => {
        const setupReady = [item.students > 0, item.nodes.length > 0].filter(Boolean).length;
        const progress = item.status === "planning" ? setupReady / 2 * 100 : item.totalMachines ? item.readyMachines / item.totalMachines * 100 : 0;
        const [action, target] = nextAction(item, t);
        return <article className={`${styles.classCard}${item.status === "partial_failed" ? ` ${styles.classCardAlert}` : ""}`} key={item.id}>
          <button type="button" className={styles.classCardMain} onClick={() => navigate(`/class-management/${item.id}`)}>
            <div className={styles.classCardTop}>
              <div><span>{item.code} · {item.term}</span><h2>{item.name}</h2></div>
              <span className={`${styles.statusBadge} ${styles[`status_${item.status}`]}`}>{STATUS_KEYS[item.status] ? t(STATUS_KEYS[item.status]) : item.status}</span>
            </div>
            <div className={styles.classMeta}>
              <strong><MIcon name="schedule" size={16} />{t("ClassManagementPage.weeklyPrefix")}{t(WEEKDAY_KEYS[item.weekday])} {item.startTime}–{item.endTime}</strong>
              <span><MIcon name="calendar_today" size={15} />{item.startDate} {t("ClassManagementPage.dateTo")} {item.endDate}</span>
              <span><MIcon name="power_settings_new" size={15} />{t("ClassManagementPage.bootLeadLabel", { minutes: item.bootLeadMinutes })}</span>
            </div>
            <div className={styles.classProgress}><div><span>{item.status === "planning" ? t("ClassManagementPage.progressSetup") : t("ClassManagementPage.progressBuild")}</span><strong>{item.status === "planning" ? `${setupReady}/2` : `${item.readyMachines}/${item.totalMachines}`}</strong></div><i><b style={{ width: `${progress}%` }} /></i></div>
          </button>
          <div className={styles.classStats}>
            <div><strong>{item.students}</strong><span>{t("ClassManagementPage.unitStudents")}</span></div>
            <div><strong>{item.weeks.length}</strong><span>{t("ClassManagementPage.unitSessions")}</span></div>
            <div><strong>{item.nodes.length}</strong><span>{t("ClassManagementPage.unitMachinesPerPerson")}</span></div>
          </div>
          <div className={styles.classCardAction}><span>{STATUS_HINT_KEYS[item.status] ? t(STATUS_HINT_KEYS[item.status]) : ""}</span><button type="button" onClick={() => navigate(target)}>{action}<MIcon name="arrow_forward" size={16} /></button></div>
        </article>;
      })}
    </section> : <EmptyState
      icon="school"
      title={classes.length ? t("ClassManagementPage.emptyFilteredTitle") : t("ClassManagementPage.emptyTitle")}
      description={classes.length ? undefined : t("ClassManagementPage.emptyDescription")}
    />}
  </div>;
}
