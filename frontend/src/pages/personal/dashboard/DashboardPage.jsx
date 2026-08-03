import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../contexts/AuthContext";
import { useDragScroll } from "../../../hooks/useDragScroll";
import { TemplatesService } from "../../../services/templates";
import MIcon from "../../../components/MIcon";
import styles from "./DashboardPage.module.scss";
import { COURSES } from "./dashboard.data";

const TEMPLATE_ACCENT = "#5471bf";

/* ── SectionHeader ── */
function SectionHeader({ icon, title, desc, onSeeAll, actions }) {
  return (
    <div className={styles.sectionHeader}>
      <div className={styles.sectionTitle}>
        <span className={styles.sectionName}>
          <MIcon name={icon} size={20} />
          {title}
        </span>
        <span className={styles.sectionDesc}>{desc}</span>
      </div>
      {actions}
      {onSeeAll && (
        <button type="button" className={styles.sectionLink} onClick={onSeeAll}>
          查看全部
          <MIcon name="arrow_forward" size={14} />
        </button>
      )}
    </div>
  );
}

/* ── TemplateCard ── */
function TemplateCard({ name, desc, icon, logo, accent, categoryTitle, onSelect }) {
  const [logoFailed, setLogoFailed] = useState(false);
  return (
    <button
      type="button"
      className={styles.templateCard}
      style={{ "--accent-color": accent }}
      onClick={onSelect}
    >
      <div className={styles.templateHeader}>
        <span className={styles.templateLogo}>
          {logo && !logoFailed ? (
            <img
              src={logo}
              alt={`${name} logo`}
              width={28}
              height={28}
              loading="lazy"
              onError={() => setLogoFailed(true)}
            />
          ) : (
            <MIcon name={icon} size={22} />
          )}
        </span>
        <span className={styles.templateCategoryChip}>{categoryTitle}</span>
      </div>
      <div className={styles.templateBody}>
        <h4 className={styles.templateName}>{name}</h4>
        <p className={styles.templateDesc}>{desc}</p>
      </div>
      <div className={styles.templateFooter}>
        <span className={styles.templateAction}>
          立即建立
          <MIcon name="arrow_forward" size={14} />
        </span>
      </div>
    </button>
  );
}

/* ── CourseCard ── */
function CourseCard({ title, description, subjects, teacher, classGroup, icon, accent }) {
  return (
    <article
      className={styles.courseCard}
      style={{ "--accent-color": accent }}
    >
      <div className={styles.cardBanner}>
        <div className={styles.cardBannerLeft}>
          <div className={styles.cardBannerIcon}>
            <MIcon name={icon} size={22} />
          </div>
          <h3 className={styles.cardTitle}>{title}</h3>
        </div>
      </div>

      <div className={styles.cardBody}>
        <div className={styles.cardSubjects}>
          {subjects.map((s) => (
            <span key={s} className={styles.cardSubjectTag}>{s}</span>
          ))}
        </div>
        <p className={styles.cardDesc}>{description}</p>

        <div className={styles.cardMeta}>
          <span className={styles.metaItem}>
            <MIcon name="person" size={12} />
            {teacher}
          </span>
          <span className={styles.metaItem}>
            <MIcon name="group" size={12} />
            {classGroup}
          </span>
        </div>
      </div>
    </article>
  );
}

/* ── Page ── */
export default function DashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const firstName = user?.full_name?.split(" ")[0] ?? user?.email?.split("@")[0] ?? "同學";
  const isAdmin = Boolean(user?.is_superuser || user?.role === "admin");

  const scrollRef = useRef(null);

  /* 課程推薦捲動列：< > 按鈕與兩端停用狀態（拖曳與按鈕捲動共用） */
  const [canScroll, setCanScroll] = useState({ left: false, right: false });
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      setCanScroll({ left: el.scrollLeft > 2, right: el.scrollLeft < max - 2 });
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  const scrollCourses = (dir) => {
    const el = scrollRef.current;
    el?.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
  };

  /* 快速入門：撈範本系統中可用（ready）的 LXC 範本 */
  const [templates, setTemplates] = useState([]);
  const [tplLoading, setTplLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    TemplatesService.list({ signal: controller.signal })
      .then((res) => setTemplates(
        (res?.data ?? []).filter(
          (t) => t.resource_type === "lxc" && t.status === "ready" && t.pve_exists !== false,
        ),
      ))
      .catch((err) => {
        if (!err?.cancelled) setTemplates([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setTplLoading(false);
      });
    return () => controller.abort();
  }, []);

  useDragScroll(scrollRef, { draggingClass: styles.dragging });

  return (
    <div className={styles.page}>

      {/* ── Greeting ── */}
      <div className={styles.pageHeader}>
        <div className={styles.pageHeading}>
          <h1 className={styles.pageTitle}>嗨，{firstName} 👋</h1>
          <p className={styles.pageSubtitle}>歡迎回來，很高興再次見到你！</p>
        </div>
      </div>

      {/* ── 快速操作（非管理員）── */}
      {!isAdmin && (
        <nav aria-label="快速操作" className={styles.quickActions}>
          <button
            type="button"
            className={styles.quickPrimary}
            onClick={() => navigate("/my-requests", { state: { create: true } })}
          >
            <MIcon name="add" size={18} />
            申請新資源
          </button>
          <button
            type="button"
            className={styles.quickSecondary}
            onClick={() => navigate("/my-requests")}
          >
            查看我的申請
          </button>
        </nav>
      )}

      {/* ── 課程推薦 ── */}
      <section className={styles.section}>
        <SectionHeader
          icon="school"
          title="課程推薦"
          desc="根據你的學習歷程精選推薦"
          actions={
            <div className={styles.scrollNav}>
              <button
                type="button"
                className={styles.scrollNavBtn}
                onClick={() => scrollCourses(-1)}
                disabled={!canScroll.left}
                aria-label="往前捲動課程"
              >
                <MIcon name="chevron_left" size={20} />
              </button>
              <button
                type="button"
                className={styles.scrollNavBtn}
                onClick={() => scrollCourses(1)}
                disabled={!canScroll.right}
                aria-label="往後捲動課程"
              >
                <MIcon name="chevron_right" size={20} />
              </button>
            </div>
          }
        />

        <div className={styles.courseScroll} ref={scrollRef}>
          {COURSES.map((c, i) => (
            <CourseCard key={`${c.id}-${i}`} {...c} />
          ))}
        </div>
      </section>

      {/* ── 快速入門 ── */}
      <section className={styles.section}>
        <SectionHeader
          icon="bolt"
          title="快速入門"
          desc="選擇範本一鍵克隆練習環境"
        />

        {tplLoading ? (
          <p className={styles.sectionEmpty}>載入範本中…</p>
        ) : templates.length === 0 ? (
          <p className={styles.sectionEmpty}>
            目前沒有可用的範本。範本由老師或管理員在「範本管理」建立後即會出現在這裡。
          </p>
        ) : (
          <div className={styles.templateGrid}>
            {templates.map((t) => (
              <TemplateCard
                key={t.id}
                name={t.name}
                desc={t.description || "由範本克隆建立，數秒內完成佈建。"}
                icon="layers"
                accent={TEMPLATE_ACCENT}
                categoryTitle={`v${t.version}`}
                onSelect={() => navigate(`/quick-template/${t.id}`)}
              />
            ))}
          </div>
        )}
      </section>

    </div>
  );
}
