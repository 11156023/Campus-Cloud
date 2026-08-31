import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import MIcon from "../../../components/MIcon";
import PageHeader from "../../../components/PageHeader/PageHeader";
import EmptyState from "../../../components/EmptyState/EmptyState";
import LoadingState from "../../../components/LoadingState/LoadingState";
import { CourseEnvironmentsService } from "../../../services/courseEnvironments";
import { TeachingClassesService } from "../../../services/teachingClasses";
import { focusInvalidField } from "../../../utils/focusField";
import styles from "./ClassSetupPage.module.scss";

const STEPS = [
  ["basic", "班級與課表", "先決定何時上課"],
  ["students", "學生名單", "加入正式班級成員"],
  ["environment", "教學環境", "選擇每位學生的機器"],
  ["tasks", "每週任務", "安排 checkpoint 與內容"],
  ["review", "確認建立", "容量預檢並送出"],
];

function localDate(date) {
  const value = new Date(date);
  value.setMinutes(value.getMinutes() - value.getTimezoneOffset());
  return value.toISOString().slice(0, 10);
}

function defaultForm() {
  const start = new Date();
  start.setDate(start.getDate() + ((8 - start.getDay()) % 7));
  const end = new Date(start);
  end.setMonth(end.getMonth() + 4);
  const rocYear = start.getFullYear() - 1911;
  return {
    name: "", code: "", term: `${rocYear}-1`, location: "", startDate: localDate(start), endDate: localDate(end),
    weekday: (start.getDay() + 6) % 7, startTime: "13:10", endTime: "16:00", timezone: "Asia/Taipei", bootLeadMinutes: 10,
  };
}

export function parseStudentEmails(value) {
  return [...new Set(String(value).split(/[\s,;]+/).map((email) => email.trim().toLowerCase()).filter(Boolean))];
}

export function weekPayload(weeks) {
  return weeks.map((week, index) => ({
    week_number: Number(week.week_number ?? week.week ?? index + 1),
    session_date: week.session_date ?? week.date,
    title: String(week.title ?? "").trim(),
    target_node_key: week.target_node_key ?? week.target ?? null,
    status: week.status ?? "draft",
    files: (week.files ?? []).map((file) => ({
      filename: file.filename,
      storage_key: file.storage_key ?? null,
      target_path: file.target_path ?? null,
    })),
  }));
}

export function templateBuilderPath(classId) {
  const returnTo = `/class-setup?classId=${encodeURIComponent(classId)}&step=3`;
  return `/course-template-management/new?returnTo=${encodeURIComponent(returnTo)}`;
}

function normalizeClass(item) {
  if (!item) return null;
  return {
    ...item,
    id: String(item.id),
    students: item.students ?? [],
    nodes: item.machine_nodes ?? [],
    weeks: item.weeks ?? [],
  };
}

function SummaryLine({ done, label, value }) {
  return <div className={done ? styles.summaryDone : styles.summaryPending}><span><MIcon name={done ? "check" : "radio_button_unchecked"} size={17} /></span><div><strong>{label}</strong><small>{value}</small></div><em>{done ? "完成" : "待設定"}</em></div>;
}

export default function ClassSetupPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const classId = params.get("classId") ?? "";
  const requestedStep = Number(params.get("step") ?? 1);
  const step = Math.min(5, Math.max(1, requestedStep));
  const [form, setForm] = useState(defaultForm);
  const [item, setItem] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState("");
  const [emails, setEmails] = useState("");
  const [weeks, setWeeks] = useState([]);
  const [capacity, setCapacity] = useState(null);
  const [loading, setLoading] = useState(Boolean(classId));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [invalidField, setInvalidField] = useState("");
  const nameRef = useRef(null);
  const emailsRef = useRef(null);

  function markInvalid(key, ref) {
    setInvalidField(key);
    focusInvalidField(ref.current);
  }

  function clearInvalid(key) { setInvalidField((current) => (current === key ? "" : current)); }

  const selectedTemplate = templates.find((template) => String(template.versionId) === String(templateId));
  const completed = [Boolean(item), Boolean(item?.students.length), Boolean(item?.course_environment && item?.nodes.length), weeks.some((week) => String(week.title ?? "").trim())];

  function applyClass(result) {
    const normalized = normalizeClass(result);
    setItem(normalized);
    setWeeks(normalized.weeks);
    if (normalized.course_version_id) setTemplateId(String(normalized.course_version_id));
    setForm({
      name: normalized.name, code: normalized.code, term: normalized.term, location: normalized.location ?? "",
      startDate: normalized.start_date, endDate: normalized.end_date, weekday: normalized.weekday,
      startTime: String(normalized.start_time).slice(0, 5), endTime: String(normalized.end_time).slice(0, 5),
      timezone: normalized.timezone, bootLeadMinutes: normalized.boot_lead_minutes,
    });
  }

  useEffect(() => {
    let active = true;
    CourseEnvironmentsService.listPublished()
      .then((rows) => {
        if (!active) return;
        setTemplates(rows);
        const created = location.state?.createdTemplateId;
        if (created && rows.some((row) => String(row.id) === String(created))) {
          setTemplateId(String(rows.find((row) => String(row.id) === String(created)).versionId));
          setMessage("新教學環境已發布，確認後即可套用到班級。");
        }
      })
      .catch((reason) => active && setMessage(reason?.message ?? "無法讀取已發布教學環境"));
    return () => { active = false; };
  }, [location.state?.createdTemplateId]);

  useEffect(() => {
    if (!classId) { setLoading(false); return undefined; }
    let active = true;
    setLoading(true);
    TeachingClassesService.get(classId)
      .then((result) => active && applyClass(result))
      .catch((reason) => active && setMessage(reason?.message ?? "無法讀取班級草稿"))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [classId]);

  useEffect(() => {
    if (step !== 5 || !classId || !item?.students.length || !item?.nodes.length) return undefined;
    let active = true;
    setCapacity(null);
    TeachingClassesService.capacityPreview(classId)
      .then((result) => active && setCapacity(result))
      .catch((reason) => active && setCapacity({ ready: false, issues: [reason?.message ?? "容量預檢失敗"] }));
    return () => { active = false; };
  }, [step, classId, item?.students.length, item?.nodes.length]);

  function updateForm(key, value) { setForm((current) => ({ ...current, [key]: value })); clearInvalid(key); }
  function go(nextStep) { setParams(classId ? { classId, step: String(nextStep) } : { step: String(nextStep) }); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function createTemplate() { navigate(templateBuilderPath(classId)); }
  function pauseSetup() {
    navigate("/class-management", {
      state: { message: `「${item?.name ?? "班級"}」已保存為草稿，可隨時回來繼續。` },
    });
  }

  async function saveBasic() {
    if (!form.name.trim()) { markInvalid("name", nameRef); return false; }
    const payload = {
      name: form.name.trim(), code: form.code.trim() || `CLASS-${Date.now().toString().slice(-8)}`, term: form.term.trim() || "未指定", location: form.location.trim() || null,
      start_date: form.startDate, end_date: form.endDate, weekday: Number(form.weekday), start_time: form.startTime,
      end_time: form.endTime, timezone: form.timezone, boot_lead_minutes: Number(form.bootLeadMinutes),
    };
    const saved = classId ? await TeachingClassesService.update(classId, payload) : await TeachingClassesService.create(payload);
    applyClass(saved);
    if (!classId) setParams({ classId: String(saved.id), step: "2" });
    return true;
  }

  async function saveStudents() {
    const parsed = parseStudentEmails(emails);
    if (!item?.students.length && !parsed.length) { markInvalid("emails", emailsRef); return false; }
    if (parsed.length) {
      const result = await TeachingClassesService.addStudents(classId, parsed);
      applyClass(result.class);
      setEmails("");
      if (result.not_found?.length) setMessage(`已加入 ${result.added} 位；找不到：${result.not_found.join("、")}`);
    }
    return true;
  }

  async function saveEnvironment() {
    if (!templateId) { setMessage("請選擇一個已發布的教學環境。"); return false; }
    applyClass(await TeachingClassesService.selectCourse(classId, templateId));
    return true;
  }

  async function saveTasks() {
    applyClass(await TeachingClassesService.replaceWeeks(classId, weekPayload(weeks)));
    return true;
  }

  async function next() {
    setBusy(true); setMessage(""); setInvalidField("");
    try {
      const saved = step === 1 ? await saveBasic() : step === 2 ? await saveStudents() : step === 3 ? await saveEnvironment() : await saveTasks();
      if (saved && step < 5 && !(step === 1 && !classId)) go(step + 1);
    } catch (reason) { setMessage(reason?.message ?? "儲存失敗，請稍後再試。"); }
    finally { setBusy(false); }
  }

  async function provision() {
    if (!capacity?.ready) return;
    setBusy(true); setMessage("");
    try {
      const result = await TeachingClassesService.provision(classId);
      navigate(`/class-management/${result.id}`, { replace: true, state: { message: "班級設定已完成並送出建機審核。" } });
    } catch (reason) { setMessage(reason?.message ?? "送出建機失敗"); }
    finally { setBusy(false); }
  }

  const taskCount = useMemo(() => weeks.filter((week) => String(week.title ?? "").trim()).length, [weeks]);
  if (loading) return <LoadingState fullPage text="正在恢復班級設定…" />;

  return <div className={styles.page}>
    <button type="button" className={styles.backLink} onClick={() => navigate("/class-management")}><MIcon name="arrow_back" size={18} />返回班級</button>
    <PageHeader eyebrow="一鍵建立班級" title={item?.name || "建立完整課程班級"} subtitle="依序完成課表、學生、環境與每週任務；每一步都會保存到正式班級。">
      <span className={styles.saveState}><MIcon name="cloud_done" size={16} />{classId ? "班級草稿已建立" : "第一步後開始自動保存"}</span>
    </PageHeader>

    <nav className={styles.stepper} aria-label="建立班級流程">{STEPS.map(([key, label, hint], index) => {
      const number = index + 1;
      const done = number < step || (number <= 4 && completed[index]);
      return <button type="button" key={key} disabled={!classId && number > 1} className={`${step === number ? styles.stepActive : ""} ${done ? styles.stepDone : ""}`} onClick={() => number <= step && go(number)}><span>{done ? <MIcon name="check" size={15} /> : number}</span><div><strong>{label}</strong><small>{hint}</small></div></button>;
    })}</nav>

    {message && <div className={styles.message}><MIcon name="info" size={17} />{message}</div>}

    <main className={styles.content}>
      {step === 1 && <section className={styles.card}><div className={styles.sectionHeader}><span>1</span><div><h2>班級與固定課表</h2><p>先填老師每天會用到的資訊；代碼、時區與提前開機可維持預設。</p></div></div><div className={styles.formGrid}>
        <label className={styles.full}><span>班級名稱</span><input ref={nameRef} className={invalidField === "name" ? styles.invalid : undefined} aria-invalid={invalidField === "name"} value={form.name} onChange={(event) => updateForm("name", event.target.value)} placeholder="例如：Linux Web 實務｜115-1" autoFocus /></label>
        <label className={styles.full}><span>上課地點</span><input value={form.location} onChange={(event) => updateForm("location", event.target.value)} placeholder="例如：電腦教室 A（會顯示在學生今日課表）" /></label>
        <label><span>開始日期</span><input type="date" value={form.startDate} onChange={(event) => updateForm("startDate", event.target.value)} /></label>
        <label><span>結束日期</span><input type="date" value={form.endDate} onChange={(event) => updateForm("endDate", event.target.value)} /></label>
        <label><span>每週上課</span><select value={form.weekday} onChange={(event) => updateForm("weekday", Number(event.target.value))}>{["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"].map((label, index) => <option key={label} value={index}>{label}</option>)}</select></label>
        <label><span>上課時間</span><div className={styles.timePair}><input type="time" value={form.startTime} onChange={(event) => updateForm("startTime", event.target.value)} /><i>至</i><input type="time" value={form.endTime} onChange={(event) => updateForm("endTime", event.target.value)} /></div></label>
        <details className={styles.advanced}><summary>進階設定</summary><div className={styles.advancedGrid}><label><span>學期</span><input value={form.term} onChange={(event) => updateForm("term", event.target.value)} /></label><label><span>提前開機</span><select value={form.bootLeadMinutes} onChange={(event) => updateForm("bootLeadMinutes", Number(event.target.value))}><option value={0}>準時</option><option value={5}>5 分鐘</option><option value={10}>10 分鐘</option><option value={15}>15 分鐘</option><option value={30}>30 分鐘</option></select></label></div></details>
      </div></section>}

      {step === 2 && <section className={styles.card}><div className={styles.sectionHeader}><span>2</span><div><h2>加入學生名單</h2><p>貼上 Email；可以使用換行、逗號或分號分隔。找不到的帳號會單獨回報。</p></div></div><div className={styles.studentLayout}><label><span>學生 Email</span><textarea ref={emailsRef} className={invalidField === "emails" ? styles.invalid : undefined} aria-invalid={invalidField === "emails"} rows={10} value={emails} onChange={(event) => { setEmails(event.target.value); clearInvalid("emails"); }} placeholder={"student01@example.edu\nstudent02@example.edu"} autoFocus /><small>準備加入 {parseStudentEmails(emails).length} 個 Email</small></label><aside><strong>目前班級學生</strong><span>{item?.students.length ?? 0}<small>位</small></span><p>{item?.students.length ? "可以繼續加入學生，重複帳號會自動略過。" : "下一步前至少需要一位已存在的學生帳號。"}</p>{item?.students.slice(0, 5).map((student) => <em key={student.id}>{student.full_name || student.email}</em>)}</aside></div></section>}

      {step === 3 && (
        <section className={styles.card}>
          <div className={styles.sectionHeader}>
            <span>3</span>
            <div>
              <h2>每位學生的教學環境</h2>
              <p>選擇已發布的固定版本。送出建機後，每位學生會取得相同機器組合。</p>
            </div>
          </div>

          <div className={styles.templatePauseCard}>
            <span className={styles.templatePauseIcon}><MIcon name="bookmark_added" size={22} /></span>
            <div>
              <strong>還沒有合適的上課模板？</strong>
              <p>班級資料與學生名單已保存為草稿。可以先去建立模板；完成並發布後，系統會自動回到這一步並替你選取。</p>
              <small><MIcon name="cloud_done" size={14} />離開不會遺失前兩步資料</small>
            </div>
            <div className={styles.templatePauseActions}>
              {templates.length > 0 && (
                <button type="button" className={styles.btnPrimary} onClick={createTemplate}>
                  <MIcon name="add" size={16} />建立新的上課模板
                </button>
              )}
              <button type="button" className={styles.btnSecondary} onClick={pauseSetup}>
                先保存，稍後繼續
              </button>
            </div>
          </div>

          {templates.length > 0 ? (
            <div className={styles.environmentGrid}>
              {templates.map((template) => (
                <button
                  type="button"
                  key={template.versionId}
                  className={String(template.versionId) === String(templateId) ? styles.environmentSelected : ""}
                  onClick={() => setTemplateId(String(template.versionId))}
                >
                  <span><MIcon name="account_tree" size={20} /></span>
                  <div>
                    <strong>{template.name}</strong>
                    <p>{template.description || "沒有補充說明"}</p>
                    <small>每位 {template.nodes.length} 台 · v{template.version} · 已發布</small>
                  </div>
                  <em>{String(template.versionId) === String(templateId) ? "已選擇" : "選擇"}</em>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              icon="view_quilt"
              title="目前沒有已發布的上課模板"
              action={
                <button type="button" className={styles.btnPrimary} onClick={createTemplate}>
                  <MIcon name="add" size={16} />現在建立模板
                </button>
              }
            />
          )}

          {selectedTemplate && (
            <div className={styles.environmentSummary}>
              <strong>全班預估 {Number(item?.students.length ?? 0) * selectedTemplate.nodes.length} 台機器</strong>
              <span>{item?.students.length ?? 0} 位學生 × 每位 {selectedTemplate.nodes.length} 台</span>
            </div>
          )}
        </section>
      )}

      {step === 4 && <section className={styles.card}><div className={styles.sectionHeader}><span>4</span><div><h2>安排每週任務與 Checkpoint</h2><p>課次日期由固定課表產生。先填每週主題或 checkpoint，教材檔案之後仍可在班級內補充。</p></div><em>{taskCount}/{weeks.length} 週已設定</em></div><div className={styles.weekList}>{weeks.map((week, index) => <label key={week.id ?? week.session_date}><span><strong>第 {week.week_number ?? index + 1} 週</strong><small>{week.session_date}</small></span><input value={week.title ?? ""} onChange={(event) => setWeeks((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, title: event.target.value } : row))} placeholder="例如：完成 API 與資料庫連線 checkpoint" /></label>)}</div></section>}

      {step === 5 && <section className={styles.reviewLayout}><div className={styles.card}><div className={styles.sectionHeader}><span>5</span><div><h2>確認班級設定</h2><p>送出後學生、環境與課表會鎖定，並進入管理員建機審核。</p></div></div><div className={styles.summaryList}><SummaryLine done={Boolean(item)} label="班級與課表" value={item ? `${item.start_date} 至 ${item.end_date} · 每週${["一", "二", "三", "四", "五", "六", "日"][item.weekday]} ${String(item.start_time).slice(0, 5)}` : "尚未建立"} /><SummaryLine done={Boolean(item?.students.length)} label="學生名單" value={`${item?.students.length ?? 0} 位學生`} /><SummaryLine done={Boolean(item?.course_environment && item?.nodes.length)} label="教學環境" value={item?.course_environment ? `${item.course_environment.name} · 每位 ${item.nodes.length} 台` : "尚未選擇"} /><SummaryLine done={taskCount > 0} label="每週任務" value={`${taskCount}/${weeks.length} 週已設定；可在開課後繼續補充`} /></div></div><aside className={styles.capacityCard}><span className={styles.capacityIcon}><MIcon name={capacity?.ready ? "check" : "hourglass_top"} size={24} /></span><h2>{capacity ? capacity.ready ? "容量足夠，可以送出" : "容量預檢尚未通過" : "正在執行容量預檢"}</h2>{capacity?.ready ? <><p>全班將建立 {capacity.machine_count} 台機器，預留 {capacity.ip_count} 個 IP。</p><dl><div><dt>CPU</dt><dd>{capacity.cpu_cores}</dd></div><div><dt>RAM</dt><dd>{Math.round(capacity.memory_mb / 1024)} GB</dd></div><div><dt>Disk</dt><dd>{capacity.disk_gb} GB</dd></div></dl></> : <p>{capacity?.issues?.join("；") ?? "正在依學生人數、環境規格與課程期間確認容量。"}</p>}<button type="button" className={styles.btnPrimary} disabled={!capacity?.ready || busy} onClick={provision}><MIcon name="rocket_launch" size={17} />{busy ? "送出中…" : "完成設定並送出建機"}</button><button type="button" className={styles.btnSecondary} onClick={() => navigate(`/class-management/${classId}`)}>先保存草稿，稍後送出</button></aside></section>}
    </main>

    {step < 5 && <footer className={styles.footer}><button type="button" className={styles.btnSecondary} disabled={step === 1 || busy} onClick={() => go(step - 1)}>上一步</button><span>第 {step} 步，共 5 步</span>{step === 3 && !templateId ? <em className={styles.footerHint}><MIcon name="info" size={16} />{templates.length === 0 ? "請先建立並發布上課模板" : "選擇一個上課模板後即可繼續"}</em> : <button type="button" className={styles.btnPrimary} disabled={busy} onClick={next}>{busy ? "儲存中…" : "儲存並下一步"}<MIcon name="arrow_forward" size={16} /></button>}</footer>}
  </div>;
}
