/**
 * Multi-machine environment preview data.
 *
 * This deliberately lives outside the pages so the UI contract can later be
 * replaced by GET /api/v1/me/environments without rewriting the table rows.
 * All preview machines are read-only and never call resource control APIs.
 */
export const ENVIRONMENT_GROUP_PREVIEW = [
  {
    id: "preview-course-web",
    kind: "course",
    kindLabel: "課堂機器",
    title: "網頁課",
    status: "running",
    timingLabel: "今天 16:30 關機",
    nodeLabel: "多節點",
    preview: true,
    machines: [
      { id: "course-db", name: "Database", role: "資料庫", type: "lxc", os: "PostgreSQL 17", status: "running", ip: "10.10.20.11", node: "pve" },
      { id: "course-n8n", name: "n8n", role: "流程服務", type: "lxc", os: "n8n", status: "stopped", ip: "10.10.20.12", node: "pve" },
      { id: "course-linux", name: "Linux 操作主機", role: "操作主機", type: "qemu", os: "Debian 13", status: "running", ip: "10.10.20.10", node: "pve" },
    ],
  },
  {
    id: "preview-practice-database",
    kind: "quick_practice",
    kindLabel: "快速模板",
    title: "資料庫練習",
    status: "running",
    timingLabel: "剩餘 2 小時 18 分",
    nodeLabel: "多節點",
    preview: true,
    machines: [
      { id: "practice-mysql", name: "MySQL", role: "資料庫", type: "lxc", os: "MySQL 8.4", status: "running", ip: "10.10.30.11", node: "pve" },
      { id: "practice-windows", name: "Windows 操作主機", role: "操作主機", type: "qemu", os: "Windows 11", status: "running", ip: "10.10.30.10", node: "pve" },
    ],
  },
];

export const COURSE_MACHINE_ACCESS_PREVIEW = ENVIRONMENT_GROUP_PREVIEW[0];

