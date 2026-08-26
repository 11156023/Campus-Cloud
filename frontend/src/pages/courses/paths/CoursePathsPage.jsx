import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import MIcon from "../../../components/MIcon";
import EmptyState from "../../../components/EmptyState/EmptyState";
import { CoursesService } from "../../../services/courses";
import styles from "./CoursePathsPage.module.scss";

export function courseDestination(pathId) {
  return `/dashboard-new/course/${pathId}`;
}

function ProgressBar({ percent }) {
  return (
    <div className={styles.progressBar} aria-label={`課程進度 ${percent}%`}>
      <span className={styles.progressFill} style={{ width: `${Math.min(100, percent)}%` }} />
    </div>
  );
}

function CourseCard({ path, onOpen }) {
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
          {path.completed_questions}/{path.total_questions} 個學習檢查已完成
          {path.room_count > 0 && ` · ${path.room_count} 個課程單元`}
        </span>
        <ProgressBar percent={path.progress_percent} />
      </span>
      <span className={styles.cardAction}>查看任務<MIcon name="arrow_forward" size={17} /></span>
    </button>
  );
}

export default function CoursePathsPage() {
  const navigate = useNavigate();
  const [paths, setPaths] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    CoursesService.listPaths()
      .then(setPaths)
      .catch((requestError) => setError(requestError.message ?? "載入失敗"));
  }, []);

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div className={styles.pageHeading}>
          <p className={styles.eyebrow}>我的學習</p>
          <h1 className={styles.pageTitle}>我的課程</h1>
          <p className={styles.pageSubtitle}>選擇課程後，直接查看截至今天的任務與老師分配的練習機器。</p>
        </div>
      </header>

      {error && <div className={styles.stateText}>{error}</div>}
      {!error && paths === null && <div className={styles.stateText}>正在整理你的課程…</div>}
      {!error && paths?.length === 0 && (
        <EmptyState
          icon="school"
          title="目前沒有已發布的課程"
          description="老師發布課程後會自動出現在這裡。"
        />
      )}

      {paths?.length > 0 && (
        <div className={styles.courseList}>
          {paths.map((path) => (
            <CourseCard
              key={path.id}
              path={path}
              onOpen={() => navigate(courseDestination(path.id))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
