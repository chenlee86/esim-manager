// ── State ────────────────────────────────────────────────────────────────────
let token = localStorage.getItem('auth_token') || '';
let items = [];
let currentTab = 'dashboard';
let editingId = null;

// ── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (token) {
    showApp();
  } else {
    show('login-screen');
    document.getElementById('login-form').addEventListener('submit', doLogin);
  }
});

// ── Auth ─────────────────────────────────────────────────────────────────────
async function doLogin(e) {
  e.preventDefault();
  const pw = document.getElementById('password').value;
  const err = document.getElementById('login-error');
  err.textContent = '';
  try {
    const data = await apiFetch('POST', '/api/login', { password: pw }, true);
    token = data.token;
    localStorage.setItem('auth_token', token);
    showApp();
  } catch {
    err.textContent = '密码错误，请重试';
  }
}

function logout() {
  localStorage.removeItem('auth_token');
  token = '';
  show('login-screen');
  hide('app');
  document.getElementById('password').value = '';
}

// ── App bootstrap ─────────────────────────────────────────────────────────────
function showApp() {
  hide('login-screen');
  show('app');
  switchTab('dashboard');
}

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.nav-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  hide('section-dashboard');
  hide('section-settings');
  show(`section-${tab}`);
  if (tab === 'dashboard') loadDashboard();
  if (tab === 'settings') loadSettings();
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
async function loadDashboard() {
  const list = document.getElementById('items-container');
  list.innerHTML = '<div class="spinner"></div>';
  try {
    items = await apiFetch('GET', '/api/items');
    renderDashboard();
  } catch (e) {
    list.innerHTML = `<div class="empty-state"><p>加载失败：${e.message}</p></div>`;
  }
}

function renderDashboard() {
  const today = todayStr();
  const overdue = items.filter(i => i.next_due_at && i.next_due_at < today);
  const dueSoon = items.filter(i => {
    if (!i.next_due_at || i.next_due_at < today) return false;
    const days = daysDiff(today, i.next_due_at);
    return days <= i.notify_days_before;
  });
  const ok = items.filter(i => i.next_due_at && daysDiff(today, i.next_due_at) > i.notify_days_before);
  const unset = items.filter(i => !i.next_due_at);

  document.getElementById('stat-total').textContent = items.length;
  document.getElementById('stat-overdue').textContent = overdue.length;
  document.getElementById('stat-due-soon').textContent = dueSoon.length + unset.length;
  document.getElementById('stat-ok').textContent = ok.length;

  const list = document.getElementById('items-container');
  if (items.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="icon">📱</div>
        <h3>还没有添加项目</h3>
        <p>添加你的 eSIM、服务器或手机号，设置保号周期</p>
        <button class="btn-primary" onclick="openAddModal()">+ 添加第一个</button>
      </div>`;
    return;
  }

  list.innerHTML = items.map(item => renderItemCard(item, today)).join('');
}

function renderItemCard(item, today) {
  const status = getStatus(item, today);
  const statusDot = `<div class="item-status-dot ${status.cls}"></div>`;
  const typeLabels = { esim: 'eSIM', server: '服务器', phone: '手机号', other: '其他' };

  let dueHtml = '';
  if (item.next_due_at) {
    const days = daysDiff(today, item.next_due_at);
    let dueLabel = '';
    if (item.next_due_at < today) {
      dueLabel = `<div class="due-label overdue">逾期 ${Math.abs(days)} 天</div>`;
    } else if (days === 0) {
      dueLabel = `<div class="due-label due-soon">今天到期</div>`;
    } else if (status.cls === 'due-soon') {
      dueLabel = `<div class="due-label due-soon">还有 ${days} 天</div>`;
    } else {
      dueLabel = `<div class="due-label ok">还有 ${days} 天</div>`;
    }
    dueHtml = `<div class="item-due"><div class="due-date">${item.next_due_at}</div>${dueLabel}</div>`;
  } else {
    dueHtml = `<div class="item-due"><div class="due-date" style="color:var(--muted)">未设置</div><div class="due-label">需要操作</div></div>`;
  }

  return `<div class="item-card ${status.cls}" id="item-${item.id}">
    ${statusDot}
    <div class="item-info">
      <div class="item-name">
        <span class="type-badge">${typeLabels[item.type] || item.type}</span>
        ${esc(item.name)}
      </div>
      <div class="item-meta">
        <span>每 ${item.cycle_days} 天保号</span>
        ${item.last_done_at ? `<span>上次：${item.last_done_at}</span>` : '<span style="color:var(--red)">从未操作</span>'}
        ${item.description ? `<span>${esc(item.description)}</span>` : ''}
      </div>
    </div>
    ${dueHtml}
    <div class="item-actions">
      <button class="btn-done" onclick="markDone(${item.id})">✓ 标记完成</button>
      <button class="btn-sm" onclick="openEditModal(${item.id})">编辑</button>
      <button class="btn-danger" onclick="deleteItem(${item.id})">删除</button>
    </div>
  </div>`;
}

function getStatus(item, today) {
  if (!item.next_due_at) return { cls: 'unset' };
  if (item.next_due_at < today) return { cls: 'overdue' };
  const days = daysDiff(today, item.next_due_at);
  if (days <= item.notify_days_before) return { cls: 'due-soon' };
  return { cls: 'ok' };
}

// ── Mark Done ─────────────────────────────────────────────────────────────────
async function markDone(id) {
  const item = items.find(i => i.id === id);
  if (!item) return;

  const confirmed = confirm(`确认「${item.name}」已完成保号操作？\n将记录今日为完成日期。`);
  if (!confirmed) return;

  try {
    const updated = await apiFetch('POST', `/api/items/${id}/done`, {});
    const idx = items.findIndex(i => i.id === id);
    if (idx !== -1) items[idx] = updated;
    renderDashboard();
    toast(`✓ ${item.name} 已标记完成，下次提醒：${updated.next_due_at}`);
  } catch (e) {
    toast('操作失败：' + e.message, true);
  }
}

// ── Delete ────────────────────────────────────────────────────────────────────
async function deleteItem(id) {
  const item = items.find(i => i.id === id);
  if (!item) return;
  if (!confirm(`确认删除「${item.name}」？此操作不可撤销。`)) return;

  try {
    await apiFetch('DELETE', `/api/items/${id}`);
    items = items.filter(i => i.id !== id);
    renderDashboard();
    toast('已删除');
  } catch (e) {
    toast('删除失败：' + e.message, true);
  }
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function openAddModal() {
  editingId = null;
  document.getElementById('modal-title').textContent = '添加项目';
  resetForm();
  document.getElementById('modal').classList.remove('hidden');
}

function openEditModal(id) {
  editingId = id;
  const item = items.find(i => i.id === id);
  if (!item) return;
  document.getElementById('modal-title').textContent = '编辑项目';
  document.getElementById('f-name').value = item.name;
  document.getElementById('f-type').value = item.type;
  document.getElementById('f-description').value = item.description || '';
  document.getElementById('f-cycle').value = item.cycle_days;
  document.getElementById('f-last-done').value = item.last_done_at || '';
  document.getElementById('f-notify').value = item.notify_days_before;
  document.getElementById('f-notes').value = item.notes || '';
  updateCyclePresets(item.cycle_days);
  document.getElementById('modal').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal').classList.add('hidden');
  editingId = null;
}

function resetForm() {
  document.getElementById('item-form').reset();
  document.getElementById('f-notify').value = '3';
  document.getElementById('f-type').value = 'esim';
  document.getElementById('f-last-done').value = new Date().toISOString().split('T')[0];
  updateCyclePresets(null);
}

function setCyclePreset(days) {
  document.getElementById('f-cycle').value = days;
  updateCyclePresets(days);
}

function updateCyclePresets(active) {
  document.querySelectorAll('.cycle-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.days) === parseInt(active));
  });
}

async function submitForm(e) {
  e.preventDefault();
  const body = {
    name: document.getElementById('f-name').value.trim(),
    type: document.getElementById('f-type').value,
    description: document.getElementById('f-description').value.trim(),
    cycle_days: parseInt(document.getElementById('f-cycle').value),
    last_done_at: document.getElementById('f-last-done').value || null,
    notify_days_before: parseInt(document.getElementById('f-notify').value) || 3,
    notes: document.getElementById('f-notes').value.trim()
  };

  if (!body.name) { alert('请填写名称'); return; }
  if (!body.cycle_days || body.cycle_days < 1) { alert('请填写有效的保号周期'); return; }

  try {
    if (editingId) {
      const updated = await apiFetch('PUT', `/api/items/${editingId}`, body);
      const idx = items.findIndex(i => i.id === editingId);
      if (idx !== -1) items[idx] = updated;
    } else {
      const created = await apiFetch('POST', '/api/items', body);
      items.push(created);
    }
    closeModal();
    renderDashboard();
    toast(editingId ? '已保存' : '已添加');
  } catch (e) {
    alert('保存失败：' + e.message);
  }
}

// ── Manual notify ─────────────────────────────────────────────────────────────
async function sendTestNotify() {
  const btn = document.getElementById('btn-notify');
  btn.disabled = true;
  btn.textContent = '发送中...';
  try {
    const result = await apiFetch('POST', '/api/notify', {});
    toast(`通知已发送，共 ${result.sent} 个项目`);
  } catch (e) {
    toast('发送失败：' + e.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = '立即发送通知';
  }
}

// ── Settings ──────────────────────────────────────────────────────────────────
async function loadSettings() {
  try {
    const s = await apiFetch('GET', '/api/settings');
    document.getElementById('s-tg-token').value = s.telegram_bot_token || '';
    document.getElementById('s-tg-chat').value = s.telegram_chat_id || '';
    document.getElementById('s-resend-key').value = s.resend_api_key || '';
    document.getElementById('s-email-to').value = s.email_to || '';
    document.getElementById('s-email-from').value = s.email_from || '';
  } catch (e) {
    toast('设置加载失败：' + e.message, true);
  }
}

async function saveSettings(e) {
  e.preventDefault();
  const body = {
    telegram_bot_token: document.getElementById('s-tg-token').value.trim(),
    telegram_chat_id: document.getElementById('s-tg-chat').value.trim(),
    resend_api_key: document.getElementById('s-resend-key').value.trim(),
    email_to: document.getElementById('s-email-to').value.trim(),
    email_from: document.getElementById('s-email-from').value.trim()
  };
  try {
    await apiFetch('PUT', '/api/settings', body);
    toast('设置已保存');
  } catch (e) {
    toast('保存失败：' + e.message, true);
  }
}

// ── API helper ────────────────────────────────────────────────────────────────
async function apiFetch(method, path, body, skipAuth = false) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (!skipAuth) opts.headers['X-Auth-Token'] = token;
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (res.status === 401 && !skipAuth) { logout(); throw new Error('会话已过期'); }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

// ── Utils ─────────────────────────────────────────────────────────────────────
function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function daysDiff(from, to) {
  return Math.round((new Date(to) - new Date(from)) / 86400000);
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function show(id) { document.getElementById(id)?.classList.remove('hidden'); }
function hide(id) { document.getElementById(id)?.classList.add('hidden'); }

let toastTimer;
function toast(msg, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.background = isError ? '#dc2626' : '#1e293b';
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}
