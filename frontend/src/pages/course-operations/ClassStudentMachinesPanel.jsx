import { useCallback, useEffect, useState } from "react";
import MIcon from "../../components/MIcon";
import { TeachingClassesService } from "../../services/teachingClasses";
import styles from "./CourseOperations.module.scss";

function metric(value) {
  return value == null ? "—" : `${value.toFixed(1)}%`;
}

export default function ClassStudentMachinesPanel({ classId, onData }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await TeachingClassesService.studentMachines(classId);
      setData(result);
      onData?.(result);
    } catch (reason) {
      setError(reason?.message ?? "無法讀取學生機器狀態");
    } finally {
      setLoading(false);
    }
  }, [classId, onData]);

  useEffect(() => { refresh(); }, [refresh]);
  if (!data && loading) return <div className={styles.emptyState}>正在讀取學生機器…</div>;

  return <div className={styles.stack}>
    <section className={styles.card}>
      <div className={styles.cardHeader}>
        <div><h2>學生機器</h2><p>資料庫配置與本次 PVE 即時快照。</p></div>
        <button type="button" onClick={refresh} disabled={loading}><MIcon name="refresh" size={16} />重新整理</button>
      </div>
      {error && <p className={styles.errorMessage}>{error}</p>}
      {data && <div className={styles.statsGrid}>
        {[
          ["學生", data.summary.students], ["機器", data.summary.machines],
          ["執行中", data.summary.running], ["停止", data.summary.stopped],
          ["配置中", data.summary.provisioning], ["失敗", data.summary.failed],
          ["未知", data.summary.unknown],
        ].map(([label, value]) => <div className={styles.statCard} key={label}><span>{label}</span><strong>{value}</strong></div>)}
      </div>}
    </section>
    {data?.students.map((student) => <section className={styles.card} key={student.student_id}>
      <div className={styles.cardHeader}><div><h2>{student.name}</h2><p>{student.email}</p></div><span>{student.machines.length} 台</span></div>
      <div className={styles.tableWrap}><table className={styles.table}>
        <thead><tr><th>機器</th><th>VMID / Node</th><th>配置</th><th>Runtime</th><th>CPU</th><th>RAM</th><th>Disk</th></tr></thead>
        <tbody>{student.machines.map((machine) => <tr key={machine.mapping_id}>
          <td><strong>{machine.name}</strong><small>{machine.node_key} · {machine.role}</small></td>
          <td><strong>{machine.vmid ?? "—"}</strong><small>{machine.proxmox_node ?? machine.resource_type}</small></td>
          <td><span className={`${styles.statusBadge} ${machine.provision_status === "failed" ? styles.status_partial_failed : styles.status_active}`}>{machine.provision_status}</span>{machine.provision_error && <small>{machine.provision_error}</small>}</td>
          <td>{machine.runtime_status}</td><td>{metric(machine.cpu_usage_pct)}</td><td>{metric(machine.ram_usage_pct)}</td><td>{metric(machine.disk_usage_pct)}</td>
        </tr>)}</tbody>
      </table></div>
      {!student.machines.length && <div className={styles.emptyState}>尚無配置機器</div>}
    </section>)}
  </div>;
}
