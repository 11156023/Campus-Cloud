import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import MIcon from "../../components/MIcon";
import { TemplatesService } from "../../services/templates";
import { templateCatalog } from "./courseOperationsMock";
import styles from "./CourseOperations.module.scss";

const TABS = [
  ["basic", "settings", "基本資料"],
  ["machines", "account_tree", "機器配置"],
];

const emptyTemplate = { id: "new", name: "", code: "", description: "", status: "draft", classes: 0, updatedAt: "尚未儲存", nodes: [] };

function MachineEditor({ value, onChange, pveTemplates }) {
  const [sourceId, setSourceId] = useState("");
  const sources = pveTemplates.length ? pveTemplates : [
    { id: "fallback-linux", name: "Ubuntu Server 24.04", resource_type: "LXC", default_cores: 2, default_memory: 2048, default_disk: 24 },
    { id: "fallback-router", name: "Debian Router Lab", resource_type: "VM", default_cores: 2, default_memory: 2048, default_disk: 12 },
  ];
  function addMachine() {
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
  return <div className={styles.stack}>
    <section className={styles.card}>
      <div className={styles.cardHeader}><div><h2>加入上課機器</h2><p>從既有 PVE 範本加入機器；一位學生可以使用一台或多台互聯機器。</p></div></div>
      <div className={styles.inlineBuilder}>
        <label className={styles.field}><span>選擇既有 PVE 範本</span><select value={sourceId} onChange={(event) => setSourceId(event.target.value)}><option value="">請選擇…</option>{sources.map((source) => <option key={source.id} value={source.id}>{source.name} · {source.resource_type ?? "VM"}</option>)}</select></label>
        <button type="button" className={styles.btnPrimary} onClick={addMachine}><MIcon name="add" size={16} />加入藍圖</button>
        <span className={styles.helperText}>來源沿用現有「模板管理」；此處只定義學生上課要使用幾台機器及如何連線。</span>
      </div>
    </section>
    <section className={styles.card}>
      <div className={styles.cardHeader}><div><h2>每位學生的機器配置</h2><p>{value.length ? `${value.length} 台固定機器` : "尚未加入機器"}</p></div></div>
      {value.length ? <div className={styles.blueprintCanvas}>{value.map((node, index) => <div className={styles.blueprintItem} key={node.id}>
        <article className={styles.machineBlock}>
          <div className={styles.machineTitle}><span><MIcon name={node.icon ?? "dns"} size={20} /></span><div><input value={node.name} onChange={(event) => onChange(value.map((item) => item.id === node.id ? { ...item, name: event.target.value } : item))} /><small>{node.image}</small></div><em>{node.type}</em></div>
          <div className={styles.machineFields}><label>角色<input value={node.role} onChange={(event) => onChange(value.map((item) => item.id === node.id ? { ...item, role: event.target.value } : item))} /></label><label>網路<input value={node.network} onChange={(event) => onChange(value.map((item) => item.id === node.id ? { ...item, network: event.target.value } : item))} /></label></div>
          <div className={styles.machineSpecs}><span>{node.cpu} CPU</span><span>{node.memory} GB RAM</span><span>{node.disk} GB Disk</span><button type="button" onClick={() => onChange(value.filter((item) => item.id !== node.id))}><MIcon name="delete_outline" size={16} />移除</button></div>
        </article>
        {index < value.length - 1 && <div className={styles.connection}><span>{node.network}</span><i /><MIcon name="arrow_forward" size={18} /></div>}
      </div>)}</div> : <div className={styles.emptyState}><MIcon name="dns" size={32} /><p>請先從既有 PVE 範本加入第一台機器。</p></div>}
    </section>
    <div className={styles.metricGrid}><div><span>每位學生</span><strong>{value.length} 台</strong></div><div><span>CPU 合計</span><strong>{totals.cpu} cores</strong></div><div><span>記憶體合計</span><strong>{totals.ram} GB</strong></div><div><span>磁碟合計</span><strong>{totals.disk} GB</strong></div></div>
  </div>;
}

export default function CourseTemplateEditorPage() {
  const { templateId } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const requestedTab = params.get("tab") ?? "basic";
  const tab = TABS.some(([key]) => key === requestedTab) ? requestedTab : "basic";
  const source = templateCatalog.find((template) => template.id === templateId);
  const [template, setTemplate] = useState(() => structuredClone(source ?? emptyTemplate));
  const [pveTemplates, setPveTemplates] = useState([]);
  const isNew = !templateId;
  useEffect(() => { let active = true; TemplatesService.list().then((result) => { const rows = result?.data ?? result ?? []; if (active) setPveTemplates(rows.filter((item) => item.status === "ready")); }).catch(() => {}); return () => { active = false; }; }, []);
  function update(patch) { setTemplate((current) => ({ ...current, ...patch })); }
  function save() { navigate("/course-template-management", { state: { savedTemplate: template } }); }
  return <div className={styles.page}>
    <button type="button" className={styles.backLink} onClick={() => navigate("/course-template-management")}><MIcon name="arrow_back" size={18} />返回上課機器模板</button>
    <div className={styles.pageHeader}><div className={styles.pageHeading}><div className={styles.titleLine}><h1 className={styles.pageTitle}>{isNew ? "建立上課機器模板" : template.name}</h1><span className={styles.devBadge}>待開發</span></div><p className={styles.pageSubtitle}>{isNew ? "定義學生上課使用的固定機器、規格與連線。" : `${template.code} · v${template.version} · ${template.updatedAt}`}</p></div><div className={styles.pageActions}><button type="button" className={styles.btnSecondary} onClick={() => navigate("/course-template-management")}>取消</button><button type="button" className={styles.btnPrimary} disabled={!template.name.trim() || template.nodes.length === 0} onClick={save}><MIcon name="save" size={16} />儲存模板</button></div></div>
    <div className={styles.stepTabs}>{TABS.map(([key, icon, label], index) => <button type="button" key={key} className={tab === key ? styles.stepActive : ""} onClick={() => setParams({ tab: key })}><span>{index + 1}</span><MIcon name={icon} size={17} />{label}</button>)}</div>
    {tab === "basic" && <section className={styles.card}><div className={styles.cardHeader}><div><h2>基本資料</h2><p>上課機器模板只組合既有 PVE 範本，不管理班級任務或進度。</p></div></div><div className={styles.formGrid}><label className={styles.field}><span>模板名稱</span><input value={template.name} onChange={(event) => update({ name: event.target.value })} placeholder="例如：Linux 三層式上課環境" /></label><label className={styles.field}><span>模板代碼</span><input value={template.code} onChange={(event) => update({ code: event.target.value })} placeholder="LINUX-3TIER" /></label><label className={`${styles.field} ${styles.fieldFull}`}><span>環境用途</span><textarea rows={5} value={template.description} onChange={(event) => update({ description: event.target.value })} /></label></div><div className={styles.actionFooter}><button type="button" className={styles.btnPrimary} onClick={() => setParams({ tab: "machines" })}>下一步：機器配置<MIcon name="arrow_forward" size={16} /></button></div></section>}
    {tab === "machines" && <MachineEditor value={template.nodes} onChange={(nodes) => update({ nodes })} pveTemplates={pveTemplates} />}
  </div>;
}
