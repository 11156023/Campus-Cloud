export const templateCatalog = [
  {
    id: "tpl-linux-three-tier",
    name: "Linux 三層式上課環境",
    code: "LINUX-3TIER",
    version: 3,
    status: "published",
    description: "每位學生配置 Client、Web Server 與 Database，供整學期固定使用。",
    classes: 3,
    updatedAt: "2026/07/12",
    nodes: [
      { id: "client", name: "Client", role: "學生端", type: "LXC", image: "Ubuntu Desktop 24.04", cpu: 1, memory: 2, disk: 16, network: "lab-net", icon: "laptop_mac" },
      { id: "web", name: "Web Server", role: "應用伺服器", type: "VM", image: "Ubuntu Server 24.04", cpu: 2, memory: 4, disk: 30, network: "lab-net / backend-net", icon: "dns" },
      { id: "database", name: "Database", role: "資料庫", type: "LXC", image: "PostgreSQL 18 Lab", cpu: 2, memory: 3, disk: 24, network: "backend-net", icon: "database" },
    ],
  },
  {
    id: "tpl-network-pair",
    name: "Router + Client 上課環境",
    code: "NETWORK-PAIR",
    version: 2,
    status: "published",
    description: "每位學生配置固定的路由器與用戶端機器。",
    classes: 2,
    updatedAt: "2026/06/28",
    nodes: [
      { id: "router", name: "Router", role: "路由器", type: "VM", image: "Debian Router Lab", cpu: 2, memory: 2, disk: 12, network: "wan / lab-net", icon: "router" },
      { id: "client", name: "Client", role: "學生端", type: "LXC", image: "Ubuntu 24.04", cpu: 1, memory: 2, disk: 16, network: "lab-net", icon: "laptop_mac" },
    ],
  },
  {
    id: "tpl-docker-single",
    name: "Docker 開發環境",
    code: "DOCKER-DEV",
    version: 4,
    status: "draft",
    description: "固定 Docker Engine 與 Compose 開發環境。",
    classes: 0,
    updatedAt: "2026/07/16",
    nodes: [
      { id: "docker", name: "Docker Host", role: "容器主機", type: "VM", image: "Ubuntu Docker Lab", cpu: 2, memory: 4, disk: 40, network: "lab-net", icon: "deployed_code" },
    ],
  },
];

export const classCatalog = [
  { id: "class-linux-1141", name: "Linux 系統管理｜114-1", code: "CS-LINUX-1141", term: "114-1", teacher: "王老師", students: 32, templateId: "tpl-linux-three-tier", templateVersion: 3, machinesPerStudent: 3, status: "active", startDate: "2026/09/01", endDate: "2027/01/31", readyMachines: 94, totalMachines: 96 },
  { id: "class-network-night", name: "企業網路實務｜夜間班", code: "NET-LAB-N1", term: "114-1", teacher: "王老師", students: 24, templateId: "tpl-network-pair", templateVersion: 2, machinesPerStudent: 2, status: "planning", startDate: "2026/09/08", endDate: "2027/01/20", readyMachines: 0, totalMachines: 48 },
  { id: "class-docker-summer", name: "Docker 暑期密集班", code: "DOCKER-SUMMER", term: "2026 暑期", teacher: "林老師", students: 18, templateId: "tpl-docker-single", templateVersion: 3, machinesPerStudent: 1, status: "archived", startDate: "2026/07/01", endDate: "2026/08/15", readyMachines: 18, totalMachines: 18 },
];

export const classStudents = [
  { id: 1, name: "陳怡君", account: "s114001", email: "s114001@example.edu", machines: "3/3", machineStatus: "ready", ai: "檢查正常", aiTone: "good", done: true },
  { id: 2, name: "李冠廷", account: "s114002", email: "s114002@example.edu", machines: "3/3", machineStatus: "ready", ai: "Apache 設定可能缺漏", aiTone: "warn", done: false },
  { id: 3, name: "張雅雯", account: "s114003", email: "s114003@example.edu", machines: "3/3", machineStatus: "ready", ai: "檢查正常", aiTone: "good", done: true },
  { id: 4, name: "吳柏翰", account: "s114004", email: "s114004@example.edu", machines: "2/3", machineStatus: "warning", ai: "Database 未回應", aiTone: "danger", done: false },
  { id: 5, name: "林子晴", account: "s114005", email: "s114005@example.edu", machines: "3/3", machineStatus: "ready", ai: "資料不足", aiTone: "muted", done: false },
];

export const classWeeks = [
  { id: "cw1", week: 1, title: "登入與 Linux 基礎", date: "2026/09/08", status: "completed", files: ["week01-guide.md", "linux-basics.zip"], target: "Client", distributed: "32/32" },
  { id: "cw2", week: 2, title: "帳號與檔案權限", date: "2026/09/15", status: "completed", files: ["week02-permissions.pdf", "accounts.csv", "setup.sh"], target: "Client", distributed: "32/32" },
  { id: "cw3", week: 3, title: "Apache 與反向代理", date: "2026/09/22", status: "published", files: ["apache-lab.zip", "virtualhost.conf", "hidden-checks.json"], target: "Web Server", distributed: "30/32" },
  { id: "cw4", week: 4, title: "PostgreSQL 建置與查詢", date: "2026/09/29", status: "draft", files: ["schema.sql", "sample-data.sql"], target: "Database", distributed: "尚未派送" },
];
