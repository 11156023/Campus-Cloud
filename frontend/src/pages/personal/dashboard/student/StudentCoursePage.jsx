import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
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
  auto: { label: "AI 可提供檢查建議", icon: "smart_toy", tone: "auto" },
  partial: { label: "AI 輔助＋老師確認", icon: "rule", tone: "partial" },
  manual: { label: "老師人工確認", icon: "person_check", tone: "manual" },
};

const NO_COURSE_STATUS = { label: "目前沒有課程", tone: "muted", icon: "event_busy" };

function StatusBadge({ meta }) {
  return (
    <span className={`${styles.statusBadge} ${styles[meta.tone]}`}>
      <MIcon name={meta.icon} size={16} />
      {meta.label}
    </span>
  );
}

/**
 * 單一課程的總覽頁（/dashboard/course/:pathId）。
 * 內容分三塊：課堂卡片（進度與環境）、課堂機器、截至今天的 AI 任務。
 */
export default function StudentCoursePage() {
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
  const [reportingItemKey, setReportingItemKey] = useState(null);
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
      ? { label: "正在上課", tone: "success", icon: "sensors" }
      : { label: "可以開始", tone: "success", icon: "play_circle" }
    : NO_COURSE_STATUS;

  async function openPracticeMachine(machine) {
    if (!machine?.vmid) {
      toast.error("這台課堂機器尚未建立完成");
      return;
    }
    const toastId = `start-class-machine-${machine.vmid}`;
    setOpeningMachineId(machine.vmid);
    try {
      let resource = await ResourcesService.get(machine.vmid);
      if (resource.status !== "running") {
        toast.info("正在啟動課堂機器，通常需要一點時間…", { id: toastId });
        await ResourcesService.start(resource.vmid);
        resource = await waitForPracticeMachine(resource.vmid);
        if (resource?.status !== "running") {
          toast.info("機器仍在啟動中，請稍後再試。", { id: toastId });
          return;
        }
        toast.success("課堂機器已啟動", { id: toastId });
      }
      setActivePracticeResource({ ...machine, ...resource });
    } catch (error) {
      toast.error(error?.message ?? "無法開啟課堂機器");
    } finally {
      setOpeningMachineId(null);
    }
  }

  function openMachineInformation(machine) {
    if (!machine?.vmid) {
      toast.info("這台課堂機器尚未建立完成。");
      return;
    }
    navigate(`/my-resources/${machine.vmid}`);
  }

  function toggleAssignment(assignmentId) {
    setExpandedAssignmentId((current) => (current === assignmentId ? null : assignmentId));
  }

  async function updateCompletion(assignment, taskItem) {
    if (reportingItemKey) return;
    const itemKey = `${assignment.id}:${taskItem.id}`;
    const completedItemIds = new Set(assignment.completion?.completed_item_ids ?? []);
    const completed = !completedItemIds.has(taskItem.id);
    setReportingItemKey(itemKey);
    setExpandedAssignmentId(assignment.id);
    try {
      const completion = await CoursesService.updateAssignmentCompletion(
        view.activePath.id,
        assignment.id,
        taskItem.id,
        completed,
      );
      setView((current) => ({
        ...current,
        aiAssignments: current.aiAssignments.map((item) => (
          item.id === assignment.id ? { ...item, completion } : item
        )),
      }));
      toast.success(completed ? "已勾選這個任務" : "已取消這個任務的勾選");
    } catch (error) {
      toast.error(error?.message ?? "目前無法更新完成狀態");
    } finally {
      setReportingItemKey(null);
    }
  }

  if (view.loading) {
    return (
      <div className={styles.page}>
        <LoadingState text="正在整理你的課堂資訊" fullPage />
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
          返回今日課表
        </button>
        <div className={styles.coursePageTitle}>
          <p className={styles.eyebrow}>課程總覽</p>
          <h1>{view.activePath?.title ?? "課程"}</h1>
          <p>{view.activePath?.description ?? "查看今天的環境與任務。"}</p>
        </div>
      </header>

      {view.hasError && (
        <div className={styles.notice} role="status">
          <MIcon name="cloud_off" size={20} />
          <div>
            <strong>暫時無法取得最新資訊</strong>
            <span>你仍可直接前往課程或我的資源查看。</span>
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
                {currentSchedule?.state === "now" ? "現在正在進行" : "接下來可以練習"}
              </p>
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

              <div
                className={styles.progressTrack}
                aria-label={`章節進度 ${roomProgress}%`}
                data-guide="home-progress"
              >
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
            <EmptyState
              icon="event_available"
              title="目前沒有待完成的課程"
              description="老師發布今天的內容後，就會顯示在這裡。"
            />
          )}

          {practiceMachines.length > 0 && (
            <section className={styles.machinePicker} aria-label="課堂機器" data-guide="home-start">
              <header>
                <div>
                  <strong>你的課堂機器</strong>
                  <span>直接點擊機器即可進入；右側資訊按鈕可查看完整設定。</span>
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
                        aria-label={`${actionLabel}：${machineName}`}
                      >
                        <span className={styles.machineIcon}>
                          <MIcon name={machine.type === "lxc" ? "terminal" : "desktop_windows"} size={22} />
                        </span>
                        <span className={styles.machineCopy}>
                          <strong>{machineName}</strong>
                          <small>
                            {machine.classMachineRole ?? "課堂練習機"}
                            {machine.vmid != null ? ` · VMID ${machine.vmid}` : " · 尚未配置"}
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
                        aria-label={`查看 ${machineName} 的完整資源資訊`}
                        title="前往我的資源查看完整設定"
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
            <h2 id="task-title">截至今天的所有任務</h2>
          </div>
          {aiRequirementCount > 0 && (
            <span>{aiAssignments.length} 個任務 · {aiRequirementCount} 個檢查項目</span>
          )}
        </div>

        {aiAssignments.length > 0 ? (
          <div className={styles.assignmentList}>
            {aiAssignments.map((assignment, index) => {
              const expanded = expandedAssignmentId === assignment.id;
              const completedItemIds = new Set(
                assignment.completion?.completed_item_ids ?? [],
              );
              const completedItemCount = (assignment.items ?? []).filter(
                (item) => completedItemIds.has(item.id),
              ).length;
              const completionReported = Boolean(assignment.completion?.completed);
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
                        {" · "}{assignment.items?.length ?? 0} 個檢查項目
                      </small>
                    </span>
                    <span className={`${styles.assignmentStatus} ${completionReported ? styles.assignmentStatus_completed : styles.assignmentStatus_ready}`}>
                      <MIcon name={completionReported ? "check_circle" : "checklist"} size={16} />
                      {completedItemCount}/{assignment.items?.length ?? 0} 已完成
                    </span>
                    <MIcon name={expanded ? "expand_less" : "expand_more"} size={21} />
                  </button>

                  {expanded && (
                    <div className={styles.assignmentDetail} id={`assignment-detail-${assignment.id}`}>
                      <div className={styles.aiBrief}>
                        <span><MIcon name="auto_awesome" size={19} /></span>
                        <div>
                          <strong>AI 整理的任務重點</strong>
                          <p>{assignment.summary || "依照下面的項目完成操作，完成後回報老師即可。"}</p>
                        </div>
                      </div>

                      <ol className={styles.aiRequirementList}>
                        {(assignment.items ?? []).map((item, itemIndex) => {
                          const detectableMeta = AI_DETECTABLE_META[item.detectable]
                            ?? AI_DETECTABLE_META.manual;
                          const itemKey = `${assignment.id}:${item.id}`;
                          const itemCompleted = completedItemIds.has(item.id);
                          return (
                            <li
                              className={`${styles.aiRequirementItem} ${itemCompleted ? styles.aiRequirementItemCompleted : ""}`}
                              key={item.id}
                            >
                              <label className={styles.requirementCheckbox}>
                                <input
                                  type="checkbox"
                                  checked={itemCompleted}
                                  onChange={() => updateCompletion(assignment, item)}
                                  disabled={reportingItemKey !== null}
                                  aria-label={`${itemCompleted ? "取消" : "標記"}${item.title}完成`}
                                />
                                {reportingItemKey === itemKey && <MIcon name="sync" size={15} />}
                              </label>
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

                      <p className={styles.assignmentNote}>
                        <MIcon name="info" size={16} />
                        勾選只會記錄你的完成狀態，不會啟動 AI 檢查。
                      </p>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon="checklist"
            title="截至今天沒有需要完成的任務"
            description="老師發布並核准 AI 任務後，會依發布日期完整列在這裡。"
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
