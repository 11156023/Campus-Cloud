import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import MIcon from "../../../components/MIcon";
import { useAuth } from "../../../contexts/AuthContext";
import { CoursesService } from "../../../services/courses";
import { ResourcesService } from "../../../services/resources";
import { TemplatesService } from "../../../services/templates";
import useGuideDemo from "../../../hooks/useGuideDemo";
import styles from "./StudentHomeNewPage.module.scss";
import dashboardStyles from "./DashboardPage.module.scss";

const STATUS_META = {
  running: { label: "環境已就緒", tone: "success", icon: "check_circle" },
  provisioning: { label: "環境準備中", tone: "info", icon: "hourglass_top" },
  failed: { label: "環境建立失敗", tone: "danger", icon: "error" },
  expired: { label: "環境已到期", tone: "muted", icon: "schedule" },
  stopped: { label: "環境已關機", tone: "muted", icon: "power_settings_new" },
  no_lab: { label: "不需要實驗機", tone: "success", icon: "menu_book" },
  not_started: { label: "尚未啟動", tone: "warning", icon: "play_circle" },
  empty: { label: "目前沒有課程", tone: "muted", icon: "event_busy" },
};

const TOUR_STEPS = [
  {
    selector: '[data-student-tour="class"]',
    icon: "school",
    eyebrow: "上課第一步",
    title: "先看今天要完成什麼",
    description: "首頁會依你的課程進度，直接整理出最適合接著完成的章節。按主要按鈕就能進入課堂，不必從功能選單尋找。",
    tip: "課堂機器由老師或課程準備，不需要另外送申請。",
  },
  {
    selector: '[data-student-tour="environment"]',
    icon: "computer",
    eyebrow: "上課環境",
    title: "確認機器是否可以使用",
    description: "這裡會顯示環境狀態、作業系統、IP 與使用期限。看到「環境已就緒」就可以直接進入課堂。",
    tip: "若環境仍在準備，只要留在課堂頁面查看進度即可。",
  },
  {
    selector: '[data-student-tour="tasks"]',
    icon: "checklist",
    eyebrow: "課堂任務",
    title: "照順序完成今天的任務",
    description: "系統會標出建議的下一步，也會保留已完成的作答進度。點任一任務即可回到同一個課堂。",
    tip: "不用一次做完，下次回來會從尚未完成的地方繼續。",
  },
  {
    selector: '[data-student-tour="practice"]',
    icon: "history",
    eyebrow: "下課後練習",
    title: "沿用原本的課堂環境",
    description: "下課後想繼續練習時，從這裡回到相同課程與機器，檔案和任務進度都會保留。",
    tip: "課堂練習不需要建立另一台研究機器。",
  },
  {
    selector: '[data-student-tour="research"]',
    icon: "science",
    eyebrow: "自主研究",
    title: "只有研究需求才需要申請",
    description: "專題、開發或個人實驗才從這裡前往申請。一般上課與下課練習都不需要填申請單。",
    tip: "自主研究流程會再持續優化，目前可先查看既有申請。",
  },
];

function formatDemoTime(date) {
  return new Intl.DateTimeFormat("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function createDemoPaths() {
  const now = new Date();
  const atOffset = (minutes) => new Date(now.getTime() + minutes * 60 * 1000);
  const timeRange = (startMinutes, endMinutes) => (
    `${formatDemoTime(atOffset(startMinutes))}–${formatDemoTime(atOffset(endMinutes))}`
  );

  return [{
    id: "demo-linux-path",
    title: "Linux 系統管理實務",
    description: "練習帳號權限、檔案管理與常用系統指令。",
    room_count: 4,
    total_questions: 12,
    completed_questions: 3,
    progress_percent: 25,
    schedule: {
      time: timeRange(-30, 70),
      place: "電腦教室 A",
      teacher: "陳老師",
      state: "now",
      label: "正在上課",
    },
  }, {
    id: "demo-cloud-path",
    title: "雲端服務部署",
    description: "從應用程式部署到網路發布的基礎實作。",
    room_count: 3,
    total_questions: 10,
    completed_questions: 0,
    progress_percent: 0,
    schedule: {
      time: timeRange(150, 260),
      place: "電腦教室 B",
      teacher: "林老師",
      state: "later",
      label: "今天稍後",
    },
  }];
}

const DEMO_PATH_DETAIL = {
  id: "demo-linux-path",
  title: "Linux 系統管理實務",
  description: "練習帳號權限、檔案管理與常用系統指令。",
  rooms: [
    {
      id: "demo-linux-permissions",
      title: "Linux 檔案權限與使用者",
      description: "完成權限判讀、chmod 與群組設定練習。",
      difficulty: "easy",
      category: "Linux 基礎",
      has_lab: true,
      order: 1,
      total_questions: 5,
      completed_questions: 2,
      progress_percent: 40,
    },
    {
      id: "demo-linux-process",
      title: "程序與服務管理",
      description: "觀察程序並練習服務的啟動與停止。",
      difficulty: "easy",
      category: "Linux 基礎",
      has_lab: true,
      order: 2,
      total_questions: 4,
      completed_questions: 0,
      progress_percent: 0,
    },
  ],
};

const DEMO_ROOM_DETAIL = {
  id: "demo-linux-permissions",
  path_id: "demo-linux-path",
  title: "Linux 檔案權限與使用者",
  description: "完成權限判讀、chmod 與群組設定練習。",
  difficulty: "easy",
  category: "Linux 基礎",
  has_lab: true,
  tasks: [
    {
      id: "demo-task-login",
      title: "登入課堂機器並確認帳號",
      content: "",
      order: 1,
      questions: [
        { id: "demo-q-1", prompt: "確認目前帳號", completed: true },
      ],
    },
    {
      id: "demo-task-permission",
      title: "判讀檔案權限",
      content: "",
      order: 2,
      questions: [
        { id: "demo-q-2", prompt: "判讀權限", completed: true },
      ],
    },
    {
      id: "demo-task-chmod",
      title: "使用 chmod 修改權限",
      content: "",
      order: 3,
      questions: [
        { id: "demo-q-3", prompt: "完成指定權限", completed: false },
        { id: "demo-q-4", prompt: "驗證結果", completed: false },
      ],
    },
    {
      id: "demo-task-group",
      title: "完成群組權限練習",
      content: "",
      order: 4,
      questions: [
        { id: "demo-q-5", prompt: "完成群組設定", completed: false },
      ],
    },
  ],
  my_deployment: {
    id: "demo-deployment",
    room_id: "demo-linux-permissions",
    vm_request_id: "demo-request",
    vmid: 218,
    status: "running",
    created_at: "2026-07-31T09:00:00+08:00",
    expires_at: "2026-07-31T18:00:00+08:00",
  },
};

const DEMO_RESOURCES = [
  {
    vmid: 218,
    request_id: "demo-request",
    name: "linux-class-student-01",
    status: "running",
    node: "classroom-node",
    type: "qemu",
    can_control: true,
    environment_type: "Course Lab",
    os_info: "Ubuntu 24.04 LTS",
    expiry_date: "2026-07-31",
    ip_address: "10.20.31.18",
  },
];

const DEMO_CLOUD_PATH_DETAIL = {
  id: "demo-cloud-path",
  title: "雲端服務部署",
  description: "從應用程式部署到網路發布的基礎實作。",
  rooms: [{
    id: "demo-cloud-deploy",
    title: "部署第一個 Web 服務",
    description: "準備應用程式、啟動服務並確認對外連線。",
    difficulty: "easy",
    category: "雲端部署",
    has_lab: true,
    order: 1,
    total_questions: 4,
    completed_questions: 0,
    progress_percent: 0,
  }],
};

const DEMO_CLOUD_ROOM_DETAIL = {
  id: "demo-cloud-deploy",
  path_id: "demo-cloud-path",
  title: "部署第一個 Web 服務",
  description: "準備應用程式、啟動服務並確認對外連線。",
  difficulty: "easy",
  category: "雲端部署",
  has_lab: true,
  tasks: [
    { id: "demo-cloud-task-1", title: "確認課堂環境與服務 Port", order: 1, questions: [{ id: "demo-cloud-q-1", completed: false }] },
    { id: "demo-cloud-task-2", title: "啟動 Web 應用程式", order: 2, questions: [{ id: "demo-cloud-q-2", completed: false }] },
    { id: "demo-cloud-task-3", title: "測試服務回應", order: 3, questions: [{ id: "demo-cloud-q-3", completed: false }] },
  ],
  my_deployment: {
    id: "demo-cloud-deployment",
    room_id: "demo-cloud-deploy",
    vm_request_id: "demo-cloud-request",
    vmid: 219,
    status: "stopped",
    created_at: "2026-07-31T13:00:00+08:00",
    expires_at: "2026-07-31T20:00:00+08:00",
  },
};

const DEMO_CLOUD_RESOURCE = {
  vmid: 219,
  request_id: "demo-cloud-request",
  name: "cloud-class-student-01",
  status: "stopped",
  node: "classroom-node",
  type: "qemu",
  can_control: true,
  environment_type: "Course Lab",
  os_info: "Ubuntu 24.04 LTS",
  expiry_date: "2026-07-31",
  ip_address: "10.20.31.19",
};

const DEMO_AI_ASSIGNMENTS = [{
  id: "demo-ai-linux-permissions",
  teaching_class_id: "demo-linux-class",
  teaching_class_name: "Linux 系統管理實務 A 班",
  title: "Linux 權限與使用者設定",
  summary: "老師已核准本次 AI 評分要求；完成課堂操作後會依下列項目檢查。",
  template_key: "linux",
  version: 1,
  approved_at: "2026-08-04T09:00:00+08:00",
  items: [
    {
      id: "permission",
      title: "設定指定目錄權限",
      description: "依題目要求完成擁有者、群組與 chmod 權限設定。",
      detectable: "auto",
      order: 0,
    },
    {
      id: "user-group",
      title: "建立課堂使用者與群組",
      description: "建立指定帳號，並確認帳號已加入正確群組。",
      detectable: "partial",
      order: 1,
    },
    {
      id: "explanation",
      title: "說明權限設計",
      description: "簡短說明這組權限如何符合題目需求。",
      detectable: "manual",
      order: 2,
    },
  ],
}];

const AI_DETECTABLE_META = {
  auto: { label: "可自動檢查", icon: "smart_toy", tone: "auto" },
  partial: { label: "部分自動檢查", icon: "rule", tone: "partial" },
  manual: { label: "老師人工確認", icon: "person_check", tone: "manual" },
};

function getTourStorageKey(user) {
  return `skylab:student-home-tour:v1:${user?.id ?? user?.email ?? "student"}`;
}

function TourOverlay({ stepIndex, onBack, onNext, onSkip }) {
  const [targetRect, setTargetRect] = useState(null);
  const panelRef = useRef(null);
  const step = TOUR_STEPS[stepIndex];
  const isLast = stepIndex === TOUR_STEPS.length - 1;

  useEffect(() => {
    const target = document.querySelector(step.selector);
    if (!target) {
      setTargetRect(null);
      return undefined;
    }

    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "center",
      inline: "nearest",
    });

    const updateRect = () => {
      const rect = target.getBoundingClientRect();
      setTargetRect({
        top: rect.top,
        left: rect.left,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      });
    };

    const timer = window.setTimeout(updateRect, reducedMotion ? 0 : 280);
    updateRect();
    window.addEventListener("resize", updateRect);
    window.addEventListener("scroll", updateRect, true);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", updateRect);
      window.removeEventListener("scroll", updateRect, true);
    };
  }, [step]);

  useEffect(() => {
    panelRef.current?.focus();
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onSkip();
      if (event.key === "ArrowLeft" && stepIndex > 0) onBack();
      if (event.key === "ArrowRight") onNext();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onBack, onNext, onSkip, stepIndex]);

  const panelStyle = useMemo(() => {
    if (!targetRect || typeof window === "undefined") return undefined;
    const panelWidth = Math.min(360, window.innerWidth - 32);
    const estimatedHeight = 250;
    const left = Math.min(
      Math.max(16, targetRect.left),
      Math.max(16, window.innerWidth - panelWidth - 16),
    );
    const hasRoomBelow = window.innerHeight - targetRect.bottom > estimatedHeight + 24;
    const top = hasRoomBelow
      ? targetRect.bottom + 12
      : Math.max(16, targetRect.top - estimatedHeight - 12);
    return { left, top, width: panelWidth };
  }, [targetRect]);

  return (
    <div className={styles.tourLayer}>
      <div className={styles.tourClickBlocker} aria-hidden="true" />
      {targetRect && (
        <div
          className={styles.tourSpotlight}
          style={{
            top: Math.max(8, targetRect.top - 6),
            left: Math.max(8, targetRect.left - 6),
            width: Math.min(
              window.innerWidth - Math.max(8, targetRect.left - 6) - 8,
              targetRect.width + 12,
            ),
            height: targetRect.height + 12,
          }}
          aria-hidden="true"
        />
      )}
      <section
        ref={panelRef}
        className={styles.tourPanel}
        style={panelStyle}
        role="dialog"
        aria-modal="true"
        aria-labelledby="student-tour-title"
        tabIndex={-1}
      >
        <div className={styles.tourPanelTop}>
          <span className={styles.tourIcon}><MIcon name={step.icon} size={22} /></span>
          <span className={styles.tourCount}>{stepIndex + 1} / {TOUR_STEPS.length}</span>
          <button type="button" className={styles.tourClose} onClick={onSkip} aria-label="跳過導覽">
            <MIcon name="close" size={19} />
          </button>
        </div>
        <p className={styles.tourEyebrow}>{step.eyebrow}</p>
        <h2 id="student-tour-title">{step.title}</h2>
        <p className={styles.tourDescription}>{step.description}</p>
        <div className={styles.tourTip}>
          <MIcon name="lightbulb" size={17} />
          <span>{step.tip}</span>
        </div>
        <div className={styles.tourProgress} aria-label={`導覽進度 ${stepIndex + 1} / ${TOUR_STEPS.length}`}>
          {TOUR_STEPS.map((tourStep, index) => (
            <span
              key={tourStep.selector}
              className={index === stepIndex ? styles.tourProgressActive : ""}
            />
          ))}
        </div>
        <div className={styles.tourActions}>
          <button type="button" className={styles.tourSkip} onClick={onSkip}>跳過導覽</button>
          <div>
            {stepIndex > 0 && (
              <button type="button" className={styles.tourBack} onClick={onBack}>
                上一步
              </button>
            )}
            <button type="button" className={styles.tourNext} onClick={onNext}>
              {isLast ? "完成導覽" : "下一步"}
              <MIcon name={isLast ? "check" : "arrow_forward"} size={17} />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function toPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function chooseCurrentPath(paths) {
  return (
    paths.find((path) => toPercent(path.progress_percent) > 0 && toPercent(path.progress_percent) < 100)
    ?? paths.find((path) => toPercent(path.progress_percent) < 100)
    ?? paths[0]
    ?? null
  );
}

function chooseNextRoom(rooms) {
  return (
    rooms.find((room) => toPercent(room.progress_percent) > 0 && toPercent(room.progress_percent) < 100)
    ?? rooms.find((room) => toPercent(room.progress_percent) < 100)
    ?? rooms[0]
    ?? null
  );
}

function taskIsComplete(task) {
  return task.questions?.length > 0 && task.questions.every((question) => question.completed);
}

function isClassResource(resource) {
  const environmentType = resource?.environment_type;
  if (environmentType === "Course Lab") return true;
  return typeof environmentType === "string"
    && /^[A-Za-z0-9_.]+-[A-Za-z0-9_.-]+$/.test(environmentType);
}

function formatExpiry(value) {
  if (!value) return "依課程設定";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("zh-TW", {
    month: "numeric",
    day: "numeric",
    hour: value.includes?.("T") ? "2-digit" : undefined,
    minute: value.includes?.("T") ? "2-digit" : undefined,
  }).format(date);
}

function StatusBadge({ meta }) {
  return (
    <span className={`${styles.statusBadge} ${styles[meta.tone]}`}>
      <MIcon name={meta.icon} size={16} />
      {meta.label}
    </span>
  );
}

function LoadingState() {
  return (
    <div className={styles.loadingState} aria-label="正在整理你的課堂資訊">
      <span className={styles.loadingIcon}><MIcon name="school" size={28} /></span>
      <div>
        <strong>正在整理你的課堂資訊</strong>
        <p>確認課程進度與老師分發的實驗環境中…</p>
      </div>
    </div>
  );
}

const HOME_REMINDERS = [
  {
    id: "resource-expiry",
    icon: "schedule",
    tone: "warning",
    title: "課堂機器即將到期",
    description: "course-web-lab 將於今天 18:00 到期，請先保存需要的檔案。",
    time: "今天 18:00",
    target: "/my-resources",
  },
  {
    id: "request-approved",
    icon: "check_circle",
    tone: "success",
    title: "資源申請已核准",
    description: "你的 research-ubuntu 已建立完成，可以前往我的資源查看。",
    time: "10 分鐘前",
    target: "/my-requests",
  },
  {
    id: "task-due",
    icon: "assignment_late",
    tone: "danger",
    title: "課堂任務明天到期",
    description: "Linux 檔案權限與使用者還有 3 個項目尚未完成。",
    time: "明天 23:59",
    target: "course",
  },
];

function ReminderCenter({ reminders = [], onNavigate }) {
  const [open, setOpen] = useState(false);
  const [readIds, setReadIds] = useState([]);
  const rootRef = useRef(null);
  const unreadCount = reminders.filter((item) => !readIds.includes(item.id)).length;

  useEffect(() => {
    if (reminders.length > 0) return;
    setReadIds([]);
    setOpen(false);
  }, [reminders.length]);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsideClick = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const openReminder = (reminder) => {
    setReadIds((current) => current.includes(reminder.id) ? current : [...current, reminder.id]);
    setOpen(false);
    onNavigate(reminder.target);
  };

  return (
    <div className={styles.reminderCenter} ref={rootRef} data-guide="home-reminders">
      <button
        type="button"
        className={`${styles.reminderButton} ${open ? styles.reminderButtonOpen : ""}`}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <MIcon name="notifications" size={17} />
        <span>提醒</span>
        {unreadCount > 0 && <span className={styles.reminderCount}>{unreadCount}</span>}
      </button>

      {open && (
        <section className={styles.reminderPopover} role="dialog" aria-label="近期提醒">
          <div className={styles.reminderHeader}>
            <div>
              <p className={styles.eyebrow}>近期事項</p>
              <h2>提醒</h2>
            </div>
            <span>{unreadCount > 0 ? `${unreadCount} 則未讀` : "全部已讀"}</span>
          </div>

          <div className={styles.reminderList}>
            {reminders.length === 0 && (
              <div className={styles.reminderEmpty}>
                <MIcon name="notifications_none" size={25} />
                <strong>目前沒有新提醒</strong>
                <span>機器期限、審核結果與任務到期資訊會出現在這裡。</span>
              </div>
            )}
            {reminders.map((reminder) => {
              const unread = !readIds.includes(reminder.id);
              return (
                <button
                  type="button"
                  key={reminder.id}
                  className={`${styles.reminderItem} ${unread ? styles.reminderItemUnread : ""}`}
                  onClick={() => openReminder(reminder)}
                >
                  <span className={`${styles.reminderIcon} ${styles[reminder.tone]}`}>
                    <MIcon name={reminder.icon} size={19} />
                  </span>
                  <span className={styles.reminderContent}>
                    <strong>{reminder.title}</strong>
                    <small>{reminder.description}</small>
                    <time>{reminder.time}</time>
                  </span>
                  {unread && <span className={styles.unreadDot} aria-label="未讀" />}
                  <MIcon name="chevron_right" size={18} />
                </button>
              );
            })}
          </div>

          <button
            type="button"
            className={styles.reminderFooter}
            onClick={() => setReadIds(reminders.map((item) => item.id))}
            disabled={unreadCount === 0}
          >
            全部標為已讀
            <MIcon name="done_all" size={17} />
          </button>
        </section>
      )}
    </div>
  );
}

export default function StudentHomeNewPage({ courseView = false }) {
  const navigate = useNavigate();
  const { pathId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const guideDemoActive = useGuideDemo("student-home");
  const demoMode = searchParams.get("demo") === "class";
  const [view, setView] = useState({
    loading: true,
    hasError: false,
    paths: [],
    resources: [],
    activePath: null,
    pathDetail: null,
    roomDetail: null,
    aiAssignments: [],
  });
  const [quickTemplates, setQuickTemplates] = useState([]);
  const [templatesLoading, setTemplatesLoading] = useState(!courseView);

  const firstName = user?.full_name?.trim()?.split(/\s+/)[0]
    ?? user?.email?.split("@")[0]
    ?? "同學";

  const todayLabel = useMemo(
    () => new Intl.DateTimeFormat("zh-TW", {
      month: "long",
      day: "numeric",
      weekday: "long",
    }).format(new Date()),
    [],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadStudentHome() {
      if (demoMode) {
        const demoPaths = createDemoPaths();
        const selectedPath = courseView
          ? demoPaths.find((path) => path.id === pathId) ?? demoPaths[0]
          : demoPaths[0];
        const cloudCourse = selectedPath.id === "demo-cloud-path";
        setView({
          loading: false,
          hasError: false,
          paths: demoPaths,
          resources: cloudCourse ? [...DEMO_RESOURCES, DEMO_CLOUD_RESOURCE] : DEMO_RESOURCES,
          activePath: selectedPath,
          pathDetail: cloudCourse ? DEMO_CLOUD_PATH_DETAIL : DEMO_PATH_DETAIL,
          roomDetail: {
            ...(cloudCourse ? DEMO_CLOUD_ROOM_DETAIL : DEMO_ROOM_DETAIL),
            my_deployment: {
              ...(cloudCourse ? DEMO_CLOUD_ROOM_DETAIL.my_deployment : DEMO_ROOM_DETAIL.my_deployment),
              expires_at: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
            },
          },
          aiAssignments: courseView && !cloudCourse ? DEMO_AI_ASSIGNMENTS : [],
        });
        return;
      }

      const [pathsResult, resourcesResult] = await Promise.allSettled([
        CoursesService.listPaths(),
        ResourcesService.list(),
      ]);

      if (cancelled) return;

      const paths = pathsResult.status === "fulfilled" && Array.isArray(pathsResult.value)
        ? pathsResult.value
        : [];
      const resources = resourcesResult.status === "fulfilled" && Array.isArray(resourcesResult.value)
        ? resourcesResult.value
        : [];
      const activePath = courseView && pathId
        ? paths.find((path) => String(path.id) === String(pathId)) ?? chooseCurrentPath(paths)
        : chooseCurrentPath(paths);
      let pathDetail = null;
      let roomDetail = null;
      let aiAssignments = [];

      if (activePath) {
        const [pathDetailResult, aiAssignmentsResult] = await Promise.allSettled([
          CoursesService.getPath(activePath.id),
          courseView ? CoursesService.getAiAssignments(activePath.id) : Promise.resolve([]),
        ]);
        if (pathDetailResult.status === "fulfilled") {
          pathDetail = pathDetailResult.value;
          const nextRoom = chooseNextRoom(pathDetail?.rooms ?? []);
          if (nextRoom) {
            try {
              roomDetail = await CoursesService.getRoom(nextRoom.id);
            } catch {
              roomDetail = null;
            }
          }
        }
        aiAssignments = aiAssignmentsResult.status === "fulfilled"
          && Array.isArray(aiAssignmentsResult.value)
          ? aiAssignmentsResult.value
          : [];
      }

      if (!cancelled) {
        setView({
          loading: false,
          hasError: pathsResult.status === "rejected" && resourcesResult.status === "rejected",
          paths,
          resources,
          activePath,
          pathDetail,
          roomDetail,
          aiAssignments,
        });
      }
    }

    loadStudentHome();
    return () => {
      cancelled = true;
    };
  }, [courseView, demoMode, pathId]);

  useEffect(() => {
    if (courseView) return undefined;
    const controller = new AbortController();
    setTemplatesLoading(true);
    TemplatesService.list({ signal: controller.signal })
      .then((response) => {
        const available = (response?.data ?? []).filter(
          (template) => template.resource_type === "lxc"
            && template.status === "ready"
            && template.pve_exists !== false,
        );
        setQuickTemplates(available.slice(0, 3));
      })
      .catch((error) => {
        if (!error?.cancelled) setQuickTemplates([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setTemplatesLoading(false);
      });
    return () => controller.abort();
  }, [courseView]);

  const nextRoom = chooseNextRoom(view.pathDetail?.rooms ?? []);
  const roomProgress = toPercent(nextRoom?.progress_percent);
  const deployment = view.roomDetail?.my_deployment;
  const matchedResource = view.resources.find(
    (resource) => deployment?.vmid && resource.vmid === deployment.vmid,
  ) ?? view.resources.find(
    (resource) => isClassResource(resource) && resource.status === "running",
  ) ?? view.resources.find(isClassResource) ?? null;

  let environmentStatus = deployment?.status;
  if (!environmentStatus && view.roomDetail && !view.roomDetail.has_lab) {
    environmentStatus = "no_lab";
  } else if (!environmentStatus && matchedResource?.status === "running") {
    environmentStatus = "running";
  } else if (!environmentStatus && matchedResource?.status === "stopped") {
    environmentStatus = "stopped";
  } else if (!environmentStatus && nextRoom) {
    environmentStatus = nextRoom.has_lab ? "not_started" : "no_lab";
  } else if (!environmentStatus) {
    environmentStatus = "empty";
  }
  const statusMeta = STATUS_META[environmentStatus] ?? STATUS_META.not_started;

  const roomTasks = view.roomDetail?.tasks ?? [];
  const aiAssignments = view.aiAssignments ?? [];
  const aiRequirementCount = aiAssignments.reduce(
    (count, assignment) => count + (assignment.items?.length ?? 0),
    0,
  );
  const displayedQuickTemplates = quickTemplates;
  const firstIncompleteTask = roomTasks.findIndex((task) => !taskIsComplete(task));
  const primaryTarget = nextRoom ? `/courses/rooms/${nextRoom.id}` : "/courses";
  const primaryLabel = nextRoom ? "開始練習" : "查看可用課程";
  const currentSchedule = view.activePath?.schedule;
  const heroStatusMeta = view.activePath
    ? currentSchedule?.state === "now"
      ? { label: "正在上課", tone: "success", icon: "sensors" }
      : { label: "可以開始", tone: "success", icon: "play_circle" }
    : STATUS_META.empty;

  const toggleDemoMode = () => {
    const nextParams = new URLSearchParams(searchParams);
    if (demoMode) nextParams.delete("demo");
    else nextParams.set("demo", "class");
    setSearchParams(nextParams, { replace: true });
  };

  const openPrimaryTarget = () => {
    if (demoMode) {
      toast.info(`Demo：開始「${nextRoom?.title ?? view.activePath?.title ?? "課堂任務"}」練習`);
      return;
    }
    navigate(primaryTarget);
  };

  const openDemoAwarePage = (target, message) => {
    if (demoMode) {
      toast.info(message);
      return;
    }
    navigate(target);
  };

  const openCourseOverview = (path = view.activePath) => {
    if (!path) {
      navigate("/courses");
      return;
    }
    navigate(`/dashboard-new/course/${path.id}${demoMode ? "?demo=class" : ""}`);
  };

  const openReminderTarget = (target) => {
    if (target === "course") {
      openCourseOverview(view.activePath);
      return;
    }
    navigate(target);
  };

  if (view.loading) {
    return (
      <div className={styles.page}>
        <LoadingState />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {courseView && (
        <header className={styles.coursePageHeader}>
          <button
            type="button"
            className={styles.courseBackButton}
            onClick={() => navigate(`/dashboard-new${demoMode ? "?demo=class" : ""}`)}
          >
            <MIcon name="arrow_back" size={18} />
            返回今日課表
          </button>
          <div className={styles.coursePageTitle}>
            <p className={styles.eyebrow}>課程總覽</p>
            <h1>{view.activePath?.title ?? "課程"}</h1>
            <p>{view.activePath?.description ?? "查看今天的環境與任務。"}</p>
          </div>
          {demoMode && <span className={styles.previewBadge}><MIcon name="science" size={16} />模擬課程</span>}
        </header>
      )}

      {view.hasError && (
        <div className={styles.notice} role="status">
          <MIcon name="cloud_off" size={20} />
          <div>
            <strong>暫時無法取得最新資訊</strong>
            <span>你仍可直接前往課程或我的資源查看。</span>
          </div>
        </div>
      )}

      {!courseView && (
        <>
          <section className={styles.todaySchedule} aria-labelledby="today-schedule-title" data-guide="home-schedule">
            <div className={styles.scheduleHeading}>
              <div>
                <p className={styles.eyebrow}>今日課表</p>
                <h2 id="today-schedule-title">
                  {view.paths.length > 0 ? `目前有 ${view.paths.length} 堂課` : "目前沒有課程"}
                </h2>
              </div>
              <div className={styles.scheduleActions}>
                {view.paths.some((path) => path.schedule?.state === "now") && <span>有一堂正在進行</span>}
                <ReminderCenter reminders={guideDemoActive ? HOME_REMINDERS : []} onNavigate={openReminderTarget} />
              </div>
            </div>
            {view.paths.length > 0 ? (
            <div className={styles.scheduleGrid}>
              {view.paths.map((path, index) => (
                <button
                  type="button"
                  key={path.id}
                  className={`${styles.scheduleCard} ${path.schedule?.state === "now" ? styles.scheduleCardNow : ""}`}
                  onClick={() => openCourseOverview(path)}
                >
                  <div className={styles.scheduleOrder}>{index + 1}</div>
                  <div className={styles.scheduleContent}>
                    <div className={styles.scheduleTopline}>
                      <span className={`${styles.scheduleState} ${path.schedule?.state === "now" ? styles.scheduleStateNow : ""}`}>
                        {path.schedule?.state === "now" && <span className={styles.liveDot} />}
                        {path.schedule?.label ?? "可繼續學習"}
                      </span>
                      {path.schedule?.time && <span>{path.schedule.time}</span>}
                    </div>
                    <h3>{path.title}</h3>
                    <p>{path.description}</p>
                    {(path.schedule?.teacher || path.schedule?.place) && (
                      <div className={styles.scheduleMeta}>
                        {path.schedule?.teacher && <span><MIcon name="person" size={15} />{path.schedule.teacher}</span>}
                        {path.schedule?.place && <span><MIcon name="location_on" size={15} />{path.schedule.place}</span>}
                      </div>
                    )}
                  </div>
                  {path.schedule?.state === "now" ? (
                    <span className={styles.currentCourseArrow}><MIcon name="arrow_forward" size={19} /></span>
                  ) : (
                    <span className={styles.laterCourseIcon}><MIcon name="schedule" size={19} /></span>
                  )}
                </button>
              ))}
            </div>
            ) : (
              <div className={styles.courseEmptyState}>
                <span><MIcon name="school" size={25} /></span>
                <div>
                  <strong>老師還沒有發布可使用的課程</strong>
                  <p>課程發布後會直接出現在這裡，不需要另外申請上課機器。</p>
                </div>
              </div>
            )}
          </section>

        </>
      )}

      {courseView && (
        <>
      <main className={styles.mainGrid}>
        <section className={styles.classCard} aria-labelledby="today-class-title" data-student-tour="class" data-guide="home-current-course">
          <div className={styles.classCardTop}>
            <div>
              <p className={styles.eyebrow}>{currentSchedule?.state === "now" ? "現在正在進行" : "接下來可以練習"}</p>
              <h2 id="today-class-title">
                {view.activePath?.title ?? "目前沒有可開始的課程"}
              </h2>
              <p className={styles.classDescription}>
                {nextRoom
                  ? `這堂課要做：${nextRoom.title}`
                  : view.activePath?.description
                    ?? "老師發布內容後，這裡會直接告訴你現在要做什麼。"}
              </p>
            </div>
            <StatusBadge meta={heroStatusMeta} />
          </div>

          {view.activePath ? (
            <>
              <div className={styles.courseContext}>
                {currentSchedule ? (
                  <>
                    <span><MIcon name="schedule" size={18} />{currentSchedule.time}</span>
                    <span><MIcon name="person" size={18} />{currentSchedule.teacher}</span>
                    <span><MIcon name="location_on" size={18} />{currentSchedule.place}</span>
                  </>
                ) : (
                  <span><MIcon name="task_alt" size={18} />任務進度 {roomProgress}%</span>
                )}
              </div>

              <div className={styles.progressTrack} aria-label={`章節進度 ${roomProgress}%`} data-guide="home-progress">
                <span style={{ width: `${roomProgress}%` }} />
              </div>

              <div className={styles.simpleCourseHint}>
                <MIcon name="check_circle" size={18} />
                <span>
                  {environmentStatus === "running" || environmentStatus === "no_lab"
                    ? "練習內容已可使用，直接開始即可。"
                    : "開始後系統會自動準備需要的內容。"}
                </span>
              </div>
            </>
          ) : (
            <div className={styles.emptyClass}>
              <MIcon name="event_available" size={28} />
              <div>
                <strong>目前沒有待完成的課程</strong>
                <p>可以先查看所有課程，或等待老師發布今天的內容。</p>
              </div>
            </div>
          )}

          <div className={styles.primaryActions}>
            <button type="button" className={styles.primaryButton} onClick={openPrimaryTarget} data-guide="home-start">
              {primaryLabel}
              <MIcon name="arrow_forward" size={18} />
            </button>
            <button
              type="button"
              className={styles.textButton}
              onClick={() => openDemoAwarePage("/courses", "Demo：將顯示學生可使用的所有課程")}
            >
              查看全部課程
            </button>
          </div>
        </section>

        <aside className={styles.environmentCard} aria-labelledby="environment-title" data-student-tour="environment" data-guide="home-environment">
          <div className={styles.cardHeading}>
            <span className={styles.iconBox}><MIcon name="computer" size={22} /></span>
            <div>
              <p className={styles.eyebrow}>今天的上課環境</p>
              <h2 id="environment-title">{matchedResource?.name ?? "等待課堂環境"}</h2>
            </div>
          </div>

          <dl className={styles.environmentDetails}>
            <div>
              <dt>狀態</dt>
              <dd><span className={`${styles.statusDot} ${styles[statusMeta.tone]}`} />{statusMeta.label}</dd>
            </div>
            <div>
              <dt>作業系統</dt>
              <dd>{matchedResource?.os_info ?? (nextRoom?.has_lab ? "依課程模板" : "不需要")}</dd>
            </div>
            <div>
              <dt>IP 位址</dt>
              <dd>{matchedResource?.ip_address ?? "進入課堂後顯示"}</dd>
            </div>
            <div>
              <dt>可使用至</dt>
              <dd>{formatExpiry(deployment?.expires_at ?? matchedResource?.expiry_date)}</dd>
            </div>
          </dl>

          <div className={styles.teacherNote}>
            <MIcon name="info" size={18} />
            <p>
              {nextRoom?.has_lab
                ? "課堂環境由老師與課程設定準備，不需要另外填申請單。"
                : "這個章節可直接開始，不需要啟動實驗機。"}
            </p>
          </div>

          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => openDemoAwarePage("/my-resources", "Demo：將開啟老師分發的課堂機器")}
          >
            查看我的所有資源
            <MIcon name="chevron_right" size={18} />
          </button>
        </aside>
      </main>

      <section className={styles.taskSection} aria-labelledby="task-title" data-student-tour="tasks" data-guide="home-tasks">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>進入課堂後照順序完成</p>
            <h2 id="task-title">今天的任務</h2>
          </div>
          {roomTasks.length > 0 && <span>{roomTasks.filter(taskIsComplete).length} / {roomTasks.length} 已完成</span>}
        </div>

        {roomTasks.length > 0 ? (
          <div className={styles.taskList}>
            {roomTasks.slice(0, 4).map((task, index) => {
              const complete = taskIsComplete(task);
              const current = !complete && index === firstIncompleteTask;
              return (
                <button
                  type="button"
                  className={`${styles.taskItem} ${complete ? styles.taskDone : ""} ${current ? styles.taskCurrent : ""}`}
                  key={task.id}
                  onClick={openPrimaryTarget}
                >
                  <span className={styles.taskNumber}>
                    {complete ? <MIcon name="check" size={17} /> : index + 1}
                  </span>
                  <div>
                    <strong>{task.title}</strong>
                    <small>
                      {complete
                        ? "已完成"
                        : current
                          ? "建議從這裡繼續"
                          : `${task.questions?.length ?? 0} 個檢查項目`}
                    </small>
                  </div>
                  {current && <span className={styles.currentLabel}>下一步</span>}
                  <MIcon name="chevron_right" size={20} />
                </button>
              );
            })}
          </div>
        ) : (
          <div className={styles.taskEmpty}>
            <MIcon name="checklist" size={24} />
            <div>
              <strong>{nextRoom ? "進入課堂查看完整任務" : "目前沒有課堂任務"}</strong>
              <p>{nextRoom ? "教材與作答內容會集中在課堂頁面，不需要到處尋找。" : "老師發布後會自動出現在這裡。"}</p>
            </div>
            {nextRoom && (
              <button type="button" className={styles.textButton} onClick={openPrimaryTarget}>
                查看任務
              </button>
            )}
          </div>
        )}
      </section>

      <section
        className={styles.aiAssignmentSection}
        aria-labelledby="ai-assignment-title"
        data-guide="course-ai-assignments"
      >
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>老師已核准 · AI 協助檢查</p>
            <h2 id="ai-assignment-title">AI 評分任務</h2>
          </div>
          {aiRequirementCount > 0 && <span>共 {aiRequirementCount} 個評分項目</span>}
        </div>

        {aiAssignments.length > 0 ? (
          <div className={styles.aiAssignmentList}>
            {aiAssignments.map((assignment) => (
              <article className={styles.aiAssignmentCard} key={assignment.id}>
                <header className={styles.aiAssignmentHeader}>
                  <span className={styles.aiAssignmentIcon}>
                    <MIcon name="fact_check" size={22} />
                  </span>
                  <div>
                    <h3>{assignment.title}</h3>
                    <p>{assignment.teaching_class_name} · 第 {assignment.version} 版</p>
                  </div>
                  <span className={styles.approvedBadge}>
                    <MIcon name="verified" size={15} />已核准
                  </span>
                </header>

                {assignment.summary && (
                  <p className={styles.aiAssignmentSummary}>{assignment.summary}</p>
                )}

                <ol className={styles.aiRequirementList}>
                  {(assignment.items ?? []).map((item, index) => {
                    const detectableMeta = AI_DETECTABLE_META[item.detectable]
                      ?? AI_DETECTABLE_META.manual;
                    return (
                      <li className={styles.aiRequirementItem} key={item.id}>
                        <span className={styles.aiRequirementNumber}>{index + 1}</span>
                        <div className={styles.aiRequirementContent}>
                          <strong>{item.title}</strong>
                          {item.description && <p>{item.description}</p>}
                        </div>
                        <span className={`${styles.aiCheckBadge} ${styles[detectableMeta.tone]}`}>
                          <MIcon name={detectableMeta.icon} size={15} />
                          {detectableMeta.label}
                        </span>
                      </li>
                    );
                  })}
                </ol>

                <footer className={styles.aiAssignmentFoot}>
                  <MIcon name="info" size={16} />
                  完成課堂操作後，老師執行檢查時會依這些項目評分。
                </footer>
              </article>
            ))}
          </div>
        ) : (
          <div className={styles.aiAssignmentEmpty}>
            <span><MIcon name="fact_check" size={24} /></span>
            <div>
              <strong>老師尚未發布 AI 評分任務</strong>
              <p>老師核准評分內容後，檢查項目會自動出現在這裡。</p>
            </div>
          </div>
        )}
      </section>
        </>
      )}

      {!courseView && (
      <section className={styles.otherNeeds} aria-labelledby="other-needs-title" data-guide="home-other-needs">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>不是現在要上課？</p>
            <h2 id="other-needs-title">其他使用情境</h2>
          </div>
        </div>

        <div className={styles.needGrid}>
          <article className={styles.needCard} data-student-tour="practice">
            <span className={`${styles.needIcon} ${styles.violet}`}><MIcon name="history" size={22} /></span>
            <div>
              <span className={styles.needBadge}>下課後練習 · 沿用原環境</span>
              <h3>繼續上次的課堂進度</h3>
              <p>回到相同課程與機器，任務、檔案及作答進度都會保留。</p>
            </div>
            <button type="button" className={styles.secondaryButton} onClick={() => openCourseOverview()}>
              繼續練習
              <MIcon name="arrow_forward" size={18} />
            </button>
          </article>

          <article className={`${styles.needCard} ${styles.researchCard}`} data-student-tour="research">
            <span className={`${styles.needIcon} ${styles.amber}`}><MIcon name="science" size={22} /></span>
            <div>
              <span className={`${styles.needBadge} ${styles.waiting}`}>自主研究 · 需要申請</span>
              <h3>建立自己的研究環境</h3>
              <p>適合專題、開發或實驗需求；這個入口先保留，申請流程將再持續優化。</p>
            </div>
            <button type="button" className={styles.secondaryButton} onClick={() => navigate("/my-requests")}>
              前往我的申請
              <MIcon name="arrow_forward" size={18} />
            </button>
          </article>
        </div>

        <section className={styles.quickTemplateSection} aria-labelledby="quick-template-title" data-guide="home-quick-templates">
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>免等待人工審核</p>
              <h2 id="quick-template-title">快速練習環境</h2>
            </div>
            <span>選一個輕量容器，填名稱與密碼就能開始</span>
          </div>

          {templatesLoading ? (
            <div className={styles.quickTemplateGrid} aria-label="正在載入快速模板">
              {[0, 1, 2].map((item) => <div key={item} className={styles.quickTemplateSkeleton} />)}
            </div>
          ) : displayedQuickTemplates.length > 0 ? (
            <div className={dashboardStyles.templateGrid}>
              {displayedQuickTemplates.map((template) => (
                <button
                  type="button"
                  key={template.id}
                  className={dashboardStyles.templateCard}
                  style={{ "--accent-color": "#5471bf" }}
                  onClick={() => {
                    if (template._demo) {
                      toast.info(`展示模板「${template.name}」：正式模板發布後可直接建立容器`);
                      return;
                    }
                    navigate(`/quick-template/${template.id}`, { state: { from: "/dashboard-new" } });
                  }}
                >
                  <div className={dashboardStyles.templateHeader}>
                    <span className={dashboardStyles.templateLogo}><MIcon name="layers" size={22} /></span>
                    <span className={dashboardStyles.templateCategoryChip}>
                      {template._demo ? "展示模板" : "免人工審核"}
                    </span>
                  </div>
                  <div className={dashboardStyles.templateBody}>
                    <h4 className={dashboardStyles.templateName}>{template.name}</h4>
                    <p className={dashboardStyles.templateDesc}>
                      {template.description || "由範本快速建立，適合臨時練習、指令測試與輕量開發。"}
                    </p>
                  </div>
                  <div className={dashboardStyles.templateFooter}>
                    <span className={dashboardStyles.templateAction}>
                      立即建立
                      <MIcon name="arrow_forward" size={14} />
                    </span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className={styles.quickTemplateEmpty}>
              <span><MIcon name="inventory_2" size={23} /></span>
              <div>
                <strong>目前沒有可快速建立的模板</strong>
                <p>老師或管理員發布輕量容器模板後，就會顯示在這裡。</p>
              </div>
            </div>
          )}
        </section>
      </section>
      )}

    </div>
  );
}
