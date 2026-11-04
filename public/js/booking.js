import { api, rp, pad, toast, $, todayIso, addDays, dayLabel, fmtDate, fmtTime, fmtDT, waLink, esc, wibNow } from './common.js';

// Semua waktu dalam "detik WIB". Jam main bebas sampai ke menit.
const st = { info: null, date: todayIso(), table: null, startMin: null, durMin: 120, avail: {} };
const S = () => st.info.settings;
const dayTs = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 1000;
const hm = (min) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;
const parseHm = (v) => { const m = /^(\d{1,2}):(\d{2})/.exec(v || ''); return m ? +m[1] * 60 + +m[2] : null; };
function durLabel(mins) {
  const h = Math.floor(mins / 60), m = mins % 60;
  return [h ? `${h} jam` : '', m ? `${m} menit` : ''].filter(Boolean).join(' ') || '0 menit';
}

// ---- harga: sama persis dengan server (per menit, tarif mengikuti jam dinding, dibulatkan ke Rp500) ----
function rateAt(ts) {
  const s = S(), h = Math.floor((ts % 86400) / 3600);
  const hp = +s.happy_price || 0, hs = s.happy_start === '' || s.happy_start == null ? -1 : +s.happy_start, he = +s.happy_end;
  return hp > 0 && hs >= 0 && he > hs && h >= hs && h < he ? hp : +s.price_per_hour;
}
function minutePrice(start, mins) { let sum = 0; for (let i = 0; i < mins; i++) sum += rateAt(start + i * 60) / 60; return sum; }
function price(start, mins) {
  const s = S(), pm = +s.package_hours * 60, pp = +s.package_price;
  let sum = minutePrice(start, mins);
  if (pp > 0 && pm > 0 && mins >= pm) { const k = Math.floor(mins / pm); sum = Math.min(sum, k * pp + minutePrice(start + k * pm * 60, mins - k * pm)); }
  return Math.round(sum / 500) * 500;
}
// rincian per tarif, untuk ditampilkan
function breakdown(start, mins) {
  const out = [];
  for (let i = 0; i < mins; i++) {
    const r = rateAt(start + i * 60), last = out[out.length - 1];
    if (last && last.rate === r) last.mins++; else out.push({ rate: r, from: start + i * 60, mins: 1 });
  }
  return out;
}

const startTs = () => dayTs(st.date) + st.startMin * 60;
const endTs = () => startTs() + st.durMin * 60;
const minDur = () => +S().min_booking_minutes || 60;
const maxDur = () => (+S().max_booking_hours || 8) * 60;

async function loadAvail(date) {
  if (!st.avail[date]) st.avail[date] = await api('/availability?date=' + date);
  return st.avail[date];
}
function busyOf(tableId) {
  const a = st.avail[st.date];
  return a?.tables.find((t) => t.id === tableId)?.busy || [];
}
const clashes = (tableId) => st.startMin != null && busyOf(tableId).some(([s, e]) => s < endTs() && e > startTs());

function problem() {
  if (st.startMin == null) return 'Isi jam mulai.';
  if (st.durMin < minDur()) return `Minimal main ${durLabel(minDur())}.`;
  if (st.durMin > maxDur()) return `Maksimal ${durLabel(maxDur())} per booking.`;
  if (startTs() <= wibNow()) return 'Jam mulai sudah lewat, pilih jam lain.';
  return '';
}

// ---------- render ----------
function renderDays() {
  const n = Math.min(+S().max_days_ahead || 30, 30);
  $('#days').innerHTML = Array.from({ length: n }, (_, i) => {
    const iso = addDays(todayIso(), i), l = dayLabel(iso);
    return `<button type="button" class="tile" data-d="${iso}" aria-pressed="${iso === st.date}">
      <small>${i === 0 ? 'Hari ini' : l.dow}</small><b>${l.d}</b><small>${l.m}</small></button>`;
  }).join('');
}
function renderTimes() {
  $('#t-start').value = st.startMin == null ? '' : hm(st.startMin);
  $('#t-end').value = st.startMin == null ? '' : hm(st.startMin + st.durMin);
  $('#nextday').classList.toggle('hide', !(st.startMin != null && st.startMin + st.durMin > 1440));
  const opts = [60, 90, 120, 180, 240, 300].filter((m) => m >= minDur() && m <= maxDur());
  $('#quick').innerHTML = opts.map((m) => `<button type="button" data-m="${m}" aria-pressed="${m === st.durMin}">${(m / 60).toLocaleString('id-ID')} jam</button>`).join('');
  const p = problem();
  const note = $('#dur-note');
  note.classList.toggle('err', !!p);
  note.textContent = p || `Durasi ${durLabel(st.durMin)}.`;
}
const pct = (ts, d0) => Math.max(0, Math.min(100, ((ts - d0) / 86400) * 100));
function renderBoard() {
  const a = st.avail[st.date], d0 = dayTs(st.date), now = wibNow();
  const ticks = [0, 6, 12, 18, 24].map((h) => `<span style="left:${(h / 24) * 100}%">${pad(h)}</span>`).join('');
  let hhBar = '';
  const s = S();
  if (+s.happy_price > 0) hhBar = `<i class="hh" style="left:${(+s.happy_start / 24) * 100}%;width:${((+s.happy_end - +s.happy_start) / 24) * 100}%"></i>`;
  const past = now > d0 ? `<i class="past" style="left:0;width:${pct(now, d0)}%"></i>` : '';
  const rows = st.info.tables.map((t) => {
    const busy = (a ? busyOf(t.id) : []).map(([b0, b1]) => b1 > d0 && b0 < d0 + 86400
      ? `<i class="busy" style="left:${pct(b0, d0)}%;width:${pct(b1, d0) - pct(b0, d0)}%"></i>` : '').join('');
    const sel = t.id === st.table, c = clashes(t.id);
    const pick = sel && st.startMin != null
      ? `<i class="pick ${c ? 'clash' : ''}" style="left:${pct(startTs(), d0)}%;width:${Math.max(.6, pct(endTs(), d0) - pct(startTs(), d0))}%"></i>` : '';
    const state = !a ? '' : st.startMin == null ? '' : c ? '<span class="lane-state no">terisi</span>' : '<span class="lane-state ok">kosong</span>';
    return `<button type="button" class="lane" data-t="${t.id}" aria-pressed="${sel}">
      <span class="lane-name">${esc(t.name)}</span><span class="track">${past}${busy}${pick}</span>${state || '<span class="lane-state"></span>'}</button>`;
  }).join('');
  $('#board').innerHTML = `<div class="scale"><span></span><span class="ticks">${ticks}${hhBar}</span><span></span></div>${rows}`;
}
function renderSummary() {
  const t = st.info.tables.find((x) => x.id === st.table);
  $('#s-table').textContent = t ? t.name : '–';
  const ok = !problem();
  if (st.startMin != null) {
    const s0 = startTs(), s1 = endTs();
    $('#s-time').textContent = `${fmtDate(s0)}, ${fmtTime(s0)}–${fmtTime(s1)}${s1 - dayTs(st.date) > 86400 ? ' (+1)' : ''} · ${durLabel(st.durMin)}`;
  } else $('#s-time').textContent = '–';
  if (ok) {
    const parts = breakdown(startTs(), st.durMin);
    $('#s-total').textContent = rp(price(startTs(), st.durMin));
    $('#s-break').innerHTML = parts.length > 1 || parts[0]?.rate !== +S().price_per_hour
      ? parts.map((p) => `<li><span>${fmtTime(p.from)}–${fmtTime(p.from + p.mins * 60)}</span><span>${p.rate < +S().price_per_hour ? 'happy hour ' : ''}${Math.round(p.rate / 1000)}K/jam</span></li>`).join('') : '';
  } else { $('#s-total').textContent = 'Rp0'; $('#s-break').innerHTML = ''; }
  $('#submit').disabled = !(ok && st.table && !clashes(st.table));
}
function render() { renderTimes(); renderBoard(); renderSummary(); }

async function refresh() {
  render();
  try { await loadAvail(st.date); } catch (e) { toast(e.message, true); }
  // pilih otomatis meja pertama yang kosong bila meja sekarang bentrok
  if (st.table == null || clashes(st.table)) st.table = st.info.tables.find((t) => !clashes(t.id))?.id ?? st.table;
  render();
}
function defaultStart() {
  if (st.date !== todayIso()) return 19 * 60;
  const n = wibNow() % 86400 / 60 + 15;
  const m = Math.ceil(n / 30) * 30; // 30 menit berikutnya
  return m >= 1440 ? null : m;
}

// ---------- event ----------
$('#days').addEventListener('click', (e) => {
  const b = e.target.closest('[data-d]'); if (!b) return;
  st.date = b.dataset.d;
  if (st.startMin == null || (st.date === todayIso() && startTs() <= wibNow())) st.startMin = defaultStart();
  renderDays(); refresh();
});
$('#t-start').addEventListener('change', (e) => {
  const v = parseHm(e.target.value); if (v == null) return;
  st.startMin = v; render();
});
$('#t-end').addEventListener('change', (e) => {
  const v = parseHm(e.target.value); if (v == null || st.startMin == null) return;
  let d = v - st.startMin; if (d <= 0) d += 1440; // lewat tengah malam
  st.durMin = d; render();
});
$('#quick').addEventListener('click', (e) => {
  const b = e.target.closest('[data-m]'); if (!b) return;
  st.durMin = +b.dataset.m; if (st.startMin == null) st.startMin = defaultStart(); render();
});
$('#board').addEventListener('click', (e) => {
  const lane = e.target.closest('[data-t]'); if (!lane) return;
  st.table = +lane.dataset.t;
  const tr = e.target.closest('.track');
  if (tr) {
    const r = tr.getBoundingClientRect();
    const m = Math.round((((e.clientX - r.left) / r.width) * 1440) / 15) * 15;
    st.startMin = Math.max(0, Math.min(1425, m));
  }
  render();
});
$('#f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  if (!fd.get('name').trim()) return toast('Isi nama dulu', true);
  if (fd.get('phone').replace(/\D/g, '').length < 9) return toast('Isi nomor WhatsApp yang aktif', true);
  $('#submit').disabled = true;
  try {
    const r = await api('/bookings', { body: { name: fd.get('name'), phone: fd.get('phone'), note: fd.get('note'), table_id: st.table, date: st.date, time: hm(st.startMin), minutes: st.durMin } });
    const t = st.info.tables.find((x) => x.id === st.table);
    $('#d-code').textContent = r.code;
    $('#d-detail').innerHTML = `<b>${esc(t.name)}</b> · ${fmtDate(r.start_ts)}, ${fmtTime(r.start_ts)}–${fmtTime(r.end_ts)} · <b class="num">${rp(r.total)}</b>`;
    $('#d-qamt').textContent = rp(r.total);
    $('#d-pay').textContent = r.payment_info;
    $('#d-exp').textContent = fmtDT(r.expires_at);
    $('#d-wa').href = waLink(r.whatsapp, `Halo Zi Mo, saya mau konfirmasi pembayaran booking ${r.code} a.n. ${fd.get('name')} (${t.name}, ${fmtDate(r.start_ts)} ${fmtTime(r.start_ts)}–${fmtTime(r.end_ts)}, ${rp(r.total)}). Bukti transfer terlampir.`);
    $('#d-cek').href = `/cek.html?code=${encodeURIComponent(r.code)}&phone=${encodeURIComponent(fd.get('phone'))}`;
    $('#form-view').classList.add('hide'); $('#done-view').classList.remove('hide');
    window.scrollTo({ top: 0 });
  } catch (err) {
    toast(err.message, true);
    st.avail = {}; refresh();
  } finally { renderSummary(); }
});

(async () => {
  try {
    st.info = await api('/public/info');
    const s = S();
    $('#rate').textContent = rp(s.price_per_hour);
    if (+s.happy_price > 0) {
      $('#hh-note').innerHTML = `Happy hour <b>${rp(s.happy_price)}</b>/jam · ${pad(s.happy_start)}.00–${pad(s.happy_end)}.00`;
      $('#hh-note').classList.remove('hide'); $('#lg-hh').classList.remove('hide');
    }
    $('#hold').textContent = s.hold_minutes;
    st.startMin = defaultStart();
    if (st.startMin == null) { st.date = addDays(todayIso(), 1); st.startMin = 19 * 60; }
    st.durMin = Math.max(minDur(), Math.min(120, maxDur()));
    renderDays(); refresh();
  } catch (e) { toast('Gagal memuat jadwal: ' + e.message, true); }
})();
