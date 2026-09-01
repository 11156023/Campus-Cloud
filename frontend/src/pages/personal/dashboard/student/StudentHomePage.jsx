import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import MIcon from "../../../../components/MIcon";
import EmptyState from "../../../../components/EmptyState/EmptyState";
import LoadingState from "../../../../components/LoadingState/LoadingState";
import PageHeader from "../../../../components/PageHeader/PageHeader";
import { CoursesService } from "../../../../services/courses";
import { QuickPracticeService } from "../../../../services/quickPractice";
import { normalizeSchedule, pickInProgress } from "./studentDashboard";
import styles from "./StudentHomePage.module.scss";

/** 首頁只呈現最前面幾個快速模板，其餘留在快速練習頁。 */
const QUICK_TEMPLATE_LIMIT = 3;

/**
 * 學生首頁（/dashboard）：今日課表、其他使用情境、快速練習環境。
 * 單一課程的環境與任務在 StudentCoursePage。
 */
export default function StudentHomePage() {
  const navigate = useNavigate();

  const [view, setView] = useState({
    loading: true,
    hasError: false,
    paths: [],
    activePath: null,
  });
  const [quickTemplates, setQuickTemplates] = useState([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);

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

    CoursesService.listSchedule()
      .then((rows) => {
        if (cancelled) return;
        const paths = Array.isArray(rows) ? rows.map(normalizeSchedule) : [];
        setView({
          loading: false,
          hasError: false,
          paths,
          activePath: pickInProgress(paths),
        });
      })
      .catch(() => {
        if (cancelled) return;
        setView({ loading: false, hasError: true, paths: [], activePath: null });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setTemplatesLoading(true);
    QuickPracticeService.listTemplates({ signal: controller.signal })
      .then((available) => setQuickTemplates(available.slice(0, QUICK_TEMPLATE_LIMIT)))
      .catch((error) => {
        if (!error?.cancelled) setQuickTemplates([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setTemplatesLoading(false);
      });
    return () => controller.abort();
  }, []);

  /** 進入單一課程總覽；沒有課程時退回課程列表。 */
  function openCourseOverview(path = view.activePath) {
    if (!path) {
      navigate("/courses");
      return;
    }
    navigate(`/dashboard/course/${path.id}`, { state: { from: "/dashboard" } });
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
      {view.hasError && (
        <div className={styles.notice} role="status">
          <MIcon name="cloud_off" size={20} />
          <div>
            <strong>暫時無法取得最新資訊</strong>
            <span>你仍可直接前往課程或我的資源查看。</span>
          </div>
        </div>
      )}

      <PageHeader
        title={`今日課表 · ${todayLabel}`}
        subtitle={view.paths.length > 0 ? `目前有 ${view.paths.length} 堂課` : "目前沒有課程"}
      >
        {view.paths.some((path) => path.schedule?.state === "now") && (
          <div className={styles.scheduleActions}>
            <span>有一堂正在進行</span>
          </div>
        )}
      </PageHeader>

      <section className={styles.todaySchedule} aria-label="今日課表" data-guide="home-schedule">
        {view.paths.length > 0 ? (
          <div className={styles.scheduleGrid}>
            {view.paths.map((path, index) => {
              const isNow = path.schedule?.state === "now";
              return (
                <button
                  type="button"
                  key={path.id}
                  className={`${styles.scheduleCard} ${isNow ? styles.scheduleCardNow : ""}`}
                  onClick={() => openCourseOverview(path)}
                >
                  <div className={styles.scheduleOrder}>{index + 1}</div>
                  <div className={styles.scheduleContent}>
                    <div className={styles.scheduleTopline}>
                      <span className={`${styles.scheduleState} ${isNow ? styles.scheduleStateNow : ""}`}>
                        {isNow && <span className={styles.liveDot} />}
                        {path.schedule?.label ?? "可繼續學習"}
                      </span>
                      {path.schedule?.time && <span>{path.schedule.time}</span>}
                    </div>
                    <h3>{path.title}</h3>
                    <p>{path.description}</p>
                    {(path.schedule?.teacher || path.schedule?.place) && (
                      <div className={styles.scheduleMeta}>
                        {path.schedule?.teacher && (
                          <span><MIcon name="person" size={15} />{path.schedule.teacher}</span>
                        )}
                        {path.schedule?.place && (
                          <span><MIcon name="location_on" size={15} />{path.schedule.place}</span>
                        )}
                      </div>
                    )}
                  </div>
                  <span className={isNow ? styles.currentCourseArrow : styles.laterCourseIcon}>
                    <MIcon name={isNow ? "arrow_forward" : "schedule"} size={19} />
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon="school"
            title="老師還沒有發布可使用的課程"
            description="課程發布後會直接出現在這裡，不需要另外申請上課機器。"
          />
        )}
      </section>

      <section
        className={styles.otherNeeds}
        aria-labelledby="other-needs-title"
        data-guide="home-other-needs"
      >
        <div className={styles.sectionHeading}>
          <div>
            <h2 id="other-needs-title">其他使用情境</h2>
          </div>
        </div>

        <div className={styles.needGrid}>
          <article className={styles.needCard}>
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

          <article className={`${styles.needCard} ${styles.researchCard}`}>
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
      </section>

      <section
        className={styles.quickTemplateSection}
        aria-labelledby="quick-template-title"
        data-guide="home-quick-templates"
      >
        <div className={styles.sectionHeading}>
          <div>
            <h2 id="quick-template-title">快速練習環境</h2>
          </div>
          <span>選擇固定配置的多機環境，整組啟動並受練習時限管理</span>
        </div>

        {templatesLoading ? (
          <div className={styles.quickTemplateGrid} aria-label="正在載入快速模板">
            {Array.from({ length: QUICK_TEMPLATE_LIMIT }, (_, index) => (
              <div key={index} className={styles.quickTemplateSkeleton} />
            ))}
          </div>
        ) : quickTemplates.length > 0 ? (
          <div className={styles.quickTemplateGrid}>
            {quickTemplates.map((template) => (
              <button
                type="button"
                key={template.id}
                className={styles.templateCard}
                onClick={() => navigate(`/quick-template/${template.id}`, { state: { from: "/dashboard" } })}
              >
                <div className={styles.templateHeader}>
                  <span className={styles.templateLogo}><MIcon name="layers" size={22} /></span>
                  <span className={styles.templateCategoryChip}>免人工審核</span>
                </div>
                <div className={styles.templateBody}>
                  <h4 className={styles.templateName}>{template.name}</h4>
                  <p className={styles.templateDesc}>
                    {template.description
                      || `包含 ${template.nodes.length} 台機器，適合臨時練習與課後操作。`}
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
          <EmptyState
            icon="inventory_2"
            title="目前沒有可快速建立的模板"
            description="老師發布可供快速練習的多機環境後，就會顯示在這裡。"
          />
        )}
      </section>
    </div>
  );
}
