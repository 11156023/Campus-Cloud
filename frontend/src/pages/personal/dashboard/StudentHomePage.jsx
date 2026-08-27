import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import MIcon from "../../../components/MIcon";
import TerminalDialog from "../resources/TerminalDialog";
import VncDialog from "../resources/VncDialog";
import { CoursesService } from "../../../services/courses";
import { ResourcesService } from "../../../services/resources";
import { TemplatesService } from "../../../services/templates";
import styles from "./StudentHomePage.module.scss";

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
    selector: '[data-student-tour="tasks"]',
    icon: "checklist",
    eyebrow: "課堂任務",
    title: "完成任務後交給 AI 檢查",
    description: "這裡會列出截至今天老師已發布的任務。展開任務可以先看 AI 整理的要求，完成後直接送出 AI Check。",
    tip: "AI 回覆會保留在同一列，方便你依照每一項建議修正後再次送檢。",
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

const AI_DETECTABLE_META = {
  auto: { label: "可自動檢查", icon: "smart_toy", tone: "auto" },
  partial: { label: "部分自動檢查", icon: "rule", tone: "partial" },
  manual: { label: "老師人工確認", icon: "person_check", tone: "manual" },
};

const AI_CHECK_STATUS_META = {
  pending: { label: "等待 AI Check", icon: "hourglass_top", tone: "pending" },
  running: { label: "AI 檢查中", icon: "sync", tone: "running" },
  completed: { label: "已收到 AI 回覆", icon: "task_alt", tone: "completed" },
  failed: { label: "檢查失敗", icon: "error_outline", tone: "failed" },
  cancelled: { label: "已取消", icon: "block", tone: "cancelled" },
};

export function assignmentsUntilToday(assignments, now = new Date()) {
  const dateKey = (value) => {
    const parts = new Intl.DateTimeFormat("en", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(value);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  };
  const todayKey = dateKey(now);
  return [...(assignments ?? [])]
    .filter((assignment) => {
      if (!assignment?.approved_at) return true;
      const approvedAt = new Date(assignment.approved_at);
      return !Number.isNaN(approvedAt.getTime()) && dateKey(approvedAt) <= todayKey;
    })
    .sort((left, right) => {
      const leftTime = left.approved_at ? new Date(left.approved_at).getTime() : 0;
      const rightTime = right.approved_at ? new Date(right.approved_at).getTime() : 0;
      return leftTime - rightTime;
    });
}

function formatAssignmentDate(value) {
  if (!value) return "已發布";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "已發布";
  return new Intl.DateTimeFormat("zh-TW", {
    month: "numeric",
    day: "numeric",
  }).format(date);
}

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

export function buildPracticeMachines(classMachines, resources, deployment, roomTitle) {
  const machines = (classMachines ?? []).map((machine) => {
    const resource = (resources ?? []).find(
      (item) => machine.vmid != null && Number(item.vmid) === Number(machine.vmid),
    );
    return {
      ...machine,
      ...resource,
      classMachineName: machine.name,
      classMachineRole: machine.role,
      type: resource?.type ?? machine.resource_type,
      name: resource?.name ?? machine.name,
    };
  });

  if (machines.length === 0 && deployment?.vmid) {
    const fallbackResource = (resources ?? []).find(
      (resource) => Number(resource.vmid) === Number(deployment.vmid),
    );
    machines.push({
      ...fallbackResource,
      vmid: deployment.vmid,
      status: fallbackResource?.status ?? deployment.status,
      type: fallbackResource?.type ?? "qemu",
      name: fallbackResource?.name ?? roomTitle ?? "課堂練習機",
      classMachineName: roomTitle ?? "課堂練習機",
      classMachineRole: "本章節練習環境",
    });
  }

  return machines;
}

export function practiceMachineActionLabel(machine, openingMachineId = null) {
  if (machine?.vmid == null) return "環境配置中";
  if (openingMachineId === machine.vmid) return "確認狀態中…";
  if (machine.status === "running") return "直接開啟";
  return "等待自動開機";
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

function formatScheduleTime(value) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(parsed);
}

function normalizeSchedule(row) {
  return {
    ...row,
    schedule: {
      state: row.state,
      label: row.label,
      time: `${formatScheduleTime(row.start_at)}–${formatScheduleTime(row.end_at)}`,
      teacher: row.teacher,
      place: row.location,
    },
  };
}

export default function StudentHomePage({ courseView = false }) {
  const navigate = useNavigate();
  const { pathId } = useParams();
  const [view, setView] = useState({
    loading: true,
    hasError: false,
    paths: [],
    resources: [],
    activePath: null,
    pathDetail: null,
    roomDetail: null,
    aiAssignments: [],
    practiceMachines: [],
  });
  const [quickTemplates, setQuickTemplates] = useState([]);
  const [templatesLoading, setTemplatesLoading] = useState(!courseView);
  const [expandedAssignmentId, setExpandedAssignmentId] = useState(null);
  const [assignmentChecks, setAssignmentChecks] = useState({});
  const [checkingAssignmentId, setCheckingAssignmentId] = useState(null);
  const [machinePickerOpen, setMachinePickerOpen] = useState(false);
  const [activePracticeResource, setActivePracticeResource] = useState(null);
  const [openingMachineId, setOpeningMachineId] = useState(null);

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
      const [pathsResult, resourcesResult, scheduleResult] = await Promise.allSettled([
        CoursesService.listPaths(),
        ResourcesService.list(),
        CoursesService.listSchedule(),
      ]);

      if (cancelled) return;

      const catalogPaths = pathsResult.status === "fulfilled" && Array.isArray(pathsResult.value)
        ? pathsResult.value
        : [];
      const schedulePaths = scheduleResult.status === "fulfilled" && Array.isArray(scheduleResult.value)
        ? scheduleResult.value.map(normalizeSchedule)
        : [];
      const paths = courseView ? catalogPaths : schedulePaths;
      const resources = resourcesResult.status === "fulfilled" && Array.isArray(resourcesResult.value)
        ? resourcesResult.value
        : [];
      let activePath = courseView && pathId
        ? catalogPaths.find((path) => String(path.id) === String(pathId)) ?? chooseCurrentPath(catalogPaths)
        : chooseCurrentPath(paths);
      const scheduledVersion = schedulePaths.find((path) => String(path.id) === String(activePath?.id));
      if (activePath && scheduledVersion) activePath = { ...activePath, schedule: scheduledVersion.schedule };
      let pathDetail = null;
      let roomDetail = null;
      let aiAssignments = [];
      let practiceMachines = [];

      if (activePath) {
        const [pathDetailResult, aiAssignmentsResult, practiceMachinesResult] = await Promise.allSettled([
          CoursesService.getPath(activePath.id),
          courseView ? CoursesService.getAiAssignments(activePath.id) : Promise.resolve([]),
          CoursesService.getPracticeMachines(activePath.id),
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
        practiceMachines = practiceMachinesResult.status === "fulfilled"
          && Array.isArray(practiceMachinesResult.value)
          ? practiceMachinesResult.value
          : [];
      }

      if (!cancelled) {
        setView({
          loading: false,
          hasError: courseView
            ? pathsResult.status === "rejected" && resourcesResult.status === "rejected"
            : scheduleResult.status === "rejected",
          paths,
          resources,
          activePath,
          pathDetail,
          roomDetail,
          aiAssignments,
          practiceMachines,
        });
      }
    }

    loadStudentHome();
    return () => {
      cancelled = true;
    };
  }, [courseView, pathId]);

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

  useEffect(() => {
    if (!courseView || !view.activePath?.id) return undefined;
    const activeChecks = assignmentsUntilToday(view.aiAssignments)
      .map((assignment) => [
        String(assignment.id),
        assignmentChecks[assignment.id] ?? assignment.latest_check,
      ])
      .filter(([, check]) => check?.status === "pending" || check?.status === "running");
    if (activeChecks.length === 0) return undefined;

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const updates = await Promise.all(activeChecks.map(async ([assignmentId, check]) => {
        try {
          const nextCheck = await CoursesService.getAiCheck(
            view.activePath.id,
            assignmentId,
            check.run_id,
          );
          return [assignmentId, nextCheck];
        } catch {
          return null;
        }
      }));
      if (cancelled) return;
      setAssignmentChecks((current) => {
        const next = { ...current };
        updates.filter(Boolean).forEach(([assignmentId, check]) => {
          next[assignmentId] = check;
        });
        return next;
      });
    }, 2500);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [assignmentChecks, courseView, view.activePath?.id, view.aiAssignments]);

  const nextRoom = chooseNextRoom(view.pathDetail?.rooms ?? []);
  const roomProgress = toPercent(nextRoom?.progress_percent);
  const deployment = view.roomDetail?.my_deployment;
  const practiceMachines = buildPracticeMachines(
    view.practiceMachines,
    view.resources,
    deployment,
    view.roomDetail?.title,
  );
  const aiAssignments = assignmentsUntilToday(view.aiAssignments);
  const aiRequirementCount = aiAssignments.reduce(
    (count, assignment) => count + (assignment.items?.length ?? 0),
    0,
  );
  const displayedQuickTemplates = quickTemplates;
  const primaryTarget = nextRoom ? `/courses/rooms/${nextRoom.id}` : "/courses";
  const primaryLabel = nextRoom ? "開始練習" : "查看可用課程";
  const currentSchedule = view.activePath?.schedule;
  const heroStatusMeta = view.activePath
    ? currentSchedule?.state === "now"
      ? { label: "正在上課", tone: "success", icon: "sensors" }
      : { label: "可以開始", tone: "success", icon: "play_circle" }
    : STATUS_META.empty;

  const openPracticeMachine = async (machine) => {
    if (!machine?.vmid) {
      toast.error("這台課堂機器尚未建立完成");
      return;
    }
    setOpeningMachineId(machine.vmid);
    let resource = machine;
    try {
      if (resource.status !== "running") {
        resource = await ResourcesService.get(resource.vmid);
      }
      if (resource.status !== "running") {
        toast.info("課堂機器會依上課時間自動開機，目前尚未就緒");
        return;
      }
      setActivePracticeResource({ ...machine, ...resource });
      setMachinePickerOpen(false);
    } catch (error) {
      toast.error(error?.message ?? "無法開啟課堂機器");
    } finally {
      setOpeningMachineId(null);
    }
  };

  const openPrimaryTarget = () => {
    if (practiceMachines.length === 1) {
      openPracticeMachine(practiceMachines[0]);
      return;
    }
    if (practiceMachines.length > 1) {
      setMachinePickerOpen((current) => !current);
      return;
    }
    navigate(primaryTarget);
  };

  const openCourseOverview = (path = view.activePath) => {
    if (!path) {
      navigate("/courses");
      return;
    }
    navigate(`/dashboard-new/course/${path.id}`);
  };

  const toggleAssignment = (assignmentId) => {
    setExpandedAssignmentId((current) => current === assignmentId ? null : assignmentId);
  };

  const submitAiCheck = async (assignment) => {
    if (checkingAssignmentId) return;
    setCheckingAssignmentId(assignment.id);
    setExpandedAssignmentId(assignment.id);
    try {
      const check = await CoursesService.startAiCheck(
        view.activePath.id,
        assignment.id,
      );
      setAssignmentChecks((current) => ({ ...current, [assignment.id]: check }));
      toast.success(check.status === "completed" ? "AI Check 已完成" : "已送出，AI 正在檢查你的課堂環境");
    } catch (error) {
      toast.error(error?.message ?? "目前無法送出 AI Check");
    } finally {
      setCheckingAssignmentId(null);
    }
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
            onClick={() => navigate("/dashboard-new")}
          >
            <MIcon name="arrow_back" size={18} />
            返回今日課表
          </button>
          <div className={styles.coursePageTitle}>
            <p className={styles.eyebrow}>課程總覽</p>
            <h1>{view.activePath?.title ?? "課程"}</h1>
            <p>{view.activePath?.description ?? "查看今天的環境與任務。"}</p>
          </div>
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
                <p className={styles.eyebrow}>今日課表 · {todayLabel}</p>
                <h2 id="today-schedule-title">
                  {view.paths.length > 0 ? `目前有 ${view.paths.length} 堂課` : "目前沒有課程"}
                </h2>
              </div>
              <div className={styles.scheduleActions}>
                {view.paths.some((path) => path.schedule?.state === "now") && <span>有一堂正在進行</span>}
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
                  {deployment?.status === "running" || !nextRoom?.has_lab
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
              {practiceMachines.length > 1 ? `開始練習 · ${practiceMachines.length} 台機器` : primaryLabel}
              <MIcon name="arrow_forward" size={18} />
            </button>
          </div>

          {machinePickerOpen && practiceMachines.length > 1 && (
            <section className={styles.machinePicker} aria-label="選擇練習機器">
              <header>
                <div><strong>這個課程需要操作多台機器</strong><span>依照任務步驟選擇要開啟的角色，完成後可隨時切換。</span></div>
                <button type="button" onClick={() => setMachinePickerOpen(false)} aria-label="關閉機器選擇">
                  <MIcon name="close" size={18} />
                </button>
              </header>
              <div className={styles.machineGrid}>
                {practiceMachines.map((machine) => (
                  <button
                    type="button"
                    key={machine.machine_node_id ?? `${machine.teaching_class_id ?? "course"}-${machine.vmid}`}
                    className={styles.machineOption}
                    onClick={() => openPracticeMachine(machine)}
                    disabled={openingMachineId !== null || machine.vmid == null}
                  >
                    <span className={styles.machineIcon}><MIcon name={machine.type === "lxc" ? "terminal" : "desktop_windows"} size={22} /></span>
                    <span className={styles.machineCopy}>
                      <strong>{machine.classMachineName ?? machine.name}</strong>
                      <small>
                        {machine.classMachineRole ?? "課堂練習機"}
                        {machine.vmid != null ? ` · VMID ${machine.vmid}` : " · 尚未配置"}
                      </small>
                    </span>
                    <span className={`${styles.machineState} ${machine.status === "running" ? styles.machineStateReady : ""}`}>
                      {practiceMachineActionLabel(machine, openingMachineId)}
                    </span>
                    <MIcon name="arrow_forward" size={18} />
                  </button>
                ))}
              </div>
            </section>
          )}
        </section>

      </main>

      <section className={styles.taskSection} aria-labelledby="task-title" data-student-tour="tasks" data-guide="home-tasks">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>老師已發布 · 完成後可直接送檢</p>
            <h2 id="task-title">截至今天的所有任務</h2>
          </div>
          {aiRequirementCount > 0 && <span>{aiAssignments.length} 個任務 · {aiRequirementCount} 個檢查項目</span>}
        </div>

        {aiAssignments.length > 0 ? (
          <div className={styles.assignmentList}>
            {aiAssignments.map((assignment, index) => {
              const expanded = expandedAssignmentId === assignment.id;
              const check = assignmentChecks[assignment.id] ?? assignment.latest_check;
              const checkMeta = check ? AI_CHECK_STATUS_META[check.status] : null;
              const checkRunning = check?.status === "pending" || check?.status === "running";
              return (
                <article className={`${styles.assignmentRow} ${expanded ? styles.assignmentRowOpen : ""}`} key={assignment.id}>
                  <button
                    type="button"
                    className={styles.assignmentToggle}
                    onClick={() => toggleAssignment(assignment.id)}
                    aria-expanded={expanded}
                    aria-controls={`assignment-detail-${assignment.id}`}
                  >
                    <span className={styles.taskNumber}>{index + 1}</span>
                    <span className={styles.assignmentTitle}>
                      <strong>{assignment.title}</strong>
                      <small>{formatAssignmentDate(assignment.approved_at)} · {assignment.teaching_class_name} · {assignment.items?.length ?? 0} 個檢查項目</small>
                    </span>
                    {checkMeta ? (
                      <span className={`${styles.assignmentStatus} ${styles[`assignmentStatus_${checkMeta.tone}`]}`}>
                        <MIcon name={checkMeta.icon} size={16} />{checkMeta.label}
                      </span>
                    ) : (
                      <span className={`${styles.assignmentStatus} ${styles.assignmentStatus_ready}`}>
                        <MIcon name="radio_button_unchecked" size={16} />尚未送檢
                      </span>
                    )}
                    <MIcon name={expanded ? "expand_less" : "expand_more"} size={21} />
                  </button>

                  {expanded && (
                    <div className={styles.assignmentDetail} id={`assignment-detail-${assignment.id}`}>
                      <div className={styles.aiBrief}>
                        <span><MIcon name="auto_awesome" size={19} /></span>
                        <div>
                          <strong>AI 整理的任務重點</strong>
                          <p>{assignment.summary || "依照下面的項目完成操作，完成後再送出 AI Check。"}</p>
                        </div>
                      </div>

                      <ol className={styles.aiRequirementList}>
                        {(assignment.items ?? []).map((item, itemIndex) => {
                          const detectableMeta = AI_DETECTABLE_META[item.detectable]
                            ?? AI_DETECTABLE_META.manual;
                          return (
                            <li className={styles.aiRequirementItem} key={item.id}>
                              <span className={styles.aiRequirementNumber}>{itemIndex + 1}</span>
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

                      {check && (
                        <section className={`${styles.aiReply} ${styles[`aiReply_${check.status}`]}`} aria-label="AI Check 回覆">
                          <header>
                            <span><MIcon name={checkRunning ? "sync" : check.status === "completed" ? "smart_toy" : "error_outline"} size={20} /></span>
                            <div>
                              <strong>{checkRunning ? "AI 正在檢查你的課堂環境" : "AI Check 回覆"}</strong>
                              <small>
                                {typeof check.score === "number" ? `評分 ${check.score}/${check.max_score ?? 5}` : checkMeta?.label}
                              </small>
                            </div>
                          </header>
                          {(check.summary || check.error) && <p>{check.error || check.summary}</p>}
                          {(check.items ?? []).length > 0 && (
                            <div className={styles.aiReplyItems}>
                              {check.items.map((item, itemIndex) => (
                                <div key={`${item.item_id}-${itemIndex}`}>
                                  <MIcon name={item.status === "passed" ? "check_circle" : "tips_and_updates"} size={17} />
                                  <span><strong>{item.title || "評分項目"}</strong>{item.comment && <small>{item.comment}</small>}</span>
                                  {typeof item.score === "number" && <em>{item.score}/{item.max_score ?? 1}</em>}
                                </div>
                              ))}
                            </div>
                          )}
                        </section>
                      )}

                      <footer className={styles.assignmentActions}>
                        <span><MIcon name="info" size={16} />送出前請先啟動課堂機器，AI 只會檢查你自己的環境。</span>
                        <button
                          type="button"
                          className={styles.aiCheckButton}
                          onClick={() => submitAiCheck(assignment)}
                          disabled={checkingAssignmentId !== null || checkRunning}
                        >
                          <MIcon name={checkRunning ? "sync" : "fact_check"} size={18} />
                          {checkRunning
                            ? "AI 檢查中…"
                            : checkingAssignmentId === assignment.id
                              ? "正在送出…"
                              : check?.status === "completed"
                                ? "完成修正，再次 AI Check"
                                : "我完成了，送出 AI Check"}
                        </button>
                      </footer>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <div className={styles.taskEmpty}>
            <MIcon name="checklist" size={24} />
            <div>
              <strong>截至今天沒有需要送檢的任務</strong>
              <p>老師發布並核准 AI 任務後，會依發布日期完整列在這裡。</p>
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
            <span className={`${styles.needIcon} ${styles.needIcon_primary}`}><MIcon name="history" size={22} /></span>
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
            <span className={`${styles.needIcon} ${styles.needIcon_info}`}><MIcon name="science" size={22} /></span>
            <div>
              <span className={`${styles.needBadge} ${styles.needBadge_info}`}>自主研究 · 需要申請</span>
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
            <div className={styles.quickTemplateGrid}>
              {displayedQuickTemplates.map((template) => (
                <button
                  type="button"
                  key={template.id}
                  className={styles.templateCard}
                  style={{ "--accent-color": "var(--color-primary)" }}
                  onClick={() => navigate(`/quick-template/${template.id}`, { state: { from: "/dashboard-new" } })}
                >
                  <div className={styles.templateHeader}>
                    <span className={styles.templateLogo}><MIcon name="layers" size={22} /></span>
                    <span className={styles.templateCategoryChip}>
                      免人工審核
                    </span>
                  </div>
                  <div className={styles.templateBody}>
                    <h4 className={styles.templateName}>{template.name}</h4>
                    <p className={styles.templateDesc}>
                      {template.description || "由範本快速建立，適合臨時練習、指令測試與輕量開發。"}
                    </p>
                  </div>
                  <div className={styles.templateFooter}>
                    <span className={styles.templateAction}>
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

      {activePracticeResource?.type === "lxc" && (
        <TerminalDialog resource={activePracticeResource} onClose={() => setActivePracticeResource(null)} />
      )}
      {activePracticeResource && activePracticeResource.type !== "lxc" && (
        <VncDialog resource={activePracticeResource} onClose={() => setActivePracticeResource(null)} />
      )}

    </div>
  );
}
