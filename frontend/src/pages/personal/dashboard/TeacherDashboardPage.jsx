import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import MIcon from "../../../components/MIcon";
import { useAuth } from "../../../contexts/AuthContext";
import { CourseAdminService } from "../../../services/courses";
import { TeachingClassesService } from "../../../services/teachingClasses";
import styles from "./TeacherDashboardPage.module.scss";

const CLASS_STATUS = {
  planning: "準備中",
  pending_review: "等待審核",
  provisioning: "建立中",
  partial_failed: "部分失敗",
  active: "上課中",
  archived: "已結束",
};

function dateKey(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

function weekdayFromDateKey(value) {
  const [year, month, day] = value.split("-").map(Number);
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

function addDaysToDateKey(value, days) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function taipeiDateTime(date, time = "00:00") {
  return new Date(`${date}T${time.slice(0, 5)}:00+08:00`);
}

export function nextClassSession(item, now = new Date()) {
  if (!item?.start_date || !item?.end_date) return null;
  const start = taipeiDateTime(item.start_date);
  const end = new Date(`${item.end_date}T23:59:59+08:00`);
  if (now > end) return null;
  const targetWeekday = Number(item.weekday ?? 0);
  const baseDate = now < start ? item.start_date : dateKey(now);
  const daysUntilTarget = (targetWeekday - weekdayFromDateKey(baseDate) + 7) % 7;
  let sessionDate = addDaysToDateKey(baseDate, daysUntilTarget);
  let session = taipeiDateTime(sessionDate, String(item.start_time ?? "00:00"));
  if (session < start || session < now) {
    sessionDate = addDaysToDateKey(sessionDate, 7);
    session = taipeiDateTime(sessionDate, String(item.start_time ?? "00:00"));
  }
  return session <= end ? session : null;
}

export function summarizeCheckpointReports(rows) {
  const summary = rows.reduce((acc, row) => {
    const students = row.report?.students ?? [];
    const completed = students.reduce((sum, student) => sum + Number(student.completed_questions ?? 0), 0);
    const possible = students.reduce((sum, student) => sum + Number(student.total_questions ?? 0), 0);
    acc.completed += completed;
    acc.possible += possible;
    acc.students += students.length;
    return acc;
  }, { completed: 0, possible: 0, students: 0 });
  return {
    ...summary,
    percent: summary.possible ? Math.round(summary.completed / summary.possible * 100) : 0,
  };
}

function normalizeClass(item) {
  return {
    ...item,
    id: String(item.id),
    students: item.member_count ?? item.students?.length ?? 0,
    nodes: item.machine_nodes ?? [],
    readyMachines: item.ready_machines ?? 0,
    totalMachines: item.total_machines ?? 0,
  };
}

function CheckpointRow({ item, onOpen }) {
  const students = item.report?.students ?? [];
  const completed = students.reduce((sum, student) => sum + Number(student.completed_questions ?? 0), 0);
  const possible = students.reduce((sum, student) => sum + Number(student.total_questions ?? 0), 0);
  const percent = possible ? Math.round(completed / possible * 100) : 0;
  const fullyCompleted = students.filter((student) => Number(student.progress_percent) >= 100).length;
  return <button type="button" className={styles.checkpointRow} onClick={onOpen}>
    <span className={styles.courseIcon}><MIcon name="checklist" size={19} /></span>
    <span className={styles.checkpointMain}>
      <span><strong>{item.path.title}</strong><small>{students.length ? `${fullyCompleted}/${students.length} 位學生完成全部 checkpoint` : "尚無學生 checkpoint 紀錄"}</small></span>
      <span className={styles.progressTrack}><i style={{ width: `${percent}%` }} /></span>
    </span>
    <span className={styles.checkpointMetric}><strong>{percent}%</strong><small>{completed}/{possible || item.report?.total_questions || 0}</small></span>
    <MIcon name="chevron_right" size={19} />
  </button>;
}

export default function TeacherDashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [classes, setClasses] = useState([]);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const [classRows, pathRows] = await Promise.all([
          TeachingClassesService.list(),
          CourseAdminService.listPaths(),
        ]);
        if (!active) return;
        setClasses((classRows?.data ?? classRows ?? []).map(normalizeClass));
        const ownedPaths = (pathRows ?? []).filter((path) => !path.created_by || String(path.created_by) === String(user?.id));
        const settled = await Promise.allSettled(
          ownedPaths.slice(0, 6).map(async (path) => ({ path, report: await CourseAdminService.getPathProgress(path.id) })),
        );
        if (active) setReports(settled.filter((result) => result.status === "fulfilled").map((result) => result.value));
      } catch (reason) {
        if (active) setError(reason?.message ?? "無法讀取教師儀表板資料");
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, [user?.id]);

  const checkpointSummary = useMemo(() => summarizeCheckpointReports(reports), [reports]);
  const upcoming = useMemo(() => classes
    .map((item) => ({ item, session: nextClassSession(item) }))
    .filter((row) => row.session)
    .sort((a, b) => a.session - b.session)
    .slice(0, 4), [classes]);
  const incompleteStudents = useMemo(() => reports.flatMap(({ path, report }) => (report?.students ?? [])
    .filter((student) => Number(student.progress_percent) < 100)
    .map((student) => ({ ...student, pathTitle: path.title, pathId: path.id })))
    .sort((a, b) => Number(a.progress_percent) - Number(b.progress_percent))
    .slice(0, 5), [reports]);
  const firstName = user?.full_name?.trim()?.split(/\s+/)[0] ?? user?.email?.split("@")[0] ?? "老師";

  return <div className={styles.page}>
    <header className={styles.header}>
      <div><span className={styles.eyebrow}>教師儀表板</span><h1>{firstName}老師，今天想先看哪個班級？</h1><p>集中查看學生 checkpoint 完成度、近期課堂與課程準備狀態。</p></div>
      <button type="button" className={styles.btnPrimary} onClick={() => navigate("/class-setup")}><MIcon name="add" size={18} />一鍵建立班級</button>
    </header>

    {error && <div className={styles.error}><MIcon name="error_outline" size={18} />{error}</div>}

    <section className={styles.metricGrid} aria-label="教學摘要">
      <article><span className={styles.metricIcon}><MIcon name="task_alt" size={20} /></span><div><small>Checkpoint 完成度</small><strong>{loading ? "—" : `${checkpointSummary.percent}%`}</strong><p>{checkpointSummary.completed}/{checkpointSummary.possible} 個學生 checkpoint</p></div></article>
      <article><span className={styles.metricIcon}><MIcon name="groups" size={20} /></span><div><small>已有學習紀錄</small><strong>{loading ? "—" : checkpointSummary.students}</strong><p>跨 {reports.length} 個學習路徑</p></div></article>
      <article><span className={styles.metricIcon}><MIcon name="school" size={20} /></span><div><small>進行中的班級</small><strong>{loading ? "—" : classes.filter((item) => item.status !== "archived").length}</strong><p>{classes.filter((item) => item.status === "planning").length} 個仍在準備</p></div></article>
      <article><span className={styles.metricIcon}><MIcon name="calendar_today" size={20} /></span><div><small>下一堂課</small><strong>{upcoming[0] ? upcoming[0].session.toLocaleDateString("zh-TW", { month: "numeric", day: "numeric" }) : "—"}</strong><p>{upcoming[0]?.item.name ?? "尚無近期班級"}</p></div></article>
    </section>

    <div className={styles.mainGrid}>
      <section className={styles.panel}>
        <div className={styles.panelHeader}><div><span className={styles.eyebrow}>學習成果</span><h2>學生 Checkpoint 完成度</h2><p>以學生實際完成的題目與 checkpoint 統計，不混入機器建立狀態。</p></div><button type="button" className={styles.textButton} onClick={() => navigate("/course-cms?tab=progress")}>完整進度<MIcon name="arrow_forward" size={16} /></button></div>
        <div className={styles.checkpointList}>{loading ? <p className={styles.empty}>正在讀取 checkpoint…</p> : reports.length ? reports.map((item) => <CheckpointRow key={item.path.id} item={item} onOpen={() => navigate(`/course-cms?tab=progress&pathId=${item.path.id}`)} />) : <div className={styles.emptyAction}><MIcon name="checklist" size={28} /><strong>尚無 checkpoint 資料</strong><p>先建立並發布教學內容，學生完成後會在這裡彙整。</p><button type="button" className={styles.btnSecondary} onClick={() => navigate("/course-cms")}>建立教學內容</button></div>}</div>
      </section>

      <aside className={styles.panel}>
        <div className={styles.panelHeader}><div><span className={styles.eyebrow}>跟進學生</span><h2>尚未完成 Checkpoint</h2><p>優先列出完成度較低的學生。</p></div></div>
        <div className={styles.studentList}>{loading ? <p className={styles.empty}>正在讀取學生進度…</p> : incompleteStudents.length ? incompleteStudents.map((student) => <button key={`${student.pathId}-${student.user_id}`} type="button" onClick={() => navigate(`/course-cms?tab=progress&pathId=${student.pathId}`)}><span className={styles.studentAvatar}>{(student.user_name ?? student.user_email ?? "學").slice(0, 1)}</span><span><strong>{student.user_name ?? student.user_email}</strong><small>{student.pathTitle} · {student.completed_questions}/{student.total_questions}</small></span><em>{Math.round(student.progress_percent)}%</em></button>) : <div className={styles.allDone}><MIcon name="verified" size={26} /><strong>{reports.length ? "目前學生皆已完成" : "尚無學生進度"}</strong><p>{reports.length ? "沒有需要跟進的 checkpoint。" : "學生開始作答後會顯示於此。"}</p></div>}</div>
      </aside>
    </div>

    <section className={styles.panel}>
      <div className={styles.panelHeader}><div><span className={styles.eyebrow}>課堂安排</span><h2>近期班級</h2><p>從班級進入學生名單、機器、任務與上課監看。</p></div><button type="button" className={styles.textButton} onClick={() => navigate("/class-management")}>全部班級<MIcon name="arrow_forward" size={16} /></button></div>
      <div className={styles.classList}>{loading ? <p className={styles.empty}>正在讀取班級…</p> : upcoming.length ? upcoming.map(({ item, session }) => {
        const ready = item.totalMachines ? Math.round(item.readyMachines / item.totalMachines * 100) : 0;
        return <button type="button" key={item.id} className={styles.classRow} onClick={() => navigate(`/class-management/${item.id}`)}><span className={styles.classDate}><strong>{session.toLocaleDateString("zh-TW", { month: "numeric", day: "numeric" })}</strong><small>{String(item.start_time ?? "").slice(0, 5)}</small></span><span className={styles.classMain}><strong>{item.name}</strong><small>{item.students} 位學生 · 每位 {item.nodes.length} 台機器</small></span><span className={styles.classState}><em className={styles[`status_${item.status}`]}>{CLASS_STATUS[item.status] ?? item.status}</em><small>{item.status === "active" ? `${ready}% 機器就緒` : item.status === "planning" ? "繼續完成班級設定" : "查看目前進度"}</small></span><MIcon name="chevron_right" size={19} /></button>;
      }) : <div className={styles.emptyAction}><MIcon name="event_available" size={28} /><strong>尚無近期班級</strong><p>建立第一個班級，把學生、環境與任務一次設定完成。</p><button type="button" className={styles.btnPrimary} onClick={() => navigate("/class-setup")}>一鍵建立班級</button></div>}</div>
    </section>
  </div>;
}
