import { useEffect, useState } from "react";
import {
  Background,
  MarkerType,
  ReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import MIcon from "../../components/MIcon";
import { CourseEnvironmentsService } from "../../services/courseEnvironments";
import { apiGet } from "../../services/api";
import { TemplatesService } from "../../services/templates";
import styles from "./CourseOperations.module.scss";

const TABS = [
  ["basic", "基本資料"],
  ["machines", "機器配置"],
];

const emptyTemplate = { id: "new", name: "", code: "", description: "", status: "draft", classes: 0, updatedAt: "尚未儲存", nodes: [], edges: [] };

const FIREWALL_PROTOCOLS = ["tcp", "udp", "icmp", "icmpv6", "sctp"];

function MachineEditor({ value, edges, onChange, onEdgesChange, pveTemplates, vmImages, lxcImages, locked = false }) {
  const [sourceMode, setSourceMode] = useState("template");
  const [sourceId, setSourceId] = useState("");
  const [customType, setCustomType] = useState("qemu");
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [selectedEdgeId, setSelectedEdgeId] = useState("");
  const atLimit = value.length >= 3;

  function addMachine() {
    if (atLimit || !sourceId) return;
    const nodeId = `node-${Date.now()}`;
    if (sourceMode === "template") {
      const source = pveTemplates.find((item) => String(item.id) === sourceId);
      if (!source) return;
      onChange([...value, {
        id: nodeId, sourceType: "template", sourceTemplateId: source.id, name: source.name, role: "課程機器",
        type: String(source.resource_type).toLowerCase() === "lxc" ? "lxc" : "qemu", image: source.name, cpu: source.default_cores ?? 2,
        memory: Math.max(1, Math.round((source.default_memory ?? 2048) / 1024)), disk: source.default_disk ?? 24,
        network: "lab-net", icon: "dns",
      }]);
    } else {
      const source = (customType === "lxc" ? lxcImages : vmImages).find((item) => String(item.value) === sourceId);
      if (!source) return;
      onChange([...value, {
        id: nodeId, sourceType: "custom", sourceTemplateId: null, customImageRef: source.value,
        customStorage: "local-lvm", customUsername: "student", customUnprivileged: true,
        name: source.label.split(" · ")[0], role: "課程機器", type: customType, image: source.label,
        cpu: 2, memory: 2, disk: customType === "lxc" ? 8 : 20, network: "lab-net", icon: "dns",
      }]);
    }
    setSelectedNodeId(nodeId);
    setSelectedEdgeId("");
    setSourceId("");
  }

  function removeMachine(nodeId) {
    onChange(value.filter((item) => item.id !== nodeId));
    onEdgesChange(edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
    setSelectedNodeId("");
  }

  function connect(connection) {
    if (locked || connection.source === connection.target) return;
    const duplicate = edges.some((edge) => (
      edge.source === connection.source
      && edge.target === connection.target
      && edge.direction === "one_way"
      && edge.protocol === "tcp"
      && Number(edge.port) === 22
    ));
    if (duplicate) return;
    const edge = {
      id: `edge-${Date.now()}`,
      source: connection.source,
      target: connection.target,
      direction: "one_way",
      protocol: "tcp",
      port: 22,
    };
    onEdgesChange([...edges, edge]);
    setSelectedEdgeId(edge.id);
    setSelectedNodeId("");
  }

  function patchNode(nodeId, patch) {
    onChange(value.map((item) => item.id === nodeId ? { ...item, ...patch } : item));
  }

  function patchEdge(patch) {
    onEdgesChange(edges.map((edge) => edge.id === selectedEdgeId ? { ...edge, ...patch } : edge));
  }

  const selectedEdge = edges.find((edge) => edge.id === selectedEdgeId);
  const selectedNode = value.find((node) => node.id === selectedNodeId) ?? (!selectedEdge ? value[0] : null);
  const graphNodes = value.map((node, index) => ({
    id: String(node.id),
    position: { x: 60 + index * 260, y: 95 + (index % 2) * 45 },
    data: {
      label: <div className={styles.flowNodeLabel}>
        <strong>{node.name}</strong>
        <span>{node.sourceType === "custom" ? "自訂" : "範本"} · {String(node.type).toUpperCase()}</span>
        <small>{node.cpu} CPU · {node.memory} GB</small>
      </div>,
    },
    selected: selectedNode?.id === node.id,
    style: { width: 190, border: "1px solid var(--color-primary)", borderRadius: 10 },
  }));
  const graphEdges = edges.map((edge) => ({
    ...edge,
    label: `${edge.direction === "bidirectional" ? "雙向" : "單向"} · ${edge.protocol}${edge.port ? `/${edge.port}` : ""}`,
    markerEnd: { type: MarkerType.ArrowClosed },
    markerStart: edge.direction === "bidirectional" ? { type: MarkerType.ArrowClosed } : undefined,
    style: { strokeWidth: 2 },
  }));

  return <section className={`${styles.card} ${styles.templateMachineWorkspace}`}>
      <div className={styles.machineWorkspaceHeader}>
        <div><h2>每位學生的上課環境</h2><p>新增節點，再用連線定義可互通的服務。</p></div>
        <span className={styles.nodeLimit}>{value.length} / 3 節點</span>
      </div>
      <div className={styles.machineAddBar}>
        <label className={styles.field}><span>來源方式</span><select value={sourceMode} disabled={locked || atLimit} onChange={(event) => { setSourceMode(event.target.value); setSourceId(""); }}><option value="template">① 選擇既有範本</option><option value="custom">② 新增 VM/LXC 規格</option></select></label>
        {sourceMode === "custom" && <label className={styles.field}><span>機器類型</span><select value={customType} disabled={locked || atLimit} onChange={(event) => { setCustomType(event.target.value); setSourceId(""); }}><option value="qemu">VM</option><option value="lxc">LXC</option></select></label>}
        <label className={styles.field}><span>{sourceMode === "template" ? "既有範本" : "基礎映像"}</span><select value={sourceId} disabled={locked || atLimit} onChange={(event) => setSourceId(event.target.value)}><option value="">{locked ? "已發布版本不可修改" : atLimit ? "已達 3 台上限" : "請選擇"}</option>{sourceMode === "template" ? pveTemplates.map((source) => <option key={source.id} value={source.id}>{source.name} · {source.resource_type ?? "VM"}</option>) : (customType === "lxc" ? lxcImages : vmImages).map((source) => <option key={source.value} value={source.value}>{source.label}</option>)}</select></label>
        <button type="button" className={styles.btnPrimary} disabled={locked || atLimit || !sourceId} onClick={addMachine}><MIcon name={atLimit ? "check" : "add"} size={16} />{atLimit ? "已達上限" : "加入機器"}</button>
      </div>
      {value.length ? <>
        <div className={styles.topologyHelp}><MIcon name="account_tree" size={17} /><span>拖曳節點圓點建立連線；點節點或連線進行設定。</span></div>
        <div className={styles.topologyWorkspace}>
          <div className={styles.topologyCanvas}><ReactFlow
            nodes={graphNodes}
            edges={graphEdges}
            onConnect={connect}
            onNodeClick={(_, node) => { setSelectedNodeId(node.id); setSelectedEdgeId(""); }}
            onEdgeClick={(_, edge) => { setSelectedEdgeId(edge.id); setSelectedNodeId(""); }}
            nodesDraggable={false}
            nodesConnectable={!locked}
            elementsSelectable
            minZoom={0.7}
            maxZoom={1.4}
            fitView
            fitViewOptions={{ padding: 0.22, maxZoom: 1.1 }}
            proOptions={{ hideAttribution: true }}
          ><Background gap={20} size={1} /></ReactFlow></div>
          <aside className={styles.topologyInspector}>
            {selectedEdge ? <>
              <div className={styles.inspectorTitle}><MIcon name="link" size={18} /><div><strong>連線規則</strong><small>{value.find((node) => node.id === selectedEdge.source)?.name} → {value.find((node) => node.id === selectedEdge.target)?.name}</small></div></div>
              <label>方向<select disabled={locked} value={selectedEdge.direction} onChange={(event) => patchEdge({ direction: event.target.value })}><option value="one_way">單向</option><option value="bidirectional">雙向</option></select></label>
              <div className={styles.inspectorSplit}>
                <label>協定<select disabled={locked} value={selectedEdge.protocol} onChange={(event) => patchEdge({ protocol: event.target.value })}>{selectedEdge.protocol === "any" && <option value="any">全部（舊設定）</option>}{FIREWALL_PROTOCOLS.map((protocol) => <option key={protocol} value={protocol}>{protocol.toUpperCase()}</option>)}</select></label>
                <label>Port<input disabled={locked || selectedEdge.protocol === "any"} type="number" min="1" max="65535" value={selectedEdge.port ?? ""} onChange={(event) => patchEdge({ port: event.target.value })} /></label>
              </div>
              <p className={styles.inspectorHint}>單向會建立來源 OUT 與目標 IN 規則；雙向會再建立反向規則。</p>
              {!locked && <button type="button" className={styles.inspectorDanger} onClick={() => { onEdgesChange(edges.filter((edge) => edge.id !== selectedEdge.id)); setSelectedEdgeId(""); }}><MIcon name="delete_outline" size={16} />刪除連線</button>}
            </> : selectedNode ? <>
              <div className={styles.inspectorTitle}><MIcon name="dns" size={18} /><div><strong>{selectedNode.name}</strong><small>{selectedNode.sourceType === "custom" ? "自訂規格" : "既有範本"} · {String(selectedNode.type).toUpperCase()}</small></div></div>
              <label>名稱<input disabled={locked} value={selectedNode.name} onChange={(event) => patchNode(selectedNode.id, { name: event.target.value })} /></label>
              <label>角色<input disabled={locked} value={selectedNode.role} onChange={(event) => patchNode(selectedNode.id, { role: event.target.value })} /></label>
              <div className={styles.inspectorSplit}>
                <label>CPU<input disabled={locked || selectedNode.sourceType !== "custom"} type="number" min="1" max="32" value={selectedNode.cpu} onChange={(event) => patchNode(selectedNode.id, { cpu: Number(event.target.value) })} /></label>
                <label>RAM (GB)<input disabled={locked || selectedNode.sourceType !== "custom"} type="number" min="1" max="64" value={selectedNode.memory} onChange={(event) => patchNode(selectedNode.id, { memory: Number(event.target.value) })} /></label>
              </div>
              <label>Disk (GB)<input disabled={locked || selectedNode.sourceType !== "custom"} type="number" min={selectedNode.type === "lxc" ? 1 : 10} max="1000" value={selectedNode.disk} onChange={(event) => patchNode(selectedNode.id, { disk: Number(event.target.value) })} /></label>
              {selectedNode.sourceType === "custom" && <label>儲存區<input disabled={locked} value={selectedNode.customStorage} onChange={(event) => patchNode(selectedNode.id, { customStorage: event.target.value })} /></label>}
              {!locked && <button type="button" className={styles.inspectorDanger} onClick={() => removeMachine(selectedNode.id)}><MIcon name="delete_outline" size={16} />移除節點</button>}
            </> : null}
          </aside>
        </div>
      </> : <div className={styles.emptyState}><MIcon name="dns" size={32} /><p>先加入一個節點，再設定機器之間的連線。</p></div>}
  </section>;
}

export default function CourseTemplateEditorPage() {
  const { templateId } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const requestedTab = params.get("tab") ?? "basic";
  const returnTo = params.get("returnTo");
  const tab = TABS.some(([key]) => key === requestedTab) ? requestedTab : "basic";
  const [template, setTemplate] = useState(() => structuredClone(emptyTemplate));
  const [pveTemplates, setPveTemplates] = useState([]);
  const [vmImages, setVmImages] = useState([]);
  const [lxcImages, setLxcImages] = useState([]);
  const [loading, setLoading] = useState(Boolean(templateId));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const isNew = !templateId;
  const locked = template.status !== "draft";
  const invalidTopology = (template.edges ?? []).some((edge) => (
    edge.protocol !== "any"
    && (!Number.isInteger(Number(edge.port)) || Number(edge.port) < 1 || Number(edge.port) > 65535)
  ));
  useEffect(() => {
    if (!templateId) { setTemplate(structuredClone(emptyTemplate)); setLoading(false); return undefined; }
    let active = true;
    setLoading(true);
    CourseEnvironmentsService.get(templateId)
      .then((result) => active && setTemplate(result))
      .catch((reason) => active && setMessage(reason?.message ?? "無法讀取環境模板"))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [templateId]);
  useEffect(() => { let active = true; TemplatesService.list().then((result) => { const rows = result?.data ?? result ?? []; if (active) setPveTemplates(rows.filter((item) => item.status === "ready")); }).catch(() => {}); return () => { active = false; }; }, []);
  useEffect(() => {
    let active = true;
    Promise.all([apiGet("/api/v1/vm/templates"), apiGet("/api/v1/lxc/templates")])
      .then(([vms, lxcs]) => {
        if (!active) return;
        setVmImages((vms ?? []).map((item) => ({ value: String(item.vmid), label: `${item.name} · VMID ${item.vmid} · ${item.node}` })));
        setLxcImages((lxcs ?? []).map((item) => ({ value: item.volid, label: item.volid.split("/").pop() ?? item.volid })));
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);
  function update(patch) { setTemplate((current) => ({ ...current, ...patch })); }
  function changeTab(nextTab) { setParams(returnTo ? { tab: nextTab, returnTo } : { tab: nextTab }); }
  async function save() {
    setSaving(true); setMessage("");
    try {
      const saved = isNew
        ? await CourseEnvironmentsService.create(template)
        : await CourseEnvironmentsService.update(template.id, template);
      setTemplate(saved);
      if (isNew) navigate(`/course-template-management/${saved.id}${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`, { replace: true });
      else setMessage("草稿已儲存。確認無誤後可以發布鎖定。");
    } catch (reason) { setMessage(reason?.message ?? "儲存失敗"); }
    finally { setSaving(false); }
  }
  async function publish() {
    setSaving(true); setMessage("");
    try {
      const published = await CourseEnvironmentsService.publish(template.id);
      setTemplate(published);
      setMessage("課程環境已發布並鎖定，現在可以在教室管理中選擇。");
      if (returnTo) navigate(returnTo, { state: { createdTemplateId: published.id } });
    } catch (reason) { setMessage(reason?.message ?? "發布失敗"); }
    finally { setSaving(false); }
  }
  async function newVersion() {
    setSaving(true); setMessage("");
    try { setTemplate(await CourseEnvironmentsService.createVersion(template.id)); }
    catch (reason) { setMessage(reason?.message ?? "建立新版本失敗"); }
    finally { setSaving(false); }
  }
  if (loading) return <div className={styles.emptyState}><p>正在讀取環境模板…</p></div>;
  return <div className={styles.page}>
    <button type="button" className={styles.backLink} onClick={() => navigate(returnTo ?? "/course-template-management")}><MIcon name="arrow_back" size={18} />{returnTo ? "返回班級上課環境" : "返回環境模板"}</button>
    <div className={styles.pageHeader}><div className={styles.pageHeading}><div className={styles.titleLine}><h1 className={styles.pageTitle}>{isNew ? "建立環境模板" : template.name}</h1></div><p className={styles.pageSubtitle}>{isNew ? "定義可重複套用到班級的學生機器組合。" : `${template.code} · v${template.version} · ${template.updatedAt}`}</p></div><div className={styles.pageActions}><button type="button" className={styles.btnSecondary} onClick={() => navigate(returnTo ?? "/course-template-management")}>返回</button>{locked ? <button type="button" className={styles.btnPrimary} disabled={saving} onClick={newVersion}><MIcon name="content_copy" size={16} />建立新版本</button> : <><button type="button" className={styles.btnSecondary} disabled={isNew || saving || template.nodes.length === 0 || invalidTopology} onClick={publish}><MIcon name="lock" size={16} />發布並鎖定</button><button type="button" className={styles.btnPrimary} disabled={saving || !template.name.trim() || !template.code.trim() || template.nodes.length === 0 || template.nodes.length > 3 || invalidTopology} onClick={save}><MIcon name="save" size={16} />{saving ? "儲存中…" : "儲存草稿"}</button></>}</div></div>
    {message && <p className={styles.persistentFeedback}><MIcon name="info" size={17} />{message}</p>}
    <div className={styles.stepTabs}>{TABS.map(([key, label], index) => <button type="button" key={key} className={tab === key ? styles.stepActive : ""} onClick={() => changeTab(key)}><span>{index + 1}</span>{label}</button>)}</div>
    {tab === "basic" && <section className={styles.card}><div className={styles.cardHeader}><div><h2>基本資料</h2><p>{locked ? "這個版本已發布並鎖定；需要調整時請建立新版本。" : "環境模板只定義機器組合，不包含班級名單、每週任務或進度。"}</p></div></div><div className={styles.formGrid}><label className={styles.field}><span>模板名稱</span><input disabled={locked} value={template.name} onChange={(event) => update({ name: event.target.value })} placeholder="例如：Linux 三層式上課環境" /></label><label className={styles.field}><span>模板代碼</span><input disabled={locked} value={template.code} onChange={(event) => update({ code: event.target.value })} placeholder="LINUX-3TIER" /></label><label className={`${styles.field} ${styles.fieldFull}`}><span>環境用途</span><textarea disabled={locked} rows={5} value={template.description ?? ""} onChange={(event) => update({ description: event.target.value })} /></label></div><div className={styles.actionFooter}><button type="button" className={styles.btnPrimary} onClick={() => changeTab("machines")}>查看機器配置<MIcon name="arrow_forward" size={16} /></button></div></section>}
    {tab === "machines" && <MachineEditor value={template.nodes} edges={template.edges ?? []} onChange={(nodes) => update({ nodes })} onEdgesChange={(edges) => update({ edges })} pveTemplates={pveTemplates} vmImages={vmImages} lxcImages={lxcImages} locked={locked} />}
  </div>;
}
