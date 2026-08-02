/** Pure helpers shared by the AI PVE template page and its tests. */

export function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[char]);
}

export function findPendingTool(data) {
  return (data?.tools_called || []).find((tool) => tool?.result?.pending) || null;
}

export function getConfirmationDetails(data) {
  const pending = findPendingTool(data);
  if (!pending && !data?.needs_confirmation) return null;

  const result = pending?.result || {};
  return {
    command: pending?.args?.command || result.command || '',
    reason: result.reason || '這個指令不在 template 的唯讀 smoke command 清單，需要人工確認。',
    token: result.confirm_token || null,
    vmid: data?.vmid ?? pending?.args?.vmid ?? null,
  };
}

export function getResponseStatus(data) {
  if (data?.error) return { kind: 'error', message: data.error };
  if (getConfirmationDetails(data)) {
    return { kind: 'confirmation', message: 'AI 已提出需要人工確認的指令。' };
  }
  if (data?.confirmation_result) {
    const result = data.confirmation_result;
    if (result.error?.includes('使用者已拒絕')) {
      return { kind: 'complete', message: '你已拒絕執行指令，AI 已根據此決定繼續處理。' };
    }
    if (result.blocked) {
      return { kind: 'error', message: `指令已被安全規則攔截：${result.block_reason || '不允許執行'}` };
    }
    if (result.error) {
      return { kind: 'error', message: `指令確認後執行失敗：${result.error}` };
    }
    return { kind: 'complete', message: '指令已獲同意並執行，AI 已接續整理結果。' };
  }
  return { kind: 'complete', message: 'AI 已完成本次分析。' };
}

export function getToolDisplayData(tool) {
  const result = { ...(tool?.result || {}) };
  // The confirmation token is only for the in-memory confirm request; never
  // put it into the visible tool transcript or a copied result payload.
  delete result.confirm_token;
  return { args: tool?.args || {}, result };
}
