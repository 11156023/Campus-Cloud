import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import MIcon from "../../components/MIcon";
import AiJudgePanel from "../system/groups/AiJudgePanel";
import ConfigPushPanel from "../teaching/ConfigPushPanel";
import { GroupsService } from "../../services/groups";
import { classCatalog, classStudents, classWeeks, templateCatalog } from "./courseOperationsMock";
import styles from "./CourseOperations.module.scss";

const TABS = [
  ["overview", "dashboard", "班級總覽"],
  ["students", "groups", "學生"],
  ["machines", "account_tree", "上課機器"],
  ["weekly", "calendar_view_week", "每週任務"],
  ["progress", "checklist", "學生進度"],
  ["ai", "auto_awesome", "AI 檢查"],
];

function normalizeMembers(members) {
  return members.map((member, index) => ({
    id: member.user_id ?? member.id ?? index, name: member.full_name ?? member.name ?? member.email,
    email: member.email, account: member.account ?? member.email?.split("@")[0] ?? "—", vmid: member.vmid,
    machines: member.vmid ? "1/1" : "0/1", machineStatus: member.vm_status === "running" ? "ready" : "warning", done: false,
  }));
}

function Overview({ classItem, members, template, onStart }) {
  const isActive = classItem.status === "active";
  const canStart = members.length > 0 && Boolean(template);
  return <div className={styles.stack}>
    <div className={styles.metricGrid}><div><span>班級狀態</span><strong>{isActive ? "上課中" : "設計中"}</strong><small>{isActive ? "已正式啟用" : "尚未開始課程"}</small></div><div><span>學生</span><strong>{members.length} 人</strong><small>{members.length ? "名單已建立" : "尚未加入"}</small></div><div><span>上課機器</span><strong>{template ? `${template.nodes.length} 台／人` : "未選擇"}</strong><small>開課後固定</small></div><div><span>每週任務</span><strong>{classWeeks.length} 週</strong><small>全部屬於此班級</small></div></div>
    <section className={styles.card}><div className={styles.cardHeader}><div><h2>{isActive ? "本週上課" : "開課前檢查"}</h2><p>{isActive ? "課堂動作只在班級正式啟用後提供。" : "班級設計完整後，才啟用課程與建立固定機器。"}</p></div></div><div className={styles.checkSteps}><div className={styles.stepDone}><span>1</span><div><strong>班級基本資料</strong><small>{classItem.name}</small></div><MIcon name="check_circle" size={20} /></div><div className={members.length ? styles.stepDone : styles.stepCurrent}><span>2</span><div><strong>學生名單</strong><small>{members.length ? `${members.length} 位學生` : "待完成"}</small></div><MIcon name={members.length ? "check_circle" : "pending"} size={20} /></div><div className={template ? styles.stepDone : styles.stepCurrent}><span>3</span><div><strong>上課機器模板</strong><small>{template?.name ?? "待選擇"}</small></div><MIcon name={template ? "check_circle" : "pending"} size={20} /></div><div className={classWeeks.length ? styles.stepDone : styles.stepCurrent}><span>4</span><div><strong>每週任務</strong><small>{classWeeks.length} 週已規劃</small></div><MIcon name="check_circle" size={20} /></div></div><div className={styles.actionFooter}>{isActive ? <button type="button" className={styles.btnPrimary} disabled><MIcon name="cast_for_education" size={16} />進入此班虛擬教室（待開發）</button> : <button type="button" className={styles.btnPrimary} disabled={!canStart} onClick={onStart}><MIcon name="play_arrow" size={16} />確認班級並開始上課</button>}</div></section>
  </div>;
}

function Students({ classItem, members, setMembers, isReal }) {
  const [emails, setEmails] = useState("");
  const [message, setMessage] = useState("");
  const fileRef = useRef(null);
  async function addStudents(event) {
    event.preventDefault();
    const values = emails.split(/[\n,;]/).map((value) => value.trim()).filter(Boolean);
    if (!values.length) return;
    if (isReal) {
      try { await GroupsService.addMembers(classItem.id, values); const detail = await GroupsService.detail(classItem.id); setMembers(normalizeMembers(detail?.members ?? [])); setMessage("學生已加入既有群組。"); setEmails(""); }
      catch (error) { setMessage(error?.message ?? "加入學生失敗"); }
    } else {
      setMembers((current) => [...current, ...values.map((email, index) => ({ id: `${Date.now()}-${index}`, name: email.split("@")[0], email, account: email.split("@")[0], machines: "0/0", machineStatus: "warning", done: false }))]); setEmails(""); setMessage("已加入預覽名單。");
    }
  }
  async function importCsv() {
    const file = fileRef.current?.files?.[0]; if (!file) return;
    if (!isReal) { setMessage("預覽班級不會上傳 CSV；連結既有群組後會使用現有匯入功能。"); return; }
    try { await GroupsService.importCsv(classItem.id, file); const detail = await GroupsService.detail(classItem.id); setMembers(normalizeMembers(detail?.members ?? [])); setMessage("CSV 匯入完成。"); }
    catch (error) { setMessage(error?.message ?? "CSV 匯入失敗"); }
  }
  return <div className={styles.stack}>
    <section className={styles.card}><div className={styles.cardHeader}><div><h2>加入學生</h2><p>直接沿用既有群組的成員管理與 CSV 匯入，不使用小彈窗。</p></div></div><div className={styles.studentTools}><form onSubmit={addStudents}><label className={styles.field}><span>Email，可用逗號或換行分隔</span><textarea rows={3} value={emails} onChange={(event) => setEmails(event.target.value)} placeholder="student01@example.edu&#10;student02@example.edu" /></label><button type="submit" className={styles.btnPrimary}><MIcon name="person_add" size={16} />加入學生</button></form><div className={styles.csvArea}><label className={styles.field}><span>大量匯入 CSV</span><input ref={fileRef} type="file" accept=".csv,text/csv" /></label><button type="button" className={styles.btnSecondary} onClick={importCsv}><MIcon name="upload" size={16} />開始匯入</button></div></div>{message && <p className={styles.inlineMessage}>{message}</p>}</section>
    <section className={styles.card}><div className={styles.cardHeader}><div><h2>學生名單（{members.length} 人）</h2><p>班級學生可先沿用既有群組來源；多機器固定環境待上課機器模板資料模型完成。</p></div></div><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>學生</th><th>帳號</th><th>Email</th><th>既有 VM</th><th>狀態</th></tr></thead><tbody>{members.map((member) => <tr key={member.id}><td><strong>{member.name}</strong></td><td>{member.account}</td><td>{member.email}</td><td>{member.vmid ?? "—"}</td><td><span className={`${styles.dot} ${member.machineStatus === "ready" ? styles.dotGood : styles.dotWarn}`} />{member.machineStatus === "ready" ? "運行中" : "尚未就緒"}</td></tr>)}</tbody></table></div>{!members.length && <div className={styles.emptyState}><MIcon name="group_add" size={32} /><p>尚未加入學生。</p></div>}</section>
  </div>;
}

function TemplateAndMachines({ members, templateId, setTemplateId, locked, setLocked }) {
  const template = templateCatalog.find((item) => item.id === templateId);
  const totals = template ? { machines: members.length * template.nodes.length, cpu: members.length * template.nodes.reduce((sum, node) => sum + node.cpu, 0), ram: members.length * template.nodes.reduce((sum, node) => sum + node.memory, 0) } : { machines: 0, cpu: 0, ram: 0 };
  return <div className={styles.stack}>
    <section className={styles.card}><div className={styles.cardHeader}><div><h2>選擇上課機器模板</h2><p>只決定學生上課使用的機器；任務與進度由班級自己管理。</p></div>{locked && <span className={styles.lockBadge}><MIcon name="lock" size={14} />已鎖定</span>}</div><div className={styles.templateChoices}>{templateCatalog.filter((item) => item.status === "published").map((item) => <label key={item.id} className={templateId === item.id ? styles.templateSelected : ""}><input type="radio" name="class-template" disabled={locked} checked={templateId === item.id} onChange={() => setTemplateId(item.id)} /><span><MIcon name="account_tree" size={21} /></span><div><strong>{item.name}</strong><p>{item.description}</p><small>v{item.version} · 每位學生 {item.nodes.length} 台固定機器</small></div></label>)}</div></section>
    {template && <><section className={styles.card}><div className={styles.cardHeader}><div><h2>每位學生的固定機器</h2><p>來源是現有 PVE 範本；班級只保存機器組合與版本快照。</p></div></div><div className={styles.blueprintCanvas}>{template.nodes.map((node, index) => <div className={styles.blueprintItem} key={node.id}><article className={styles.machineBlock}><div className={styles.machineTitle}><span><MIcon name={node.icon} size={20} /></span><div><strong>{node.name}</strong><small>{node.image}</small></div><em>{node.type}</em></div><div className={styles.machineSpecs}><span>{node.cpu} CPU</span><span>{node.memory} GB RAM</span><span>{node.disk} GB Disk</span></div></article>{index < template.nodes.length - 1 && <div className={styles.connection}><span>{node.network}</span><i /><MIcon name="arrow_forward" size={18} /></div>}</div>)}</div></section><div className={styles.metricGrid}><div><span>學生</span><strong>{members.length} 人</strong></div><div><span>機器需求</span><strong>{totals.machines} 台</strong></div><div><span>CPU 需求</span><strong>{totals.cpu} cores</strong></div><div><span>記憶體需求</span><strong>{totals.ram} GB</strong></div></div><section className={styles.confirmBar}><div><MIcon name="calculate" size={20} /><span><strong>容量與租借評估</strong><small>確認租借期間、配額與可用容量；不包含搬移策略。</small></span></div><button type="button" className={styles.btnPrimary} disabled={locked || !members.length} onClick={() => setLocked(true)}><MIcon name="lock" size={16} />{locked ? "固定環境已確認" : `確認 ${totals.machines} 台固定機器（待開發）`}</button></section></>}
  </div>;
}

function WeeklyContent({ classItem, members, templateId, locked, navigate }) {
  const [weeks] = useState(classWeeks);
  const [selectedId, setSelectedId] = useState(classWeeks[2].id);
  const selected = weeks.find((week) => week.id === selectedId);
  return <div className={styles.stack}>
    <section className={styles.card}><div className={styles.cardHeader}><div><h2>班級每週任務</h2><p>任務只屬於此班級，與上課機器模板無關。</p></div><button type="button" className={styles.btnSecondary} disabled><MIcon name="add" size={16} />新增任務（待開發）</button></div><div className={styles.weekTimeline}>{weeks.map((week) => <button type="button" key={week.id} className={selectedId === week.id ? styles.weekActive : ""} onClick={() => setSelectedId(week.id)}><b>第 {week.week} 週</b><span>{week.title}</span><small>{week.date} · {week.target}</small><em>{week.status === "completed" ? "已完成" : week.status === "published" ? "已發布" : "草稿"}</em></button>)}</div></section>
    {selected && <section className={styles.card}><div className={styles.cardHeader}><div><h2>第 {selected.week} 週：{selected.title}</h2><p>檔案派送到班級固定機器，不會重新建立或搬移機器。</p></div></div><div className={styles.weekDetail}><div><span>上課日期</span><strong>{selected.date}</strong></div><div><span>任務檔案</span><strong>{selected.files.length} 個</strong></div><div><span>學生派送</span><strong>{selected.distributed}</strong></div><div><span>目標機器</span><strong>{selected.target}</strong></div></div><div className={styles.fileList}>{selected.files.map((file) => <span key={file}><MIcon name="description" size={15} />{file}</span>)}</div><div className={styles.actionFooter}><button type="button" className={styles.btnSecondary} disabled><MIcon name="edit" size={16} />編輯任務（待開發）</button><button type="button" className={styles.btnPrimary} onClick={() => navigate(`/class-management/${classItem.id}/delivery`, { state: { classItem, members, templateId, locked } })}><MIcon name="upload_file" size={16} />前往檔案派送</button></div></section>}
  </div>;
}

function Delivery({ classItem, members, templateId, locked, isReal, navigate }) {
  return <div className={styles.stack}><button type="button" className={styles.backLink} onClick={() => navigate(`/class-management/${classItem.id}/weekly`, { state: { classItem, members, templateId, locked } })}><MIcon name="arrow_back" size={18} />返回每週任務</button>{isReal ? <div className={styles.embeddedFeature}><div className={styles.embeddedHeading}><MIcon name="upload_file" size={20} /><div><strong>檔案派送</strong><p>沿用現有非同步派送與逐台結果輪詢；正式綁定週次仍待開發。</p></div></div><ConfigPushPanel groupId={classItem.id} /></div> : <section className={styles.card}><div className={styles.emptyState}><MIcon name="upload_file" size={32} /><p>預覽班級沒有真實 VMID，檔案派送待班級資料模型完成。</p><span className={styles.devBadge}>待開發</span></div></section>}</div>;
}

function Progress({ members }) {
  const [week, setWeek] = useState(3);
  const [checks, setChecks] = useState(() => Object.fromEntries(members.map((member, index) => [member.id, index < 2])));
  const done = members.filter((member) => checks[member.id]).length;
  return <div className={styles.stack}>
    <div className={styles.integrationStrip}><MIcon name="verified_user" size={19} /><div><strong>進度全部屬於班級</strong><span>學生任務完成與老師確認分欄顯示；AI 檢查仍保持獨立，不會自動改變進度。</span></div><span className={styles.devBadge}>進度持久化待開發</span></div>
    <section className={styles.card}><div className={styles.cardHeader}><div><h2>第 {week} 週學生進度</h2><p>老師可同時查看學生任務完成情況並做正式確認。</p></div><select className={styles.compactSelect} value={week} onChange={(event) => setWeek(Number(event.target.value))}>{classWeeks.map((item) => <option key={item.id} value={item.week}>第 {item.week} 週 · {item.title}</option>)}</select></div><div className={styles.progressSummary}><strong>{done}/{members.length}</strong><span>位學生已由老師確認</span></div><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>學生</th><th>任務完成</th><th>固定機器</th><th>老師確認</th><th>正式狀態</th></tr></thead><tbody>{members.map((member, index) => <tr key={member.id}><td><strong>{member.name}</strong><small>{member.email}</small></td><td><strong className={index < 2 ? styles.textSuccess : styles.textMuted}>{index < 2 ? "已完成" : "未完成"}</strong></td><td>{member.vmid ?? "待建立"}</td><td><label className={styles.checkbox}><input type="checkbox" checked={Boolean(checks[member.id])} onChange={() => setChecks((current) => ({ ...current, [member.id]: !current[member.id] }))} /><span /></label></td><td><strong className={checks[member.id] ? styles.textSuccess : styles.textMuted}>{checks[member.id] ? "老師已確認" : "尚未確認"}</strong></td></tr>)}</tbody></table></div><div className={styles.actionFooter}><button type="button" className={styles.btnPrimary} disabled><MIcon name="save" size={16} />儲存第 {week} 週進度（待開發）</button></div></section>
  </div>;
}

function AiCheck({ classItem, members, isReal }) {
  if (isReal) return <div className={styles.embeddedFeature}><div className={styles.embeddedHeading}><MIcon name="auto_awesome" size={20} /><div><strong>現有 AI 教師檢查</strong><p>直接使用原本的評分表、受管收集腳本、核准與指定 VM 執行流程；結果只供老師判斷。</p></div></div><AiJudgePanel groupId={classItem.id} members={members.map((member) => ({ user_id: member.id, full_name: member.name, email: member.email, vmid: member.vmid, vm_status: member.machineStatus === "ready" ? "running" : "stopped" }))} /></div>;
  return <section className={styles.card}><div className={styles.cardHeader}><div><h2>班級 AI 檢查</h2><p>目前預覽班級沒有真實班級 ID 與固定機器，完成班級資料模型後才啟用。</p></div><span className={styles.devBadge}>待開發</span></div><div className={styles.ruleGrid}><div><MIcon name="description" size={20} /><strong>評分表</strong><p>上傳文件並由 AI 解析檢查項目。</p></div><div><MIcon name="terminal" size={20} /><strong>收集腳本</strong><p>產生、審查並核准受管腳本。</p></div><div><MIcon name="play_circle" size={20} /><strong>執行與結果</strong><p>指定學生 VM 執行，回傳 AI 輔助判斷。</p></div></div></section>;
}

export default function ClassWorkspacePage() {
  const { classId, section } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const tab = section ?? "overview";
  const fallback = location.state?.classItem ?? classCatalog.find((item) => item.id === classId) ?? { id: classId, name: "班級工作區", code: String(classId), term: "", teacher: "", students: 0, templateId: null, status: "planning" };
  const [classItem, setClassItem] = useState(fallback);
  const [members, setMembers] = useState(location.state?.members ?? (fallback.realGroup ? [] : classStudents));
  const [isReal, setIsReal] = useState(Boolean(fallback.realGroup));
  const [templateId, setTemplateId] = useState(location.state?.templateId ?? fallback.templateId ?? "");
  const [locked, setLocked] = useState(location.state?.locked ?? Boolean(fallback.templateId && fallback.status === "active"));
  useEffect(() => { const shouldLoadGroup = fallback.realGroup || (!classId.startsWith("class-") && !classId.startsWith("draft-")); if (!shouldLoadGroup || fallback.preview) return; let active = true; GroupsService.detail(classId).then((group) => { if (!active) return; setIsReal(true); setMembers(normalizeMembers(group?.members ?? [])); setClassItem((current) => ({ ...current, name: group.name ?? current.name, students: group.members?.length ?? current.students })); }).catch(() => {}); return () => { active = false; }; }, [classId, fallback.realGroup, fallback.preview]);
  const template = templateCatalog.find((item) => item.id === templateId);
  return <div className={styles.page}>
    <button type="button" className={styles.backLink} onClick={() => navigate("/class-management")}><MIcon name="arrow_back" size={18} />返回班級清單</button>
    <div className={styles.workspaceHeader}><div><span className={styles.overline}>CLASS · {classItem.code}</span><div className={styles.titleLine}><h1 className={styles.pageTitle}>{classItem.name}</h1><span className={styles.devBadge}>待開發</span></div><p className={styles.pageSubtitle}>{classItem.teacher} · {classItem.term} · {members.length || classItem.students} 位學生</p></div><div className={styles.headerState}><span className={`${styles.statusBadge} ${styles[`status_${classItem.status}`]}`}>{classItem.status === "active" ? "上課中" : "設計中"}</span>{isReal && <span className={styles.sourceBadge}><MIcon name="link" size={13} />學生群組來源</span>}</div></div>
    {tab !== "delivery" && <nav className={styles.workspaceTabs}>{TABS.map(([key, icon, label]) => <button type="button" key={key} className={tab === key ? styles.workspaceTabActive : ""} onClick={() => navigate(key === "overview" ? `/class-management/${classId}` : `/class-management/${classId}/${key}`, { state: { classItem, members, templateId, locked } })}><MIcon name={icon} size={17} />{label}</button>)}</nav>}
    {tab === "overview" && <Overview classItem={classItem} members={members} template={template} onStart={() => { setClassItem((current) => ({ ...current, status: "active" })); setLocked(true); }} />}
    {tab === "students" && <Students classItem={classItem} members={members} setMembers={setMembers} isReal={isReal} />}
    {tab === "machines" && <TemplateAndMachines members={members} templateId={templateId} setTemplateId={setTemplateId} locked={locked} setLocked={setLocked} />}
    {tab === "weekly" && <WeeklyContent classItem={classItem} members={members} templateId={templateId} locked={locked} navigate={navigate} />}
    {tab === "delivery" && <Delivery classItem={classItem} members={members} templateId={templateId} locked={locked} isReal={isReal} navigate={navigate} />}
    {tab === "progress" && <Progress members={members} />}
    {tab === "ai" && <AiCheck classItem={classItem} members={members} isReal={isReal} />}
  </div>;
}
