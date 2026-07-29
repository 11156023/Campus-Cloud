import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import MIcon from "../../components/MIcon";
import { TemplatesService } from "../../services/templates";
import { getCourseTemplate, saveCourseTemplate } from "./courseOperationsStore";
import styles from "./CourseOperations.module.scss";

const TABS = [
  ["basic", "基本資料"],
  ["machines", "機器配置"],
];

const emptyTemplate = { id: "new", name: "", code: "", description: "", status: "draft", classes: 0, updatedAt: "尚未儲存", nodes: [] };

function MachineEditor({ value, onChange, pveTemplates }) {
  const [sourceId, setSourceId] = useState("");
  const atLimit = value.length >= 3;
  const sources = pveTemplates.length ? pveTemplates : [
    { id: "fallback-linux", name: "Ubuntu Server 24.04", resource_type: "LXC", default_cores: 2, default_memory: 2048, default_disk: 24 },
    { id: "fallback-router", name: "Debian Router Lab", resource_type: "VM", default_cores: 2, default_memory: 2048, default_disk: 12 },
  ];
  function addMachine() {
    if (atLimit || !sourceId) return;
    const source = sources.find((item) => String(item.id) === sourceId) ?? sources[0];
    onChange([...value, {
      id: `node-${Date.now()}`, sourceTemplateId: source.id, name: source.name, role: "課程機器",
      type: source.resource_type ?? "VM", image: source.name, cpu: source.default_cores ?? 2,
      memory: Math.max(1, Math.round((source.default_memory ?? 2048) / 1024)), disk: source.default_disk ?? 24,
      network: "lab-net", icon: "dns",
    }]);
    setSourceId("");
  }
  const totals = useMemo(() => ({ cpu: value.reduce((sum, node) => sum + node.cpu, 0), ram: value.reduce((sum, node) => sum + node.memory, 0), disk: value.reduce((sum, node) => sum + node.disk, 0) }), [value]);
  return <section className={`${styles.card} ${styles.templateMachineWorkspace}`}>
      <div className={styles.machineWorkspaceHeader}>
        <div><h2>每位學生的上課環境</h2><p>下方這組機器會套用給班級中的每一位學生。</p></div>
        <div className={styles.machineTotals}><span><strong>{value.length}</strong> 台機器</span><span><strong>{totals.cpu}</strong> CPU</span><span><strong>{totals.ram}</strong> GB RAM</span><span><strong>{totals.disk}</strong> GB 磁碟</span></div>
      </div>
      <div className={styles.machineAddBar}>
        <label className={styles.field}><span>新增機器來源（最多 3 台）</span><select value={sourceId} disabled={atLimit} onChange={(event) => setSourceId(event.target.value)}><option value="">{atLimit ? "已達 3 台上限" : "選擇既有 PVE 範本"}</option>{sources.map((source) => <option key={source.id} value={source.id}>{source.name} · {source.resource_type ?? "VM"}</option>)}</select></label>
        <button type="button" className={styles.btnPrimary} disabled={atLimit || !sourceId} onClick={addMachine}><MIcon name={atLimit ? "check" : "add"} size={16} />{atLimit ? "已達上限" : "加入機器"}</button>
      </div>
      {value.length ? <div className={styles.blueprintCanvas}>{value.map((node, index) => <div className={styles.blueprintItem} key={node.id}>
        <article className={styles.machineBlock}>
          <div className={styles.machineTitle}><span><MIcon name={node.icon ?? "dns"} size={20} /></span><div><input aria-label={`機器 ${index + 1} 名稱`} value={node.name} onChange={(event) => onChange(value.map((item) => item.id === node.id ? { ...item, name: event.target.value } : item))} /><small>{node.image}</small></div><em>{node.type}</em></div>
          <div className={styles.machineFields}><label>角色<input value={node.role} onChange={(event) => onChange(value.map((item) => item.id === node.id ? { ...item, role: event.target.value } : item))} /></label><label>網路<input value={node.network} onChange={(event) => onChange(value.map((item) => item.id === node.id ? { ...item, network: event.target.value } : item))} /></label></div>
          <div className={styles.machineSpecs}><span>{node.cpu} CPU</span><span>{node.memory} GB RAM</span><span>{node.disk} GB Disk</span><button type="button" onClick={() => onChange(value.filter((item) => item.id !== node.id))}><MIcon name="delete_outline" size={16} />移除</button></div>
        </article>
        {index < value.length - 1 && <div className={styles.connection}><span>{node.network}</span><i /><MIcon name="arrow_forward" size={18} /></div>}
      </div>)}</div> : <div className={styles.emptyState}><MIcon name="dns" size={32} /><p>請先從既有 PVE 範本加入第一台機器。</p></div>}
  </section>;
}

export default function CourseTemplateEditorPage() {
  const { templateId } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const requestedTab = params.get("tab") ?? "basic";
  const returnTo = params.get("returnTo");
  const tab = TABS.some(([key]) => key === requestedTab) ? requestedTab : "basic";
  const source = getCourseTemplate(templateId);
  const [template, setTemplate] = useState(() => structuredClone(source ?? emptyTemplate));
  const [pveTemplates, setPveTemplates] = useState([]);
  const isNew = !templateId;
  useEffect(() => { let active = true; TemplatesService.list().then((result) => { const rows = result?.data ?? result ?? []; if (active) setPveTemplates(rows.filter((item) => item.status === "ready")); }).catch(() => {}); return () => { active = false; }; }, []);
  function update(patch) { setTemplate((current) => ({ ...current, ...patch })); }
  function changeTab(nextTab) { setParams(returnTo ? { tab: nextTab, returnTo } : { tab: nextTab }); }
  function save() {
    const saved = saveCourseTemplate(template);
    navigate(returnTo ?? `/course-template-management/${saved.id}`, { replace: true, state: returnTo ? { createdTemplateId: saved.id } : { saved: true } });
  }
  return <div className={styles.page}>
    <button type="button" className={styles.backLink} onClick={() => navigate(returnTo ?? "/course-template-management")}><MIcon name="arrow_back" size={18} />{returnTo ? "返回班級上課環境" : "返回環境模板"}</button>
    <div className={styles.pageHeader}><div className={styles.pageHeading}><div className={styles.titleLine}><h1 className={styles.pageTitle}>{isNew ? "建立環境模板" : template.name}</h1></div><p className={styles.pageSubtitle}>{isNew ? "定義可重複套用到班級的學生機器組合。" : `${template.code} · v${template.version} · ${template.updatedAt}`}</p></div><div className={styles.pageActions}><button type="button" className={styles.btnSecondary} onClick={() => navigate(returnTo ?? "/course-template-management")}>取消</button><button type="button" className={styles.btnPrimary} disabled={!template.name.trim() || !template.code.trim() || template.nodes.length === 0 || template.nodes.length > 3} onClick={save}><MIcon name="save" size={16} />儲存模板</button></div></div>
    <div className={styles.stepTabs}>{TABS.map(([key, label], index) => <button type="button" key={key} className={tab === key ? styles.stepActive : ""} onClick={() => changeTab(key)}><span>{index + 1}</span>{label}</button>)}</div>
    {tab === "basic" && <section className={styles.card}><div className={styles.cardHeader}><div><h2>基本資料</h2><p>環境模板只定義機器組合，不包含班級名單、每週任務或進度。</p></div></div><div className={styles.formGrid}><label className={styles.field}><span>模板名稱</span><input value={template.name} onChange={(event) => update({ name: event.target.value })} placeholder="例如：Linux 三層式上課環境" /></label><label className={styles.field}><span>模板代碼</span><input value={template.code} onChange={(event) => update({ code: event.target.value })} placeholder="LINUX-3TIER" /></label><label className={`${styles.field} ${styles.fieldFull}`}><span>環境用途</span><textarea rows={5} value={template.description} onChange={(event) => update({ description: event.target.value })} /></label></div><div className={styles.actionFooter}><button type="button" className={styles.btnPrimary} onClick={() => changeTab("machines")}>下一步：機器配置<MIcon name="arrow_forward" size={16} /></button></div></section>}
    {tab === "machines" && <MachineEditor value={template.nodes} onChange={(nodes) => update({ nodes })} pveTemplates={pveTemplates} />}
  </div>;
}
