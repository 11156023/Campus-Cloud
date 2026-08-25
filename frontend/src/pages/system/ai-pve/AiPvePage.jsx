import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import AiPveChat from "../../../components/AiPveChat/AiPveChat";
import MIcon from "../../../components/MIcon";
import styles from "./AiPvePage.module.scss";

export default function AiPvePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const initialPromptRef = useRef(String(location.state?.initialPrompt ?? "").trim());

  useEffect(() => {
    if (!initialPromptRef.current) return;
    navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, navigate]);

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeading}>
        <h2 className={styles.panelTitle}>
          <MIcon name="smart_toy" size={20} />
          AI PVE 維運助手
        </h2>
        <p className={styles.panelDesc}>
          管理員專用的全站 PVE 維運工具，可查詢 VM/LXC 與節點狀態，執行指令前會再次確認
        </p>
      </div>
      <AiPveChat initialPrompt={initialPromptRef.current} />
    </div>
  );
}
