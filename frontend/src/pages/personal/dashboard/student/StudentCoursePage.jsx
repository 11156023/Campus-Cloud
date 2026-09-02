import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import MIcon from "../../../../components/MIcon";
import EmptyState from "../../../../components/EmptyState/EmptyState";
import LoadingState from "../../../../components/LoadingState/LoadingState";
import TerminalDialog from "../../resources/TerminalDialog";
import VncDialog from "../../resources/VncDialog";
import { CoursesService } from "../../../../services/courses";
import { ResourcesService } from "../../../../services/resources";
import {
  assignmentsUntilToday,
  buildPracticeMachines,
  formatAssignmentDate,
  normalizeSchedule,
  pickInProgress,
  practiceMachineActionLabel,
  toPercent,
  waitForPracticeMachine,
} from "./studentDashboard";
import styles from "./StudentCoursePage.module.scss";

/** AI 任務的每個檢查項目可被自動判定的程度。 */
const AI_DETECTABLE_META = {
  auto: { labelKey: "StudentCoursePage.detectableAuto", icon: "smart_toy", tone: "auto" },
  partial: { labelKey: "StudentCoursePage.detectablePartial", icon: "rule", tone: "partial" },
  manual: { labelKey: "StudentCoursePage.detectableManual", icon: "person_check", tone: "manual" },
};

/** 一次 AI Check 送出後的執行狀態。 */
const AI_CHECK_STATUS_META = {
  pending: { labelKey: "StudentCoursePage.checkStatusPending", icon: "hourglass_top", tone: "pending" },
  running: { labelKey: "StudentCoursePage.checkStatusRunning", icon: "sync", tone: "running" },
  completed: { labelKey: "StudentCoursePage.checkStatusCompleted", icon: "task_alt", tone: "completed" },
  failed: { labelKey: "StudentCoursePage.checkStatusFailed", icon: "error_outline", tone: "failed" },
  cancelled: { labelKey: "StudentCoursePage.checkStatusCancelled", icon: "block", tone: "cancelled" },
};

const NO_COURSE_STATUS = { labelKey: "StudentCoursePage.noCourseStatus", tone: "muted", icon: "event_busy" };

/** AI Check 送出後、尚未有結論前的輪詢間隔。 */
const AI_CHECK_POLL_MS = 2500;

function StatusBadge({ meta }) {
  const { t } = useTranslation("personal");
  return (
    <span className={`${styles.statusBadge} ${styles[meta.tone]}`}>
      <MIcon name={meta.icon} size={16} />
      {t(meta.labelKey)}
    </span>
  );
}

/**
 * 單一課程的總覽頁（/dashboard/course/:pathId）。
 * 內容分三塊：課堂卡片（進度與環境）、課堂機器、截至今天的 AI 任務。
 */
export default function StudentCoursePage() {
  const { t } = useTranslation("personal");
  const navigate = useNavigate();
  const location = useLocation();
  const { pathId } = useParams();

  const [view, setView] = useState({
    loading: true,
    hasError: false,
    resources: [],
    activePath: null,
    pathDetail: null,
    roomDetail: null,
    aiAssignments: [],
    practiceMachines: [],
  });
  const [expandedAssignmentId, setExpandedAssignmentId] = useState(null);
  const [assignmentChecks, setAssignmentChecks] = useState({});
  const [checkingAssignmentId, setCheckingAssignmentId] = useState(null);
  const [activePracticeResource, setActivePracticeResource] = useState(null);
  const [openingMachineId, setOpeningMachineId] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function loadCourse() {
      const [pathsResult, resourcesResult, scheduleResult] = await Promise.allSettled([
        CoursesService.listPaths(),
        ResourcesService.list(),
        CoursesService.listSchedule(),
      ]);
      if (cancelled) return;

      const catalogPaths = pathsResult.status === "fulfilled" && Array.isArray(pathsResult.value)
        ? pathsResult.value
        : [];
      const resources = resourcesResult.status === "fulfilled" && Array.isArray(resourcesResult.value)
        ? resourcesResult.value
        : [];
      const schedulePaths = scheduleResult.status === "fulfilled" && Array.isArray(scheduleResult.value)
        ? scheduleResult.value.map(normalizeSchedule)
        : [];

      // 網址指定的課程優先；找不到時退回目前進行中的課程。
      let activePath = (pathId
        && catalogPaths.find((path) => String(path.id) === String(pathId)))
        || pickInProgress(catalogPaths);
      const scheduledVersion = schedulePaths.find(
        (path) => String(path.id) === String(activePath?.id),
      );
      if (activePath && scheduledVersion) {
        activePath = { ...activePath, schedule: scheduledVersion.schedule };
      }

      let pathDetail = null;
      let roomDetail = null;
      let aiAssignments = [];
      let practiceMachines = [];

      if (activePath) {
        const [pathDetailResult, aiAssignmentsResult, practiceMachinesResult] = await Promise.allSettled([
          CoursesService.getPath(activePath.id),
          CoursesService.getAiAssignments(activePath.id),
          CoursesService.getPracticeMachines(activePath.id),
        ]);
        if (pathDetailResult.status === "fulfilled") {
          pathDetail = pathDetailResult.value;
          const nextRoom = pickInProgress(pathDetail?.rooms);
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

      if (cancelled) return;
      setView({
        loading: false,
        hasError: pathsResult.status === "rejected" && resourcesResult.status === "rejected",
        resources,
        activePath,
        pathDetail,
        roomDetail,
        aiAssignments,
        practiceMachines,
      });
    }

    loadCourse();
    return () => {
      cancelled = true;
    };
  }, [pathId]);

  // AI Check 送出後沒有推播，靠輪詢把 pending/running 的結果補上。
  useEffect(() => {
    if (!view.activePath?.id) return undefined;
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
    }, AI_CHECK_POLL_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [assignmentChecks, view.activePath?.id, view.aiAssignments]);

  const nextRoom = pickInProgress(view.pathDetail?.rooms);
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
  const currentSchedule = view.activePath?.schedule;
  const heroStatusMeta = view.activePath
    ? currentSchedule?.state === "now"
      ? { labelKey: "StudentCoursePage.statusInClass", tone: "success", icon: "sensors" }
      : { labelKey: "StudentCoursePage.statusReadyToStart", tone: "success", icon: "play_circle" }
    : NO_COURSE_STATUS;

  async function openPracticeMachine(machine) {
    if (!machine?.vmid) {
      toast.error(t("StudentCoursePage.machineNotReady"));
      return;
    }
    const toastId = `start-class-machine-${machine.vmid}`;
    setOpeningMachineId(machine.vmid);
    try {
      let resource = await ResourcesService.get(machine.vmid);
      if (resource.status !== "running") {
        toast.info(t("StudentCoursePage.startingMachine"), { id: toastId });
        await ResourcesService.start(resource.vmid);
        resource = await waitForPracticeMachine(resource.vmid);
        if (resource?.status !== "running") {
          toast.info(t("StudentCoursePage.machineStillStarting"), { id: toastId });
          return;
        }
        toast.success(t("StudentCoursePage.machineStarted"), { id: toastId });
      }
      setActivePracticeResource({ ...machine, ...resource });
    } catch (error) {
      toast.error(error?.message ?? t("StudentCoursePage.openMachineFailed"));
    } finally {
      setOpeningMachineId(null);
    }
  }

  function openMachineInformation(machine) {
    if (!machine?.vmid) {
      toast.info(t("StudentCoursePage.machineNotReadyInfo"));
      return;
    }
    navigate(`/my-resources/${machine.vmid}`);
  }

  function toggleAssignment(assignmentId) {
    setExpandedAssignmentId((current) => (current === assignmentId ? null : assignmentId));
  }

  async function submitAiCheck(assignment) {
    if (checkingAssignmentId) return;
    setCheckingAssignmentId(assignment.id);
    setExpandedAssignmentId(assignment.id);
    try {
      const check = await CoursesService.startAiCheck(view.activePath.id, assignment.id);
      setAssignmentChecks((current) => ({ ...current, [assignment.id]: check }));
      toast.success(check.status === "completed"
        ? t("StudentCoursePage.aiCheckCompleted")
        : t("StudentCoursePage.aiCheckSubmitted"));
    } catch (error) {
      toast.error(error?.message ?? t("StudentCoursePage.aiCheckSubmitFailed"));
    } finally {
      setCheckingAssignmentId(null);
    }
  }

  if (view.loading) {
    return (
      <div className={styles.page}>
        <LoadingState text={t("StudentCoursePage.loadingText")} fullPage />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.coursePageHeader}>
        <button
          type="button"
          className={styles.courseBackButton}
          onClick={() => navigate(location.state?.from ?? "/dashboard")}
        >
          <MIcon name="arrow_back" size={18} />
          {t("StudentCoursePage.backToToday")}
        </button>
        <div className={styles.coursePageTitle}>
          <p className={styles.eyebrow}>{t("StudentCoursePage.eyebrowCourseOverview")}</p>
          <h1>{view.activePath?.title ?? t("StudentCoursePage.defaultCourseTitle")}</h1>
          <p>{view.activePath?.description ?? t("StudentCoursePage.defaultCourseDesc")}</p>
        </div>
      </header>

      {view.hasError && (
        <div className={styles.notice} role="status">
          <MIcon name="cloud_off" size={20} />
          <div>
            <strong>{t("StudentCoursePage.noticeTitle")}</strong>
            <span>{t("StudentCoursePage.noticeDesc")}</span>
          </div>
        </div>
      )}

      <main className={styles.mainGrid}>
        <section
          className={styles.classCard}
          aria-labelledby="today-class-title"
          data-guide="home-current-course"
        >
          <div className={styles.classCardTop}>
            <div>
              <p className={styles.eyebrow}>
                {currentSchedule?.state === "now" ? t("StudentCoursePage.eyebrowNow") : t("StudentCoursePage.eyebrowUpcoming")}
              </p>
              <h2 id="today-class-title">
                {view.activePath?.title ?? t("StudentCoursePage.noCourseAvailable")}
              </h2>
              <p className={styles.classDescription}>
                {nextRoom
                  ? t("StudentCoursePage.classTaskDesc", { title: nextRoom.title })
                  : view.activePath?.description
                    ?? t("StudentCoursePage.classNoContentYet")}
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
                  <span><MIcon name="task_alt" size={18} />{t("StudentCoursePage.taskProgress", { percent: roomProgress })}</span>
                )}
              </div>

              <div
                className={styles.progressTrack}
                aria-label={t("StudentCoursePage.chapterProgressAria", { percent: roomProgress })}
                data-guide="home-progress"
              >
                <span style={{ width: `${roomProgress}%` }} />
              </div>

              <div className={styles.simpleCourseHint}>
                <MIcon name="check_circle" size={18} />
                <span>
                  {deployment?.status === "running" || !nextRoom?.has_lab
                    ? t("StudentCoursePage.hintReady")
                    : t("StudentCoursePage.hintWillPrepare")}
                </span>
              </div>
            </>
          ) : (
            <EmptyState
              icon="event_available"
              title={t("StudentCoursePage.emptyNoCourseTitle")}
              description={t("StudentCoursePage.emptyNoCourseDesc")}
            />
          )}

          {practiceMachines.length === 0 ? (
            <div className={styles.primaryActions}>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => navigate(nextRoom ? `/courses/rooms/${nextRoom.id}` : "/courses")}
              >
                {nextRoom ? t("StudentCoursePage.startPractice") : t("StudentCoursePage.viewAvailableCourses")}
                <MIcon name="arrow_forward" size={18} />
              </button>
            </div>
          ) : (
            <section className={styles.machinePicker} aria-label={t("StudentCoursePage.classMachinesAriaLabel")} data-guide="home-start">
              <header>
                <div>
                  <strong>{t("StudentCoursePage.yourClassMachines")}</strong>
                  <span>{t("StudentCoursePage.machineHint")}</span>
                </div>
              </header>
              <div className={styles.machineGrid}>
                {practiceMachines.map((machine) => {
                  const machineName = machine.classMachineName ?? machine.name;
                  const actionLabel = practiceMachineActionLabel(machine, openingMachineId);
                  return (
                    <div
                      key={machine.machine_node_id
                        ?? `${machine.teaching_class_id ?? "course"}-${machine.vmid}`}
                      className={styles.machineOption}
                    >
                      <button
                        type="button"
                        className={styles.machineLaunchButton}
                        onClick={() => openPracticeMachine(machine)}
                        disabled={openingMachineId !== null || machine.vmid == null}
                        aria-label={t("StudentCoursePage.machineLaunchAria", { action: actionLabel, name: machineName })}
                      >
                        <span className={styles.machineIcon}>
                          <MIcon name={machine.type === "lxc" ? "terminal" : "desktop_windows"} size={22} />
                        </span>
                        <span className={styles.machineCopy}>
                          <strong>{machineName}</strong>
                          <small>
                            {machine.classMachineRole ?? t("StudentCoursePage.defaultMachineRole")}
                            {machine.vmid != null ? t("StudentCoursePage.vmidSuffix", { vmid: machine.vmid }) : t("StudentCoursePage.notConfiguredSuffix")}
                          </small>
                        </span>
                        <span className={`${styles.machineState} ${machine.status === "running" ? styles.machineStateReady : ""}`}>
                          {actionLabel}
                        </span>
                        <span className={styles.machineArrow}><MIcon name="arrow_forward" size={20} /></span>
                      </button>
                      <button
                        type="button"
                        className={styles.machineInfoButton}
                        onClick={() => openMachineInformation(machine)}
                        disabled={machine.vmid == null}
                        aria-label={t("StudentCoursePage.viewFullInfoAria", { name: machineName })}
                        title={t("StudentCoursePage.viewFullSettingsTitle")}
                      >
                        <MIcon name="info" size={20} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </section>
      </main>

      <section className={styles.taskSection} aria-labelledby="task-title" data-guide="home-tasks">
        <div className={styles.sectionHeading}>
          <div>
            <h2 id="task-title">{t("StudentCoursePage.tasksTitle")}</h2>
          </div>
          {aiRequirementCount > 0 && (
            <span>{t("StudentCoursePage.tasksSummary", { tasks: aiAssignments.length, items: aiRequirementCount })}</span>
          )}
        </div>

        {aiAssignments.length > 0 ? (
          <div className={styles.assignmentList}>
            {aiAssignments.map((assignment, index) => {
              const expanded = expandedAssignmentId === assignment.id;
              const check = assignmentChecks[assignment.id] ?? assignment.latest_check;
              const checkMeta = check ? AI_CHECK_STATUS_META[check.status] : null;
              const checkRunning = check?.status === "pending" || check?.status === "running";
              return (
                <article
                  key={assignment.id}
                  className={`${styles.assignmentRow} ${expanded ? styles.assignmentRowOpen : ""}`}
                >
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
                      <small>
                        {formatAssignmentDate(assignment.approved_at)}
                        {" · "}{assignment.teaching_class_name}
                        {" · "}{t("StudentCoursePage.itemsCount", { count: assignment.items?.length ?? 0 })}
                      </small>
                    </span>
                    {checkMeta ? (
                      <span className={`${styles.assignmentStatus} ${styles[`assignmentStatus_${checkMeta.tone}`]}`}>
                        <MIcon name={checkMeta.icon} size={16} />{t(checkMeta.labelKey)}
                      </span>
                    ) : (
                      <span className={`${styles.assignmentStatus} ${styles.assignmentStatus_ready}`}>
                        <MIcon name="radio_button_unchecked" size={16} />{t("StudentCoursePage.notSubmittedYet")}
                      </span>
                    )}
                    <MIcon name={expanded ? "expand_less" : "expand_more"} size={21} />
                  </button>

                  {expanded && (
                    <div className={styles.assignmentDetail} id={`assignment-detail-${assignment.id}`}>
                      <div className={styles.aiBrief}>
                        <span><MIcon name="auto_awesome" size={19} /></span>
                        <div>
                          <strong>{t("StudentCoursePage.aiSummaryTitle")}</strong>
                          <p>{assignment.summary || t("StudentCoursePage.aiSummaryFallback")}</p>
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
                                {t(detectableMeta.labelKey)}
                              </span>
                            </li>
                          );
                        })}
                      </ol>

                      {check && (
                        <section
                          className={`${styles.aiReply} ${styles[`aiReply_${check.status}`]}`}
                          aria-label={t("StudentCoursePage.aiReplyAriaLabel")}
                        >
                          <header>
                            <span>
                              <MIcon
                                name={checkRunning
                                  ? "sync"
                                  : check.status === "completed" ? "smart_toy" : "error_outline"}
                                size={20}
                              />
                            </span>
                            <div>
                              <strong>{checkRunning ? t("StudentCoursePage.aiCheckingEnv") : t("StudentCoursePage.aiCheckReplyTitle")}</strong>
                              <small>
                                {typeof check.score === "number"
                                  ? t("StudentCoursePage.scoreFormat", { score: check.score, max: check.max_score ?? 5 })
                                  : checkMeta?.labelKey && t(checkMeta.labelKey)}
                              </small>
                            </div>
                          </header>
                          {(check.summary || check.error) && <p>{check.error || check.summary}</p>}
                          {(check.items ?? []).length > 0 && (
                            <div className={styles.aiReplyItems}>
                              {check.items.map((item, itemIndex) => (
                                <div key={`${item.item_id}-${itemIndex}`}>
                                  <MIcon
                                    name={item.status === "passed" ? "check_circle" : "tips_and_updates"}
                                    size={17}
                                  />
                                  <span>
                                    <strong>{item.title || t("StudentCoursePage.defaultScoreItemTitle")}</strong>
                                    {item.comment && <small>{item.comment}</small>}
                                  </span>
                                  {typeof item.score === "number" && (
                                    <em>{item.score}/{item.max_score ?? 1}</em>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </section>
                      )}

                      <footer className={styles.assignmentActions}>
                        <span>
                          <MIcon name="info" size={16} />
                          {t("StudentCoursePage.beforeSubmitHint")}
                        </span>
                        <button
                          type="button"
                          className={styles.aiCheckButton}
                          onClick={() => submitAiCheck(assignment)}
                          disabled={checkingAssignmentId !== null || checkRunning}
                        >
                          <MIcon name={checkRunning ? "sync" : "fact_check"} size={18} />
                          {checkRunning
                            ? t("StudentCoursePage.aiChecking")
                            : checkingAssignmentId === assignment.id
                              ? t("StudentCoursePage.submitting")
                              : check?.status === "completed"
                                ? t("StudentCoursePage.recheckAfterFix")
                                : t("StudentCoursePage.submitAiCheck")}
                        </button>
                      </footer>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon="checklist"
            title={t("StudentCoursePage.emptyNoTasksTitle")}
            description={t("StudentCoursePage.emptyNoTasksDesc")}
          />
        )}
      </section>

      {activePracticeResource?.type === "lxc" && (
        <TerminalDialog
          resource={activePracticeResource}
          onClose={() => setActivePracticeResource(null)}
        />
      )}
      {activePracticeResource && activePracticeResource.type !== "lxc" && (
        <VncDialog
          resource={activePracticeResource}
          onClose={() => setActivePracticeResource(null)}
        />
      )}
    </div>
  );
}
