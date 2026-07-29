import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import MIcon from "../../components/MIcon";
import ClassroomWatchDialog from "../../components/Classroom/ClassroomWatchDialog";
import { ClassroomService } from "../../services/classroom";
import { TeachingClassesService } from "../../services/teachingClasses";
import { listCourseTemplates } from "./courseOperationsStore";
import styles from "./CourseOperations.module.scss";

const TABS = [
  ["overview", "dashboard", "班級總覽", "確認開課條件"],
  ["students", "groups", "加入學生", "建立正式名單"],
  ["machines", "account_tree", "上課環境", "套用環境模板"],
  ["weekly", "calendar_view_week", "每週內容", "可隨時補充"],
  ["classroom", "cast_for_education", "上課監看", "觀看與直播"],
  ["progress", "checklist", "學生機器", "逐人多機狀態"],
  ["ai", "auto_awesome", "AI 檢查", "機器與上課情況"],
];

const STATUS = {
  planning: "準備中",
  pending_review: "等待審核",
  provisioning: "正在建立",
  partial_failed: "需要處理",
  active: "可以上課",
  archived: "已結束",
};

const JOB_STATUS = {
  pending_review: "待審核", approved: "已核准", pending: "等待建立",
  running: "建立中", completed: "已完成", failed: "失敗",
  rejected: "已退回", cancelled: "已取消",
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
    nodes: item.machine_nodes ?? [],
    weeks: (item.weeks ?? []).map((week) => ({
      ...week,
      id: String(week.id),
      week: week.week_number,
      date: week.session_date,
      target: week.target_node_key ?? "",
      files: (week.files ?? []).map((file) => typeof file === "string" ? { filename: file } : file),
    })),
    students: (item.students ?? []).map((student) => ({ ...student, id: String(student.id), machines: student.machines ?? [] })),
    jobs: item.provision_jobs ?? [],
    readyMachines: item.ready_machines ?? 0,
    totalMachines: item.total_machines ?? 0,
  };
}

function Overview({ item, template, onProvision, onNavigate, provisioning, message }) {
  const studentsReady = item.students.length > 0;
  const machinesReady = item.nodes.length > 0;
  const completed = [studentsReady, machinesReady].filter(Boolean).length;
  const canProvision = completed === 2 && item.status === "planning";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: item.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const currentWeek = [...item.weeks].reverse().find((week) => week.date <= today) ?? item.weeks.find((week) => week.date > today);
  const weekLabel = currentWeek?.date === today ? "本週課程" : currentWeek?.date > today ? "下一次課程" : currentWeek === item.weeks.at(-1) && today > currentWeek.date ? "最後一週" : "目前週次";
  const weekday = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"][item.weekday];
  const setupItems = [
    [studentsReady, "學生名單", studentsReady ? `${item.students.length} 位學生` : "尚未加入學生"],
    [machinesReady, "上課環境", machinesReady ? `${template?.name ?? "已套用環境模板"} · 每位學生 ${item.nodes.length} 台` : "尚未選擇環境模板"],
  ];
  let title = `還差 ${2 - completed} 項設定`;
  let description = "完成學生名單與上課環境後，即可送出建機。";
  let actionLabel = studentsReady ? "選擇環境模板" : "加入學生";
  let actionIcon = studentsReady ? "account_tree" : "person_add";
  let action = () => onNavigate(studentsReady ? "machines" : "students");
  if (canProvision) {
    title = "可以送出建機";
    description = `${item.students.length} 位學生，每位 ${item.nodes.length} 台機器。送出後設定將鎖定並等待審核。`;
    actionLabel = provisioning ? "正在送出…" : "確認並送出建機";
    actionIcon = "rocket_launch";
    action = onProvision;
  } else if (item.status === "pending_review") {
    title = "等待建機審核"; description = "設定已鎖定，審核通過後會開始建立全班環境。"; actionLabel = "";
  } else if (item.status === "provisioning") {
    title = "正在建立全班環境"; description = "系統正在處理每位學生的機器，結果會自動更新。"; actionLabel = "";
  } else if (item.status === "partial_failed") {
    title = "部分機器建立失敗"; description = "請查看下方失敗節點，處理完成後才能正式上課。"; actionLabel = "";
  } else if (item.status === "active") {
    title = "班級已就緒"; description = `${item.readyMachines}/${item.totalMachines} 台機器已完成，可以查看學生環境。`; actionLabel = "查看學生機器"; actionIcon = "checklist"; action = () => onNavigate("progress");
  } else if (item.status === "archived") {
    title = "班級已結束"; description = "學生、機器與每週內容已保留為歷史紀錄。"; actionLabel = "";
  }
  return <div className={styles.stack}>
    <section className={styles.readinessPanel}>
      <div className={styles.setupSummary}>
        <span className={styles.setupSummaryIcon}><MIcon name={item.status === "active" ? "check" : item.status === "partial_failed" ? "error_outline" : "assignment"} size={22} /></span>
        <div><span>建機準備 · {completed}/2</span><h2>{title}</h2><p>{description}</p></div>
        {actionLabel && <button type="button" className={styles.btnPrimary} disabled={provisioning} onClick={action}><MIcon name={actionIcon} size={17} />{actionLabel}</button>}
      </div>
      <div className={styles.setupChecklist}>{setupItems.map(([done, label, note]) => <div key={label} className={done ? styles.setupItemDone : styles.setupItemTodo}><span><MIcon name={done ? "check" : "radio_button_unchecked"} size={17} /></span><div><strong>{label}</strong><small>{note}</small></div><em>{done ? "完成" : "待設定"}</em></div>)}</div>
      {item.jobs.length > 0 && <div className={styles.jobGrid}>{item.jobs.map((job, index) => <article key={job.id}><span>節點 {index + 1}</span><strong>{JOB_STATUS[job.status] ?? job.status}</strong><small>{job.done}/{job.total} 成功 · {job.failed_count} 失敗</small></article>)}</div>}
      {message && <p className={styles.persistentFeedback}><MIcon name="info" size={17} />{message}</p>}
    </section>
    <div className={styles.overviewDetailGrid}>
      <section className={styles.overviewInfoCard}>
        <div className={styles.overviewCardHeader}><h2>班級資訊</h2></div>
        <div className={styles.classFacts}>
          <div><span>班級代碼</span><strong>{item.code}</strong></div><div><span>學期</span><strong>{item.term}</strong></div>
          <div><span>固定上課</span><strong>{weekday} {item.startTime}–{item.endTime}</strong></div><div><span>提前開機</span><strong>{item.bootLeadMinutes} 分鐘</strong></div>
          <div><span>課程期間</span><strong>{item.startDate}–{item.endDate}</strong></div><div><span>時區</span><strong>{item.timezone}</strong></div>
        </div>
      </section>
      <section className={styles.overviewInfoCard}>
        <div className={styles.overviewCardHeader}><h2>{weekLabel}</h2><button type="button" onClick={() => onNavigate("weekly")}>查看全部週次<MIcon name="arrow_forward" size={15} /></button></div>
        {currentWeek ? <div className={styles.currentWeekSummary}><div><span>第 {currentWeek.week} 週</span><strong>{currentWeek.title || "尚未設定主題／任務"}</strong><small>{currentWeek.date} · {item.startTime}–{item.endTime}</small></div><span className={styles.weekFileCount}><MIcon name="attach_file" size={15} />{currentWeek.files.length} 個檔案</span></div> : <div className={styles.currentWeekEmpty}>目前沒有課程週次</div>}
      </section>
    </div>
  </div>;
}

function Students({ item, onRefresh }) {
  const [emails, setEmails] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const fileRef = useRef(null);
  const locked = item.status !== "planning";
  async function add(event) {
    event.preventDefault();
    const values = emails.split(/[\n,;]/).map((value) => value.trim()).filter(Boolean);
    if (!values.length) return;
    setBusy(true);
    try {
      const result = await TeachingClassesService.addStudents(item.id, values);
      setEmails("");
      setShowAdd(false);
      setMessage(result.not_found?.length ? `已加入 ${result.added} 位；找不到：${result.not_found.join("、")}` : `已加入 ${result.added} 位學生。`);
      onRefresh(result.class);
    } catch (error) { setMessage(error?.message ?? "加入學生失敗"); }
    finally { setBusy(false); }
  }
  async function importCsv() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const result = await TeachingClassesService.importStudents(item.id, file);
      setMessage(result.not_found?.length ? `匯入完成；${result.not_found.length} 個帳號不存在。` : "CSV 匯入完成。");
      onRefresh(result.class);
    } catch (error) { setMessage(error?.message ?? "CSV 匯入失敗"); }
    finally { if (fileRef.current) fileRef.current.value = ""; setBusy(false); }
  }
  async function remove(studentId) {
    if (!window.confirm("確定從此班級移除這位學生？")) return;
    try { onRefresh(await TeachingClassesService.removeStudent(item.id, studentId)); }
    catch (error) { setMessage(error?.message ?? "移除失敗"); }
  }
  return <div className={styles.stack}>
    <div className={styles.memberPageHeader}>
      <div><h2>學生名單</h2><span>{item.students.length} 人</span></div>
      <div className={styles.memberActions}>
        <input ref={fileRef} className={styles.hiddenFileInput} disabled={locked} type="file" accept=".csv,text/csv" onChange={importCsv} />
        <button type="button" className={styles.btnSecondary} disabled={locked || busy} onClick={() => fileRef.current?.click()}><MIcon name="upload" size={16} />匯入 CSV</button>
        <button type="button" className={styles.btnSecondary} disabled={locked || busy} onClick={() => setShowAdd(true)}><MIcon name="person_add" size={16} />加入學生</button>
      </div>
    </div>

    {message && <p className={styles.inlineMessage}>{message}</p>}

    <section className={styles.memberPanel}>
      <div className={styles.memberPanelHead}><strong>成員列表（{item.students.length} 人）</strong><span>機器 {item.readyMachines}/{item.totalMachines || 0}</span></div>
      {item.students.length ? <div className={styles.memberList}>{item.students.map((student) => {
        const ready = student.machines.filter((machine) => machine.status === "completed").length;
        return <article className={styles.memberRow} key={student.id}>
          <div className={styles.memberIdentity}><strong>{student.full_name || student.email}</strong><span>{student.email}</span></div>
          <span>{student.machines.length ? student.machines.map((machine) => machine.vmid ?? "—").join("、") : "—"}</span>
          <span className={`${styles.memberMachineState} ${ready === item.nodes.length && item.nodes.length ? styles.memberReady : ""}`}>{item.nodes.length ? `${ready}/${item.nodes.length} 就緒` : "未建立"}</span>
          <span>{student.joined_at ? new Date(student.joined_at).toLocaleDateString("zh-TW") : "—"}</span>
          {!locked ? <button type="button" className={styles.memberRemove} aria-label="移除學生" onClick={() => remove(student.id)}><MIcon name="person_remove" size={17} /></button> : <span />}
        </article>;
      })}</div> : <div className={styles.emptyState}><MIcon name="group_add" size={32} /><p>尚未加入學生。</p></div>}
    </section>

    {showAdd && <div className={styles.createDialogOverlay} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setShowAdd(false); }}><section className={`${styles.createDialog} ${styles.studentDialog}`} role="dialog" aria-modal="true" aria-labelledby="add-student-title"><header className={styles.createDialogHeader}><h2 id="add-student-title">加入學生</h2><button type="button" className={styles.iconBtn} aria-label="關閉" onClick={() => setShowAdd(false)}><MIcon name="close" size={19} /></button></header><form onSubmit={add}><div className={styles.studentDialogBody}><label className={styles.field}><span>Email，可使用逗號或換行分隔</span><textarea rows={6} value={emails} onChange={(event) => setEmails(event.target.value)} placeholder="student01@example.edu&#10;student02@example.edu" autoFocus /></label></div><footer className={styles.createDialogFooter}><button type="button" className={styles.btnSecondary} onClick={() => setShowAdd(false)}>取消</button><button type="submit" className={styles.btnPrimary} disabled={!emails.trim() || busy}>{busy ? "加入中…" : "加入學生"}</button></footer></form></section></div>}
  </div>;
}

function WeeklyContent({ item, onRefresh }) {
  const [weeks, setWeeks] = useState(item.weeks);
  const [saving, setSaving] = useState(false);
  const [uploadingWeek, setUploadingWeek] = useState("");
  const [message, setMessage] = useState("");
  const locked = item.status === "archived";
  useEffect(() => setWeeks(item.weeks), [item.weeks]);
  function update(id, key, value) { setWeeks((rows) => rows.map((row) => row.id === id ? { ...row, [key]: value } : row)); }
  function mergeUploadedFiles(result) {
    const serverWeeks = normalizeClass(result).weeks;
    setWeeks((current) => serverWeeks.map((serverWeek) => ({ ...serverWeek, title: current.find((week) => week.date === serverWeek.date)?.title ?? serverWeek.title })));
  }
  async function upload(weekId, fileList) {
    const files = Array.from(fileList ?? []);
    if (!files.length) return;
    setUploadingWeek(weekId); setMessage("");
    try {
      let result;
      for (const file of files) result = await TeachingClassesService.uploadWeekFile(item.id, weekId, file);
      if (result) mergeUploadedFiles(result);
      setMessage(`已上傳 ${files.length} 個任務檔案。`);
    } catch (error) { setMessage(error?.message ?? "任務檔案上傳失敗"); }
    finally { setUploadingWeek(""); }
  }
  async function removeFile(weekId, file) {
    if (!file.id) return;
    setUploadingWeek(weekId); setMessage("");
    try { mergeUploadedFiles(await TeachingClassesService.deleteWeekFile(item.id, weekId, file.id)); }
    catch (error) { setMessage(error?.message ?? "移除任務檔案失敗"); }
    finally { setUploadingWeek(""); }
  }
  async function save() {
    setSaving(true); setMessage("");
    try {
      const result = await TeachingClassesService.replaceWeeks(item.id, weeks.map((week) => ({ week_number: week.week, session_date: week.date, title: week.title.trim(), target_node_key: null, status: week.status, files: week.files.map((file) => ({ filename: file.filename, storage_key: file.storage_key ?? null, target_path: file.target_path ?? null })) })));
      onRefresh(result); setMessage("每週任務與檔案已儲存並綁定課次。");
    } catch (error) { setMessage(error?.message ?? "儲存失敗"); }
    finally { setSaving(false); }
  }
  return <div className={styles.stack}>
    <section className={styles.card}><div className={styles.cardHeader}><div><h2>每週上課內容（{weeks.length} 週）</h2></div></div><div className={styles.weekRows}>{weeks.map((week) => <article key={week.id}><div className={styles.weekDate}><strong>第 {week.week} 週</strong><span>{week.date}</span></div><label className={styles.field}><span>主題／任務</span><input disabled={locked} value={week.title} onChange={(event) => update(week.id, "title", event.target.value)} placeholder="輸入本週主題或任務" /></label><div className={styles.weekFiles}><span>任務檔案</span><div className={styles.weekFileList}>{week.files.map((file) => <span className={styles.weekFileChip} key={file.id ?? file.filename}><MIcon name="description" size={15} /><b>{file.filename}</b>{!locked && file.id && <button type="button" disabled={uploadingWeek === week.id} aria-label={`移除 ${file.filename}`} onClick={() => removeFile(week.id, file)}><MIcon name="close" size={14} /></button>}</span>)}{!locked && <label className={styles.weekUploadButton}><input type="file" multiple disabled={uploadingWeek === week.id} onChange={(event) => { upload(week.id, event.target.files); event.target.value = ""; }} /><MIcon name="upload_file" size={16} />{uploadingWeek === week.id ? "上傳中…" : "上傳檔案"}</label>}</div></div></article>)}</div>{message && <p className={styles.inlineMessage}>{message}</p>}{!locked && <div className={styles.actionFooter}><button type="button" className={styles.btnPrimary} disabled={saving || Boolean(uploadingWeek)} onClick={save}><MIcon name="save" size={16} />{saving ? "儲存中…" : "儲存每週內容"}</button></div>}</section>
  </div>;
}

function Machines({ item, templates, template, onRefresh, onTemplate, createdTemplateId }) {
  const navigate = useNavigate();
  const [message, setMessage] = useState(createdTemplateId ? "環境模板已建立，請選擇套用到這個班級。" : "");
  const locked = item.status !== "planning";
  async function choose(candidate) {
    if (candidate.nodes.some((node) => !node.sourceTemplateId)) { setMessage("此課程模板仍有節點未綁定可用的 PVE 範本。"); return; }
    try {
      const result = await TeachingClassesService.replaceMachines(item.id, candidate.nodes.map((node) => ({ node_key: String(node.id), source_template_id: node.sourceTemplateId, name: node.name, role: node.role || node.name, resource_type: String(node.type).toLowerCase() === "lxc" ? "lxc" : "qemu", cpu: Number(node.cpu), memory_mb: Number(node.memory) * 1024, disk_gb: Number(node.disk), network: node.network || null })));
      onTemplate(candidate.id); onRefresh(result); setMessage(`已套用「${candidate.name}」。`);
    } catch (error) { setMessage(error?.message ?? "套用模板失敗"); }
  }
  return <div className={styles.stack}><section className={styles.card}><div className={styles.cardHeader}><div><h2>選擇環境模板</h2><p>套用後，每位學生會取得相同的一組固定機器。</p></div><div className={styles.pageActions}>{!locked && <button type="button" className={styles.btnSecondary} onClick={() => navigate(`/course-template-management/new?returnTo=${encodeURIComponent(`/class-management/${item.id}/machines`)}`)}><MIcon name="add" size={16} />建立新模板</button>}{locked && <span className={styles.lockBadge}><MIcon name="lock" size={14} />設定已鎖定</span>}</div></div><div className={styles.templateChoices}>{templates.filter((row) => row.status !== "archived").map((candidate) => <button type="button" key={candidate.id} disabled={locked} className={`${template?.id === candidate.id ? styles.templateSelected : ""} ${String(candidate.id) === String(createdTemplateId) ? styles.templateSuggested : ""}`} onClick={() => choose(candidate)}><span><MIcon name="account_tree" size={21} /></span><div><strong>{candidate.name}</strong><p>{candidate.description}</p><small>每位學生 {candidate.nodes.length} 台 · {candidate.nodes.every((node) => node.sourceTemplateId) ? "可以使用" : "模板設定尚未完成"}</small></div></button>)}</div>{message && <p className={styles.inlineMessage}>{message}</p>}</section>{item.nodes.length > 0 && <section className={styles.card}><div className={styles.cardHeader}><div><h2>已套用的上課環境</h2><p>每位學生 {item.nodes.length} 台，全班共需要 {item.students.length * item.nodes.length} 台機器。</p></div></div><div className={styles.blueprintCanvas}>{item.nodes.map((node, index) => <div className={styles.blueprintItem} key={node.id}><article className={styles.machineBlock}><div className={styles.machineTitle}><span><MIcon name="dns" size={20} /></span><div><strong>{node.name}</strong><small>{node.role}</small></div><em>{node.resource_type}</em></div><div className={styles.machineSpecs}><span>{node.cpu} CPU</span><span>{Math.round(node.memory_mb / 1024)} GB RAM</span><span>{node.disk_gb} GB Disk</span></div></article>{index < item.nodes.length - 1 && <div className={styles.connection}><span>{node.network}</span><i /><MIcon name="arrow_forward" size={18} /></div>}</div>)}</div></section>}</div>;
}

function ClassMonitor({ item }) {
  const [students, setStudents] = useState(null);
  const [sources, setSources] = useState([]);
  const [message, setMessage] = useState("");
  const [watch, setWatch] = useState(null);
  const [watching, setWatching] = useState(false);
  const [broadcasting, setBroadcasting] = useState(false);
  const [broadcast, setBroadcast] = useState(null);
  const load = useCallback(async () => {
    try { setStudents(await ClassroomService.listClassStudents(item.id)); }
    catch (error) { setMessage(error?.message ?? "無法讀取班級監看狀態"); setStudents((current) => current ?? []); }
  }, [item.id]);
  useEffect(() => {
    load();
    ClassroomService.listClassBroadcastSources(item.id).then(setSources).catch(() => setSources([]));
    const timer = window.setInterval(load, 10000);
    return () => window.clearInterval(timer);
  }, [item.id, load]);
  const orderedStudents = useMemo(() => [...(students ?? [])].sort((a, b) => {
    const aReady = a.online && a.vms.some((vm) => vm.status === "running");
    const bReady = b.online && b.vms.some((vm) => vm.status === "running");
    return Number(aReady) - Number(bReady);
  }), [students]);
  const onlineCount = (students ?? []).filter((student) => student.online).length;
  const machineCount = (students ?? []).reduce((sum, student) => sum + student.vms.length, 0);
  const runningCount = (students ?? []).reduce((sum, student) => sum + student.vms.filter((vm) => vm.status === "running").length, 0);
  async function openWatch(student, vm) {
    setWatching(true); setMessage("");
    try {
      const session = await ClassroomService.createSession({ vmid: vm.vmid, mode: "monitor", class_id: item.id });
      setWatch({ sessionId: session.id, title: `${student.full_name || student.email} · ${vm.name || `VM ${vm.vmid}`}` });
    } catch (error) { setMessage(error?.message ?? "開啟觀看失敗"); }
    finally { setWatching(false); }
  }
  async function closeWatch() {
    if (watch) ClassroomService.stopSession(watch.sessionId).catch(() => {});
    setWatch(null);
  }
  async function startBroadcast(vmid) {
    if (!vmid) return;
    setBroadcasting(true); setMessage("");
    try {
      const session = await ClassroomService.createSession({ vmid: Number(vmid), mode: "broadcast", class_id: item.id });
      setBroadcast(session); setMessage("已開始向班級直播示範畫面。");
    } catch (error) { setMessage(error?.message ?? "開始直播失敗"); }
    finally { setBroadcasting(false); }
  }
  async function stopBroadcast() {
    if (!broadcast) return;
    setBroadcasting(true);
    try { await ClassroomService.stopSession(broadcast.id); setBroadcast(null); setMessage("直播已結束。"); }
    catch (error) { setMessage(error?.message ?? "結束直播失敗"); }
    finally { setBroadcasting(false); }
  }
  return <div className={styles.stack}>
    <section className={styles.classroomPanel}>
      <div className={styles.classroomHeader}><div><h2>上課監看</h2><p>未就緒與離線學生會優先顯示。</p></div><div className={styles.classroomStats}><span><strong>{onlineCount}</strong>/{students?.length ?? 0} 在線</span><span><strong>{runningCount}</strong>/{machineCount} 執行中</span></div></div>
      <div className={styles.broadcastTools}><MIcon name="sensors" size={18} /><strong>直播示範</strong>{broadcast ? <><span>直播進行中</span><button type="button" className={styles.btnSecondary} disabled={broadcasting} onClick={stopBroadcast}>結束直播</button></> : <><select disabled={broadcasting || !sources.length} defaultValue="" onChange={(event) => { startBroadcast(event.target.value); event.target.value = ""; }}><option value="">{sources.length ? "選擇教師的執行中 VM" : "目前沒有可直播的 VM"}</option>{sources.map((source) => <option key={source.vmid} value={source.vmid}>{source.name || `VM ${source.vmid}`}</option>)}</select></>}</div>
      {message && <p className={styles.inlineMessage}>{message}</p>}
      {students === null ? <div className={styles.classroomLoading}>正在讀取學生狀態…</div> : orderedStudents.length ? <div className={styles.classroomList}>{orderedStudents.map((student) => <article className={styles.classroomStudentRow} key={student.user_id}><div className={styles.classroomStudentIdentity}><strong>{student.full_name || student.email}</strong><span>{student.email}</span></div><span className={`${styles.classroomPresence} ${student.online ? styles.classroomOnline : ""}`}><i />{student.online ? "在線" : "離線"}</span><div className={styles.classroomMachines}>{student.vms.map((vm) => { const canWatch = vm.vm_type !== "lxc" && vm.status === "running"; return <div className={styles.classroomMachine} key={vm.vmid}><span><strong>{vm.name || `VM ${vm.vmid}`}</strong><small>{vm.status === "running" ? "執行中" : vm.status === "completed" ? "尚未開機" : vm.status}</small></span><button type="button" disabled={!canWatch || watching} onClick={() => openWatch(student, vm)}>{vm.vm_type === "lxc" ? "LXC" : "觀看"}</button></div>; })}{!student.vms.length && <span className={styles.classroomNoMachine}>尚無班級機器</span>}</div></article>)}</div> : <div className={styles.emptyState}><MIcon name="groups" size={30} /><p>班級目前沒有學生機器。</p></div>}
    </section>
    {watch && <ClassroomWatchDialog sessionId={watch.sessionId} title={watch.title} canControl onClose={closeWatch} />}
  </div>;
}

function StudentMachines({ item, ai = false }) {
  const issues = item.students.flatMap((student) => student.machines.filter((machine) => machine.status === "failed").map((machine) => ({ student, machine })));
  return <div className={styles.stack}>{ai && <div className={styles.integrationStrip}><MIcon name="auto_awesome" size={19} /><div><strong>AI 上課檢查</strong><span>集中查看機器異常與學生環境完整度，協助老師快速找到需要處理的學生。</span></div><span className={styles.devBadge}>判讀功能準備中</span></div>}<section className={styles.card}><div className={styles.cardHeader}><div><h2>{ai ? "需要注意的環境" : "學生機器狀態"}</h2><p>{ai ? (issues.length ? `有 ${issues.length} 個機器項目需要處理。` : "目前沒有發現建立失敗的機器。") : "逐一確認每位學生的上課環境。"}</p></div></div><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>學生</th>{item.nodes.map((node) => <th key={node.id}>{node.name}</th>)}<th>結果</th></tr></thead><tbody>{item.students.map((student) => { const byNode = Object.fromEntries(student.machines.map((machine) => [String(machine.machine_node_id), machine])); const ready = student.machines.filter((machine) => machine.status === "completed").length; return <tr key={student.id}><td><strong>{student.full_name || student.email}</strong><small>{student.email}</small></td>{item.nodes.map((node) => { const machine = byNode[String(node.id)]; return <td key={node.id}><strong>{machine?.vmid ?? "—"}</strong><small>{machine ? JOB_STATUS[machine.status] ?? machine.status : "尚未建立"}</small></td>; })}<td><span className={`${styles.statusBadge} ${ready === item.nodes.length ? styles.status_active : styles.status_partial_failed}`}>{ready}/{item.nodes.length} 就緒</span></td></tr>; })}</tbody></table></div></section></div>;
}

function LockedFeature({ section }) {
  const label = section === "ai" ? "AI 檢查" : section === "classroom" ? "上課監看" : "學生機器";
  return <section className={styles.lockedFeature}><span><MIcon name="lock" size={22} /></span><div><h2>{label}尚未開放</h2><p>班級必須通過審核，且每位學生的所有節點都建立成功後才會正式啟用。</p></div></section>;
}

export default function ClassWorkspacePage() {
  const { classId, section } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const tab = section ?? "overview";
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [provisioning, setProvisioning] = useState(false);
  const [templateId, setTemplateId] = useState("");
  const templates = useMemo(() => listCourseTemplates(), []);
  const template = templates.find((row) => row.id === templateId);

  function refresh(result) { setItem(normalizeClass(result)); }
  useEffect(() => {
    let active = true;
    TeachingClassesService.get(classId).then((result) => active && refresh(result)).catch((reason) => active && setError(reason?.message ?? "無法讀取班級")).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [classId]);
  useEffect(() => {
    if (!item || !["pending_review", "provisioning"].includes(item.status)) return undefined;
    const timer = window.setInterval(() => TeachingClassesService.provisionStatus(item.id).then(refresh).catch(() => {}), 3000);
    return () => window.clearInterval(timer);
  }, [item?.id, item?.status]);

  async function provision() {
    setProvisioning(true); setMessage("");
    try { refresh(await TeachingClassesService.provision(classId)); setMessage("所有節點批次工作已送出，正在等待審核；頁面會自動更新結果。"); }
    catch (reason) { setMessage(reason?.message ?? "送出建機失敗"); }
    finally { setProvisioning(false); }
  }

  if (loading) return <div className={styles.emptyState}><p>正在讀取班級…</p></div>;
  if (!item) return <div className={styles.page}><button type="button" className={styles.backLink} onClick={() => navigate("/class-management")}><MIcon name="arrow_back" size={18} />返回班級清單</button><p className={styles.errorMessage}>{error || "找不到班級"}</p></div>;
  const postUnavailable = ["classroom", "progress", "ai"].includes(tab) && item.status !== "active";
  const completed = [item.students.length > 0, item.nodes.length > 0].filter(Boolean).length;

  return <div className={styles.page}>
    <button type="button" className={styles.backLink} onClick={() => navigate("/class-management")}><MIcon name="arrow_back" size={18} />返回班級清單</button>
    <div className={styles.workspaceHeader}><div><span className={styles.overline}>{item.code} · {item.term}</span><div className={styles.titleLine}><h1 className={styles.pageTitle}>{item.name}</h1></div><p className={styles.pageSubtitle}>{item.students.length} 位學生 · {item.weeks.length} 個課次 · 每週{["一", "二", "三", "四", "五", "六", "日"][item.weekday]} {item.startTime}–{item.endTime}</p></div><div className={styles.headerState}><span className={`${styles.statusBadge} ${styles[`status_${item.status}`]}`}>{STATUS[item.status] ?? item.status}</span></div></div>
    {error && <p className={styles.errorMessage}>{error}</p>}
    <section className={styles.workflowTabsBar} aria-label="班級管理流程">
      <nav className={styles.workspaceTabs}>{TABS.map(([key, icon, label]) => {
        const unavailable = ["classroom", "progress", "ai"].includes(key) && item.status !== "active";
        const done = key === "students" ? item.students.length > 0 : key === "weekly" ? item.weeks.some((week) => week.title.trim()) : key === "machines" ? item.nodes.length > 0 : false;
        return <button type="button" key={key} disabled={unavailable} title={unavailable ? "全部機器成功後開放" : undefined} className={`${tab === key ? styles.workspaceTabActive : ""} ${unavailable ? styles.workspaceTabLocked : ""}`} onClick={() => navigate(key === "overview" ? `/class-management/${classId}` : `/class-management/${classId}/${key}`)}><MIcon name={unavailable ? "lock" : done ? "check" : icon} size={17} /><strong>{label}</strong></button>;
      })}</nav>
      <div className={styles.workflowProgress}><span>準備進度</span><strong>{item.status === "active" ? "全部就緒" : `${completed}/2 已完成`}</strong></div>
    </section>
    <main className={styles.workspaceContent}>
      {tab === "overview" && <Overview item={item} template={template} onProvision={provision} onNavigate={(target) => navigate(`/class-management/${classId}/${target}`)} provisioning={provisioning} message={message} />}
      {tab === "students" && <Students item={item} onRefresh={refresh} />}
      {tab === "weekly" && <WeeklyContent item={item} onRefresh={refresh} />}
      {tab === "machines" && <Machines item={item} templates={templates} template={template} onRefresh={refresh} onTemplate={setTemplateId} createdTemplateId={location.state?.createdTemplateId} />}
      {postUnavailable && <LockedFeature section={tab} />}
      {tab === "classroom" && !postUnavailable && <ClassMonitor item={item} />}
      {tab === "progress" && !postUnavailable && <StudentMachines item={item} />}
      {tab === "ai" && !postUnavailable && <StudentMachines item={item} ai />}
      {!TABS.some(([key]) => key === tab) && <LockedFeature section={tab} />}
    </main>
  </div>;
}
