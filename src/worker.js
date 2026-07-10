import { checkAndNotify } from './notify.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    if (url.pathname.startsWith('/api/')) {
      return handleAPI(request, env, url).catch(err =>
        json({ error: err.message }, 500)
      );
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env) {
    console.log('Cron triggered:', new Date().toISOString());
    await checkAndNotify(env);
  }
};

// ── Router ────────────────────────────────────────────────────────────────────

async function handleAPI(request, env, url) {
  const { pathname } = url;
  const method = request.method;

  // 登录不需要 token
  if (pathname === '/api/login' && method === 'POST') {
    return handleLogin(request, env);
  }

  // 所有其他 API 需要认证
  if (!isAuthed(request, env)) {
    return json({ error: '未授权，请先登录' }, 401);
  }

  // GET /api/items
  if (pathname === '/api/items' && method === 'GET') return listItems(env);
  // POST /api/items
  if (pathname === '/api/items' && method === 'POST') return createItem(request, env);

  // /api/items/:id
  const itemMatch = pathname.match(/^\/api\/items\/(\d+)$/);
  if (itemMatch) {
    const id = parseInt(itemMatch[1]);
    if (method === 'GET') return getItem(id, env);
    if (method === 'PUT') return updateItem(id, request, env);
    if (method === 'DELETE') return deleteItem(id, env);
  }

  // POST /api/items/:id/done
  const doneMatch = pathname.match(/^\/api\/items\/(\d+)\/done$/);
  if (doneMatch && method === 'POST') return markDone(parseInt(doneMatch[1]), request, env);

  // GET /api/items/:id/history
  const histMatch = pathname.match(/^\/api\/items\/(\d+)\/history$/);
  if (histMatch && method === 'GET') return getHistory(parseInt(histMatch[1]), env);

  // Settings
  if (pathname === '/api/settings' && method === 'GET') return getSettings(env);
  if (pathname === '/api/settings' && method === 'PUT') return saveSettings(request, env);

  // Manual notify trigger (测试：强制发送所有项目)
  if (pathname === '/api/notify' && method === 'POST') {
    const result = await checkAndNotify(env, { test: true });
    return json({ ok: true, ...result });
  }

  return json({ error: '接口不存在' }, 404);
}

// ── Auth ──────────────────────────────────────────────────────────────────────

function isAuthed(request, env) {
  const secret = env.ADMIN_SECRET || 'changeme123';
  const token =
    request.headers.get('X-Auth-Token') ||
    parseCookie(request.headers.get('Cookie') || '', 'auth_token');
  return token === secret;
}

async function handleLogin(request, env) {
  const { password } = await request.json().catch(() => ({}));
  const secret = env.ADMIN_SECRET || 'changeme123';
  if (password !== secret) return json({ error: '密码错误' }, 401);
  return json({ ok: true, token: secret });
}

// ── Items CRUD ─────────────────────────────────────────────────────────────────

async function listItems(env) {
  const { results } = await env.DB.prepare(
    'SELECT * FROM items ORDER BY next_due_at ASC NULLS FIRST, name ASC'
  ).all();
  return json(results);
}

async function createItem(request, env) {
  const body = await request.json();
  const { name, type, description, cycle_days, last_done_at, notify_days_before, notes } = body;
  if (!name || !cycle_days) return json({ error: '名称和周期为必填项' }, 400);

  const next_due_at = calcNextDue(last_done_at, cycle_days);
  const { meta } = await env.DB.prepare(
    `INSERT INTO items (name, type, description, cycle_days, last_done_at, next_due_at, notify_days_before, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    name.trim(), type || 'esim', description || '', parseInt(cycle_days),
    last_done_at || null, next_due_at, parseInt(notify_days_before) || 3, notes || ''
  ).run();

  const item = await env.DB.prepare('SELECT * FROM items WHERE id = ?').bind(meta.last_row_id).first();
  return json(item, 201);
}

async function getItem(id, env) {
  const item = await env.DB.prepare('SELECT * FROM items WHERE id = ?').bind(id).first();
  if (!item) return json({ error: '不存在' }, 404);
  return json(item);
}

async function updateItem(id, request, env) {
  const body = await request.json();
  const { name, type, description, cycle_days, last_done_at, notify_days_before, notes } = body;
  if (!name || !cycle_days) return json({ error: '名称和周期为必填项' }, 400);

  const next_due_at = calcNextDue(last_done_at, cycle_days);
  await env.DB.prepare(
    `UPDATE items SET name=?, type=?, description=?, cycle_days=?, last_done_at=?, next_due_at=?,
     notify_days_before=?, notes=?, updated_at=datetime('now') WHERE id=?`
  ).bind(
    name.trim(), type, description || '', parseInt(cycle_days),
    last_done_at || null, next_due_at, parseInt(notify_days_before) || 3, notes || '', id
  ).run();

  const item = await env.DB.prepare('SELECT * FROM items WHERE id = ?').bind(id).first();
  if (!item) return json({ error: '不存在' }, 404);
  return json(item);
}

async function deleteItem(id, env) {
  await env.DB.prepare('DELETE FROM items WHERE id = ?').bind(id).run();
  return json({ ok: true });
}

async function markDone(id, request, env) {
  const item = await env.DB.prepare('SELECT * FROM items WHERE id = ?').bind(id).first();
  if (!item) return json({ error: '不存在' }, 404);

  const body = await request.json().catch(() => ({}));
  const doneDate = body.done_at || todayStr();
  const next_due_at = calcNextDue(doneDate, item.cycle_days);

  await env.DB.prepare(
    `UPDATE items SET last_done_at=?, next_due_at=?, updated_at=datetime('now') WHERE id=?`
  ).bind(doneDate, next_due_at, id).run();

  await env.DB.prepare('INSERT INTO history (item_id, done_at, note) VALUES (?, ?, ?)')
    .bind(id, doneDate, body.note || '').run();

  const updated = await env.DB.prepare('SELECT * FROM items WHERE id = ?').bind(id).first();
  return json(updated);
}

async function getHistory(id, env) {
  const { results } = await env.DB.prepare(
    'SELECT * FROM history WHERE item_id = ? ORDER BY done_at DESC LIMIT 20'
  ).bind(id).all();
  return json(results);
}

// ── Settings ──────────────────────────────────────────────────────────────────

async function getSettings(env) {
  const { results } = await env.DB.prepare('SELECT key, value FROM settings').all();
  return json(Object.fromEntries(results.map(r => [r.key, r.value])));
}

async function saveSettings(request, env) {
  const body = await request.json();
  for (const [key, value] of Object.entries(body)) {
    await env.DB.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
    ).bind(key, String(value)).run();
  }
  return json({ ok: true });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function calcNextDue(lastDoneAt, cycleDays) {
  if (!lastDoneAt) return null;
  const d = new Date(lastDoneAt);
  d.setDate(d.getDate() + parseInt(cycleDays));
  return d.toISOString().split('T')[0];
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Token'
  };
}

function parseCookie(cookieStr, name) {
  const m = cookieStr.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}
