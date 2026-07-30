import { useMemo, useState } from "react";
import AiJudgePanel from "../system/groups/AiJudgePanel";
import AiPvePanel from "../system/groups/AiPvePanel";
import styles from "./CourseOperations.module.scss";

const TABS = [
  ["rubrics", "評分表"],
  ["scripts", "收集腳本"],
  ["execution", "執行與結果"],
  ["pve", "AI PVE 助手"],
];

export default function ClassAiCheckPanel({ classId, machineState }) {
  const [tab, setTab] = useState("rubrics");
  const { data: machineData, loading } = machineState;
  const scope = useMemo(() => ({ type: "teaching-class", id: classId }), [classId]);
  const members = useMemo(
    () => (machineData?.students ?? []).flatMap((student) =>
      student.machines
        .filter((machine) => (
          machine.vmid != null
          && ["completed", "ready"].includes(machine.provision_status)
        ))
        .map((machine) => ({
          id: machine.mapping_id,
          user_id: student.user_id,
          email: student.email,
          full_name: student.name,
          vmid: machine.vmid,
          vm_status: machine.runtime_status,
          vm_type: machine.resource_type,
        }))),
    [machineData],
  );
  const hasVm = members.some((member) => member.vmid != null);

  return <div className={styles.stack}>
    <nav className={styles.workspaceTabs}>
      {TABS.map(([key, label]) => <button type="button" key={key} className={tab === key ? styles.workspaceTabActive : ""} onClick={() => setTab(key)}>{label}</button>)}
    </nav>
    {tab !== "pve" && <AiJudgePanel scope={scope} members={members} visibleTab={tab} />}
    {tab === "pve" && (loading && !machineData
      ? <section className={styles.emptyState}>正在確認班級機器…</section>
      : hasVm
      ? <AiPvePanel scope={scope} />
      : <section className={styles.lockedFeature}><div><h2>尚無可用 VMID</h2><p>至少完成一台學生機器配置後才能使用 AI PVE 助手。</p></div></section>)}
  </div>;
}
