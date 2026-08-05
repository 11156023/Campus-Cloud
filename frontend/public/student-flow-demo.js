const state = {
  step: 1,
  purpose: "development",
  environment: "linux",
  duration: "month",
  name: "research-chen",
  feature: "course",
  visitedFeatures: new Set(),
  machineOn: true,
  snapshots: [
    { name: "skylab-init", note: "老師提供的初始狀態", date: "2026/07/21 12:50", locked: true },
    { name: "完成權限練習", note: "下課前建立", date: "2026/07/21 16:42", locked: false },
  ],
  cores: 2,
  memory: 4,
  disk: 40,
  gpu: "none",
  access: "private",
  firewall: "safe",
  port: 8080,
  https: true,
  autoDomain: true,
  requestStatus: "review",
  aiKey: "",
  tourIndex: -1,
};

const purposes = {
  development: { title: "一般程式開發", icon: "◇", description: "開發程式、網站、API 或研究原型。", tag: "常用" },
  data: { title: "資料分析／運算", icon: "▥", description: "處理資料、執行分析或長時間運算。" },
  ai: { title: "AI 或 GPU 研究", icon: "✦", description: "需要模型、推論、訓練或 GPU 加速。" },
  custom: { title: "我想自己設定", icon: "⌘", description: "自行選擇系統、硬體與網路設定。" },
};

const environments = {
  development: [
    { id: "linux", title: "研究開發環境", description: "適合程式、網站、API 與一般研究原型", meta: "Ubuntu · 開發工具", ready: "審核後約 3 分鐘", icon: ">_" },
    { id: "web", title: "公開網站研究環境", description: "包含測試網址與安全的 HTTPS 設定", meta: "Web Stack · 自動 HTTPS", ready: "審核後約 5 分鐘", icon: "◇" },
  ],
  data: [
    { id: "python", title: "資料分析環境", description: "已安裝 Python、Jupyter 與常用分析套件", meta: "Python · Jupyter", ready: "審核後約 3 分鐘", icon: "Py" },
    { id: "compute", title: "長時間運算環境", description: "適合需要較多 CPU 與記憶體的研究", meta: "8 核心 · 16 GB", ready: "需確認研究配額", icon: "▥" },
  ],
  ai: [
    { id: "gpu", title: "AI / GPU 研究環境", description: "已安裝 Python、Jupyter 與常用 AI 套件", meta: "GPU · Jupyter", ready: "需審核 GPU 配額", icon: "✦" },
    { id: "python", title: "AI 開發環境（無 GPU）", description: "適合 API 串接、資料前處理與小型模型", meta: "Python · Jupyter", ready: "審核後約 3 分鐘", icon: "Py" },
  ],
  custom: [
    { id: "desktop", title: "完整虛擬電腦", description: "可使用桌面與完整作業系統功能", meta: "虛擬機（VM）", ready: "審核後約 5 分鐘", icon: "▣" },
    { id: "linux", title: "輕量研究環境", description: "啟動快速，適合指令與服務研究", meta: "容器（LXC）", ready: "審核後約 2 分鐘", icon: ">_" },
  ],
};

const durations = {
  week: { title: "7 天", description: "短期研究與測試" },
  month: { title: "30 天", description: "一般研究專題" },
  semester: { title: "到本學期末", description: "需較長期使用" },
};

const wizardContent = document.querySelector("#wizard-content");
const backButton = document.querySelector("#back-button");
const nextButton = document.querySelector("#next-button");
const stepHint = document.querySelector("#step-hint");
const featureContent = document.querySelector("#feature-content");
let toastTimer;

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  }[char]));
}

function selectedEnvironment() {
  return environments[state.purpose].find((item) => item.id === state.environment) || environments[state.purpose][0];
}

function ensureEnvironmentSelection() {
  if (!environments[state.purpose].some((item) => item.id === state.environment)) {
    state.environment = environments[state.purpose][0].id;
  }
}

function renderPurposeStep() {
  wizardContent.innerHTML = `
    <div class="wizard-intro">
      <p class="eyebrow">第 1 步，共 4 步</p>
      <h2>這台研究機器要用來做什麼？</h2>
      <p>課堂練習不需要填這裡。自主研究只要先選最接近的用途。</p>
    </div>
    <div class="option-grid">
      ${Object.entries(purposes).map(([id, item]) => `
        <button type="button" class="option-card ${state.purpose === id ? "selected" : ""}" data-select-purpose="${id}" aria-pressed="${state.purpose === id}">
          <span class="option-icon" aria-hidden="true">${item.icon}</span>
          <div>
            <strong>${item.title}</strong>
            <small>${item.description}</small>
            ${item.tag ? `<small class="option-tag">${item.tag}</small>` : ""}
          </div>
        </button>
      `).join("")}
    </div>`;
}

function renderEnvironmentStep() {
  ensureEnvironmentSelection();
  wizardContent.innerHTML = `
    <div class="wizard-intro">
      <p class="eyebrow">第 2 步，共 4 步</p>
      <h2>選擇研究需要的能力</h2>
      <p>已依「${purposes[state.purpose].title}」排序，第一個是系統建議。</p>
    </div>
    <div class="environment-list">
      ${environments[state.purpose].map((item, index) => `
        <button type="button" class="environment-card ${state.environment === item.id ? "selected" : ""}" data-select-environment="${item.id}" aria-pressed="${state.environment === item.id}">
          <span class="option-icon" aria-hidden="true">${item.icon}</span>
          <span class="environment-meta">
            <strong>${item.title}${index === 0 ? ' <span class="badge recommended">系統建議</span>' : ""}</strong>
            <span>${item.description}</span>
            <span>${item.meta}</span>
          </span>
          <span class="environment-spec"><strong>${item.ready}</strong><span>預計建立時間</span></span>
        </button>
      `).join("")}
    </div>`;
}

function renderDurationStep() {
  wizardContent.innerHTML = `
    <div class="wizard-intro">
      <p class="eyebrow">第 3 步，共 4 步</p>
      <h2>研究名稱與預計使用期間</h2>
      <p>研究期限會影響配額與審核；大多數情況不需要調整技術規格。</p>
    </div>
    <div class="form-grid">
      <div class="field full">
        <label for="environment-name">研究機器名稱</label>
        <input id="environment-name" value="${escapeHtml(state.name)}" maxlength="32" autocomplete="off" />
        <span class="field-hint">用來辨認研究用途，可以保持預設名稱。</span>
      </div>
      <div class="duration-options" role="group" aria-label="使用時間">
        ${Object.entries(durations).map(([id, item]) => `
          <button type="button" class="choice-chip ${state.duration === id ? "selected" : ""}" data-select-duration="${id}" aria-pressed="${state.duration === id}">
            <strong>${item.title}</strong><span>${item.description}</span>
          </button>
        `).join("")}
      </div>
      <details class="advanced">
        <summary>進階設定（大多數人不用改）</summary>
        <div class="advanced-content">
          <div class="mini-setting"><span>處理器</span><strong>2 核心 · 建議值</strong></div>
          <div class="mini-setting"><span>記憶體</span><strong>4 GB · 建議值</strong></div>
          <div class="mini-setting"><span>網路</span><strong>僅校園內可用</strong></div>
        </div>
      </details>
    </div>`;
  document.querySelector("#environment-name").addEventListener("input", (event) => {
    state.name = event.target.value;
    updateNavigation();
  });
}

function renderReviewStep() {
  const environment = selectedEnvironment();
  wizardContent.innerHTML = `
    <div class="wizard-intro">
      <p class="eyebrow">第 4 步，共 4 步</p>
      <h2>確認研究機器申請</h2>
      <p>送出後會進入審核；你不需要留在頁面等待。</p>
    </div>
    <div class="review-grid">
      <section class="review-panel" aria-label="申請摘要">
        <div class="review-row"><span>研究用途</span><strong>${purposes[state.purpose].title}</strong><button class="review-edit" type="button" data-go-step="1">修改</button></div>
        <div class="review-row"><span>環境</span><strong>${environment.title}</strong><button class="review-edit" type="button" data-go-step="2">修改</button></div>
        <div class="review-row"><span>名稱</span><strong>${escapeHtml(state.name)}</strong><button class="review-edit" type="button" data-go-step="3">修改</button></div>
        <div class="review-row"><span>使用時間</span><strong>${durations[state.duration].title}</strong><button class="review-edit" type="button" data-go-step="3">修改</button></div>
        <div class="review-row"><span>預計建立</span><strong>${environment.ready}</strong><span></span></div>
        <div class="review-row"><span>配額影響</span><strong>使用研究資源配額，不影響課堂機器</strong><span></span></div>
      </section>
      <aside class="after-submit">
        <h3>送出後會發生什麼？</h3>
        <ol><li>審核研究用途與配額。</li><li>通過後自動建立研究機器。</li><li>首頁出現「開啟研究機器」。</li></ol>
      </aside>
    </div>`;
}

function renderWizard() {
  if (state.step === 1) renderPurposeStep();
  if (state.step === 2) renderEnvironmentStep();
  if (state.step === 3) renderDurationStep();
  if (state.step === 4) renderReviewStep();

  document.querySelectorAll("[data-step-indicator]").forEach((indicator) => {
    const indicatorStep = Number(indicator.dataset.stepIndicator);
    indicator.classList.toggle("active", indicatorStep === state.step);
    indicator.classList.toggle("complete", indicatorStep < state.step);
    indicator.querySelector("span").textContent = indicatorStep < state.step ? "✓" : String(indicatorStep);
  });
  updateNavigation();
}

function updateNavigation() {
  backButton.style.visibility = state.step === 1 ? "hidden" : "visible";
  nextButton.innerHTML = state.step === 4 ? "確認送出" : '下一步 <span aria-hidden="true">→</span>';
  nextButton.disabled = state.step === 3 && !state.name.trim();
  const hints = {
    1: "選一個最接近的用途即可，之後還能修改。",
    2: "推薦方案已經包含完成需求需要的工具。",
    3: "不確定時，保持預設值就可以。",
    4: "這是 Demo，確認送出不會送出真實申請。",
  };
  stepHint.textContent = hints[state.step];
}

function showView(viewId) {
  document.querySelectorAll(".view").forEach((view) => view.classList.add("hidden"));
  document.querySelector(`#${viewId}`).classList.remove("hidden");
  document.querySelector("#main-content").focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 2600);
}

function startFlow() {
  state.step = 1;
  showView("flow-view");
  renderWizard();
}

function resetDemo() {
  Object.assign(state, {
    step: 1, purpose: "development", environment: "linux", duration: "month", name: "research-chen",
    feature: "course", machineOn: true, cores: 2, memory: 4, disk: 40, gpu: "none",
    access: "private", firewall: "safe", port: 8080, https: true, autoDomain: true,
    requestStatus: "review", aiKey: "", tourIndex: -1,
  });
  state.snapshots = [
    { name: "skylab-init", note: "老師提供的初始狀態", date: "2026/07/21 12:50", locked: true },
    { name: "完成權限練習", note: "下課前建立", date: "2026/07/21 16:42", locked: false },
  ];
  state.visitedFeatures.clear();
  document.body.classList.remove("demo-dark");
  clearTourHighlight();
  document.querySelector("#tour-guide").classList.add("hidden");
  closeModal();
  showView("home-view");
  showToast("Demo 已重設");
}

function submitDemo() {
  const environment = selectedEnvironment();
  document.querySelector("#success-environment").textContent = environment.title;
  document.querySelector("#success-name").textContent = state.name;
  showView("success-view");
}

const featureMeta = {
  course: { title: "課堂機器", desc: "老師分發的機器會依課程出現；上課與下課練習沿用同一台。", badge: "課程來源" },
  resource: { title: "機器操作", desc: "依目前狀態只突出一個主要動作，其他操作放在次要區域。", badge: "我的環境" },
  backup: { title: "快照與重置", desc: "建立還原點、回復資料，並清楚區分還原與全部重置。", badge: "資料保護" },
  specs: { title: "規格與 GPU", desc: "學生看得懂需求與配額；超過建議值時才送出規格調整申請。", badge: "研究機器" },
  monitor: { title: "監控與操作紀錄", desc: "先顯示環境是否健康，完整圖表與事件放在技術資訊。", badge: "技術資訊" },
  network: { title: "網路、發布與防火牆", desc: "把 Port、網域、HTTPS、反向代理與防火牆整合成「發布服務」流程。", badge: "進階設定" },
  requests: { title: "申請與進度", desc: "每個狀態都回答下一步，包含等待、補件、失敗、取消與重試。", badge: "自主研究" },
  ai: { title: "AI API", desc: "以申請、取得金鑰、複製範例與查看用量的順序帶學生完成。", badge: "更多服務" },
  settings: { title: "帳號、安全與協助", desc: "個人資料、密碼、語言、外觀和求助集中於個人選單。", badge: "個人選單" },
};

function featureHeader(key) {
  const item = featureMeta[key];
  return `<header class="feature-stage-header"><div><h2>${item.title}</h2><p>${item.desc}</p></div><span class="origin-badge">${item.badge}</span></header>`;
}

function renderCourseFeature() {
  return `${featureHeader("course")}
    <section class="machine-card" data-tour-target="course-machine">
      <div class="machine-head"><div class="machine-name"><strong>Linux 系統管理 · 課堂機器</strong><span>王老師分發 · CS-LINUX-1141 · 資料保留至學期末</span></div><span class="status-pill">已就緒</span></div>
      <div class="machine-meta"><div><span>目前課堂</span><strong>檔案權限</strong></div><div><span>上次進度</span><strong>3 / 5 任務</strong></div><div><span>機器狀態</span><strong>${state.machineOn ? "執行中" : "已關機"}</strong></div><div><span>資料期限</span><strong>2027/01/31</strong></div></div>
      <div class="button-row"><button class="mini-button primary" type="button" data-action="open-class">進入今天的課堂</button><button class="mini-button" type="button" data-action="watch-broadcast">觀看老師直播</button><button class="mini-button" type="button" data-action="start-after-class">下課後繼續練習</button></div>
    </section>
    <section class="feature-section"><div class="feature-section-title"><h3>課堂狀態會主動說明下一步</h3><span>學生不需要管理課程資源</span></div><div class="demo-grid three">
      <article class="demo-panel soft"><h3>上課前</h3><p>老師已分發機器；若尚未開機，只顯示「等待老師準備」。</p><span class="badge recommended">不用申請</span></article>
      <article class="demo-panel"><h3>上課中</h3><p>直接進入教材、控制台與題目，不暴露模板或節點設定。</p><span class="badge">單一入口</span></article>
      <article class="demo-panel"><h3>下課後</h3><p>沿用原機器，關機保留資料；重置才會清除練習內容。</p><span class="badge waiting">保留進度</span></article>
    </div></section>`;
}

function renderResourceFeature() {
  const status = state.machineOn ? "執行中" : "已關機";
  return `${featureHeader("resource")}
    <section class="machine-card">
      <div class="machine-head"><div class="machine-name"><strong>research-chen</strong><span>自主研究機器 · Ubuntu 24.04 · VMID 218</span></div><span class="status-pill ${state.machineOn ? "" : "off"}">${status}</span></div>
      <div class="machine-meta"><div><span>IP 位址</span><strong>${state.machineOn ? "10.20.8.31" : "—"}</strong></div><div><span>CPU / RAM</span><strong>2 核 / 4 GB</strong></div><div><span>到期日</span><strong>2026/08/27</strong></div><div><span>來源</span><strong>自主研究</strong></div></div>
      <div class="feature-section-title"><h3>電源控制</h3><span>關機保留資料，刪除才會清除</span></div>
      <div class="button-row" data-tour-target="power-controls"><button class="mini-button primary" type="button" data-power="start" ${state.machineOn ? "disabled" : ""}>開機</button><button class="mini-button" type="button" data-power="stop" ${state.machineOn ? "" : "disabled"}>關機</button><button class="mini-button" type="button" data-power="reboot" ${state.machineOn ? "" : "disabled"}>重新啟動</button><button class="mini-button danger" type="button" data-action="delete-explain">刪除說明</button></div>
    </section>
    <section class="feature-section" data-tour-target="console-actions"><div class="feature-section-title"><h3>連線與協作</h3><span>可試用模擬視窗</span></div><div class="demo-grid three">
      <article class="demo-panel"><h3>終端機 / 控制台</h3><p>依機器類型直接開啟 SSH 終端或圖形桌面。</p><button class="mini-button primary" type="button" data-action="open-console" ${state.machineOn ? "" : "disabled"}>開啟終端機</button></article>
      <article class="demo-panel"><h3>複製連線指令</h3><p>不必自行組合 IP、使用者與 Port。</p><button class="mini-button" type="button" data-action="copy-ssh">複製 SSH 指令</button></article>
      <article class="demo-panel"><h3>邀請同學協作</h3><p>產生限時、可撤銷的共同操作邀請。</p><button class="mini-button" type="button" data-action="invite-peer">建立協作邀請</button></article>
    </div></section>`;
}

function renderBackupFeature() {
  return `${featureHeader("backup")}
    <section class="feature-section" data-tour-target="snapshot-actions"><div class="feature-section-title"><h3>還原點</h3><button class="mini-button primary" type="button" data-action="create-snapshot">＋ 建立還原點</button></div><div class="demo-panel">
      ${state.snapshots.map((item) => `<div class="snapshot-row"><div><strong>${item.name}${item.locked ? ' <span class="badge recommended">初始狀態</span>' : ""}</strong><span>${item.note} · ${item.date}</span></div><div class="button-row"><button class="mini-button" type="button" data-restore="${item.name}">還原</button>${item.locked ? "" : `<button class="mini-button danger" type="button" data-delete-snapshot="${item.name}">刪除</button>`}</div></div>`).join("")}
    </div></section>
    <section class="feature-section"><div class="demo-grid"><article class="demo-panel warning"><h3>重置課堂環境</h3><p>回到老師提供的初始狀態，個人練習變更會消失。</p><button class="mini-button danger" type="button" data-action="reset-machine">查看重置影響</button></article><article class="demo-panel soft"><h3>關機不等於重置</h3><p>關機只停止用量並保留檔案；再次開機可繼續進度。</p><button class="mini-button" type="button" data-action="backup-help">比較三種操作</button></article></div></section>`;
}

function renderSpecsFeature() {
  return `${featureHeader("specs")}
    <section class="feature-section" data-tour-target="spec-controls"><div class="feature-section-title"><h3>研究機器規格</h3><span>目前配額：8 核心 / 16 GB / 200 GB</span></div><div class="demo-panel control-list">
      <div class="control-row"><label for="cores-range">CPU 核心</label><input id="cores-range" type="range" min="1" max="8" value="${state.cores}" data-spec="cores" /><strong id="cores-value">${state.cores} 核心</strong></div>
      <div class="control-row"><label for="memory-range">記憶體</label><input id="memory-range" type="range" min="1" max="16" value="${state.memory}" data-spec="memory" /><strong id="memory-value">${state.memory} GB</strong></div>
      <div class="control-row"><label for="disk-range">硬碟空間</label><input id="disk-range" type="range" min="20" max="200" step="10" value="${state.disk}" data-spec="disk" /><strong id="disk-value">${state.disk} GB</strong></div>
      <div class="control-row"><label for="gpu-select">GPU 加速<small>依時段與配額檢查</small></label><select id="gpu-select" data-spec="gpu"><option value="none" ${state.gpu === "none" ? "selected" : ""}>不需要 GPU</option><option value="t4" ${state.gpu === "t4" ? "selected" : ""}>NVIDIA T4 · 目前可用</option><option value="a100" ${state.gpu === "a100" ? "selected" : ""}>NVIDIA A100 · 需教師核准</option></select><strong>${state.gpu === "none" ? "0 張" : "1 張"}</strong></div>
    </div><div class="button-row" style="margin-top:12px"><button class="mini-button primary" type="button" data-action="save-specs">送出規格調整申請</button><button class="mini-button" type="button" data-action="recommend-specs">套用系統建議</button></div></section>`;
}

function renderMonitorFeature() {
  const heights = [22, 35, 28, 56, 46, 62, 39, 52, 71, 48, 33, 42, 60, 37, 29, 45];
  return `${featureHeader("monitor")}
    <section class="feature-section" data-tour-target="monitor-charts"><div class="metric-grid"><div class="metric-card"><span>環境健康</span><strong>正常</strong><small>沒有需要處理的問題</small></div><div class="metric-card"><span>CPU</span><strong>34%</strong><small>低於建議上限</small></div><div class="metric-card"><span>記憶體</span><strong>2.8 GB</strong><small>剩餘 1.2 GB</small></div><div class="metric-card"><span>網路</span><strong>12 MB</strong><small>最近 1 小時</small></div></div>
      <div class="feature-section-title" style="margin-top:18px"><h3>使用趨勢</h3><div class="segmented"><button class="active" type="button" data-monitor-range="hour">1 小時</button><button type="button" data-monitor-range="day">1 天</button><button type="button" data-monitor-range="week">1 週</button></div></div><div class="chart" aria-label="CPU 使用量示意圖">${heights.map((height) => `<span class="chart-bar" style="height:${height}%" title="${height}%"></span>`).join("")}</div>
    </section><section class="feature-section"><div class="feature-section-title"><h3>最近事件</h3><span>只有需要排錯時才展開</span></div><div class="event-list"><div class="event-item"><time>14:32</time><span>使用者開啟終端機</span></div><div class="event-item"><time>13:58</time><span>機器啟動完成</span></div><div class="event-item"><time>昨天</time><span>建立還原點「完成權限練習」</span></div></div></section>`;
}

function renderNetworkFeature() {
  const publicUrl = state.access === "private" ? "尚未公開" : state.autoDomain ? "https://research-chen.skylab.edu.tw" : `https://10.20.8.31:${state.port}`;
  return `${featureHeader("network")}
    <section class="feature-section" data-tour-target="firewall-config"><div class="feature-section-title"><h3>防火牆保護</h3><span>使用情境預設，仍可查看實際規則</span></div><div class="demo-panel">
      <div class="control-row"><label>防火牆預設</label><div class="segmented"><button type="button" data-firewall="safe" class="${state.firewall === "safe" ? "active" : ""}">安全</button><button type="button" data-firewall="website" class="${state.firewall === "website" ? "active" : ""}">網站</button><button type="button" data-firewall="internal" class="${state.firewall === "internal" ? "active" : ""}">校內</button></div><strong>${state.firewall === "safe" ? "只允許自己的連線" : state.firewall === "website" ? "開放 HTTPS" : "限校園網路"}</strong></div>
      <div class="firewall-rule"><span class="rule-action">允許</span><span>TCP</span><span>${state.firewall === "website" ? "443" : "22"}</span><span>${state.firewall === "internal" ? "校園網路" : state.firewall === "website" ? "所有人" : "我的帳號"}</span></div>
      <div class="button-row" style="margin-top:10px"><button class="mini-button" type="button" data-action="add-firewall-rule">＋ 新增自訂規則</button><button class="mini-button" type="button" data-action="firewall-help">什麼時候需要修改？</button></div>
    </div></section>
    <section class="feature-section" data-tour-target="publish-config"><div class="feature-section-title"><h3>發布服務</h3><span>整合 Port、網域、HTTPS 與反向代理</span></div><div class="demo-panel control-list">
      <div class="control-row"><label>誰可以存取</label><div class="segmented"><button type="button" data-access="private" class="${state.access === "private" ? "active" : ""}">不公開</button><button type="button" data-access="website" class="${state.access === "website" ? "active" : ""}">公開網站</button><button type="button" data-access="port" class="${state.access === "port" ? "active" : ""}">公開 Port</button></div><strong>${state.access === "private" ? "最安全" : "需防火牆規則"}</strong></div>
      <div class="control-row"><label for="service-port">服務 Port</label><input id="service-port" type="number" min="1" max="65535" value="${state.port}" data-network="port" ${state.access === "private" ? "disabled" : ""} /><strong>${state.port}</strong></div>
      <div class="control-row"><label>HTTPS</label><button class="switch ${state.https ? "on" : ""}" type="button" data-action="toggle-https" aria-pressed="${state.https}"></button><strong>${state.https ? "自動憑證" : "關閉"}</strong></div>
      <div class="control-row"><label>自動網域</label><button class="switch ${state.autoDomain ? "on" : ""}" type="button" data-action="toggle-domain" aria-pressed="${state.autoDomain}"></button><strong>${state.autoDomain ? "由反向代理連接" : "使用 IP"}</strong></div>
      <div class="publish-preview"><span>學生最後會拿到的網址</span><code>${publicUrl}</code></div>
    </div><div class="button-row" style="margin-top:12px"><button class="mini-button primary" type="button" data-action="apply-network">套用發布設定</button><button class="mini-button" type="button" data-action="network-explain">查看流量路徑</button></div></section>`;
}

function renderRequestsFeature() {
  const statusLabel = state.requestStatus === "review" ? "等待審核" : state.requestStatus === "revision" ? "需要補件" : state.requestStatus === "failed" ? "建立失敗" : "已核准";
  return `${featureHeader("requests")}
    <section class="feature-section" data-tour-target="request-timeline"><div class="demo-panel soft"><div class="machine-head"><div class="machine-name"><strong>AI 模型效能研究</strong><span>研究機器申請 · 2026/07/28 送出</span></div><span class="status-pill ${state.requestStatus === "failed" ? "off" : ""}">${statusLabel}</span></div>
      <ol class="request-timeline"><li class="done"><i></i><span>已送出</span></li><li class="${state.requestStatus === "revision" ? "current" : "done"}"><i></i><span>資料檢查</span></li><li class="${state.requestStatus === "review" ? "current" : state.requestStatus === "approved" ? "done" : ""}"><i></i><span>審核</span></li><li class="${state.requestStatus === "approved" ? "current" : ""}"><i></i><span>建立機器</span></li></ol>
      <p style="margin:18px 0 10px;color:var(--muted);font-size:12px">${state.requestStatus === "review" ? "目前不需要任何操作，通常 1 個工作天內完成。" : state.requestStatus === "revision" ? "請補充 GPU 使用方式，原申請內容會保留。" : state.requestStatus === "failed" ? "建立時發生問題，可直接重試，不必重新填表。" : "已通過，系統正在建立研究機器。"}</p>
      <div class="button-row"><button class="mini-button" type="button" data-request-state="revision">模擬需要補件</button><button class="mini-button" type="button" data-request-state="failed">模擬建立失敗</button><button class="mini-button primary" type="button" data-request-state="approved">模擬核准</button><button class="mini-button danger" type="button" data-action="cancel-request">取消申請</button></div>
    </div></section>
    <section class="feature-section"><div class="feature-section-title"><h3>其他申請</h3><span>操作只在可用時出現</span></div><div class="demo-panel"><div class="request-row"><div><strong>Web 資料視覺化</strong><span>已完成 · 研究機器已可使用</span></div><button class="mini-button primary" type="button" data-action="open-research-machine">開啟機器</button></div><div class="request-row"><div><strong>短期 GPU 測試</strong><span>已取消 · 不占用配額</span></div><button class="mini-button" type="button" data-action="duplicate-request">重新申請</button></div></div></section>`;
}

function renderAiFeature() {
  return `${featureHeader("ai")}
    <section class="feature-section" data-tour-target="ai-api"><div class="demo-grid"><article class="demo-panel soft"><h3>1. 申請用途</h3><p>課程專題聊天機器人 · 每日 10,000 Tokens。</p><span class="status-pill">已核准</span></article><article class="demo-panel"><h3>2. 取得 API Key</h3><p>金鑰只在建立時完整顯示，可隨時刷新或撤銷。</p>${state.aiKey ? `<div class="api-key">${state.aiKey}</div><div class="button-row" style="margin-top:10px"><button class="mini-button" type="button" data-action="copy-api-key">複製</button><button class="mini-button danger" type="button" data-action="revoke-api-key">撤銷</button></div>` : '<button class="mini-button primary" type="button" data-action="generate-api-key">產生 Demo 金鑰</button>'}</article></div>
      <div class="demo-grid" style="margin-top:13px"><article class="demo-panel"><h3>3. 複製範例</h3><p>自動帶入 Base URL 與模型名稱，不要求學生自己組 API。</p><button class="mini-button" type="button" data-action="copy-api-example">複製 Python 範例</button></article><article class="demo-panel"><h3>4. 查看用量</h3><p>本月 128 次呼叫 · 82K 輸入 Tokens · 配額使用 18%。</p><div class="publish-preview"><span>用量</span><code>████░░░░░░ 18%</code></div></article></div>
    </section>`;
}

function renderSettingsFeature() {
  return `${featureHeader("settings")}
    <section class="feature-section" data-tour-target="settings-panel"><div class="settings-list"><div class="setting-card"><div><strong>個人資料與校園帳號</strong><span>陳同學 · s1234567@school.edu.tw · 學生</span></div><button class="mini-button" type="button" data-action="edit-profile">編輯</button></div><div class="setting-card"><div><strong>登入安全</strong><span>變更密碼、檢查登入方式與工作階段</span></div><button class="mini-button" type="button" data-action="security-check">安全檢查</button></div><div class="setting-card"><div><strong>深色模式</strong><span>介面外觀，不影響功能</span></div><button class="switch ${document.body.classList.contains("demo-dark") ? "on" : ""}" type="button" data-action="toggle-dark"></button></div><div class="setting-card"><div><strong>語言</strong><span>繁體中文 · 可切換 English / 日本語</span></div><button class="mini-button" type="button" data-action="change-language">切換語言</button></div><div class="setting-card"><div><strong>AI 導覽與求助</strong><span>用學生聽得懂的方式找功能、解釋錯誤與回報問題</span></div><button class="mini-button primary" type="button" data-action="open-help">開始求助</button></div></div></section>
    <section class="feature-section"><div class="demo-panel danger"><h3>危險區域</h3><p>刪除帳號前必須說明課程資料、研究機器與申請紀錄如何處理；不與一般外觀設定混在一起。</p><button class="mini-button danger" type="button" data-action="delete-account-explain">查看刪除影響</button></div></section>`;
}

const featureRenderers = { course: renderCourseFeature, resource: renderResourceFeature, backup: renderBackupFeature, specs: renderSpecsFeature, monitor: renderMonitorFeature, network: renderNetworkFeature, requests: renderRequestsFeature, ai: renderAiFeature, settings: renderSettingsFeature };

function renderFeature() {
  featureContent.innerHTML = featureRenderers[state.feature]();
  state.visitedFeatures.add(state.feature);
  document.querySelectorAll("[data-feature]").forEach((button) => {
    button.classList.toggle("active", button.dataset.feature === state.feature);
    button.classList.toggle("visited", state.visitedFeatures.has(button.dataset.feature));
  });
  document.querySelector("#feature-progress").textContent = `已體驗 ${state.visitedFeatures.size} / ${Object.keys(featureMeta).length}`;
}

function openFeatureCenter(feature = state.feature) {
  state.feature = feature;
  showView("feature-view");
  renderFeature();
}

function openModal(title, body) {
  document.querySelector("#demo-modal-title").textContent = title;
  document.querySelector("#demo-modal-body").innerHTML = body;
  document.querySelector("#demo-modal").classList.remove("hidden");
}

function closeModal() {
  document.querySelector("#demo-modal").classList.add("hidden");
}

const tourSteps = [
  { view: "home-view", target: "scenario-cards", title: "三種學生情境", description: "首頁先分流正在上課、下課練習與自主研究，不讓學生從系統模組猜入口。", tip: "先看三張卡片；每張卡只保留一個主要動作。" },
  { view: "flow-view", target: "wizard-content", title: "自主研究申請", description: "只有自主研究才進入四步驟申請；課堂機器不會重複申請。", tip: "可選用途並按下一步，系統會用推薦方案降低填表負擔。" },
  { feature: "course", target: "course-machine", title: "老師分發的課堂機器", description: "課堂機器依課程出現，學生能直接上課或下課後沿用原機器。", tip: "試按「進入今天的課堂」或「下課後繼續練習」。" },
  { feature: "resource", target: "power-controls", title: "電源與生命週期", description: "開機、關機、重新啟動與刪除有不同後果，介面會清楚解釋。", tip: "試著關機再開機；資料與機器名稱都會保留。" },
  { feature: "resource", target: "console-actions", title: "控制台與協作", description: "學生可以開啟終端機、複製 SSH 指令，或建立限時協作邀請。", tip: "按「開啟終端機」查看模擬控制台。" },
  { feature: "backup", target: "snapshot-actions", title: "快照、還原與重置", description: "用學生熟悉的「還原點」說法，並分清關機、還原和重置。", tip: "建立一個還原點，再試用還原或刪除。" },
  { feature: "specs", target: "spec-controls", title: "規格、GPU 與配額", description: "一般情況套用推薦值；研究需求才調整 CPU、記憶體、硬碟與 GPU。", tip: "拖曳規格滑桿或選 GPU，再送出模擬調整申請。" },
  { feature: "monitor", target: "monitor-charts", title: "健康狀態與監控", description: "先回答環境是否正常；完整效能圖表與事件供排錯使用。", tip: "切換 1 小時、1 天、1 週，觀察圖表變化。" },
  { feature: "network", target: "firewall-config", title: "防火牆", description: "防火牆以安全、網站、校內三個用途預設呈現，仍可查看實際規則。", tip: "切換「網站」預設，會自動改成允許 HTTPS 的安全規則。" },
  { feature: "network", target: "publish-config", title: "Port、網域與反向代理", description: "公開服務採單一流程，自動處理 HTTPS、網域與反向代理。", tip: "選「公開網站」，設定 Port，並觀察最後取得的網址。" },
  { feature: "requests", target: "request-timeline", title: "申請、補件與失敗處理", description: "申請進度顯示目前階段，並且每個狀態都提供明確下一步。", tip: "試用「需要補件」「建立失敗」「核准」三種模擬狀態。" },
  { feature: "ai", target: "ai-api", title: "AI API 金鑰與用量", description: "從用途申請、產生金鑰、複製範例到用量查詢形成完整流程。", tip: "產生 Demo 金鑰，再試著複製或撤銷。" },
  { feature: "settings", target: "settings-panel", title: "帳號、安全與協助", description: "低頻設定集中在個人選單，危險操作另行說明影響。", tip: "可切換深色模式，或打開模擬 AI 求助視窗。" },
  { feature: "course", target: null, title: "完整導覽完成", description: "已走過學生端三種情境與所有主要、進階功能；一般學生仍只會在需要時看到它們。", tip: "左側綠色勾選代表已體驗的功能，仍可自由重複操作。" },
];

function clearTourHighlight() {
  document.querySelectorAll(".tour-highlight").forEach((element) => element.classList.remove("tour-highlight"));
}

function presentTourStep() {
  clearTourHighlight();
  const step = tourSteps[state.tourIndex];
  if (step.feature) openFeatureCenter(step.feature);
  else if (step.view === "home-view") showView("home-view");
  else if (step.view === "flow-view") startFlow();

  document.querySelector("#tour-count").textContent = `${state.tourIndex + 1} / ${tourSteps.length}`;
  document.querySelector("#tour-progress-bar").style.width = `${((state.tourIndex + 1) / tourSteps.length) * 100}%`;
  document.querySelector("#tour-title").textContent = step.title;
  document.querySelector("#tour-description").textContent = step.description;
  document.querySelector("#tour-tip").textContent = step.tip;
  document.querySelector("#tour-back").disabled = state.tourIndex === 0;
  document.querySelector("#tour-next").textContent = state.tourIndex === tourSteps.length - 1 ? "完成導覽" : "下一步";
  document.querySelector("#tour-guide").classList.remove("hidden");
  window.setTimeout(() => {
    if (!step.target) return;
    const target = document.querySelector(`[data-tour-target="${step.target}"]`) || document.querySelector(`#${step.target}`);
    target?.classList.add("tour-highlight");
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, 40);
}

function startTour() {
  state.tourIndex = 0;
  presentTourStep();
}

function exitTour(completed = false) {
  clearTourHighlight();
  document.querySelector("#tour-guide").classList.add("hidden");
  state.tourIndex = -1;
  if (completed) {
    openFeatureCenter("course");
    showToast("完整功能導覽已完成，現在可自由試用所有功能");
  }
}

document.addEventListener("click", (event) => {
  const target = event.target.closest("button, [data-action]");
  if (!target) return;

  if (target.dataset.selectPurpose) {
    state.purpose = target.dataset.selectPurpose;
    ensureEnvironmentSelection();
    renderWizard();
    return;
  }
  if (target.dataset.selectEnvironment) {
    state.environment = target.dataset.selectEnvironment;
    renderWizard();
    return;
  }
  if (target.dataset.selectDuration) {
    state.duration = target.dataset.selectDuration;
    renderWizard();
    return;
  }
  if (target.dataset.goStep) {
    state.step = Number(target.dataset.goStep);
    renderWizard();
    return;
  }
  if (target.dataset.feature) {
    openFeatureCenter(target.dataset.feature);
    return;
  }
  if (target.dataset.power) {
    const action = target.dataset.power;
    if (action === "start") state.machineOn = true;
    if (action === "stop") state.machineOn = false;
    if (action === "reboot") showToast("機器正在重新啟動，資料會保留");
    if (action !== "reboot") showToast(state.machineOn ? "機器已啟動" : "機器已關機，資料仍保留");
    renderFeature();
    return;
  }
  if (target.dataset.restore) {
    showToast(`正在還原到「${target.dataset.restore}」，目前機器資料將被取代`);
    return;
  }
  if (target.dataset.deleteSnapshot) {
    state.snapshots = state.snapshots.filter((item) => item.name !== target.dataset.deleteSnapshot);
    renderFeature();
    showToast("還原點已刪除");
    return;
  }
  if (target.dataset.firewall) {
    state.firewall = target.dataset.firewall;
    renderFeature();
    return;
  }
  if (target.dataset.access) {
    state.access = target.dataset.access;
    if (state.access === "website") state.firewall = "website";
    renderFeature();
    return;
  }
  if (target.dataset.requestState) {
    state.requestStatus = target.dataset.requestState;
    renderFeature();
    return;
  }
  if (target.dataset.monitorRange) {
    document.querySelectorAll("[data-monitor-range]").forEach((button) => button.classList.toggle("active", button === target));
    document.querySelectorAll(".chart-bar").forEach((bar, index) => {
      const factor = target.dataset.monitorRange === "hour" ? 1 : target.dataset.monitorRange === "day" ? 1.22 : .8;
      bar.style.height = `${Math.min(92, (22 + ((index * 17) % 47)) * factor)}%`;
    });
    showToast(`已切換到最近 ${target.textContent.trim()} 的資料`);
    return;
  }
  if (target.dataset.demoToast) {
    showToast(target.dataset.demoToast);
    return;
  }

  const action = target.dataset.action;
  if (action === "home") showView("home-view");
  if (action === "start-flow") startFlow();
  if (action === "feature-center") openFeatureCenter();
  if (action === "start-tour") startTour();
  if (action === "exit-tour") exitTour();
  if (action === "tour-previous" && state.tourIndex > 0) {
    state.tourIndex -= 1;
    presentTourStep();
  }
  if (action === "tour-next") {
    if (state.tourIndex >= tourSteps.length - 1) exitTour(true);
    else {
      state.tourIndex += 1;
      presentTourStep();
    }
  }
  if (action === "close-modal") closeModal();
  if (action === "open-class") showToast("已進入課堂：教材、機器與題目會在同一個工作區");
  if (action === "watch-broadcast") openModal("老師直播", '<div class="terminal-window" style="display:grid;place-items:center;text-align:center"><div><div style="font-size:38px">▣</div><p>王老師正在示範 Linux 檔案權限</p><span style="color:#8da3c7">唯讀觀看 · 老師結束後自動關閉</span></div></div>');
  if (action === "start-after-class") showToast("已沿用老師分發的同一台機器，資料與任務進度都保留");
  if (action === "open-console") openModal("research-chen · 終端機", '<div class="terminal-window"><div>Connecting to research-chen...</div><div>Ubuntu 24.04 LTS · 10.20.8.31</div><br><div><span class="prompt">student@research-chen</span>:~$ ls</div><div>dataset&nbsp;&nbsp;notebooks&nbsp;&nbsp;project</div><div><span class="prompt">student@research-chen</span>:~$ <span class="cursor"></span></div></div>');
  if (action === "copy-ssh") {
    navigator.clipboard?.writeText("ssh student@10.20.8.31").catch(() => {});
    showToast("SSH 指令已複製：ssh student@10.20.8.31");
  }
  if (action === "invite-peer") openModal("協作邀請已建立", '<div class="demo-panel soft"><h3>邀請連結有效 30 分鐘</h3><p>同學加入後可共同操作這台研究機器；你可以隨時停止協作。</p><div class="api-key">https://skylab.edu.tw/pair/demo-7K2P</div></div>');
  if (action === "delete-explain") openModal("刪除研究機器", '<div class="demo-panel danger"><h3>刪除後無法復原</h3><p>機器、硬碟資料與個人還原點會消失；申請紀錄仍會保留。關機不會刪除資料。</p></div>');
  if (action === "create-snapshot") {
    state.snapshots.push({ name: `研究進度-${state.snapshots.length}`, note: "手動建立的還原點", date: "剛剛", locked: false });
    renderFeature();
    showToast("新的還原點已建立");
  }
  if (action === "reset-machine") openModal("重置到課堂初始狀態", '<div class="demo-panel danger"><h3>個人練習變更會消失</h3><p>機器會回到老師分發時的狀態。建議先建立還原點；關機不會造成這個影響。</p></div>');
  if (action === "backup-help") openModal("關機、還原、重置的差異", '<div class="control-list"><div class="control-row"><strong>關機</strong><span>停止運作並保留全部資料</span><b>可繼續</b></div><div class="control-row"><strong>還原</strong><span>回到自己建立的還原點</span><b>取代目前資料</b></div><div class="control-row"><strong>重置</strong><span>回到老師提供的初始狀態</span><b>清除個人變更</b></div></div>');
  if (action === "save-specs") showToast("規格調整申請已送出，目前機器可繼續使用");
  if (action === "recommend-specs") {
    Object.assign(state, { cores: 2, memory: 4, disk: 40, gpu: "none" });
    renderFeature();
    showToast("已套用一般研究的系統建議值");
  }
  if (action === "add-firewall-rule") openModal("新增防火牆規則", '<div class="form-grid"><div class="field"><label>動作</label><select><option>允許</option><option>拒絕</option></select></div><div class="field"><label>協定</label><select><option>TCP</option><option>UDP</option></select></div><div class="field"><label>Port</label><input value="8080" /></div><div class="field"><label>來源</label><select><option>校園網路</option><option>所有人</option></select></div></div><p class="field-hint" style="margin-top:12px">Demo 不會寫入真實規則。</p>');
  if (action === "firewall-help") openModal("什麼時候需要修改防火牆？", '<div class="demo-grid three"><article class="demo-panel"><h3>一般研究</h3><p>使用「安全」即可，不必修改。</p></article><article class="demo-panel"><h3>發布網站</h3><p>選「網站」，系統自動開放 HTTPS。</p></article><article class="demo-panel"><h3>特殊服務</h3><p>只有老師要求時才新增自訂 Port。</p></article></div>');
  if (action === "toggle-https") { state.https = !state.https; renderFeature(); }
  if (action === "toggle-domain") { state.autoDomain = !state.autoDomain; renderFeature(); }
  if (action === "apply-network") showToast(state.access === "private" ? "已保持私人存取，沒有建立公開規則" : "發布設定已套用：防火牆、HTTPS 與反向代理同步完成");
  if (action === "network-explain") openModal("公開網站流量路徑", '<div class="demo-panel soft" style="text-align:center"><strong>使用者</strong><p>↓ HTTPS</p><strong>校園反向代理</strong><p>↓ 防火牆允許的 Port</p><strong>research-chen : 8080</strong></div>');
  if (action === "cancel-request") openModal("取消研究機器申請", '<div class="demo-panel warning"><h3>尚未開始建立，可以取消</h3><p>取消後不占用配額；原申請資料會保留，可稍後複製重新申請。</p></div>');
  if (action === "open-research-machine") showToast("研究機器已就緒，正在開啟終端機");
  if (action === "duplicate-request") showToast("已複製原申請內容，可修改後重新送出");
  if (action === "generate-api-key") {
    state.aiKey = "sk-demo-7F2K-9QAX-EXAMPLE";
    renderFeature();
    showToast("Demo 金鑰已產生，只會完整顯示這一次");
  }
  if (action === "copy-api-key") { navigator.clipboard?.writeText(state.aiKey).catch(() => {}); showToast("API Key 已複製"); }
  if (action === "revoke-api-key") { state.aiKey = ""; renderFeature(); showToast("Demo 金鑰已撤銷"); }
  if (action === "copy-api-example") showToast("Python 範例已複製，包含 Base URL 與模型名稱");
  if (action === "edit-profile") showToast("個人資料編輯會保留校園帳號與學生角色");
  if (action === "security-check") openModal("登入安全檢查", '<div class="settings-list"><div class="setting-card"><div><strong>校園帳號</strong><span>已連結 · LDAP</span></div><span class="status-pill">正常</span></div><div class="setting-card"><div><strong>目前工作階段</strong><span>Taipei · Windows · 剛剛</span></div><button class="mini-button">登出其他裝置</button></div></div>');
  if (action === "toggle-dark") { document.body.classList.toggle("demo-dark"); renderFeature(); }
  if (action === "change-language") showToast("語言預覽：繁體中文 → English；正式版會全站一致切換");
  if (action === "open-help") openModal("AI 導覽與求助", '<div class="demo-panel soft"><h3>嗨，陳同學，需要完成什麼？</h3><p>你可以問：「我要把研究網站公開」「課堂機器為什麼開不起來？」或「關機會不會刪掉資料？」</p><div class="field"><input placeholder="輸入你的問題…" /></div></div>');
  if (action === "delete-account-explain") openModal("刪除帳號的影響", '<div class="demo-panel danger"><h3>需要管理員確認</h3><p>課堂紀錄會依校務規範保留；研究機器與個人資料將排程移除。學生必須先看到完整影響才可繼續。</p></div>');
  if (action === "start-practice") {
    const practiceButton = document.querySelector("#practice-button");
    practiceButton.disabled = true;
    practiceButton.textContent = "課堂機器開機中…";
    showToast("沿用老師分發的課堂機器，不會建立新機器");
    window.setTimeout(() => {
      practiceButton.disabled = false;
      practiceButton.textContent = "開啟練習環境";
      practiceButton.dataset.action = "open-practice";
    }, 1200);
  }
  if (action === "open-practice") showToast("課堂機器已啟動，檔案與上次進度已保留");
  if (action === "reset") resetDemo();
  if (action === "previous-step" && state.step > 1) {
    state.step -= 1;
    renderWizard();
  }
  if (action === "next-step") {
    if (state.step === 3 && !state.name.trim()) return;
    if (state.step < 4) {
      state.step += 1;
      renderWizard();
    } else {
      submitDemo();
    }
  }
});

document.addEventListener("input", (event) => {
  const input = event.target;
  if (input.dataset.spec) {
    const key = input.dataset.spec;
    state[key] = key === "gpu" ? input.value : Number(input.value);
    const value = document.querySelector(`#${key}-value`);
    if (value) value.textContent = `${state[key]} ${key === "cores" ? "核心" : key === "memory" ? "GB" : "GB"}`;
  }
  if (input.dataset.network === "port") {
    state.port = Number(input.value) || 8080;
    input.nextElementSibling.textContent = state.port;
  }
});

document.addEventListener("change", (event) => {
  if (event.target.dataset.spec === "gpu") {
    state.gpu = event.target.value;
    renderFeature();
  }
});

renderWizard();
