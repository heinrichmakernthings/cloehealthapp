// Cloe's Cozy Club — Worker backend
// Static files live in /public. This Worker only handles /api/*.
//
//   GET  /api/config            public app settings (countdowns, rewards, coupons)
//   PUT  /api/config            save settings            (X-Admin-Pin)
//   POST /api/admin/login       check PIN, returns pairing key
//   POST /api/admin/pin         change PIN               (X-Admin-Pin)
//   GET  /api/admin/state       Cloe's latest synced data (X-Admin-Pin)
//   GET  /api/admin/snapshots   list backups             (X-Admin-Pin)
//   GET  /api/admin/snapshots/:id  one backup            (X-Admin-Pin)
//   GET  /api/state             synced data              (X-Sync-Key)
//   PUT  /api/state             save synced data         (X-Sync-Key)

export const DEFAULT_CONFIG = {
  version: 1,
  countdowns: [
    { emoji: '🎃', eyebrow: 'Spooky season', title: 'Halloween', date: '2026-10-31', yearly: true, copy: 'Pumpkins, cosy films and an entirely reasonable amount of autumn nonsense.' },
    { emoji: '🎮', eyebrow: 'Vice City incoming', title: 'GTA VI', date: '2026-11-19', yearly: false, copy: 'A completely non-health thing to look forward to.' },
    { emoji: '🎄', eyebrow: 'Cosy countdown', title: 'Christmas', date: '2026-12-25', yearly: true, copy: 'Food, films, presents and maximum blanket behaviour.' },
    { emoji: '🎂', eyebrow: 'Big birthday incoming', title: "Cloe's 30th", date: '2027-07-15', yearly: false, copy: 'Thirty, gorgeous, and legally entitled to an unreasonable amount of birthday fuss.' }
  ],
  rewards: {
    daily: 'Tiny cosy treat / matcha moment 🍵',
    tiers: [
      { every: 7, emoji: '🍵', label: 'Matcha date' },
      { every: 30, emoji: '🍽️', label: 'Meal out' },
      { every: 60, emoji: '🎁', label: 'Big present' }
    ]
  },
  coupons: [
    { id: 'tea', xp: 25, icon: '🫖', name: 'Tea in bed', desc: 'One tea delivery, no questions asked.' },
    { id: 'takeaway', xp: 60, icon: '🍜', name: 'Takeaway pick', desc: 'Cloe chooses. Sam cannot lobby.' },
    { id: 'massage', xp: 100, icon: '💆', name: 'Massage voucher', desc: 'Redeemable for one proper massage.' },
    { id: 'chore', xp: 150, icon: '🧽', name: 'Chore pass', desc: 'One annoying household task delegated.' },
    { id: 'matchadate', xp: 220, icon: '🍵', name: 'Matcha date', desc: 'Actual matcha. Actual date.' },
    { id: 'silence', xp: 300, icon: '🤐', name: '20 minutes of silence', desc: 'Sam stops talking for twenty glorious minutes.' }
  ]
};

const MAX_STATE_BYTES = 2_000_000;
const MAX_CONFIG_BYTES = 100_000;
const SNAPSHOT_EVERY_HOURS = 6;
const SNAPSHOTS_KEPT = 120;
const MAX_PIN_FAILS = 8;
const LOCK_MINUTES = 15;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await api(request, env, url);
      } catch (err) {
        console.error(err);
        return json({ error: 'Server error' }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  }
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

async function getSetting(env, key) {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
  return row ? row.value : null;
}
async function setSetting(env, key, value) {
  await env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .bind(key, value).run();
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// Returns null if OK, or a Response to send back.
async function requireAdmin(request, env) {
  const failRaw = await getSetting(env, 'pin_fail');
  const fail = failRaw ? JSON.parse(failRaw) : { count: 0, until: 0 };
  if (fail.until && Date.now() < fail.until) {
    return json({ error: `Too many wrong PINs. Try again in ${Math.ceil((fail.until - Date.now()) / 60000)} min.` }, 429);
  }
  const pin = (request.headers.get('x-admin-pin') || '').trim();
  const salt = await getSetting(env, 'admin_pin_salt');
  const hash = await getSetting(env, 'admin_pin_hash');
  if (pin && salt && hash && safeEqual(await sha256(salt + ':' + pin), hash)) {
    if (fail.count) await setSetting(env, 'pin_fail', JSON.stringify({ count: 0, until: 0 }));
    return null;
  }
  const count = (fail.count || 0) + 1;
  const next = count >= MAX_PIN_FAILS ? { count: 0, until: Date.now() + LOCK_MINUTES * 60000 } : { count, until: 0 };
  await setSetting(env, 'pin_fail', JSON.stringify(next));
  return json({ error: 'Wrong PIN' }, 401);
}

async function requireSync(request, env) {
  const key = (request.headers.get('x-sync-key') || '').trim();
  const real = await getSetting(env, 'sync_key');
  if (!key || !real || !safeEqual(key, real)) return json({ error: 'Not paired' }, 401);
  return null;
}

function cleanConfig(c) {
  if (!c || typeof c !== 'object') throw new Error('Config must be an object');
  const str = (v, max = 300) => String(v == null ? '' : v).slice(0, max);
  const countdowns = (Array.isArray(c.countdowns) ? c.countdowns : []).slice(0, 20).map(x => ({
    emoji: str(x.emoji, 8), eyebrow: str(x.eyebrow, 60), title: str(x.title, 80),
    date: /^\d{4}-\d{2}-\d{2}$/.test(x.date) ? x.date : '', yearly: !!x.yearly, copy: str(x.copy, 240)
  })).filter(x => x.title && x.date);
  const tiers = (Array.isArray(c.rewards?.tiers) ? c.rewards.tiers : []).slice(0, 8).map(t => ({
    every: Math.max(1, Math.min(365, Math.round(Number(t.every) || 0))), emoji: str(t.emoji, 8), label: str(t.label, 80)
  })).filter(t => t.every && t.label);
  if (!tiers.length) throw new Error('Add at least one reward');
  const seen = new Set();
  const coupons = (Array.isArray(c.coupons) ? c.coupons : []).slice(0, 30).map(x => {
    let id = str(x.id, 40).replace(/[^a-z0-9_-]/gi, '') || str(x.name, 40).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    while (seen.has(id)) id += '-2';
    seen.add(id);
    return { id, xp: Math.max(0, Math.round(Number(x.xp) || 0)), icon: str(x.icon, 8), name: str(x.name, 60), desc: str(x.desc, 160) };
  }).filter(x => x.id && x.name);
  return { version: 1, countdowns, rewards: { daily: str(c.rewards?.daily, 120), tiers }, coupons };
}

function entryCounts(data) {
  const n = k => (Array.isArray(data?.[k]) ? data[k].length : 0);
  return { daily: n('daily'), food: n('food'), flare: n('flare') };
}

async function api(request, env, url) {
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method;

  // ---- public config ----
  if (path === '/api/config' && method === 'GET') {
    const raw = await getSetting(env, 'config');
    return json(raw ? JSON.parse(raw) : DEFAULT_CONFIG);
  }
  if (path === '/api/config' && method === 'PUT') {
    const deny = await requireAdmin(request, env); if (deny) return deny;
    const text = await request.text();
    if (text.length > MAX_CONFIG_BYTES) return json({ error: 'Too big' }, 413);
    let cfg;
    try { cfg = cleanConfig(JSON.parse(text)); } catch (e) { return json({ error: e.message || 'Bad config' }, 400); }
    await setSetting(env, 'config', JSON.stringify(cfg));
    return json({ ok: true, config: cfg });
  }

  // ---- admin ----
  if (path === '/api/admin/login' && method === 'POST') {
    const deny = await requireAdmin(request, env); if (deny) return deny;
    return json({ ok: true, syncKey: await getSetting(env, 'sync_key') });
  }
  if (path === '/api/admin/pin' && method === 'POST') {
    const deny = await requireAdmin(request, env); if (deny) return deny;
    const body = await request.json().catch(() => ({}));
    const pin = String(body.newPin || '').trim();
    if (!/^\d{4,12}$/.test(pin)) return json({ error: 'PIN must be 4–12 digits' }, 400);
    const salt = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
    await setSetting(env, 'admin_pin_salt', salt);
    await setSetting(env, 'admin_pin_hash', await sha256(salt + ':' + pin));
    return json({ ok: true });
  }
  if (path === '/api/admin/state' && method === 'GET') {
    const deny = await requireAdmin(request, env); if (deny) return deny;
    const row = await env.DB.prepare('SELECT data, client_saved_at, updated_at FROM app_state WHERE id = 1').first();
    if (!row) return json({ data: null });
    const data = JSON.parse(row.data);
    return json({ data, clientSavedAt: row.client_saved_at, updatedAt: row.updated_at, counts: entryCounts(data) });
  }
  if (path === '/api/admin/snapshots' && method === 'GET') {
    const deny = await requireAdmin(request, env); if (deny) return deny;
    const { results } = await env.DB.prepare('SELECT id, created_at, length(data) AS bytes FROM snapshots ORDER BY id DESC LIMIT 200').all();
    return json({ snapshots: results });
  }
  const snap = path.match(/^\/api\/admin\/snapshots\/(\d+)$/);
  if (snap && method === 'GET') {
    const deny = await requireAdmin(request, env); if (deny) return deny;
    const row = await env.DB.prepare('SELECT data, created_at FROM snapshots WHERE id = ?').bind(Number(snap[1])).first();
    if (!row) return json({ error: 'Not found' }, 404);
    return json({ data: JSON.parse(row.data), createdAt: row.created_at });
  }

  // ---- Cloe's data sync ----
  if (path === '/api/state' && method === 'GET') {
    const deny = await requireSync(request, env); if (deny) return deny;
    const row = await env.DB.prepare('SELECT data, client_saved_at, updated_at FROM app_state WHERE id = 1').first();
    if (!row) return json({ data: null, clientSavedAt: null });
    return json({ data: JSON.parse(row.data), clientSavedAt: row.client_saved_at, updatedAt: row.updated_at });
  }
  if (path === '/api/state' && method === 'PUT') {
    const deny = await requireSync(request, env); if (deny) return deny;
    const text = await request.text();
    if (text.length > MAX_STATE_BYTES) return json({ error: 'Too big' }, 413);
    let body;
    try { body = JSON.parse(text); } catch { return json({ error: 'Bad JSON' }, 400); }
    const data = body?.data;
    if (!data || !Array.isArray(data.daily) || !Array.isArray(data.food) || !Array.isArray(data.flare)) {
      return json({ error: 'That does not look like app data' }, 400);
    }
    const savedAt = String(body.savedAt || data._modifiedAt || new Date().toISOString()).slice(0, 40);
    const existing = await env.DB.prepare('SELECT data FROM app_state WHERE id = 1').first();

    // Keep a backup copy of what was there before, every few hours,
    // and always if the new data has fewer entries than the old.
    if (existing) {
      const last = await env.DB.prepare('SELECT created_at FROM snapshots ORDER BY id DESC LIMIT 1').first();
      const lastMs = last ? Date.parse(last.created_at.replace(' ', 'T') + 'Z') : 0;
      const before = entryCounts(JSON.parse(existing.data)), after = entryCounts(data);
      const shrank = after.daily < before.daily || after.food < before.food || after.flare < before.flare;
      if (shrank || Date.now() - lastMs > SNAPSHOT_EVERY_HOURS * 3600000) {
        await env.DB.prepare('INSERT INTO snapshots (data) VALUES (?)').bind(existing.data).run();
        await env.DB.prepare('DELETE FROM snapshots WHERE id NOT IN (SELECT id FROM snapshots ORDER BY id DESC LIMIT ?)').bind(SNAPSHOTS_KEPT).run();
      }
    }
    await env.DB.prepare("INSERT INTO app_state (id, data, client_saved_at, updated_at) VALUES (1, ?, ?, datetime('now')) ON CONFLICT(id) DO UPDATE SET data = excluded.data, client_saved_at = excluded.client_saved_at, updated_at = excluded.updated_at")
      .bind(JSON.stringify(data), savedAt).run();
    return json({ ok: true, savedAt });
  }

  return json({ error: 'Not found' }, 404);
}
