import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import MIcon from "../MIcon";
import styles from "./UserGuide.module.scss";

const STUDENT_HOME_GUIDE = {
  id: "student-home",
  title: "首頁",
  icon: "home",
  steps: [
    {
      selector: '[data-guide="home-schedule"]',
      title: "從你的進行中課程開始",
      text: "課程期間內都會顯示在這裡，不必等到上課當天。綠色代表正在上課；其他課程仍可點入使用機器、查看任務或課後練習。",
    },
    {
      selector: '[data-guide="home-quick-templates"]',
      title: "臨時練習不用等待人工審核",
      text: "需要快速測試指令或做輕量練習時，選擇模板並填寫容器名稱與密碼，系統會自動核准並開始建立。",
    },
    {
      selector: '[data-guide="home-other-needs"]',
      title: "下課練習或自主研究",
      text: "不是現在要上課時，可以從這裡回到上次的課程進度；自主研究則會帶你前往資源申請。",
    },
    {
      selector: '[data-guide="home-current-course"]',
      title: "這是你現在要上的課",
      text: "課程名稱、上課時間與「正在上課」狀態都集中在這張卡片。進首頁先看這裡，就知道今天要進哪堂課。",
    },
    {
      selector: '[data-guide="home-progress"]',
      title: "這條是章節完成進度",
      text: "進度條代表目前章節已完成的比例，不是機器建立進度。做完任務後，這個數字會往前增加。",
    },
    {
      selector: '[data-guide="home-start"]',
      title: "直接點擊要使用的課堂機器",
      text: "老師分配的機器會直接列在這裡。點擊整張機器卡可啟動並進入，右側資訊按鈕則會前往「我的資源」查看完整設定。",
    },
    {
      selector: '[data-guide="home-environment"]',
      title: "先看環境是否可以使用",
      text: "「環境已就緒」表示可以開始。IP 是連線位置；「可使用至」是這台課堂機器的到期時間。",
    },
    {
      selector: '[data-guide="home-tasks"]',
      title: "完成數量看這裡",
      text: "每個任務都有自己的完成勾選框；完成時勾選，尚未完成時可以隨時取消。",
    },
    {
      selector: '[data-guide="course-ai-assignments"]',
      title: "這些是老師交給 AI 的評分項目",
      text: "只會顯示老師已核准的檢查要求。這裡只記錄你的完成狀態，不會啟動 AI 檢查或直接判定對錯。",
      optional: true,
    },
  ],
};

const PAGE_GUIDES = {
  "/dashboard": STUDENT_HOME_GUIDE,
  "/my-requests": {
    id: "my-requests",
    title: "我的申請",
    icon: "assignment",
    steps: [
      {
        selector: '[data-guide="request-create"]',
        title: "自主研究才從這裡申請",
        text: "要建立自己的專題或研究機器時，按「申請資源」填寫需求。老師分發的課堂機器不用重複申請。",
      },
      {
        selector: '[data-guide="request-list"]',
        title: "狀態代表目前走到哪一步",
        text: "「審核中」是等待老師處理；「已開通」代表機器已建立；「開通失敗」可按重試。點資料列可展開申請原因與詳細時間。",
      },
    ],
  },
  "/my-resources": {
    id: "my-resources",
    title: "我的資源",
    icon: "computer",
    steps: [
      {
        selector: '[data-guide="resource-quota"]',
        title: "這些數字是你的使用額度",
        text: "左邊是目前已使用量，右邊是可用上限。例如「2 / 4 台」表示已用了 2 台、最多可以有 4 台。接近上限時需先釋放資源。",
      },
      {
        selector: '[data-guide="resource-card"]',
        title: "一張卡片就是一台機器",
        text: "IP 是機器的連線位置；右上角狀態顯示能否使用。點機器名稱可看完整資訊。",
      },
      {
        selector: '[data-guide="resource-console"]',
        title: "用這個按鈕進入機器",
        text: "機器顯示「執行中」時，可按「終端機」或「控制台」開始操作。旁邊的三點按鈕是開機、關機與重新啟動。",
      },
    ],
  },
  "/firewall": {
    id: "firewall",
    title: "防火牆",
    icon: "security",
    steps: [
      {
        selector: '[data-guide="firewall-create"]',
        title: "新增一條允許連線的規則",
        text: "需要讓兩台機器互通時按「新增連線」，選擇來源、目標與允許的 Port。沒有明確需求時不必新增。",
      },
      {
        selector: '[data-guide="firewall-map"]',
        title: "線條就是目前允許的連線",
        text: "每個方塊代表一台 VM，方塊之間的線代表允許通行。點選 VM 可查看它的規則；線上的數字是開放的 Port。",
      },
      {
        selector: '[data-guide="firewall-tools"]',
        title: "這些按鈕只改變查看方式",
        text: "「自動排列」整理位置；「連線標籤」顯示或隱藏 Port；「地圖」切換右下角縮圖，不會修改任何防火牆規則。",
      },
    ],
  },
  "/reverse-proxy": {
    id: "reverse-proxy",
    title: "反向代理",
    icon: "swap_horiz",
    steps: [
      {
        selector: '[data-guide="proxy-create"]',
        title: "把 VM 服務變成好記的網址",
        text: "VM 裡的網站或 API 已經啟動後，按「新增網域」，選擇 VM、服務 Port 與網址。系統會代為處理對外路由。",
      },
      {
        selector: '[data-guide="proxy-help"]',
        title: "不確定流程時先展開這裡",
        text: "這裡會說明建立前需要準備什麼，以及網址如何連到 VM。HTTPS 開啟後會自動申請與續期憑證。",
      },
      {
        selector: '[data-guide="proxy-list"]',
        title: "每一列是一個公開網址",
        text: "VM 數字是目標機器編號，Port 是 VM 內服務監聽的連接埠；HTTPS 標籤表示使用安全連線。「開啟」可直接測試網址。",
      },
    ],
  },
  "/domain": {
    id: "domain",
    title: "網域管理",
    icon: "domain",
    steps: [
      {
        selector: '[data-guide="domain-connect"]',
        title: "第一次使用先設定 Cloudflare",
        text: "按「連線設定」輸入 Account ID 與 API Token；「測試連線」只驗證設定是否有效，不會修改 DNS。",
      },
      {
        selector: '[data-guide="domain-status"]',
        title: "這裡顯示連線是否正常",
        text: "「已連線」代表平台可以管理 DNS；上次驗證時間可協助判斷憑證是否仍有效。未連線時無法載入網域。",
      },
      {
        selector: '[data-guide="domain-zones"]',
        title: "Zones 數字是可管理的網域數",
        text: "例如「Zones（3）」表示帳號中有 3 個網域可選。先點左側網域，右側才會顯示它的 DNS 紀錄。",
      },
      {
        selector: '[data-guide="domain-records"]',
        title: "在這裡搜尋或新增 DNS 紀錄",
        text: "搜尋框用來找既有紀錄；「新增紀錄」會建立名稱與 IP／服務之間的對應。不確定紀錄類型時不要直接修改正式網域。",
      },
    ],
  },
  "/ai-api": {
    id: "ai-api",
    guideVersion: "v6",
    title: "AI API",
    icon: "psychology",
    steps: [
      {
        selector: '[data-guide="ai-stats"]',
        title: "這四個數字是你的申請與金鑰數量",
        text: "「使用中金鑰」是現在可呼叫 API 的數量；「過期金鑰」已不能使用；「已通過申請」不一定等於目前有效金鑰數。",
      },
      {
        selector: '[data-guide="ai-tabs"]',
        title: "四個分頁是一套完整流程",
        text: "先申請、核准後到 API Keys 取用、在申請紀錄追蹤審核，最後到我的用量查看實際消耗。接下來會真的進入每個分頁操作。",
      },
      {
        selector: '[data-guide-tab="apply"]',
        activateSelector: '[data-guide-tab="apply"]',
        title: "申請：取得 AI API 使用資格",
        text: "這頁是用來告訴審核者「哪個專案要用 AI、要用多久」。送出後不會立刻拿到金鑰，需要等待審核通過。",
      },
      {
        selector: '[data-guide="ai-apply-name"]',
        activateSelector: '[data-guide-tab="apply"]',
        title: "金鑰名稱是給自己辨認的",
        text: "建議填課程或專案名稱，例如「畢業專題聊天機器人」。它不是 API Key 本身，之後可以修改。",
      },
      {
        selector: '[data-guide="ai-apply-purpose"]',
        activateSelector: '[data-guide-tab="apply"]',
        title: "申請目的會提供給審核者",
        text: "至少填 10 個字，清楚寫出課程、專題以及預計串接的功能，比只寫「測試」更容易讓審核者理解。",
      },
      {
        selector: '[data-guide="ai-apply-duration"]',
        activateSelector: '[data-guide-tab="apply"]',
        title: "有效期限決定金鑰能用多久",
        text: "短期作業可選幾天，長期專題再選較長期限。到期後 API Key 會停止使用，但不會刪除你的申請紀錄。",
      },
      {
        selector: '[data-guide="ai-submit"]',
        activateSelector: '[data-guide-tab="apply"]',
        title: "資料完整後再送出",
        text: "按鈕變亮表示內容符合基本條件。送出後到「申請紀錄」查看進度；核准後再到「API Keys」複製金鑰。",
      },
      {
        selector: '[data-guide-tab="keys"]',
        activateSelector: '[data-guide-tab="keys"]',
        title: "API Keys：取得程式需要的連線資料",
        text: "申請核准後才會在這頁出現金鑰。程式通常需要 Base URL 與 API Key 兩個值；API Key 等同密碼，不要貼到作業或公開儲存庫。",
      },
      {
        selector: '[data-guide="ai-keys-content"]',
        activateSelector: '[data-guide-tab="keys"]',
        title: "每張卡片代表一把已核發的金鑰",
        text: "狀態顯示金鑰是否能用，也會列出建立與到期時間。若畫面顯示「尚無金鑰」，代表還沒有申請通過。",
      },
      {
        selector: '[data-guide="ai-key-actions"]',
        activateSelector: '[data-guide-tab="keys"]',
        conditionSelector: '[data-guide-tab="keys"][data-guide-has-content="true"]',
        title: "顯示、複製、刷新與刪除的差別",
        text: "複製用於貼到自己的程式；刷新會產生新 Key 並讓舊 Key 失效；刪除後無法復原，正在使用它的程式也會連線失敗。",
      },
      {
        selector: '[data-guide-tab="records"]',
        activateSelector: '[data-guide-tab="records"]',
        title: "申請紀錄：確認審核走到哪裡",
        text: "所有送出的 AI API 申請都保留在這頁。它只顯示申請與審核結果，不是拿取金鑰的地方。",
      },
      {
        selector: '[data-guide="ai-records-content"]',
        activateSelector: '[data-guide-tab="records"]',
        title: "狀態與備註告訴你下一步",
        text: "「待審核」表示尚未處理；「已通過」後到 API Keys 取用；「已拒絕」時查看審核備註，再依原因重新調整申請。",
      },
      {
        selector: '[data-guide-tab="usage"]',
        activateSelector: '[data-guide-tab="usage"]',
        title: "我的用量：了解程式實際用了多少 AI",
        text: "這頁用來查使用趨勢與 Token 消耗，不會顯示或修改 API Key。大量增加時，可以回頭檢查程式是否重複呼叫。",
      },
      {
        selector: '[data-guide="ai-usage-panel"]',
        activateSelector: '[data-guide-tab="usage"]',
        title: "先選擇要統計的日期範圍",
        text: "7、30、90 天只會改變報表範圍，不會限制金鑰期限。右側日期是目前報表實際包含的開始與結束日期。",
      },
      {
        selector: '[data-guide="ai-proxy-usage"]',
        activateSelector: '[data-guide-tab="usage"]',
        title: "Proxy 用量是直接呼叫 AI API 的消耗",
        text: "總呼叫次數是請求數；輸入 Tokens 是送給模型的文字量，輸出 Tokens 是模型回覆量，下方可再查看各模型的用量。",
      },
      {
        selector: '[data-guide="ai-template-usage"]',
        activateSelector: '[data-guide-tab="usage"]',
        title: "Template 用量是範本功能產生的消耗",
        text: "這裡統計透過 AI Template API 執行的呼叫，與上方直接呼叫分開計算，可用來判斷哪一類功能消耗較多。",
      },
    ],
  },
};

const SPOTLIGHT_GAP = 8;
const PANEL_WIDTH = 420;
const PANEL_HEIGHT = 320;
const VIEWPORT_GAP = 16;

function getPanelPosition(rect) {
  const width = Math.min(PANEL_WIDTH, window.innerWidth - VIEWPORT_GAP * 2);
  const spaceRight = window.innerWidth - rect.right;
  const spaceLeft = rect.left;
  const spaceBelow = window.innerHeight - rect.bottom;

  let left;
  let top;
  let side;

  if (spaceRight >= width + 28) {
    left = rect.right + 20;
    top = rect.top;
    side = "right";
  } else if (spaceLeft >= width + 28) {
    left = rect.left - width - 20;
    top = rect.top;
    side = "left";
  } else if (spaceBelow >= PANEL_HEIGHT + 20) {
    left = rect.left;
    top = rect.bottom + 16;
    side = "bottom";
  } else {
    left = rect.left;
    top = rect.top - PANEL_HEIGHT - 16;
    side = "top";
  }

  return {
    left: Math.max(VIEWPORT_GAP, Math.min(left, window.innerWidth - width - VIEWPORT_GAP)),
    top: Math.max(VIEWPORT_GAP, Math.min(top, window.innerHeight - PANEL_HEIGHT - VIEWPORT_GAP)),
    width,
    side,
  };
}

export default function UserGuide() {
  const location = useLocation();
  const { user } = useAuth();
  const isStudent = user?.role === "student" && !user?.is_superuser;
  const isStudentCoursePage = /^\/dashboard\/course\/[^/]+$/.test(location.pathname);
  const guide = isStudentCoursePage
    ? {
        ...PAGE_GUIDES["/dashboard"],
        id: "student-course",
        title: "課程頁面",
        steps: PAGE_GUIDES["/dashboard"].steps.filter(
          (item) => item.selector !== '[data-guide="home-schedule"]'
            && item.selector !== '[data-guide="home-other-needs"]'
        ),
      }
    : PAGE_GUIDES[location.pathname] ?? null;
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [targetRect, setTargetRect] = useState(null);
  const originalAiTab = useRef(null);

  const availableSteps = useMemo(() => {
    if (!guide || typeof document === "undefined") return [];
    return guide.steps.filter((item) => {
      if (item.conditionSelector && !document.querySelector(item.conditionSelector)) return false;
      const targetExists = document.querySelector(item.selector);
      if (item.optional) return targetExists;
      return targetExists
        || (item.activateSelector && document.querySelector(item.activateSelector));
    });
  }, [guide, open]);

  const current = availableSteps[step] ?? availableSteps[0];
  const storageKey = guide
    ? `skylab:user-guide:${guide.guideVersion ?? "v5"}:${user?.id ?? user?.email ?? "user"}:${guide.id}`
    : null;
  const isLast = step >= availableSteps.length - 1;

  useEffect(() => {
    setOpen(false);
    setStep(0);
    setTargetRect(null);
  }, [guide?.id]);

  useEffect(() => {
    if (!guide || !isStudent || !storageKey) return undefined;

    try {
      if (localStorage.getItem(storageKey) === "completed") return undefined;
    } catch {
      // 儲存空間不可用時，仍保留學生首次進入頁面的主動導覽。
    }

    const timer = window.setTimeout(() => {
      setStep(0);
      setOpen(true);
    }, 500);

    return () => window.clearTimeout(timer);
  }, [guide?.id, isStudent, storageKey]);

  useLayoutEffect(() => {
    if (!open || !current) {
      setTargetRect(null);
      return undefined;
    }

    setTargetRect(null);
    let target = null;
    let observer = null;
    let frame = null;
    let targetTimer = null;
    let settleTimer = null;
    let targetAttempts = 0;

    const update = () => {
      if (!target) return;
      const rect = target.getBoundingClientRect();
      setTargetRect({
        top: Math.max(0, rect.top - SPOTLIGHT_GAP),
        left: Math.max(0, rect.left - SPOTLIGHT_GAP),
        right: Math.min(window.innerWidth, rect.right + SPOTLIGHT_GAP),
        bottom: Math.min(window.innerHeight, rect.bottom + SPOTLIGHT_GAP),
        width: Math.min(window.innerWidth, rect.right + SPOTLIGHT_GAP) - Math.max(0, rect.left - SPOTLIGHT_GAP),
        height: Math.min(window.innerHeight, rect.bottom + SPOTLIGHT_GAP) - Math.max(0, rect.top - SPOTLIGHT_GAP),
      });
    };

    const activate = current.activateSelector
      ? document.querySelector(current.activateSelector)
      : null;
    if (activate && activate.getAttribute("aria-selected") !== "true") activate.click();

    const attachTarget = () => {
      target = document.querySelector(current.selector);
      if (!target && targetAttempts < 12) {
        targetAttempts += 1;
        targetTimer = window.setTimeout(attachTarget, 100);
        return;
      }
      target ??= activate;
      if (!target) return;
      target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      frame = window.requestAnimationFrame(update);
      settleTimer = window.setTimeout(update, 360);
      observer = new ResizeObserver(update);
      observer.observe(target);
    };

    targetTimer = window.setTimeout(attachTarget, current.activateSelector ? 80 : 0);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.clearTimeout(targetTimer);
      window.clearTimeout(settleTimer);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      observer?.disconnect();
    };
  }, [current, open]);

  if (!guide) return null;

  const complete = () => {
    try {
      localStorage.setItem(storageKey, "completed");
    } catch {
      // 儲存空間不可用時，只關閉本次導覽。
    }
    setOpen(false);
    setStep(0);
    if (guide.id === "ai-api" && originalAiTab.current) {
      document.querySelector(`[data-guide-tab="${originalAiTab.current}"]`)?.click();
      originalAiTab.current = null;
    }
  };

  const start = () => {
    if (guide.id === "ai-api") {
      originalAiTab.current = document.querySelector('[data-guide-tab][aria-selected="true"]')?.dataset.guideTab ?? null;
    }
    setStep(0);
    window.setTimeout(() => setOpen(true), 80);
  };

  const next = () => {
    if (isLast) complete();
    else setStep((value) => value + 1);
  };

  const panelPosition = targetRect ? getPanelPosition(targetRect) : null;

  return (
    <>
      <button
        type="button"
        className={styles.helpButton}
        onClick={start}
        aria-label={`開啟${guide.title}導覽`}
        title={`${guide.title}導覽`}
      >
        <MIcon name="help_outline" size={21} />
        <span>使用導覽</span>
      </button>

      {open && current && targetRect && panelPosition && (
        <div className={styles.layer}>
          <div className={styles.guideBackdrop} aria-hidden="true" />
          <div
            className={styles.spotlight}
            style={{
              top: targetRect.top,
              left: targetRect.left,
              width: targetRect.width,
              height: targetRect.height,
            }}
          />
          <button
            type="button"
            className={styles.targetShield}
            style={{
              top: targetRect.top,
              left: targetRect.left,
              width: targetRect.width,
              height: targetRect.height,
            }}
            onClick={next}
            aria-label="下一個導覽步驟"
          />

          <section
            className={styles.panel}
            data-side={panelPosition.side}
            style={{ left: panelPosition.left, top: panelPosition.top, width: panelPosition.width }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="global-guide-title"
          >
            <div className={styles.header}>
              <span className={styles.icon}><MIcon name={guide.icon} size={22} /></span>
              <div>
                <small>{guide.title} · 元件導覽</small>
                <strong>{step + 1} / {availableSteps.length}</strong>
              </div>
              <button type="button" onClick={complete} aria-label="關閉導覽">
                <MIcon name="close" size={19} />
              </button>
            </div>

            <div className={styles.content}>
              <h2 id="global-guide-title">{current.title}</h2>
              <p>{current.text}</p>
            </div>

            <div className={styles.progress} aria-label={`導覽進度 ${step + 1} / ${availableSteps.length}`}>
              {availableSteps.map((item, index) => (
                <span key={item.selector} className={index <= step ? styles.progressActive : ""} />
              ))}
            </div>

            <div className={styles.actions}>
              <button type="button" className={styles.skip} onClick={complete}>跳過導覽</button>
              <div>
                {step > 0 && (
                  <button type="button" className={styles.back} onClick={() => setStep((value) => value - 1)}>
                    上一步
                  </button>
                )}
                <button type="button" className={styles.next} onClick={next}>
                  {isLast ? "完成" : "下一步"}
                  <MIcon name={isLast ? "check" : "arrow_forward"} size={17} />
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
