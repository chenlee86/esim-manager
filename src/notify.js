export async function checkAndNotify(env) {
  const db = env.DB;
  const today = todayStr();

  const { results: items } = await db.prepare(`
    SELECT * FROM items
    WHERE next_due_at IS NULL
       OR date(next_due_at) <= date('now', '+' || CAST(notify_days_before AS TEXT) || ' days')
    ORDER BY next_due_at ASC NULLS FIRST
  `).all();

  if (items.length === 0) return { sent: 0 };

  const { results: settingsRows } = await db.prepare('SELECT key, value FROM settings').all();
  const s = Object.fromEntries(settingsRows.map(r => [r.key, r.value]));

  const overdueItems = items.filter(i => i.next_due_at && i.next_due_at < today);
  const dueSoonItems = items.filter(i => i.next_due_at && i.next_due_at >= today);
  const neverDoneItems = items.filter(i => !i.next_due_at);

  const tgMsg = buildTelegramMessage(overdueItems, dueSoonItems, neverDoneItems, today);
  const htmlMsg = buildEmailHtml(overdueItems, dueSoonItems, neverDoneItems, today);

  const tgToken = env.TELEGRAM_BOT_TOKEN || s.telegram_bot_token;
  const tgChatId = env.TELEGRAM_CHAT_ID || s.telegram_chat_id;
  if (tgToken && tgChatId) {
    await sendTelegram(tgToken, tgChatId, tgMsg);
  }

  const emailTo = env.EMAIL_TO || s.email_to;
  const emailFrom = env.EMAIL_FROM || s.email_from;
  const resendKey = env.RESEND_API_KEY || s.resend_api_key;
  if (emailTo && resendKey) {
    await sendEmail(resendKey, emailFrom || 'esim@notifications.local', emailTo, '📱 保号提醒', htmlMsg);
  }

  return { sent: items.length };
}

function buildTelegramMessage(overdue, dueSoon, neverDone, today) {
  let msg = '📱 <b>保号管理提醒</b>\n';
  msg += `<i>${today}</i>\n\n`;

  if (overdue.length > 0) {
    msg += '🔴 <b>已逾期</b>\n';
    for (const i of overdue) {
      const days = Math.floor((new Date(today) - new Date(i.next_due_at)) / 86400000);
      msg += `• ${i.name} <i>(${typeLabel(i.type)})</i> — 逾期 <b>${days}</b> 天\n`;
    }
    msg += '\n';
  }

  if (dueSoon.length > 0) {
    msg += '🟡 <b>即将到期</b>\n';
    for (const i of dueSoon) {
      const days = Math.floor((new Date(i.next_due_at) - new Date(today)) / 86400000);
      const label = days === 0 ? '今天到期' : `还有 <b>${days}</b> 天`;
      msg += `• ${i.name} <i>(${typeLabel(i.type)})</i> — ${label}\n`;
    }
    msg += '\n';
  }

  if (neverDone.length > 0) {
    msg += '⚪ <b>未记录操作</b>\n';
    for (const i of neverDone) {
      msg += `• ${i.name} <i>(${typeLabel(i.type)})</i>\n`;
    }
    msg += '\n';
  }

  msg += '请登录管理面板进行保号操作后点击「标记完成」。';
  return msg;
}

function buildEmailHtml(overdue, dueSoon, neverDone, today) {
  const row = (icon, name, type, desc) =>
    `<tr><td style="padding:8px 12px">${icon}</td><td style="padding:8px 12px"><strong>${esc(name)}</strong> <span style="color:#64748b;font-size:13px">${typeLabel(type)}</span></td><td style="padding:8px 12px;color:#64748b">${desc}</td></tr>`;

  let html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1e293b">
<h2 style="color:#6366f1">📱 保号管理提醒</h2>
<p style="color:#64748b">${today}</p>`;

  if (overdue.length > 0) {
    html += `<h3 style="color:#ef4444">🔴 已逾期</h3><table width="100%" cellspacing="0" style="border-collapse:collapse;background:#fef2f2;border-radius:8px">`;
    for (const i of overdue) {
      const days = Math.floor((new Date(today) - new Date(i.next_due_at)) / 86400000);
      html += row('🔴', i.name, i.type, `逾期 ${days} 天`);
    }
    html += '</table>';
  }

  if (dueSoon.length > 0) {
    html += `<h3 style="color:#f59e0b">🟡 即将到期</h3><table width="100%" cellspacing="0" style="border-collapse:collapse;background:#fffbeb;border-radius:8px">`;
    for (const i of dueSoon) {
      const days = Math.floor((new Date(i.next_due_at) - new Date(today)) / 86400000);
      html += row('🟡', i.name, i.type, days === 0 ? '今天到期' : `还有 ${days} 天`);
    }
    html += '</table>';
  }

  if (neverDone.length > 0) {
    html += `<h3 style="color:#94a3b8">⚪ 未记录操作</h3><table width="100%" cellspacing="0" style="border-collapse:collapse;background:#f8fafc;border-radius:8px">`;
    for (const i of neverDone) {
      html += row('⚪', i.name, i.type, '从未标记完成');
    }
    html += '</table>';
  }

  html += `<p style="margin-top:24px;color:#64748b;font-size:13px">请登录管理面板完成保号操作后点击「标记完成」按钮。</p></div>`;
  return html;
}

async function sendTelegram(token, chatId, text) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
    });
    if (!res.ok) console.error('Telegram error:', await res.text());
  } catch (e) {
    console.error('Telegram send failed:', e.message);
  }
}

async function sendEmail(apiKey, from, to, subject, html) {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, html })
    });
    if (!res.ok) console.error('Resend error:', await res.text());
  } catch (e) {
    console.error('Email send failed:', e.message);
  }
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function typeLabel(type) {
  return { esim: 'eSIM', server: '服务器', phone: '手机号', other: '其他' }[type] || type;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
