import { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Background, MarkerType, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import MIcon from "../../components/MIcon";
import EmptyState from "../../components/EmptyState/EmptyState";
import ClassroomWatchDialog from "../../components/Classroom/ClassroomWatchDialog";
import { useConfirm } from "../../components/ConfirmDialog/ConfirmProvider";
import { ClassroomService } from "../../services/classroom";
import { courseNodeHasUsableSource, CourseEnvironmentsService } from "../../services/courseEnvironments";
import { TeachingClassesService } from "../../services/teachingClasses";
import { COURSE_MACHINE_ACCESS_PREVIEW } from "../../mocks/environmentGroups";
import AiJudgePanel from "./AiJudgePanel";
import ClassCreateDialog from "./ClassCreatePage";
import {
  machineRuntimeState,
  mergeResourceUsageByVmid,
  RESOURCE_METRICS,
  usageForMetric,
} from "./classHeatmapUsage";
import styles from "./CourseOperations.module.scss";

const TABS = [
  ["overview", "dashboard", "班級總覽", "確認開課條件"],
  ["students", "groups", "加入學生", "建立正式名單"],
  ["machines", "account_tree", "上課環境", "套用課程環境"],
  ["weekly", "calendar_view_week", "每週內容", "可隨時補充"],
  ["classroom", "cast_for_education", "上課監看", "觀看與直播"],
  ["progress", "grid_view", "資源熱力圖", "CPU／RAM 使用量"],
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
    topologyEdges: item.topology_edges ?? [],
    readyMachines: item.ready_machines ?? 0,
    totalMachines: item.total_machines ?? 0,
    archivedAt: item.archived_at,
    reclaimRequestedAt: item.reclaim_requested_at,
    resourcesReclaimedAt: item.resources_reclaimed_at,
  };
}

function CourseMachineAccessPreview({ onNavigate }) {
  const [expanded, setExpanded] = useState(false);
  const group = COURSE_MACHINE_ACCESS_PREVIEW;
  const running = group.machines.filter((machine) => machine.status === "running").length;

  return <section className={`${styles.overviewInfoCard} ${styles.machineAccessCard}`}>
    <div className={styles.overviewCardHeader}>
      <div className={styles.machineAccessTitle}>
        <span className={styles.machineAccessIcon}><MIcon name="dns" size={18} /></span>
        <div><h2>使用課堂機器</h2><small>{group.title} · {group.machines.length} 台機器</small></div>
        <em>介面預覽</em>
      </div>
      <div className={styles.machineAccessHeaderActions}>
        <button type="button" onClick={() => onNavigate("progress")}>查看資源狀態<MIcon name="monitoring" size={15} /></button>
        <button type="button" className={styles.machineAccessPrimary} aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
          <MIcon name={expanded ? "expand_less" : "computer"} size={16} />{expanded ? "收合" : "使用機器"}
        </button>
      </div>
    </div>
    <div className={styles.machineAccessSummary}>
      <span className={styles.machineAccessStatus}><i />{running}/{group.machines.length} 台執行中</span>
      <span><MIcon name="schedule" size={15} />{group.timingLabel}</span>
      <p>從課程頁直接找到這堂課的所有機器；目前按鈕僅供確認操作流程。</p>
    </div>
    {expanded && <div className={styles.machineAccessList}>
      {group.machines.map((machine) => <article key={machine.id}>
        <span className={styles.machineAccessMachineIcon}><MIcon name={machine.type === "lxc" ? "terminal" : "desktop_windows"} size={18} /></span>
        <div><strong>{machine.name}</strong><small>{machine.role} · {machine.os} · {machine.ip}</small></div>
        <span className={machine.status === "running" ? styles.machineRunning : styles.machineStopped}>{machine.status === "running" ? "執行中" : "已關機"}</span>
        <button type="button" disabled title="接上真實機器 API 後開放">{machine.type === "lxc" ? "終端機" : "控制台"}</button>
      </article>)}
    </div>}
  </section>;
}

function Overview({
  item,
  template,
  onProvision,
  onNavigate,
  onEditSchedule,
  onRetry,
  onReset,
  onExtend,
  onArchive,
  onReclaim,
  provisioning,
  recovering,
  lifecycleBusy,
  message,
}) {
  const studentsReady = item.students.length > 0;
  const machinesReady = Boolean(item.course_environment) && item.nodes.length > 0;
  const completed = [studentsReady, machinesReady].filter(Boolean).length;
  const canProvision = completed === 2 && item.status === "planning";
  const [capacity, setCapacity] = useState(null);
  const [capacityLoading, setCapacityLoading] = useState(false);
  const [extendedEndDate, setExtendedEndDate] = useState(item.endDate);
  useEffect(() => {
    let active = true;
    if (!canProvision) {
      setCapacity(null);
      return undefined;
    }
    setCapacityLoading(true);
    TeachingClassesService.capacityPreview(item.id)
      .then((result) => active && setCapacity(result))
      .catch((error) => active && setCapacity({
        ready: false,
        issues: [error?.message ?? "無法完成容量預檢"],
      }))
      .finally(() => active && setCapacityLoading(false));
    return () => { active = false; };
  }, [canProvision, item.id, item.students.length, item.nodes.length, item.course_version_id]);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: item.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const currentWeek = [...item.weeks].reverse().find((week) => week.date <= today) ?? item.weeks.find((week) => week.date > today);
  const weekLabel = currentWeek?.date === today ? "本週課程" : currentWeek?.date > today ? "下一次課程" : currentWeek === item.weeks.at(-1) && today > currentWeek.date ? "最後一週" : "目前週次";
  const weekday = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"][item.weekday];
  const setupItems = [
    [studentsReady, "學生名單", studentsReady ? `${item.students.length} 位學生` : "尚未加入學生"],
    [machinesReady, "上課環境", machinesReady ? `${template?.name ?? "已套用課程環境"} · 每位學生 ${item.nodes.length} 台` : "尚未選擇課程環境"],
  ];
  let title = `還差 ${2 - completed} 項設定`;
  let description = "完成學生名單與上課環境後，即可送出建機。";
  let actionLabel = studentsReady ? "選擇課程環境" : "加入學生";
  let actionIcon = studentsReady ? "account_tree" : "person_add";
  let action = () => onNavigate(studentsReady ? "machines" : "students");
  let actionDisabled = false;
  let secondaryAction = null;
  if (canProvision) {
    title = capacityLoading ? "正在執行完整容量預檢" : capacity?.ready ? "容量足夠，可以送出建機" : "容量預檢尚未通過";
    description = capacity
      ? `${capacity.machine_count} 台、${capacity.cpu_cores} CPU、${Math.round(capacity.memory_mb / 1024)} GB RAM、${capacity.disk_gb} GB Disk、${capacity.ip_count} 個 IP。送出後設定將鎖定。`
      : `${item.students.length} 位學生，每位 ${item.nodes.length} 台機器。送出後設定將鎖定並等待審核。`;
    if (capacity?.issues?.length) description = capacity.issues.join("；");
    actionLabel = provisioning ? "正在送出…" : "確認並送出建機";
    actionIcon = "rocket_launch";
    action = onProvision;
    actionDisabled = capacityLoading || !capacity?.ready;
  } else if (item.status === "pending_review") {
    title = "等待建機審核"; description = "設定已鎖定，審核通過後會開始建立全班環境。"; actionLabel = "";
  } else if (item.status === "provisioning") {
    title = "正在建立全班環境"; description = "系統正在處理每位學生的機器，結果會自動更新。"; actionLabel = "";
  } else if (item.status === "partial_failed") {
    title = "部分機器或網路設定失敗";
    description = "可以只重新送出失敗學生；若尚未建立任何機器，也可以解除鎖定返回編輯。";
    actionLabel = recovering ? "處理中…" : "重試失敗項目";
    actionIcon = "refresh";
    action = onRetry;
    actionDisabled = recovering;
    secondaryAction = item.readyMachines === 0 ? onReset : null;
  } else if (item.status === "active") {
    title = "班級已就緒"; description = `${item.readyMachines}/${item.totalMachines} 台機器已完成，可以查看學生環境。`; actionLabel = "查看學生機器"; actionIcon = "checklist"; action = () => onNavigate("progress");
  } else if (item.status === "archived") {
    title = "班級已結束";
    description = item.resourcesReclaimedAt
      ? "班級紀錄已封存，所有上課機器均已回收。"
      : "班級紀錄已封存；若回收曾失敗，可重新送出剩餘資源。";
    actionLabel = "";
  }
  return <div className={styles.stack}>
    <section className={styles.readinessPanel}>
      <div className={styles.setupSummary}>
        <span className={styles.setupSummaryIcon}><MIcon name={item.status === "active" ? "check" : item.status === "partial_failed" ? "error_outline" : "assignment"} size={22} /></span>
        <div><span>建機準備 · {completed}/2</span><h2>{title}</h2><p>{description}</p></div>
        {actionLabel && <div className={styles.setupActions}>{secondaryAction && <button type="button" className={styles.btnSecondary} disabled={recovering} onClick={secondaryAction}>解除鎖定並返回編輯</button>}<button type="button" className={styles.btnPrimary} disabled={provisioning || actionDisabled} onClick={action}><MIcon name={actionIcon} size={17} />{actionLabel}</button></div>}
      </div>
      <div className={styles.setupChecklist}>{setupItems.map(([done, label, note]) => <div key={label} className={done ? styles.setupItemDone : styles.setupItemTodo}><span><MIcon name={done ? "check" : "radio_button_unchecked"} size={17} /></span><div><strong>{label}</strong><small>{note}</small></div><em>{done ? "完成" : "待設定"}</em></div>)}</div>
      {item.jobs.length > 0 && <div className={styles.jobGrid}>{item.jobs.map((job, index) => <article key={job.id}><span>節點 {index + 1}</span><strong>{JOB_STATUS[job.status] ?? job.status}</strong><small>{job.done}/{job.total} 成功 · {job.failed_count} 失敗</small></article>)}</div>}
      {message && <p className={styles.persistentFeedback}><MIcon name="info" size={17} />{message}</p>}
    </section>
    <div className={styles.overviewDetailGrid}>
      <CourseMachineAccessPreview onNavigate={onNavigate} />
      <section className={styles.overviewInfoCard}>
        <div className={styles.overviewCardHeader}><h2>班級資訊</h2>{item.status === "planning" && <button type="button" onClick={onEditSchedule}>編輯班級與課表<MIcon name="edit" size={15} /></button>}</div>
        <div className={styles.classFacts}>
          <div><span>班級代碼</span><strong>{item.code}</strong></div><div><span>學期</span><strong>{item.term}</strong></div>
          <div><span>固定上課</span><strong>{weekday} {item.startTime}–{item.endTime}</strong></div><div><span>提前開機</span><strong>{item.bootLeadMinutes} 分鐘</strong></div>
          <div><span>課程期間</span><strong>{item.startDate}–{item.endDate}</strong></div><div><span>時區</span><strong>{item.timezone}</strong></div>
        </div>
      </section>
      <section className={styles.overviewInfoCard}>
        <div className={styles.overviewCardHeader}><h2>{weekLabel}</h2><button type="button" onClick={() => onNavigate("weekly")}>查看全部週次<MIcon name="arrow_forward" size={15} /></button></div>
        {currentWeek ? <div className={styles.currentWeekSummary}><div><span>第 {currentWeek.week} 週</span><strong>{currentWeek.title || "尚未設定主題／任務"}</strong><small>{currentWeek.date} · {item.startTime}–{item.endTime}</small></div><span className={styles.weekFileCount}><MIcon name="attach_file" size={15} />{currentWeek.files.length} 個檔案</span></div> : <EmptyState icon="event" title="目前沒有課程週次" />}
      </section>
      <section className={`${styles.overviewInfoCard} ${styles.lifecycleCard}`}>
        <div className={styles.overviewCardHeader}><h2>班級生命週期</h2></div>
        {item.status === "archived" ? <div className={styles.lifecycleBody}>
          <div><strong>{item.resourcesReclaimedAt ? "資源已全部回收" : item.reclaimRequestedAt ? "回收已送出，仍有資源待確認" : "尚未回收資源"}</strong><p>封存後排程停止，學生不能再操作班級機器。</p></div>
          {!item.resourcesReclaimedAt && <button type="button" className={styles.btnSecondary} disabled={lifecycleBusy} onClick={onReclaim}><MIcon name="refresh" size={16} />{lifecycleBusy ? "處理中…" : "重試回收"}</button>}
        </div> : <div className={styles.lifecycleBody}>
          <label className={styles.lifecycleDate}><span>延長班級到期日</span><input type="date" min={item.endDate} value={extendedEndDate} onChange={(event) => setExtendedEndDate(event.target.value)} /></label>
          <div className={styles.lifecycleActions}>
            <button type="button" className={styles.btnSecondary} disabled={lifecycleBusy || extendedEndDate <= item.endDate} onClick={() => onExtend(extendedEndDate)}><MIcon name="event_repeat" size={16} />延長</button>
            <button type="button" className={styles.inspectorDanger} disabled={lifecycleBusy} onClick={onArchive}><MIcon name="archive" size={16} />封存並回收</button>
          </div>
        </div>}
      </section>
    </div>
  </div>;
}

function Students({ item, onRefresh }) {
  const confirm = useConfirm();
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
      const notices = [`已加入 ${result.added} 位學生`];
      if (result.not_found?.length) notices.push(`找不到：${result.not_found.join("、")}`);
      if (result.invalid_role?.length) notices.push(`不是學生帳號：${result.invalid_role.join("、")}`);
      setMessage(`${notices.join("；")}。`);
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
      const notices = [`CSV 匯入完成，加入 ${result.added} 位學生`];
      if (result.not_found?.length) notices.push(`${result.not_found.length} 個帳號不存在`);
      if (result.invalid_role?.length) notices.push(`${result.invalid_role.length} 個帳號不是學生身分`);
      setMessage(`${notices.join("；")}。`);
      onRefresh(result.class);
    } catch (error) { setMessage(error?.message ?? "CSV 匯入失敗"); }
    finally { if (fileRef.current) fileRef.current.value = ""; setBusy(false); }
  }
  async function remove(studentId) {
    const ok = await confirm({
      title: "移除學生",
      message: "確定從此班級移除這位學生？",
      confirmText: "移除",
      danger: true,
    });
    if (!ok) return;
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
      })}</div> : <EmptyState icon="group_add" title="尚未加入學生。" />}
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

function TopologyPreview({ item }) {
  const nodes = item.nodes.map((node, index) => ({
    id: String(node.node_key),
    position: { x: 70 + index * 250, y: 95 + (index % 2) * 35 },
    data: {
      label: <div className={styles.readonlyTopologyNode}><strong>{node.name}</strong><span>{node.source_type === "custom" ? "自訂規格" : "機器範本"} · {String(node.resource_type).toUpperCase()}</span><small>{node.cpu} CPU · {Math.round(node.memory_mb / 1024)} GB RAM · {node.disk_gb} GB</small></div>,
    },
    style: { width: 205, padding: 0, borderRadius: 10, borderColor: "var(--color-border)", background: "var(--color-surface)" },
  }));
  const edges = item.topologyEdges.map((edge, index) => {
    const bidirectional = edge.direction === "bidirectional";
    return {
      id: String(edge.id ?? `topology-${index}`),
      source: edge.source_node_key,
      target: edge.target_node_key,
      type: "smoothstep",
      animated: true,
      label: `${bidirectional ? "雙向" : "單向"} · ${String(edge.protocol).toUpperCase()}${edge.port ? `/${edge.port}` : ""}`,
      markerEnd: { type: MarkerType.ArrowClosed, color: "#5d78cf" },
      markerStart: bidirectional ? { type: MarkerType.ArrowClosed, color: "#5d78cf" } : undefined,
      style: { stroke: "#5d78cf", strokeWidth: 2 },
      labelStyle: { fill: "var(--color-text-secondary)", fontSize: 10, fontWeight: 600 },
      labelBgStyle: { fill: "var(--color-surface)", fillOpacity: 0.95 },
    };
  });
  return <div className={styles.readonlyTopology}>
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      fitView
      fitViewOptions={{ padding: 0.25, maxZoom: 1.1 }}
      minZoom={0.65}
      maxZoom={1.2}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={20} size={1} />
    </ReactFlow>
  </div>;
}

function Machines({ item, templates, template, onRefresh, onTemplate, createdTemplateId }) {
  const navigate = useNavigate();
  const [message, setMessage] = useState(createdTemplateId ? "課程環境已建立，請選擇套用到這個班級。" : "");
  const locked = item.status !== "planning";
  async function choose(candidate) {
    const invalidNode = candidate.nodes.find((node) => !courseNodeHasUsableSource(node));
    if (invalidNode) {
      setMessage(`「${invalidNode.name}」尚未綁定可用的${invalidNode.sourceType === "custom" ? "基礎映像" : "機器範本"}。`);
      return;
    }
    try {
      const result = await TeachingClassesService.selectCourse(item.id, candidate.versionId);
      onTemplate(candidate.id); onRefresh(result); setMessage(`已選擇「${candidate.name} v${candidate.version}」。機器設定由課程版本鎖定。`);
    } catch (error) { setMessage(error?.message ?? "套用課程環境失敗"); }
  }
  return <div className={styles.stack}>
    <section className={styles.card}>
      <div className={styles.cardHeader}><div><h2>選擇已發布課程環境</h2><p>班級只能選擇已發布的固定版本；每位學生會取得相同的一組機器。</p></div><div className={styles.pageActions}>{!locked && <button type="button" className={styles.btnSecondary} onClick={() => navigate(`/course-template-management/new?returnTo=${encodeURIComponent(`/class-management/${item.id}/machines`)}`)}><MIcon name="add" size={16} />建立新課程環境</button>}{locked && <span className={styles.lockBadge}><MIcon name="lock" size={14} />設定已鎖定</span>}</div></div>
      <div className={styles.templateChoices}>{templates.map((candidate) => <button type="button" key={candidate.versionId} disabled={locked} className={`${template?.id === candidate.id ? styles.templateSelected : ""} ${String(candidate.id) === String(createdTemplateId) ? styles.templateSuggested : ""}`} onClick={() => choose(candidate)}><span><MIcon name="account_tree" size={21} /></span><div><strong>{candidate.name} · v{candidate.version}</strong><p>{candidate.description}</p><small>每位學生 {candidate.nodes.length} 台 · 已發布鎖定</small></div></button>)}</div>
      {!templates.length && <div className={styles.emptyState}><p>目前沒有已發布的課程環境，請先到「課程環境」建立並發布。</p></div>}
      {message && <p className={styles.inlineMessage}>{message}</p>}
    </section>
    {item.nodes.length > 0 && <section className={styles.card}>
      <div className={styles.cardHeader}><div><h2>鎖定前確認：機器與真實網路拓撲</h2><p>{item.course_environment ? `${item.course_environment.name} v${item.course_environment.version} · ` : ""}每位學生 {item.nodes.length} 台，全班共需要 {item.students.length * item.nodes.length} 台機器。線條標示實際防火牆方向、協定與 Port。</p></div></div>
      <TopologyPreview item={item} />
      {!item.topologyEdges.length && <p className={styles.topologyEmptyNote}>目前沒有跨節點防火牆連線；各機器仍會依自己的網路設定建立。</p>}
    </section>}
  </div>;
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
      {students === null ? <div className={styles.classroomLoading}>正在讀取學生狀態…</div> : orderedStudents.length ? <div className={styles.classroomList}>{orderedStudents.map((student) => <article className={styles.classroomStudentRow} key={student.user_id}><div className={styles.classroomStudentIdentity}><strong>{student.full_name || student.email}</strong><span>{student.email}</span></div><span className={`${styles.classroomPresence} ${student.online ? styles.classroomOnline : ""}`}><i />{student.online ? "在線" : "離線"}</span><div className={styles.classroomMachines}>{student.vms.map((vm) => { const canWatch = vm.vm_type !== "lxc" && vm.status === "running"; return <div className={styles.classroomMachine} key={vm.vmid}><span><strong>{vm.name || `VM ${vm.vmid}`}</strong><small>{vm.status === "running" ? "執行中" : vm.status === "completed" ? "尚未開機" : vm.status}</small></span><button type="button" disabled={!canWatch || watching} onClick={() => openWatch(student, vm)}>{vm.vm_type === "lxc" ? "LXC" : "觀看"}</button></div>; })}{!student.vms.length && <span className={styles.classroomNoMachine}>尚無班級機器</span>}</div></article>)}</div> : <EmptyState icon="groups" title="班級目前沒有學生機器。" />}
    </section>
    {watch && <ClassroomWatchDialog sessionId={watch.sessionId} title={watch.title} canControl onClose={closeWatch} />}
  </div>;
}

function heatLevel(usage) {
  if (usage >= 80) return 5;
  if (usage >= 60) return 4;
  if (usage >= 40) return 3;
  if (usage >= 20) return 2;
  return 1;
}

const StudentHeatCell = memo(function StudentHeatCell({
  email,
  index,
  machineName,
  metricLabel,
  name,
  nodeName,
  state,
  usage,
  vmid,
}) {
  const hasUsage = state === "on" && usage !== null;
  const detail = state === "off" ? "關機" : hasUsage ? `${metricLabel} ${usage}%` : "暫無資料";
  const tone = state === "off" ? styles.heatOff : hasUsage ? styles[`heat_${heatLevel(usage)}`] : styles.heatUnavailable;
  return <article className={`${styles.heatCell} ${tone}`} title={`${name}\n${email ?? ""}\n${nodeName} · VM ${vmid ?? "—"}\n${detail}`} aria-label={`${name}，${detail}`}>
    <span className={styles.studentNumber}>{String(index + 1).padStart(2, "0")}</span>
    <div><strong>{name}</strong><small>{vmid ? `VM ${vmid}` : machineName || "尚未建立"}</small></div>
    <b>{state === "off" ? "關機" : hasUsage ? `${usage}%` : "暫無資料"}</b>
  </article>;
});

function StudentMachines({ item }) {
  const [selectedNodeId, setSelectedNodeId] = useState(() => String(item.nodes[0]?.id ?? ""));
  const [metric, setMetric] = useState("cpu");
  const [usageByVmid, setUsageByVmid] = useState({});
  const [usageStatus, setUsageStatus] = useState("loading");
  const [collectedAt, setCollectedAt] = useState(null);
  const usageByVmidRef = useRef(null);

  useEffect(() => {
    if (!item.nodes.some((node) => String(node.id) === selectedNodeId)) {
      setSelectedNodeId(String(item.nodes[0]?.id ?? ""));
    }
  }, [item.nodes, selectedNodeId]);

  useEffect(() => {
    let active = true;
    let timer = null;
    usageByVmidRef.current = null;
    setUsageByVmid({});
    setUsageStatus("loading");
    setCollectedAt(null);

    async function loadUsage() {
      try {
        const response = await TeachingClassesService.resourceUsage(item.id);
        if (!active) return;
        const nextUsage = mergeResourceUsageByVmid(usageByVmidRef.current ?? {}, response?.items);
        if (usageByVmidRef.current === null || nextUsage !== usageByVmidRef.current) {
          usageByVmidRef.current = nextUsage;
          startTransition(() => {
            setUsageByVmid(nextUsage);
            setCollectedAt(response?.collected_at ? new Date(response.collected_at) : new Date());
          });
        }
        setUsageStatus("ready");
      } catch {
        if (active) setUsageStatus("error");
      } finally {
        if (active) timer = window.setTimeout(loadUsage, 10_000);
      }
    }

    loadUsage();
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [item.id]);

  const selectedNode = item.nodes.find((node) => String(node.id) === selectedNodeId) ?? item.nodes[0];
  const cells = useMemo(() => item.students.map((student, index) => {
    const machine = student.machines.find((candidate) => String(candidate.machine_node_id) === String(selectedNode?.id));
    const runtime = usageByVmid[String(machine?.vmid)] ?? null;
    const state = machineRuntimeState(machine, runtime);
    return {
      student,
      machine,
      index,
      state,
      usage: state === "on" ? usageForMetric(runtime, metric) : null,
    };
  }), [item.students, metric, selectedNode?.id, usageByVmid]);

  const activeCells = cells.filter((cell) => cell.state === "on");
  const measuredCells = activeCells.filter((cell) => cell.usage !== null);
  const average = measuredCells.length ? Math.round(measuredCells.reduce((total, cell) => total + cell.usage, 0) / measuredCells.length) : null;
  const highUsage = measuredCells.filter((cell) => cell.usage >= 80).length;
  const metricInfo = RESOURCE_METRICS[metric];
  const badgeText = usageStatus === "loading" ? "讀取即時資料" : usageStatus === "error" ? "更新失敗" : "每 10 秒更新";

  return <div className={styles.stack}>
    <section className={`${styles.card} ${styles.heatmapCard}`}>
      <div className={styles.heatmapHeader}>
        <div><span className={styles.heatmapEyebrow}>即時資源概覽</span><h2>學生使用率熱力圖</h2><p>每格代表一位學生；沒有顏色表示關機，顏色越深表示使用量越高。</p></div>
        <span className={usageStatus === "error" ? styles.prototypeBadge : styles.liveBadge}><MIcon name={usageStatus === "error" ? "sync_problem" : "sensors"} size={15} />{badgeText}</span>
      </div>

      <div className={styles.heatmapToolbar}>
        <div className={styles.machineTabs} role="tablist" aria-label="選擇課堂機器">
          {item.nodes.map((node, index) => {
            const selected = String(node.id) === String(selectedNode?.id);
            return <button key={node.id} type="button" role="tab" aria-selected={selected} className={selected ? styles.machineTabActive : ""} onClick={() => setSelectedNodeId(String(node.id))}>
              <span><MIcon name={node.resource_type === "lxc" ? "deployed_code" : "dns"} size={17} /></span>
              <span><small>機器 {String(index + 1).padStart(2, "0")}</small><strong>{node.name}</strong></span>
            </button>;
          })}
        </div>
        <div className={styles.metricTabs} role="tablist" aria-label="選擇資源指標">
          {Object.entries(RESOURCE_METRICS).map(([key, info]) => <button key={key} type="button" role="tab" aria-selected={metric === key} className={metric === key ? styles.metricTabActive : ""} onClick={() => setMetric(key)}><MIcon name={info.icon} size={16} />{info.label}</button>)}
        </div>
      </div>

      {selectedNode && item.students.length ? <>
        <div className={styles.heatmapSummary}>
          <div><span className={styles.selectedMachineIcon}><MIcon name={selectedNode.resource_type === "lxc" ? "deployed_code" : "dns"} size={20} /></span><div><strong>{selectedNode.name}</strong><small>{selectedNode.role || "課堂機器"} · {metricInfo.label} 使用量{collectedAt ? ` · ${collectedAt.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} 更新` : ""}</small></div></div>
          <dl><div><dt>開機</dt><dd>{activeCells.length}<small>/{cells.length}</small></dd></div><div><dt>平均</dt><dd>{average ?? "—"}{average !== null && <small>%</small>}</dd></div><div><dt>高負載</dt><dd>{highUsage}<small> 人</small></dd></div></dl>
        </div>

        <div className={styles.heatGrid} aria-label={`${selectedNode.name} ${metricInfo.label} 學生使用率`}>
          {cells.map(({ student, machine, index, state, usage }) => <StudentHeatCell
            key={student.id}
            email={student.email}
            index={index}
            machineName={machine?.name}
            metricLabel={metricInfo.label}
            name={student.full_name || student.email || `學生 ${index + 1}`}
            nodeName={selectedNode.name}
            state={state}
            usage={usage}
            vmid={machine?.vmid}
          />)}
        </div>

        <div className={styles.heatLegend} aria-label="熱力圖圖例"><span><i className={styles.heatOff} />關機</span><span><i className={styles.heatUnavailable} />暫無資料</span><span className={styles.legendScale}>低<i className={styles.heat_1} /><i className={styles.heat_2} /><i className={styles.heat_3} /><i className={styles.heat_4} /><i className={styles.heat_5} />高</span><span>使用率</span></div>
      </> : <EmptyState icon="grid_view" title={selectedNode ? "班級目前沒有學生。" : "尚未設定課堂機器。"} />}
    </section>
  </div>;
}

function AiJudgeWorkspace({ item }) {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    ClassroomService.listClassStudents(item.id)
      .then((students) => {
        if (!active) return;
        setMembers(
          students.flatMap((student) =>
            (student.vms ?? []).map((vm) => ({
              user_id: student.user_id,
              email: student.email,
              full_name: student.full_name,
              vmid: vm.vmid,
              vm_status: vm.status,
              vm_type: vm.vm_type,
              vm_cpu_usage_pct: null,
              vm_ram_usage_pct: null,
              vm_disk_usage_pct: null,
            })),
          ),
        );
      })
      .catch(() => active && setMembers([]))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [item.id]);

  if (loading) {
    return <div className={styles.classroomLoading}>正在讀取班級機器…</div>;
  }
  return <AiJudgePanel classId={item.id} members={members} />;
}

function LockedFeature({ section }) {
  const label = section === "ai" ? "AI 檢查" : section === "classroom" ? "上課監看" : "學生機器";
  return <section className={styles.lockedFeature}><span><MIcon name="lock" size={22} /></span><div><h2>{label}尚未開放</h2><p>班級必須通過審核，且每位學生的所有節點都建立成功後才會正式啟用。</p></div></section>;
}

export default function ClassWorkspacePage() {
  const confirm = useConfirm();
  const { classId, section } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const tab = section ?? "overview";
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [provisioning, setProvisioning] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [templateId, setTemplateId] = useState("");
  const [templates, setTemplates] = useState([]);
  const template = templates.find((row) => row.id === templateId);

  function refresh(result) {
    const normalized = normalizeClass(result);
    setItem(normalized);
    if (normalized.course_environment?.id) setTemplateId(String(normalized.course_environment.id));
  }
  useEffect(() => {
    let active = true;
    TeachingClassesService.get(classId).then((result) => active && refresh(result)).catch((reason) => active && setError(reason?.message ?? "無法讀取班級")).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [classId]);
  useEffect(() => {
    let active = true;
    CourseEnvironmentsService.listPublished()
      .then((rows) => active && setTemplates(rows))
      .catch((reason) => active && setError(reason?.message ?? "無法讀取已發布課程"));
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!item || !["pending_review", "provisioning"].includes(item.status)) return undefined;
    const timer = window.setInterval(() => TeachingClassesService.provisionStatus(item.id).then(refresh).catch(() => {}), 3000);
    return () => window.clearInterval(timer);
  }, [item?.id, item?.status]);

  async function provision() {
    const ok = await confirm({
      title: "送出審核",
      message: "送出後學生名單、課程環境與課表將鎖定並交由管理員審核，確定送出嗎？",
      confirmText: "送出",
    });
    if (!ok) return;
    setProvisioning(true); setMessage("");
    try { refresh(await TeachingClassesService.provision(classId)); setMessage("所有節點批次工作已送出，正在等待審核；頁面會自動更新結果。"); }
    catch (reason) { setMessage(reason?.message ?? "送出建機失敗"); }
    finally { setProvisioning(false); }
  }

  async function retryFailed() {
    setRecovering(true); setMessage("");
    try {
      const result = await TeachingClassesService.retryFailed(classId);
      refresh(result);
      setMessage(result.status === "active" ? "網路拓撲已重新套用，班級現在可以上課。" : "失敗項目已重新送審，只會建立尚未完成的學生機器。");
    } catch (reason) { setMessage(reason?.message ?? "重試失敗"); }
    finally { setRecovering(false); }
  }

  async function resetFailed() {
    const ok = await confirm({
      title: "返回編輯",
      message: "確定釋放已預留的容量與 IP，解除鎖定並返回編輯嗎？",
      confirmText: "釋放並返回",
      danger: true,
    });
    if (!ok) return;
    setRecovering(true); setMessage("");
    try {
      refresh(await TeachingClassesService.resetFailed(classId));
      setMessage("已釋放容量與 IP，現在可以修改學生、課程環境或課表後重新送出。");
    } catch (reason) { setMessage(reason?.message ?? "無法返回編輯"); }
    finally { setRecovering(false); }
  }

  async function extendClass(endDate) {
    setLifecycleBusy(true); setMessage("");
    try {
      refresh(await TeachingClassesService.extend(classId, endDate));
      setMessage(`班級已延長至 ${endDate}，課次與機器到期日已同步更新。`);
    } catch (reason) { setMessage(reason?.message ?? "無法延長班級"); }
    finally { setLifecycleBusy(false); }
  }

  async function archiveClass() {
    const ok = await confirm({
      title: "封存並回收班級",
      message: "這會停止後續排程、取消未完成建機，並回收全班機器。班級與課程紀錄會保留。確定繼續嗎？",
      confirmText: "封存並回收",
      danger: true,
    });
    if (!ok) return;
    setLifecycleBusy(true); setMessage("");
    try {
      const result = await TeachingClassesService.archive(classId);
      refresh(result.class);
      const failed = result.reclaim?.failed?.length ?? 0;
      setMessage(failed ? `班級已封存，但有 ${failed} 台資源未成功送出回收，可按「重試回收」。` : "班級已封存，資源回收已送出。");
    } catch (reason) { setMessage(reason?.message ?? "無法封存班級"); }
    finally { setLifecycleBusy(false); }
  }

  async function reclaimClass() {
    setLifecycleBusy(true); setMessage("");
    try {
      const result = await TeachingClassesService.reclaim(classId, { force: true });
      refresh(await TeachingClassesService.get(classId));
      const failed = result.failed?.length ?? 0;
      setMessage(failed ? `仍有 ${failed} 台資源無法回收，請交由管理者檢查設備狀態。` : "剩餘資源已重新送出回收。");
    } catch (reason) { setMessage(reason?.message ?? "無法重新回收資源"); }
    finally { setLifecycleBusy(false); }
  }

  if (loading) return <div className={styles.emptyState}><p>正在讀取班級…</p></div>;
  if (!item) return <div className={styles.page}><button type="button" className={styles.backLink} onClick={() => navigate("/class-management")}><MIcon name="arrow_back" size={18} />返回班級清單</button><p className={styles.errorMessage}>{error || "找不到班級"}</p></div>;
  const postUnavailable = ["classroom", "progress", "ai"].includes(tab) && item.status !== "active";
  const completed = [item.students.length > 0, Boolean(item.course_environment) && item.nodes.length > 0].filter(Boolean).length;

  return <div className={styles.page}>
    <button type="button" className={styles.backLink} onClick={() => navigate("/class-management")}><MIcon name="arrow_back" size={18} />返回班級清單</button>
    <div className={styles.workspaceHeader}><div><span className={styles.overline}>{item.code} · {item.term}</span><div className={styles.titleLine}><h1 className={styles.pageTitle}>{item.name}</h1></div><p className={styles.pageSubtitle}>{item.students.length} 位學生 · {item.weeks.length} 個課次 · 每週{["一", "二", "三", "四", "五", "六", "日"][item.weekday]} {item.startTime}–{item.endTime}</p></div><div className={styles.headerState}><span className={`${styles.statusBadge} ${styles[`status_${item.status}`]}`}>{STATUS[item.status] ?? item.status}</span></div></div>
    {error && <p className={styles.errorMessage}>{error}</p>}
    <section className={styles.workflowTabsBar} aria-label="班級管理流程">
      <nav className={styles.workspaceTabs}>{TABS.map(([key, icon, label]) => {
        const unavailable = ["classroom", "progress", "ai"].includes(key) && item.status !== "active";
        const done = key === "students" ? item.students.length > 0 : key === "weekly" ? item.weeks.some((week) => week.title.trim()) : key === "machines" ? Boolean(item.course_environment) && item.nodes.length > 0 : false;
        return <button type="button" key={key} disabled={unavailable} title={unavailable ? "全部機器成功後開放" : undefined} className={`${tab === key ? styles.workspaceTabActive : ""} ${unavailable ? styles.workspaceTabLocked : ""}`} onClick={() => navigate(key === "overview" ? `/class-management/${classId}` : `/class-management/${classId}/${key}`)}><MIcon name={unavailable ? "lock" : done ? "check" : icon} size={17} /><strong>{label}</strong></button>;
      })}</nav>
      <div className={styles.workflowProgress}><span>準備進度</span><strong>{item.status === "active" ? "全部就緒" : `${completed}/2 已完成`}</strong></div>
    </section>
    <main className={styles.workspaceContent}>
      {tab === "overview" && <Overview item={item} template={template} onProvision={provision} onNavigate={(target) => navigate(`/class-management/${classId}/${target}`)} onEditSchedule={() => setScheduleOpen(true)} onRetry={retryFailed} onReset={resetFailed} onExtend={extendClass} onArchive={archiveClass} onReclaim={reclaimClass} provisioning={provisioning} recovering={recovering} lifecycleBusy={lifecycleBusy} message={message} />}
      {tab === "students" && <Students item={item} onRefresh={refresh} />}
      {tab === "weekly" && <WeeklyContent item={item} onRefresh={refresh} />}
      {tab === "machines" && <Machines item={item} templates={templates} template={template} onRefresh={refresh} onTemplate={setTemplateId} createdTemplateId={location.state?.createdTemplateId} />}
      {postUnavailable && <LockedFeature section={tab} />}
      {tab === "classroom" && !postUnavailable && <ClassMonitor item={item} />}
      {tab === "progress" && !postUnavailable && <StudentMachines item={item} />}
      {tab === "ai" && !postUnavailable && <AiJudgeWorkspace item={item} />}
      {!TABS.some(([key]) => key === tab) && <LockedFeature section={tab} />}
    </main>
    {scheduleOpen && <ClassCreateDialog item={item} onClose={() => setScheduleOpen(false)} onUpdated={(result) => { refresh(result); setScheduleOpen(false); setMessage("班級與固定課表已更新。"); }} />}
  </div>;
}
