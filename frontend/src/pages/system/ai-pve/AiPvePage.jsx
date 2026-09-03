import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import AiPveChat from "../../../components/AiPveChat/AiPveChat";
import PageHeader from "../../../components/PageHeader/PageHeader";
import styles from "./AiPvePage.module.scss";

export default function AiPvePage() {
  const { t } = useTranslation("ai");
  const location = useLocation();
  const navigate = useNavigate();
  const initialPromptRef = useRef(String(location.state?.initialPrompt ?? "").trim());

  useEffect(() => {
    if (!initialPromptRef.current) return;
    navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, navigate]);

  return (
    <div className={styles.page}>
      <PageHeader
        title={t("AiPvePage.pageTitle")}
        subtitle={t("AiPvePage.pageSubtitle")}
      />
      <AiPveChat initialPrompt={initialPromptRef.current} />
    </div>
  );
}
