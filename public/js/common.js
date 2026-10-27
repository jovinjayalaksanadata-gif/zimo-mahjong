// Utilitas bersama
export async function api(path, opts = {}) {
  const r = await fetch('/api' + path, {
    method: opts.method || (opts.body ? 'POST' : 'GET'),
    headers: opts.body ? { 'content-type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  let data = null;
  try { data = await r.json(); } catch { data = {}; }
  if (!r.ok) { const e = new Error(data.error || 'Gagal (' + r.status + ')'); e.status = r.status; throw e; }
  return data;
}
export const rp = (n) => 'Rp' + Math.round(Number(n) || 0).toLocaleString('id-ID');
export const pad = (n) => String(n).padStart(2, '0');
// Waktu dari server = "detik WIB" (jam dinding WIB dibaca sebagai UTC)
const D = (ts) => new Date(ts * 1000);
const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
export const fmtTime = (ts) => pad(D(ts).getUTCHours()) + '.' + pad(D(ts).getUTCMinutes());
export const fmtDate = (ts) => { const d = D(ts); return `${HARI[d.getUTCDay()]}, ${d.getUTCDate()} ${BULAN[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
export const fmtShort = (ts) => { const d = D(ts); return `${d.getUTCDate()} ${BULAN[d.getUTCMonth()]}`; };
export const fmtDT = (ts) => `${fmtShort(ts)} ${fmtTime(ts)}`;
export const isoDate = (ts) => D(ts).toISOString().slice(0, 10);
export const wibNow = () => Math.floor(Date.now() / 1000) + 7 * 3600;
export const todayIso = () => isoDate(wibNow());
export const addDays = (iso, n) => isoDate(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 1000 + n * 86400);
export const dayLabel = (iso) => { const d = new Date(iso + 'T00:00:00Z'); return { dow: HARI[d.getUTCDay()].slice(0, 3), d: d.getUTCDate(), m: BULAN[d.getUTCMonth()] }; };
export function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
let tt;
export function toast(msg, err = false) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.append(el); }
  el.textContent = msg; el.classList.toggle('err', err); el.classList.add('show');
  clearTimeout(tt); tt = setTimeout(() => el.classList.remove('show'), 3200);
}
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const waLink = (num, text) => `https://wa.me/${String(num).replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
export const STATUS = { pending: 'Menunggu bayar', confirmed: 'Terkonfirmasi', cancelled: 'Dibatalkan', expired: 'Kedaluwarsa', completed: 'Sudah main', no_show: 'Tidak datang', paid: 'Lunas', void: 'Void', nocharge: 'Tanpa biaya' };
export const METHOD = { cash: 'Tunai', qris: 'QRIS', transfer: 'Transfer', debit: 'Debit' };
