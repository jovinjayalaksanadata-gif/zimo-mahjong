// Zi Mo Mahjong — API (Cloudflare Pages Functions + D1)
// Semua waktu disimpan sebagai "detik WIB": epoch detik dari jam dinding WIB (UTC+7)
// yang dibaca seolah-olah UTC. Jadi 2026-10-22 19:00 WIB = Date.UTC(2026,9,22,19)/1000.
import { SCHEMA } from './schema.js';

const TZ = 7 * 3600;
const nowWib = () => Math.floor(Date.now() / 1000) + TZ;
const realNow = () => Math.floor(Date.now() / 1000);

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (msg, status = 400) => { throw new HttpError(status, msg); };
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });

let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch(SCHEMA.map((s) => db.prepare(s)));
  schemaReady = true;
}

// ---------- helpers ----------
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (h) => new Uint8Array(h.match(/../g).map((x) => parseInt(x, 16)));
function randCode(n, alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789') {
  const b = crypto.getRandomValues(new Uint8Array(n));
  return [...b].map((x) => alphabet[x % alphabet.length]).join('');
}
async function hashPw(pw, saltHex) {
  const salt = saltHex ? unhex(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256);
  return { salt: hex(salt), hash: hex(bits) };
}
function safeEq(a, b) {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const int = (v, d = 0) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  if (!m) fail('Tanggal tidak valid');
  return Date.UTC(+m[1], +m[2] - 1, +m[3]) / 1000;
}
const dateStr = (ts) => new Date(ts * 1000).toISOString().slice(0, 10);
const dayStart = (ts) => ts - (ts % 86400);
function normPhone(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.startsWith('0')) d = '62' + d.slice(1);
  if (d.startsWith('8')) d = '62' + d;
  return d;
}

async function getSettings(db) {
  const { results } = await db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(results.map((r) => [r.key, r.value]));
}
function tablePrice(hours, s) {
  const rate = int(s.price_per_hour), ph = int(s.package_hours), pp = int(s.package_price);
  if (pp > 0 && ph > 0) { const k = Math.floor(hours / ph); return k * pp + (hours - k * ph) * rate; }
  return hours * rate;
}
async function audit(db, user, action, entity, entityId, detail) {
  await db.prepare('INSERT INTO audit_log(ts,user_id,user_name,action,entity,entity_id,detail) VALUES (?,?,?,?,?,?,?)')
    .bind(nowWib(), user?.id ?? null, user?.name ?? 'publik', action, entity ?? null, entityId != null ? String(entityId) : null,
      detail ? (typeof detail === 'string' ? detail : JSON.stringify(detail)) : null).run();
}
async function expirePending(db) {
  await db.prepare("UPDATE bookings SET status='expired' WHERE status='pending' AND expires_at IS NOT NULL AND expires_at < ?").bind(nowWib()).run();
}
async function checkSlot(db, tableId, start, end, ignoreId = 0) {
  const t = await db.prepare('SELECT id FROM tables_ WHERE id=? AND active=1').bind(tableId).first();
  if (!t) fail('Meja tidak ditemukan');
  const clash = await db.prepare(
    "SELECT id FROM bookings WHERE table_id=? AND status IN ('pending','confirmed') AND start_ts < ? AND end_ts > ? AND id != ? LIMIT 1"
  ).bind(tableId, end, start, ignoreId).first();
  if (clash) fail('Slot sudah terisi, pilih jam atau meja lain', 409);
  // meja yang sedang dipakai (sesi terbuka) dianggap terisi sampai minimal 1 jam ke depan
  if (start < nowWib() + 3600) {
    const open = await db.prepare("SELECT id FROM table_sessions WHERE table_id=? AND status='open' LIMIT 1").bind(tableId).first();
    if (open) fail('Meja sedang dipakai, pilih jam lain', 409);
  }
}
async function nextOrderNo(db) {
  const d = dateStr(nowWib());
  const prefix = 'ZM' + d.slice(2).replace(/-/g, '') + '-';
  const r = await db.prepare("SELECT COUNT(*) c FROM orders WHERE no LIKE ?").bind(prefix + '%').first();
  return prefix + String(r.c + 1).padStart(3, '0');
}
async function orderWithItems(db, id) {
  const o = await db.prepare(`SELECT o.*, u.name cashier_name, v.name voided_by_name FROM orders o
    LEFT JOIN users u ON u.id=o.cashier_id LEFT JOIN users v ON v.id=o.voided_by WHERE o.id=?`).bind(id).first();
  if (!o) fail('Transaksi tidak ditemukan', 404);
  const { results } = await db.prepare('SELECT * FROM order_items WHERE order_id=? ORDER BY id').bind(id).all();
  o.items = results;
  return o;
}
async function recalcOrder(db, orderId) {
  const r = await db.prepare('SELECT COALESCE(SUM(total),0) s FROM order_items WHERE order_id=?').bind(orderId).first();
  const o = await db.prepare('SELECT discount FROM orders WHERE id=?').bind(orderId).first();
  const total = Math.max(0, r.s - (o?.discount || 0));
  await db.prepare('UPDATE orders SET subtotal=?, total=? WHERE id=?').bind(r.s, total, orderId).run();
}
const PAY_METHODS = ['cash', 'qris', 'transfer', 'debit'];
function payMethod(m) { if (!PAY_METHODS.includes(m)) fail('Metode bayar tidak valid'); return m; }

// ---------- auth ----------
function getCookie(req, name) {
  const c = req.headers.get('cookie') || '';
  const m = c.split(/;\s*/).find((x) => x.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}
async function currentUser(req, db) {
  const tok = getCookie(req, 'zs');
  if (!tok) return null;
  const u = await db.prepare(`SELECT u.id, u.username, u.name, u.role FROM sessions s JOIN users u ON u.id=s.user_id
     WHERE s.token=? AND s.expires>? AND u.active=1`).bind(tok, realNow()).first();
  return u || null;
}
function need(user, ...roles) {
  if (!user) fail('Silakan login dulu', 401);
  if (roles.length && !roles.includes(user.role)) fail('Akses ditolak untuk role ' + user.role, 403);
  return user;
}
const isAdmin = (u) => u && (u.role === 'admin' || u.role === 'superadmin');

// ---------- router ----------
const routes = [];
const route = (method, pattern, handler) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler });
};

export async function onRequest(ctx) {
  const { request, env } = ctx;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, '').replace(/\/+$/, '') || '/';
  try {
    if (!env.DB) fail('Database D1 belum terhubung (binding "DB")', 500);
    await ensureSchema(env.DB);
    for (const r of routes) {
      if (r.method !== request.method) continue;
      const m = r.re.exec(path);
      if (!m) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      let body = {};
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
        const t = await request.text();
        if (t) { try { body = JSON.parse(t); } catch { fail('Body JSON tidak valid'); } }
        // proteksi CSRF sederhana: request yang mengubah data harus dari origin yang sama
        const origin = request.headers.get('origin');
        if (origin && new URL(origin).host !== url.host) fail('Origin tidak diizinkan', 403);
      }
      const user = await currentUser(request, env.DB);
      return await r.handler({ req: request, env, db: env.DB, url, q: url.searchParams, params, body, user });
    }
    fail('Endpoint tidak ditemukan', 404);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: 'Terjadi kesalahan server: ' + (e.message || e) }, 500);
  }
}

// ===== Setup & Auth =====
route('GET', '/setup', async ({ db, env }) => {
  const r = await db.prepare('SELECT COUNT(*) c FROM users').first();
  return json({ needsSetup: r.c === 0, needsKey: !!env.SETUP_KEY });
});
route('POST', '/setup', async ({ db, env, body }) => {
  const r = await db.prepare('SELECT COUNT(*) c FROM users').first();
  if (r.c > 0) fail('Setup sudah pernah dilakukan', 403);
  if (env.SETUP_KEY && body.key !== env.SETUP_KEY) fail('Kode setup salah', 403);
  const username = str(body.username, 40).toLowerCase(), name = str(body.name, 80), pw = String(body.password || '');
  if (!/^[a-z0-9._-]{2,40}$/.test(username)) fail('Username 2–40 huruf kecil/angka');
  if (pw.length < 8) fail('Password minimal 8 karakter');
  const h = await hashPw(pw);
  await db.prepare("INSERT INTO users(username,name,role,pass_hash,salt,created_at) VALUES (?,?,?,?,?,?)")
    .bind(username, name || username, 'superadmin', h.hash, h.salt, nowWib()).run();
  await audit(db, { id: null, name: name || username }, 'setup_superadmin', 'user', username);
  return json({ ok: true });
});
route('POST', '/auth/login', async ({ db, body, url }) => {
  const username = str(body.username, 40).toLowerCase();
  const u = await db.prepare('SELECT * FROM users WHERE username=? AND active=1').bind(username).first();
  const h = await hashPw(String(body.password || ''), u?.salt || '00'.repeat(16));
  if (!u || !safeEq(h.hash, u.pass_hash)) fail('Username atau password salah', 401);
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const maxAge = 7 * 86400;
  await db.prepare('DELETE FROM sessions WHERE expires < ?').bind(realNow()).run();
  await db.prepare('INSERT INTO sessions(token,user_id,expires) VALUES (?,?,?)').bind(token, u.id, realNow() + maxAge).run();
  await audit(db, u, 'login', 'user', u.id);
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  return json({ user: { id: u.id, username: u.username, name: u.name, role: u.role } }, 200,
    { 'set-cookie': `zs=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}` });
});
route('POST', '/auth/logout', async ({ db, req }) => {
  const tok = getCookie(req, 'zs');
  if (tok) await db.prepare('DELETE FROM sessions WHERE token=?').bind(tok).run();
  return json({ ok: true }, 200, { 'set-cookie': 'zs=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' });
});
route('GET', '/auth/me', async ({ user }) => json({ user }));
route('POST', '/auth/password', async ({ db, user, body }) => {
  need(user);
  const u = await db.prepare('SELECT * FROM users WHERE id=?').bind(user.id).first();
  const h = await hashPw(String(body.old || ''), u.salt);
  if (!safeEq(h.hash, u.pass_hash)) fail('Password lama salah', 401);
  if (String(body.password || '').length < 8) fail('Password baru minimal 8 karakter');
  const n = await hashPw(String(body.password));
  await db.prepare('UPDATE users SET pass_hash=?, salt=? WHERE id=?').bind(n.hash, n.salt, u.id).run();
  await audit(db, user, 'change_password', 'user', u.id);
  return json({ ok: true });
});

// ===== Publik: info & ketersediaan =====
const PUBLIC_KEYS = ['business_name', 'tagline', 'address', 'maps_url', 'whatsapp', 'instagram', 'price_per_hour',
  'package_hours', 'package_price', 'hold_minutes', 'max_booking_hours', 'max_days_ahead', 'payment_info'];
route('GET', '/public/info', async ({ db }) => {
  const s = await getSettings(db);
  const { results: tables } = await db.prepare('SELECT id, name FROM tables_ WHERE active=1 ORDER BY sort, id').all();
  return json({ settings: Object.fromEntries(PUBLIC_KEYS.map((k) => [k, s[k]])), tables, now: nowWib() });
});
route('GET', '/availability', async ({ db, q }) => {
  await expirePending(db);
  const day = parseDate(q.get('date'));
  const end = day + 86400;
  const { results: tables } = await db.prepare('SELECT id, name FROM tables_ WHERE active=1 ORDER BY sort, id').all();
  const { results: bks } = await db.prepare(
    "SELECT table_id, start_ts, end_ts FROM bookings WHERE status IN ('pending','confirmed') AND start_ts < ? AND end_ts > ?"
  ).bind(end, day).all();
  const { results: open } = await db.prepare("SELECT table_id FROM table_sessions WHERE status='open'").all();
  const now = nowWib();
  const out = tables.map((t) => {
    const busy = [];
    for (let h = 0; h < 24; h++) {
      const s = day + h * 3600, e = s + 3600;
      let st = 'free';
      if (e <= now) st = 'past';
      else if (bks.some((b) => b.table_id === t.id && b.start_ts < e && b.end_ts > s)) st = 'booked';
      else if (s < now + 3600 && open.some((o) => o.table_id === t.id)) st = 'booked';
      busy.push(st);
    }
    return { id: t.id, name: t.name, hours: busy };
  });
  return json({ date: q.get('date'), now, tables: out });
});

// ===== Publik: booking =====
route('POST', '/bookings', async ({ db, body }) => {
  await expirePending(db);
  const s = await getSettings(db);
  const name = str(body.name, 80), phone = normPhone(body.phone);
  if (name.length < 2) fail('Nama wajib diisi');
  if (phone.length < 10 || phone.length > 15) fail('Nomor WhatsApp tidak valid');
  const hours = int(body.hours);
  if (hours < 1 || hours > int(s.max_booking_hours, 8)) fail('Durasi tidak valid');
  const start = parseDate(body.date) + int(body.hour, -1) * 3600;
  const h = int(body.hour, -1); if (h < 0 || h > 23) fail('Jam tidak valid');
  const now = nowWib();
  if (start <= now) fail('Jam mulai sudah lewat');
  if (start > now + int(s.max_days_ahead, 30) * 86400) fail('Terlalu jauh ke depan');
  const end = start + hours * 3600;
  const tableId = int(body.table_id);
  await checkSlot(db, tableId, start, end);
  const total = tablePrice(hours, s);
  const code = 'ZM-' + randCode(6);
  const expires = now + int(s.hold_minutes, 60) * 60;
  await db.prepare(`INSERT INTO bookings(code,customer_name,phone,table_id,start_ts,end_ts,hours,total,status,source,expires_at,note,created_at)
     VALUES (?,?,?,?,?,?,?,?,'pending','online',?,?,?)`)
    .bind(code, name, phone, tableId, start, end, hours, total, expires, str(body.note, 300), now).run();
  await audit(db, null, 'booking_create_online', 'booking', code, { name, tableId, start: dateStr(start), hour: h, hours, total });
  return json({ code, total, start_ts: start, end_ts: end, expires_at: expires, payment_info: s.payment_info, whatsapp: s.whatsapp });
});
async function publicBooking(db, code, phone) {
  const b = await db.prepare(`SELECT b.*, t.name table_name FROM bookings b JOIN tables_ t ON t.id=b.table_id WHERE b.code=?`)
    .bind(str(code, 20).toUpperCase()).first();
  if (!b || b.phone !== normPhone(phone)) fail('Booking tidak ditemukan. Cek kode & nomor WhatsApp.', 404);
  return b;
}
const pubFields = (b) => ({ code: b.code, customer_name: b.customer_name, table_id: b.table_id, table_name: b.table_name,
  start_ts: b.start_ts, end_ts: b.end_ts, hours: b.hours, total: b.total, status: b.status, paid: b.paid,
  expires_at: b.expires_at, reschedule_count: b.reschedule_count });
route('GET', '/bookings/lookup', async ({ db, q }) => {
  await expirePending(db);
  const b = await publicBooking(db, q.get('code'), q.get('phone'));
  const s = await getSettings(db);
  return json({ booking: pubFields(b), can_reschedule: canReschedule(b), payment_info: s.payment_info, whatsapp: s.whatsapp });
});
function canReschedule(b) {
  if (!['pending', 'confirmed'].includes(b.status)) return false;
  // Reschedule paling lambat H-1: hari ini harus sebelum tanggal main
  return dayStart(nowWib()) < dayStart(b.start_ts);
}
route('POST', '/bookings/reschedule', async ({ db, body }) => {
  await expirePending(db);
  const b = await publicBooking(db, body.code, body.phone);
  if (!canReschedule(b)) fail('Reschedule hanya bisa paling lambat H-1 sebelum tanggal main');
  const start = parseDate(body.date) + int(body.hour, -1) * 3600;
  if (int(body.hour, -1) < 0 || int(body.hour) > 23) fail('Jam tidak valid');
  if (start <= nowWib()) fail('Jam mulai sudah lewat');
  const tableId = int(body.table_id, b.table_id);
  const end = start + b.hours * 3600;
  await checkSlot(db, tableId, start, end, b.id);
  await db.prepare('UPDATE bookings SET start_ts=?, end_ts=?, table_id=?, reschedule_count=reschedule_count+1 WHERE id=?')
    .bind(start, end, tableId, b.id).run();
  await audit(db, null, 'booking_reschedule_customer', 'booking', b.code, { from: b.start_ts, to: start, tableId });
  return json({ ok: true });
});

// ===== Admin: booking =====
route('GET', '/admin/bookings', async ({ db, user, q }) => {
  need(user);
  await expirePending(db);
  const from = parseDate(q.get('from')), to = parseDate(q.get('to') || q.get('from')) + 86400;
  const { results } = await db.prepare(`SELECT b.*, t.name table_name FROM bookings b JOIN tables_ t ON t.id=b.table_id
     WHERE b.start_ts < ? AND b.end_ts > ? ORDER BY b.start_ts`).bind(to, from).all();
  return json({ bookings: results });
});
route('POST', '/admin/bookings', async ({ db, user, body }) => {
  need(user);
  const s = await getSettings(db);
  const name = str(body.name, 80); if (name.length < 2) fail('Nama wajib diisi');
  const phone = normPhone(body.phone) || '-';
  const hours = int(body.hours); if (hours < 1 || hours > 24) fail('Durasi tidak valid');
  const h = int(body.hour, -1); if (h < 0 || h > 23) fail('Jam tidak valid');
  const start = parseDate(body.date) + h * 3600, end = start + hours * 3600;
  const tableId = int(body.table_id);
  await checkSlot(db, tableId, start, end);
  const total = tablePrice(hours, s);
  const code = 'ZM-' + randCode(6);
  const r = await db.prepare(`INSERT INTO bookings(code,customer_name,phone,table_id,start_ts,end_ts,hours,total,status,source,note,created_at,created_by)
     VALUES (?,?,?,?,?,?,?,?,'confirmed','staff',?,?,?)`)
    .bind(code, name, phone, tableId, start, end, hours, total, str(body.note, 300), nowWib(), user.id).run();
  const id = r.meta.last_row_id;
  if (body.paid_method) await payBooking(db, user, id, payMethod(body.paid_method));
  await audit(db, user, 'booking_create_staff', 'booking', code, { name, tableId, hours, total, paid: !!body.paid_method });
  return json({ ok: true, code });
});
async function payBooking(db, user, id, method) {
  const b = await db.prepare('SELECT b.*, t.name table_name FROM bookings b JOIN tables_ t ON t.id=b.table_id WHERE b.id=?').bind(id).first();
  if (!b) fail('Booking tidak ditemukan', 404);
  if (b.paid) fail('Booking sudah lunas');
  const now = nowWib();
  const no = await nextOrderNo(db);
  const o = await db.prepare(`INSERT INTO orders(no,booking_id,customer_name,subtotal,total,payment_method,status,cashier_id,created_at,paid_at)
     VALUES (?,?,?,?,?,?,'paid',?,?,?)`).bind(no, b.id, b.customer_name, b.total, b.total, method, user.id, now, now).run();
  const oid = o.meta.last_row_id;
  await db.prepare(`INSERT INTO order_items(order_id,item_type,ref_id,name,category,qty,price,total) VALUES (?,?,?,?,?,?,?,?)`)
    .bind(oid, 'booking', b.id, `Booking ${b.table_name} ${b.code} (${b.hours} jam)`, 'Meja', b.hours, Math.round(b.total / b.hours), b.total).run();
  await db.prepare("UPDATE bookings SET paid=1, order_id=?, status='confirmed', expires_at=NULL WHERE id=?").bind(oid, b.id).run();
  return oid;
}
route('POST', '/admin/bookings/:id/confirm', async ({ db, user, params, body }) => {
  need(user);
  const b = await db.prepare('SELECT * FROM bookings WHERE id=?').bind(int(params.id)).first();
  if (!b) fail('Booking tidak ditemukan', 404);
  if (!['pending', 'confirmed', 'expired'].includes(b.status)) fail('Status booking tidak bisa dikonfirmasi');
  if (b.status === 'expired') await checkSlot(db, b.table_id, b.start_ts, b.end_ts, b.id);
  const oid = await payBooking(db, user, b.id, payMethod(body.method || 'transfer'));
  await audit(db, user, 'booking_confirm_paid', 'booking', b.code, { method: body.method, total: b.total });
  return json({ ok: true, order_id: oid });
});
route('POST', '/admin/bookings/:id/cancel', async ({ db, user, params, body }) => {
  need(user, 'admin', 'superadmin');
  const b = await db.prepare('SELECT * FROM bookings WHERE id=?').bind(int(params.id)).first();
  if (!b) fail('Booking tidak ditemukan', 404);
  if (!['pending', 'confirmed'].includes(b.status)) fail('Booking tidak aktif');
  await db.prepare("UPDATE bookings SET status='cancelled', note=COALESCE(note,'')||? WHERE id=?")
    .bind(`\n[Batal] ${str(body.reason, 200)}`, b.id).run();
  await audit(db, user, 'booking_cancel', 'booking', b.code, { reason: body.reason, paid: b.paid });
  return json({ ok: true });
});
route('POST', '/admin/bookings/:id/reschedule', async ({ db, user, params, body }) => {
  need(user);
  const b = await db.prepare('SELECT * FROM bookings WHERE id=?').bind(int(params.id)).first();
  if (!b || !['pending', 'confirmed'].includes(b.status)) fail('Booking tidak aktif');
  const h = int(body.hour, -1); if (h < 0 || h > 23) fail('Jam tidak valid');
  const start = parseDate(body.date) + h * 3600, end = start + b.hours * 3600;
  const tableId = int(body.table_id, b.table_id);
  await checkSlot(db, tableId, start, end, b.id);
  await db.prepare('UPDATE bookings SET start_ts=?, end_ts=?, table_id=?, reschedule_count=reschedule_count+1 WHERE id=?')
    .bind(start, end, tableId, b.id).run();
  await audit(db, user, 'booking_reschedule', 'booking', b.code, { from: b.start_ts, to: start, tableId });
  return json({ ok: true });
});
route('POST', '/admin/bookings/:id/noshow', async ({ db, user, params }) => {
  need(user);
  const b = await db.prepare('SELECT * FROM bookings WHERE id=?').bind(int(params.id)).first();
  if (!b || !['pending', 'confirmed'].includes(b.status)) fail('Booking tidak aktif');
  await db.prepare("UPDATE bookings SET status='no_show' WHERE id=?").bind(b.id).run();
  await audit(db, user, 'booking_no_show', 'booking', b.code);
  return json({ ok: true });
});

// ===== Admin: POS — meja & sesi =====
async function sessionBill(db, sess, s, at = nowWib()) {
  const mins = Math.max(0, (at - sess.started_at) / 60);
  let hours = Math.max(1, Math.ceil((mins - int(s.grace_minutes, 0)) / 60));
  let amount = tablePrice(hours, s), prepaidHours = 0, label = `Main meja (${hours} jam)`;
  if (sess.booking_id) {
    const b = await db.prepare('SELECT hours, paid, code FROM bookings WHERE id=?').bind(sess.booking_id).first();
    if (b) {
      hours = Math.max(hours, b.hours);
      if (b.paid) {
        prepaidHours = b.hours;
        amount = tablePrice(hours, s) - tablePrice(b.hours, s);
        label = hours > b.hours ? `Tambahan jam (${hours - b.hours} jam, booking ${b.code})` : `Booking ${b.code} (lunas)`;
      } else { amount = tablePrice(hours, s); label = `Main meja (${hours} jam, booking ${b.code})`; }
    }
  }
  return { minutes: Math.floor(mins), hours, prepaidHours, amount, label };
}
route('GET', '/admin/pos', async ({ db, user }) => {
  need(user);
  await expirePending(db);
  const s = await getSettings(db);
  const now = nowWib();
  const { results: tables } = await db.prepare('SELECT * FROM tables_ WHERE active=1 ORDER BY sort, id').all();
  const { results: sessions } = await db.prepare(`SELECT ts.*, o.subtotal fnb_total FROM table_sessions ts
     LEFT JOIN orders o ON o.id=ts.order_id WHERE ts.status='open'`).all();
  const { results: upcoming } = await db.prepare(`SELECT * FROM bookings WHERE status IN ('pending','confirmed')
     AND end_ts > ? AND start_ts < ? ORDER BY start_ts`).bind(now, now + 86400).all();
  const { results: menu } = await db.prepare('SELECT * FROM menu_items WHERE active=1 ORDER BY category, name').all();
  for (const t of tables) {
    const sess = sessions.find((x) => x.table_id === t.id);
    if (sess) {
      const bill = await sessionBill(db, sess, s, now);
      const { results: items } = await db.prepare('SELECT * FROM order_items WHERE order_id=? ORDER BY id').bind(sess.order_id).all();
      t.session = { ...sess, bill, items };
    }
    t.upcoming = upcoming.filter((b) => b.table_id === t.id && !(sess && sess.booking_id === b.id)).slice(0, 3);
  }
  return json({ now, tables, menu, settings: { price_per_hour: s.price_per_hour, package_hours: s.package_hours, package_price: s.package_price, grace_minutes: s.grace_minutes, receipt_footer: s.receipt_footer, business_name: s.business_name, address: s.address } });
});
route('POST', '/admin/sessions', async ({ db, user, body }) => {
  need(user);
  const tableId = int(body.table_id);
  const t = await db.prepare('SELECT * FROM tables_ WHERE id=? AND active=1').bind(tableId).first();
  if (!t) fail('Meja tidak ditemukan');
  const open = await db.prepare("SELECT id FROM table_sessions WHERE table_id=? AND status='open'").bind(tableId).first();
  if (open) fail('Meja ini masih ada sesi berjalan');
  let bookingId = null, name = str(body.customer_name, 80);
  const now = nowWib();
  if (body.booking_id) {
    const b = await db.prepare("SELECT * FROM bookings WHERE id=? AND status IN ('pending','confirmed')").bind(int(body.booking_id)).first();
    if (!b) fail('Booking tidak aktif');
    bookingId = b.id; name = name || b.customer_name;
    await db.prepare("UPDATE bookings SET status='completed' WHERE id=?").bind(b.id).run();
  } else {
    // walk-in: pastikan tidak bentrok dengan booking yang mulai dalam 1 jam ke depan
    const clash = await db.prepare(`SELECT code, start_ts FROM bookings WHERE table_id=? AND status IN ('pending','confirmed')
       AND start_ts < ? AND end_ts > ? LIMIT 1`).bind(tableId, now + 3600, now).first();
    if (clash && !body.force) fail(`Ada booking ${clash.code} di meja ini sebentar lagi. Centang "tetap mulai" bila yakin.`, 409);
  }
  const no = null;
  const o = await db.prepare(`INSERT INTO orders(no,customer_name,status,cashier_id,created_at) VALUES (?,?, 'open', ?, ?)`)
    .bind(no, name || t.name, user.id, now).run();
  const r = await db.prepare(`INSERT INTO table_sessions(table_id,booking_id,customer_name,started_at,status,order_id,started_by)
     VALUES (?,?,?,?, 'open', ?, ?)`).bind(tableId, bookingId, name || 'Walk-in', now, o.meta.last_row_id, user.id).run();
  await db.prepare('UPDATE orders SET table_session_id=? WHERE id=?').bind(r.meta.last_row_id, o.meta.last_row_id).run();
  await audit(db, user, 'session_start', 'table_session', r.meta.last_row_id, { table: t.name, bookingId, name });
  return json({ ok: true, id: r.meta.last_row_id });
});
async function openSession(db, id) {
  const s = await db.prepare("SELECT * FROM table_sessions WHERE id=? AND status='open'").bind(int(id)).first();
  if (!s) fail('Sesi tidak ditemukan atau sudah ditutup', 404);
  return s;
}
route('POST', '/admin/sessions/:id/items', async ({ db, user, params, body }) => {
  need(user);
  const sess = await openSession(db, params.id);
  const m = await db.prepare('SELECT * FROM menu_items WHERE id=? AND active=1').bind(int(body.menu_id)).first();
  if (!m) fail('Menu tidak ditemukan');
  const qty = Math.max(1, Math.min(99, int(body.qty, 1)));
  const ex = await db.prepare("SELECT * FROM order_items WHERE order_id=? AND item_type='menu' AND ref_id=?").bind(sess.order_id, m.id).first();
  if (ex) await db.prepare('UPDATE order_items SET qty=qty+?, total=(qty+?)*price WHERE id=?').bind(qty, qty, ex.id).run();
  else await db.prepare('INSERT INTO order_items(order_id,item_type,ref_id,name,category,qty,price,total) VALUES (?,?,?,?,?,?,?,?)')
    .bind(sess.order_id, 'menu', m.id, m.name, m.category, qty, m.price, m.price * qty).run();
  await recalcOrder(db, sess.order_id);
  return json({ ok: true });
});
route('POST', '/admin/sessions/:id/items/:itemId/remove', async ({ db, user, params }) => {
  need(user);
  const sess = await openSession(db, params.id);
  const it = await db.prepare('SELECT * FROM order_items WHERE id=? AND order_id=?').bind(int(params.itemId), sess.order_id).first();
  if (!it) fail('Item tidak ditemukan');
  if (it.qty > 1) await db.prepare('UPDATE order_items SET qty=qty-1, total=(qty-1)*price WHERE id=?').bind(it.id).run();
  else await db.prepare('DELETE FROM order_items WHERE id=?').bind(it.id).run();
  await recalcOrder(db, sess.order_id);
  return json({ ok: true });
});
route('POST', '/admin/sessions/:id/checkout', async ({ db, user, params, body }) => {
  need(user);
  const sess = await openSession(db, params.id);
  const s = await getSettings(db);
  const method = payMethod(body.payment_method);
  const now = nowWib();
  const bill = await sessionBill(db, sess, s, now);
  const discount = Math.max(0, int(body.discount));
  if (discount > 0 && !isAdmin(user)) fail('Diskon hanya bisa diberikan admin/superadmin', 403);
  await db.prepare("DELETE FROM order_items WHERE order_id=? AND item_type='table'").bind(sess.order_id).run();
  if (bill.amount > 0 || !bill.prepaidHours)
    await db.prepare('INSERT INTO order_items(order_id,item_type,ref_id,name,category,qty,price,total) VALUES (?,?,?,?,?,?,?,?)')
      .bind(sess.order_id, 'table', sess.id, bill.label, 'Meja', 1, bill.amount, bill.amount).run();
  const no = await nextOrderNo(db);
  await db.prepare("UPDATE orders SET discount=?, payment_method=?, status='paid', paid_at=?, no=?, cashier_id=? WHERE id=?")
    .bind(discount, method, now, no, user.id, sess.order_id).run();
  await recalcOrder(db, sess.order_id);
  await db.prepare("UPDATE table_sessions SET status='closed', ended_at=?, billed_hours=?, amount=? WHERE id=?")
    .bind(now, bill.hours, bill.amount, sess.id).run();
  const o = await orderWithItems(db, sess.order_id);
  if (o.total === 0 && o.items.length === 0) await db.prepare("UPDATE orders SET status='nocharge' WHERE id=?").bind(o.id).run();
  await audit(db, user, 'session_checkout', 'order', o.no, { total: o.total, method, hours: bill.hours, discount });
  return json({ ok: true, order: o });
});
route('POST', '/admin/sessions/:id/cancel', async ({ db, user, params, body }) => {
  need(user, 'admin', 'superadmin');
  const sess = await openSession(db, params.id);
  await db.prepare("UPDATE table_sessions SET status='cancelled', ended_at=? WHERE id=?").bind(nowWib(), sess.id).run();
  await db.prepare("UPDATE orders SET status='void', void_reason=?, voided_by=?, voided_at=? WHERE id=?")
    .bind('Sesi dibatalkan: ' + str(body.reason, 200), user.id, nowWib(), sess.order_id).run();
  if (sess.booking_id) await db.prepare("UPDATE bookings SET status='confirmed' WHERE id=?").bind(sess.booking_id).run();
  await audit(db, user, 'session_cancel', 'table_session', sess.id, { reason: body.reason });
  return json({ ok: true });
});
route('GET', '/admin/sessions/:id/bill', async ({ db, user, params }) => {
  need(user);
  const sess = await openSession(db, params.id);
  const bill = await sessionBill(db, sess, await getSettings(db));
  const o = await orderWithItems(db, sess.order_id);
  return json({ bill, order: o });
});

// ===== Admin: penjualan langsung (F&B tanpa meja) =====
route('POST', '/admin/orders', async ({ db, user, body }) => {
  need(user);
  const method = payMethod(body.payment_method);
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) fail('Keranjang kosong');
  const discount = Math.max(0, int(body.discount));
  if (discount > 0 && !isAdmin(user)) fail('Diskon hanya bisa diberikan admin/superadmin', 403);
  const now = nowWib();
  const no = await nextOrderNo(db);
  const o = await db.prepare(`INSERT INTO orders(no,customer_name,discount,payment_method,status,cashier_id,created_at,paid_at)
     VALUES (?,?,?,?, 'paid', ?, ?, ?)`).bind(no, str(body.customer_name, 80) || 'Umum', discount, method, user.id, now, now).run();
  const oid = o.meta.last_row_id;
  for (const it of items) {
    const m = await db.prepare('SELECT * FROM menu_items WHERE id=? AND active=1').bind(int(it.menu_id)).first();
    if (!m) fail('Menu tidak ditemukan');
    const qty = Math.max(1, Math.min(99, int(it.qty, 1)));
    await db.prepare('INSERT INTO order_items(order_id,item_type,ref_id,name,category,qty,price,total) VALUES (?,?,?,?,?,?,?,?)')
      .bind(oid, 'menu', m.id, m.name, m.category, qty, m.price, m.price * qty).run();
  }
  await recalcOrder(db, oid);
  const order = await orderWithItems(db, oid);
  await audit(db, user, 'order_create', 'order', no, { total: order.total, method });
  return json({ ok: true, order });
});
route('GET', '/admin/orders', async ({ db, user, q }) => {
  need(user);
  let from = parseDate(q.get('from')), to = parseDate(q.get('to') || q.get('from')) + 86400;
  let sql = `SELECT o.*, u.name cashier_name FROM orders o LEFT JOIN users u ON u.id=o.cashier_id
     WHERE o.status IN ('paid','void') AND o.no IS NOT NULL AND COALESCE(o.paid_at,o.created_at) >= ? AND COALESCE(o.paid_at,o.created_at) < ?`;
  const binds = [from, to];
  if (!isAdmin(user)) { // kasir hanya melihat transaksi miliknya sendiri hari ini
    const d = dayStart(nowWib());
    binds[0] = Math.max(from, d); binds[1] = Math.min(to, d + 86400);
    sql += ' AND o.cashier_id=?'; binds.push(user.id);
  }
  sql += ' ORDER BY COALESCE(o.paid_at,o.created_at) DESC LIMIT 500';
  const { results } = await db.prepare(sql).bind(...binds).all();
  return json({ orders: results });
});
route('GET', '/admin/orders/:id', async ({ db, user, params }) => {
  need(user);
  const o = await orderWithItems(db, int(params.id));
  if (!isAdmin(user) && o.cashier_id !== user.id) fail('Akses ditolak', 403);
  return json({ order: o });
});
route('POST', '/admin/orders/:id/void', async ({ db, user, params, body }) => {
  need(user, 'superadmin');
  const reason = str(body.reason, 200);
  if (reason.length < 3) fail('Alasan void wajib diisi');
  const o = await orderWithItems(db, int(params.id));
  if (o.status !== 'paid') fail('Hanya transaksi lunas yang bisa di-void');
  await db.prepare("UPDATE orders SET status='void', void_reason=?, voided_by=?, voided_at=? WHERE id=?")
    .bind(reason, user.id, nowWib(), o.id).run();
  if (o.booking_id) await db.prepare("UPDATE bookings SET paid=0, order_id=NULL WHERE id=? AND order_id=?").bind(o.booking_id, o.id).run();
  await audit(db, user, 'order_void', 'order', o.no, { reason, total: o.total, method: o.payment_method, items: o.items.map((i) => `${i.qty}x ${i.name}`) });
  return json({ ok: true });
});

// ===== Laporan =====
async function buildReport(db, from, to, cashierId) {
  const cw = cashierId ? ' AND o.cashier_id=' + int(cashierId) : '';
  const range = `o.paid_at >= ${from} AND o.paid_at < ${to}`;
  const tot = await db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(total),0) total, COALESCE(SUM(discount),0) discount, COALESCE(SUM(subtotal),0) gross
     FROM orders o WHERE status='paid' AND ${range}${cw}`).first();
  const { results: byMethod } = await db.prepare(`SELECT payment_method method, COUNT(*) n, SUM(total) total FROM orders o
     WHERE status='paid' AND ${range}${cw} GROUP BY payment_method ORDER BY total DESC`).all();
  const { results: byCat } = await db.prepare(`SELECT CASE WHEN i.item_type IN ('table','booking') THEN 'Meja' ELSE COALESCE(i.category,'Lainnya') END cat,
     SUM(i.qty) qty, SUM(i.total) total FROM order_items i JOIN orders o ON o.id=i.order_id
     WHERE o.status='paid' AND ${range}${cw} GROUP BY cat ORDER BY total DESC`).all();
  const { results: byDay } = await db.prepare(`SELECT (o.paid_at - (o.paid_at % 86400)) d, COUNT(*) n, SUM(o.total) total FROM orders o
     WHERE status='paid' AND ${range}${cw} GROUP BY d ORDER BY d`).all();
  const { results: topItems } = await db.prepare(`SELECT i.name, SUM(i.qty) qty, SUM(i.total) total FROM order_items i JOIN orders o ON o.id=i.order_id
     WHERE o.status='paid' AND i.item_type='menu' AND ${range}${cw} GROUP BY i.ref_id, i.name ORDER BY total DESC LIMIT 10`).all();
  const voids = await db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(total),0) total FROM orders o
     WHERE status='void' AND no IS NOT NULL AND o.paid_at >= ${from} AND o.paid_at < ${to}${cw}`).first();
  const { results: byCashier } = await db.prepare(`SELECT u.name, COUNT(*) n, SUM(o.total) total FROM orders o LEFT JOIN users u ON u.id=o.cashier_id
     WHERE o.status='paid' AND ${range}${cw} GROUP BY o.cashier_id ORDER BY total DESC`).all();
  const tableHours = await db.prepare(`SELECT COALESCE(SUM(billed_hours),0) h, COUNT(*) n FROM table_sessions
     WHERE status='closed' AND ended_at >= ${from} AND ended_at < ${to}`).first();
  return { from, to, totals: tot, byMethod, byCategory: byCat, byDay: byDay.map((r) => ({ ...r, date: dateStr(r.d) })), topItems, voids, byCashier, tableHours };
}
route('GET', '/admin/reports', async ({ db, user, q }) => {
  need(user, 'admin', 'superadmin');
  const from = parseDate(q.get('from')), to = parseDate(q.get('to') || q.get('from')) + 86400;
  if (to - from > 400 * 86400) fail('Rentang maksimal ~13 bulan');
  return json(await buildReport(db, from, to));
});
route('GET', '/admin/reports/shift', async ({ db, user }) => {
  need(user);
  const d = dayStart(nowWib());
  return json(await buildReport(db, d, d + 86400, user.role === 'kasir' ? user.id : null));
});
route('GET', '/admin/reports/export', async ({ db, user, q }) => {
  need(user, 'admin', 'superadmin');
  const from = parseDate(q.get('from')), to = parseDate(q.get('to') || q.get('from')) + 86400;
  const { results } = await db.prepare(`SELECT o.no, o.paid_at, o.status, o.customer_name, o.payment_method, i.name item, i.category, i.item_type,
      i.qty, i.price, i.total item_total, o.discount, o.total order_total, u.name cashier, o.void_reason
      FROM orders o JOIN order_items i ON i.order_id=o.id LEFT JOIN users u ON u.id=o.cashier_id
      WHERE o.no IS NOT NULL AND o.status IN ('paid','void') AND o.paid_at >= ? AND o.paid_at < ? ORDER BY o.paid_at, o.id, i.id`).bind(from, to).all();
  const esc = (v) => { const s = String(v ?? ''); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const head = ['No', 'Waktu (WIB)', 'Status', 'Pelanggan', 'Metode', 'Item', 'Kategori', 'Tipe', 'Qty', 'Harga', 'Total Item', 'Diskon Order', 'Total Order', 'Kasir', 'Alasan Void'];
  const lines = [head.join(',')].concat(results.map((r) => [r.no, new Date(r.paid_at * 1000).toISOString().slice(0, 16).replace('T', ' '), r.status,
    r.customer_name, r.payment_method, r.item, r.category, r.item_type, r.qty, r.price, r.item_total, r.discount, r.order_total, r.cashier, r.void_reason].map(esc).join(',')));
  await audit(db, user, 'report_export', 'report', `${dateStr(from)}..${dateStr(to - 86400)}`);
  return new Response('﻿' + lines.join('\n'), { headers: { 'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="laporan-zimo-${dateStr(from)}_${dateStr(to - 86400)}.csv"` } });
});

// ===== Menu =====
route('GET', '/admin/menu', async ({ db, user }) => {
  need(user);
  const { results } = await db.prepare('SELECT * FROM menu_items ORDER BY active DESC, category, name').all();
  return json({ menu: results });
});
route('POST', '/admin/menu', async ({ db, user, body }) => {
  need(user, 'admin', 'superadmin');
  const name = str(body.name, 80), price = int(body.price, -1);
  if (!name || price < 0) fail('Nama & harga wajib diisi');
  const r = await db.prepare('INSERT INTO menu_items(name,category,price) VALUES (?,?,?)').bind(name, str(body.category, 40) || 'Lainnya', price).run();
  await audit(db, user, 'menu_create', 'menu', r.meta.last_row_id, { name, price });
  return json({ ok: true });
});
route('PATCH', '/admin/menu/:id', async ({ db, user, params, body }) => {
  need(user, 'admin', 'superadmin');
  const m = await db.prepare('SELECT * FROM menu_items WHERE id=?').bind(int(params.id)).first();
  if (!m) fail('Menu tidak ditemukan', 404);
  const n = { name: body.name != null ? str(body.name, 80) : m.name, category: body.category != null ? str(body.category, 40) : m.category,
    price: body.price != null ? int(body.price, m.price) : m.price, active: body.active != null ? (body.active ? 1 : 0) : m.active };
  await db.prepare('UPDATE menu_items SET name=?, category=?, price=?, active=? WHERE id=?').bind(n.name, n.category, n.price, n.active, m.id).run();
  await audit(db, user, 'menu_update', 'menu', m.id, { before: m, after: n });
  return json({ ok: true });
});

// ===== Superadmin: pengguna, meja, pengaturan, audit =====
route('GET', '/admin/users', async ({ db, user }) => {
  need(user, 'superadmin');
  const { results } = await db.prepare('SELECT id, username, name, role, active, created_at FROM users ORDER BY id').all();
  return json({ users: results });
});
route('POST', '/admin/users', async ({ db, user, body }) => {
  need(user, 'superadmin');
  const username = str(body.username, 40).toLowerCase();
  if (!/^[a-z0-9._-]{2,40}$/.test(username)) fail('Username 2–40 huruf kecil/angka');
  if (!['superadmin', 'admin', 'kasir'].includes(body.role)) fail('Role tidak valid');
  if (String(body.password || '').length < 8) fail('Password minimal 8 karakter');
  if (await db.prepare('SELECT id FROM users WHERE username=?').bind(username).first()) fail('Username sudah dipakai');
  const h = await hashPw(String(body.password));
  await db.prepare('INSERT INTO users(username,name,role,pass_hash,salt,created_at) VALUES (?,?,?,?,?,?)')
    .bind(username, str(body.name, 80) || username, body.role, h.hash, h.salt, nowWib()).run();
  await audit(db, user, 'user_create', 'user', username, { role: body.role });
  return json({ ok: true });
});
route('PATCH', '/admin/users/:id', async ({ db, user, params, body }) => {
  need(user, 'superadmin');
  const u = await db.prepare('SELECT * FROM users WHERE id=?').bind(int(params.id)).first();
  if (!u) fail('User tidak ditemukan', 404);
  if (u.id === user.id && (body.active === false || (body.role && body.role !== 'superadmin'))) fail('Tidak bisa menonaktifkan / menurunkan role akun sendiri');
  const role = body.role ?? u.role;
  if (!['superadmin', 'admin', 'kasir'].includes(role)) fail('Role tidak valid');
  const active = body.active != null ? (body.active ? 1 : 0) : u.active;
  await db.prepare('UPDATE users SET name=?, role=?, active=? WHERE id=?').bind(body.name != null ? str(body.name, 80) : u.name, role, active, u.id).run();
  if (body.password) {
    if (String(body.password).length < 8) fail('Password minimal 8 karakter');
    const h = await hashPw(String(body.password));
    await db.prepare('UPDATE users SET pass_hash=?, salt=? WHERE id=?').bind(h.hash, h.salt, u.id).run();
  }
  if (!active) await db.prepare('DELETE FROM sessions WHERE user_id=?').bind(u.id).run();
  await audit(db, user, 'user_update', 'user', u.username, { role, active, resetPassword: !!body.password });
  return json({ ok: true });
});
route('GET', '/admin/settings', async ({ db, user }) => {
  need(user, 'superadmin');
  const { results: tables } = await db.prepare('SELECT * FROM tables_ ORDER BY sort, id').all();
  return json({ settings: await getSettings(db), tables });
});
const EDITABLE = ['business_name', 'tagline', 'address', 'maps_url', 'whatsapp', 'instagram', 'price_per_hour', 'package_hours',
  'package_price', 'grace_minutes', 'hold_minutes', 'max_booking_hours', 'max_days_ahead', 'payment_info', 'receipt_footer'];
route('PUT', '/admin/settings', async ({ db, user, body }) => {
  need(user, 'superadmin');
  const before = await getSettings(db);
  const changed = {};
  for (const k of EDITABLE) if (body[k] != null && String(body[k]) !== before[k]) {
    await db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(k, str(body[k], 1000)).run();
    changed[k] = { from: before[k], to: String(body[k]) };
  }
  if (Object.keys(changed).length) await audit(db, user, 'settings_update', 'settings', null, changed);
  return json({ ok: true });
});
route('POST', '/admin/tables', async ({ db, user, body }) => {
  need(user, 'superadmin');
  const name = str(body.name, 40); if (!name) fail('Nama meja wajib diisi');
  await db.prepare('INSERT INTO tables_(name, sort) VALUES (?, (SELECT COALESCE(MAX(sort),0)+1 FROM tables_))').bind(name).run();
  await audit(db, user, 'table_create', 'table', name);
  return json({ ok: true });
});
route('PATCH', '/admin/tables/:id', async ({ db, user, params, body }) => {
  need(user, 'superadmin');
  const t = await db.prepare('SELECT * FROM tables_ WHERE id=?').bind(int(params.id)).first();
  if (!t) fail('Meja tidak ditemukan', 404);
  await db.prepare('UPDATE tables_ SET name=?, active=? WHERE id=?')
    .bind(body.name != null ? str(body.name, 40) : t.name, body.active != null ? (body.active ? 1 : 0) : t.active, t.id).run();
  await audit(db, user, 'table_update', 'table', t.id, body);
  return json({ ok: true });
});
route('GET', '/admin/audit', async ({ db, user, q }) => {
  need(user, 'superadmin');
  const { results } = await db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ? OFFSET ?')
    .bind(Math.min(200, int(q.get('limit'), 100)), int(q.get('offset'), 0)).all();
  return json({ log: results });
});

// ===== Penghitung poin mahjong (publik, pakai kode room) =====
const DEFAULT_CFG = { base: 1, per_tai: 1, zimo_mult: 1, tembak_mult: 1, start: 0 };
function cleanCfg(c = {}) {
  const n = (v, d) => { const x = Number(v); return Number.isFinite(x) && x >= 0 && x <= 100000 ? x : d; };
  return { base: n(c.base, 1), per_tai: n(c.per_tai, 1), zimo_mult: n(c.zimo_mult, 1), tembak_mult: n(c.tembak_mult, 1),
    start: Number.isFinite(Number(c.start)) ? Number(c.start) : 0 };
}
function calcDeltas(cfg, r) {
  const d = [0, 0, 0, 0];
  if (r.type === 'draw') return d;
  if (r.type === 'adjust') {
    if (!Array.isArray(r.deltas) || r.deltas.length !== 4) fail('Isi 4 angka penyesuaian');
    return r.deltas.map((x) => Math.round(Number(x) || 0));
  }
  const w = int(r.winner, -1); if (w < 0 || w > 3) fail('Pilih pemenang');
  const tai = Math.max(0, Math.min(999, int(r.tai)));
  const A = cfg.base + tai * cfg.per_tai;
  if (r.type === 'zimo') {
    for (let i = 0; i < 4; i++) if (i !== w) { d[i] -= A * cfg.zimo_mult; d[w] += A * cfg.zimo_mult; }
  } else if (r.type === 'tembak') {
    const f = int(r.from, -1); if (f < 0 || f > 3 || f === w) fail('Pilih pemain yang membuang (tembak)');
    d[f] -= A * cfg.tembak_mult; d[w] += A * cfg.tembak_mult;
  } else fail('Tipe ronde tidak valid');
  return d.map((x) => Math.round(x * 100) / 100);
}
async function roomState(db, code) {
  const room = await db.prepare('SELECT * FROM rooms WHERE code=?').bind(str(code, 10).toUpperCase()).first();
  if (!room) fail('Room tidak ditemukan', 404);
  const { results } = await db.prepare('SELECT * FROM rounds WHERE room_code=? ORDER BY id').bind(room.code).all();
  const cfg = JSON.parse(room.config);
  const totals = [0, 1, 2, 3].map(() => cfg.start || 0);
  const rounds = results.map((r, i) => {
    const d = JSON.parse(r.deltas);
    d.forEach((x, k) => (totals[k] += x));
    return { ...r, n: i + 1, deltas: d };
  });
  return { code: room.code, name: room.name, status: room.status, players: JSON.parse(room.players), config: cfg,
    rounds, totals: totals.map((x) => Math.round(x * 100) / 100), updated_at: room.updated_at };
}
route('POST', '/rooms', async ({ db, body }) => {
  const players = (Array.isArray(body.players) ? body.players : []).slice(0, 4).map((p, i) => str(p, 24) || ['Timur', 'Selatan', 'Barat', 'Utara'][i]);
  while (players.length < 4) players.push(['Timur', 'Selatan', 'Barat', 'Utara'][players.length]);
  const cfg = cleanCfg({ ...DEFAULT_CFG, ...(body.config || {}) });
  let code;
  for (let i = 0; i < 5; i++) {
    code = randCode(5);
    if (!(await db.prepare('SELECT code FROM rooms WHERE code=?').bind(code).first())) break;
  }
  const now = nowWib();
  await db.prepare('INSERT INTO rooms(code,name,players,config,created_at,updated_at) VALUES (?,?,?,?,?,?)')
    .bind(code, str(body.name, 40) || 'Meja', JSON.stringify(players), JSON.stringify(cfg), now, now).run();
  return json({ code });
});
route('GET', '/rooms/:code', async ({ db, params }) => json(await roomState(db, params.code)));
route('PATCH', '/rooms/:code', async ({ db, params, body }) => {
  const st = await roomState(db, params.code);
  const players = Array.isArray(body.players) ? body.players.slice(0, 4).map((p, i) => str(p, 24) || st.players[i]) : st.players;
  const cfg = body.config ? cleanCfg({ ...st.config, ...body.config }) : st.config;
  const status = body.status === 'finished' ? 'finished' : body.status === 'active' ? 'active' : st.status;
  await db.prepare('UPDATE rooms SET players=?, config=?, name=?, status=?, updated_at=? WHERE code=?')
    .bind(JSON.stringify(players), JSON.stringify(cfg), body.name != null ? str(body.name, 40) : st.name, status, nowWib(), st.code).run();
  return json(await roomState(db, st.code));
});
route('POST', '/rooms/:code/rounds', async ({ db, params, body }) => {
  const st = await roomState(db, params.code);
  if (st.status !== 'active') fail('Permainan sudah selesai');
  if (st.rounds.length >= 500) fail('Batas ronde tercapai');
  const deltas = calcDeltas(st.config, body);
  await db.prepare('INSERT INTO rounds(room_code,type,winner,from_player,tai,deltas,note,created_at) VALUES (?,?,?,?,?,?,?,?)')
    .bind(st.code, body.type, body.winner ?? null, body.from ?? null, int(body.tai), JSON.stringify(deltas), str(body.note, 100), nowWib()).run();
  await db.prepare('UPDATE rooms SET updated_at=? WHERE code=?').bind(nowWib(), st.code).run();
  return json(await roomState(db, st.code));
});
route('POST', '/rooms/:code/undo', async ({ db, params }) => {
  const st = await roomState(db, params.code);
  const last = st.rounds[st.rounds.length - 1];
  if (!last) fail('Belum ada ronde');
  await db.prepare('DELETE FROM rounds WHERE id=?').bind(last.id).run();
  await db.prepare('UPDATE rooms SET updated_at=? WHERE code=?').bind(nowWib(), st.code).run();
  return json(await roomState(db, st.code));
});
