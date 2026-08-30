import {
  escapeHtml,
  getConfirmationDetails,
  getToolDisplayData,
  getResponseStatus,
  groupToolCallsByVmid,
  validateTargets,
} from './ui.js';

const TARGET_COUNT = 3;
const state = { messages: [], pendingToken: null, busy: false, templates: [] };
const $ = (id) => document.getElementById(id);
const base = () => $('apiBase').value.trim().replace(/\/$/, '');
const targetNodes = () => Array.from({ length: TARGET_COUNT }, (_, index) => ({
  vmid: $(`target${index + 1}Vmid`),
  template: $(`target${index + 1}Template`),
}));
const headers = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${$('token').value.trim()}`,
});

function setBusy(busy, message = '') {
  state.busy = busy;
  const lockedByConfirmation = Boolean(state.pendingToken);
  $('loadTemplates').disabled = busy || lockedByConfirmation;
  $('send').disabled = busy || lockedByConfirmation;
  targetNodes().forEach(({ vmid, template }) => {
    vmid.disabled = busy || lockedByConfirmation;
    template.disabled = busy || lockedByConfirmation;
  });
  $('message').disabled = busy || lockedByConfirmation;
  $('approve').disabled = busy || !state.pendingToken;
  $('reject').disabled = busy || !state.pendingToken;
  $('loading').hidden = !busy;
  $('result').setAttribute('aria-busy', String(busy));
  if (message) $('loadingMessage').textContent = message;
}

function setStatus(message, kind = 'info') {
  const node = $('aiStatus');
  node.textContent = message;
  node.dataset.kind = kind;
  node.hidden = !message;
}

function showError(error) {
  setStatus('AI 請求失敗，請檢查設定後重試。', 'error');
  $('reply').textContent = `錯誤：${error}`;
}

async function request(path, options = {}) {
  const response = await fetch(`${base()}${path}`, { ...options, headers: headers() });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || `HTTP ${response.status}`);
  return data;
}

function renderTool(tool) {
  const result = tool.result || {};
  const node = document.createElement('div');
  node.className = `tool${result.pending ? ' pending' : ''}`;
  const vmid = tool?.args?.vmid ?? result.vmid;
  const label = vmid == null ? '' : `（VMID ${escapeHtml(vmid)}）`;
  node.innerHTML = `<strong>${escapeHtml(tool.name)}</strong>${label}<pre>${escapeHtml(JSON.stringify(getToolDisplayData(tool), null, 2))}</pre>`;
  return node;
}

function render(data) {
  state.messages = data.messages || state.messages;
  $('reply').textContent = data.error ? `錯誤：${data.error}` : (data.reply || '');
  const groups = groupToolCallsByVmid(data);
  const nodes = [];
  for (const [vmid, tools] of groups) {
    if (vmid !== 'unknown') {
      const heading = document.createElement('h3');
      heading.textContent = `VMID ${vmid}`;
      nodes.push(heading);
    }
    nodes.push(...tools.map(renderTool));
  }
  $('tools').replaceChildren(...nodes);

  const confirmation = getConfirmationDetails(data);
  state.pendingToken = confirmation?.token || null;
  if (confirmation) {
    $('confirmationReason').textContent = confirmation.reason;
    $('confirmationCommand').textContent = confirmation.command;
    $('confirmationVmid').textContent = confirmation.vmid == null ? '' : `VMID ${confirmation.vmid}`;
    $('confirmation').hidden = false;
    $('approve').disabled = !state.pendingToken;
    $('reject').disabled = !state.pendingToken;
  } else {
    $('confirmation').hidden = true;
  }

  if (data.confirmation_result) {
    const result = document.createElement('pre');
    result.className = 'confirmation-result';
    result.textContent = `confirmation result:\n${JSON.stringify(data.confirmation_result, null, 2)}`;
    $('tools').appendChild(result);
  }

  const status = getResponseStatus(data);
  setStatus(status.message, status.kind);
}

async function withLoading(message, action) {
  if (state.busy) return;
  setBusy(true, message);
  try {
    return await action();
  } catch (error) {
    showError(error.message);
  } finally {
    setBusy(false);
  }
}

$('loadTemplates').onclick = () => withLoading('正在載入可用的 AI 模板…', async () => {
  const templates = await request('/ai/pve-template/templates');
  state.templates = templates;
  targetNodes().forEach(({ template }) => {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '請選擇模板（填 VMID 才啟用）';
    template.replaceChildren(placeholder, ...templates.map((item) => {
      const option = document.createElement('option');
      option.value = item.template_key;
      option.textContent = `${item.display_name} — ${item.description}`;
      return option;
    }));
  });
  setStatus(`已載入 ${templates.length} 個可用模板。`, 'complete');
});

$('send').onclick = () => withLoading('AI 正在分析模板、VMID 與任務，請稍候…', async () => {
  const validation = validateTargets(targetNodes().map(({ vmid, template }) => ({
    vmid: vmid.value,
    template_key: template.value,
  })));
  if (validation.error) {
    setStatus(validation.error, 'error');
    return;
  }
  const data = await request('/ai/pve-template/chat', {
    method: 'POST',
    body: JSON.stringify({
      targets: validation.targets,
      message: $('message').value,
      messages: state.messages.length ? state.messages : undefined,
    }),
  });
  render(data);
});

async function confirm(approved) {
  if (!state.pendingToken || state.busy) return;
  await withLoading(approved ? '正在執行已確認的 AI 指令…' : '正在送出拒絕結果…', async () => {
    const data = await request('/ai/pve-template/ssh/confirm', {
      method: 'POST',
      body: JSON.stringify({ token: state.pendingToken, approved }),
    });
    state.pendingToken = null;
    render(data);
  });
}

$('approve').onclick = () => confirm(true);
$('reject').onclick = () => confirm(false);

targetNodes().forEach(({ vmid, template }) => {
  const reset = () => {
    if (!state.messages.length && !state.pendingToken) return;
    state.messages = [];
    state.pendingToken = null;
    $('tools').replaceChildren();
    $('reply').textContent = '目標已變更，請重新送出任務。';
    $('confirmation').hidden = true;
  };
  vmid.addEventListener('change', reset);
  template.addEventListener('change', reset);
});
