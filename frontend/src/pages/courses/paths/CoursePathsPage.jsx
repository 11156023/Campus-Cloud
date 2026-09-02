import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import MIcon from "../../../components/MIcon";
import EmptyState from "../../../components/EmptyState/EmptyState";
import { CoursesService } from "../../../services/courses";
import styles from "./CoursePathsPage.module.scss";
import PageHeader from "../../../components/PageHeader/PageHeader";

export function courseDestination(pathId) {
  return `/dashboard/course/${pathId}`;
}

function ProgressBar({ percent }) {
  const { t } = useTranslation("teaching");
  return (
    <div className={styles.progressBar} aria-label={t("CoursePathsPage.progressAria", { percent })}>
      <span className={styles.progressFill} style={{ width: `${Math.min(100, percent)}%` }} />
    </div>
  );
}

function CourseCard({ path, onOpen }) {
  const { t } = useTranslation("teaching");
  return (
    <button type="button" className={styles.courseCard} onClick={onOpen}>
      <span className={styles.cardIcon}><MIcon name="school" size={23} /></span>
      <span className={styles.cardContent}>
        <span className={styles.cardTopline}>
          <strong>{path.title}</strong>
          <em>{path.progress_percent}%</em>
        </span>
        {path.description && <span className={styles.cardDesc}>{path.description}</span>}
        <span className={styles.cardMeta}>
          {t("CoursePathsPage.checksCompleted", { completed: path.completed_questions, total: path.total_questions })}
          {path.room_count > 0 && t("CoursePathsPage.roomCountSuffix", { count: path.room_count })}
        </span>
        <ProgressBar percent={path.progress_percent} />
      </span>
      <span className={styles.cardAction}>{t("CoursePathsPage.viewTasks")}<MIcon name="arrow_forward" size={17} /></span>
    </button>
  );
}

export default function CoursePathsPage() {
  const { t } = useTranslation("teaching");
  const navigate = useNavigate();
  const [paths, setPaths] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    CoursesService.listPaths()
      .then(setPaths)
      .catch((requestError) => setError(requestError.message ?? t("CoursePathsPage.loadFailed")));
  }, [t]);

  return (
    <div className={styles.page}>
      <PageHeader
        title={t("CoursePathsPage.title")}
        subtitle={t("CoursePathsPage.subtitle")}
      />

      {error && <div className={styles.stateText}>{error}</div>}
      {!error && paths === null && <div className={styles.stateText}>{t("CoursePathsPage.loading")}</div>}
      {!error && paths?.length === 0 && (
        <EmptyState
          icon="school"
          title={t("CoursePathsPage.emptyTitle")}
        />
      )}

      {paths?.length > 0 && (
        <div className={styles.courseList}>
          {paths.map((path) => (
            <CourseCard
              key={path.id}
              path={path}
              onOpen={() => navigate(courseDestination(path.id), { state: { from: "/courses" } })}
            />
          ))}
        </div>
      )}
    </div>
  );
}
