import { api, rp, pad, toast, $, todayIso, addDays, dayLabel, fmtDate, fmtTime, fmtDT, waLink, esc } from './common.js';

const st = { info: null, date: todayIso(), table: null, hour: null, hours: null, avail: {}, };

async function loadAvail(date) {
  if (!st.avail[date]) st.avail[date] = await api('/availability?date=' + date);
  return st.avail[date];
}
function slotStatus(date, tableId, h) {
  // h bisa >= 24 (lewat tengah malam)
  const d = h >= 24 ? addDays(date, 1) : date;
  const a = st.avail[d];
  if (!a) return 'unknown';
  const t = a.tables.find((x) => x.id === tableId);
  return t ? t.hours[h % 24] : 'booked';
}
// Sama dengan perhitungan server: tarif tiap jam ditentukan jam mulainya (happy hour lebih murah).
function rateAt(ts) {
  const s = st.info.settings, h = Math.floor((ts % 86400) / 3600);
  const hp = +s.happy_price || 0, hs = s.happy_start === '' ? -1 : +s.happy_start, he = +s.happy_end;
  return hp > 0 && hs >= 0 && he > hs && h >= hs && h < he ? hp : +s.price_per_hour;
}
function price(start, hours) {
  const s = st.info.settings, ph = +s.package_hours, pp = +s.package_price;
  let sum = 0; for (let i = 0; i < hours; i++) sum += rateAt(start + i * 3600);
  if (pp > 0 && ph > 0 && hours >= ph) {
    const k = Math.floor(hours / ph); let alt = k * pp;
    for (let i = k * ph; i < hours; i++) alt += rateAt(start + i * 3600);
    sum = Math.min(sum, alt);
  }
  return sum;
}
const dayTs = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 1000;
const kLabel = (n) => (n % 1000 ? (n / 1000).toFixed(1) : n / 1000) + 'K';

function renderDays() {
  const n = Math.min(+st.info.settings.max_days_ahead || 30, 30);
  $('#days').innerHTML = Array.from({ length: n }, (_, i) => {
    const iso = addDays(todayIso(), i), l = dayLabel(iso);
    return `<button type="button" class="tile" data-d="${iso}" aria-pressed="${iso === st.date}">
      <small>${i === 0 ? 'Hari ini' : l.dow}</small><b>${l.d}</b><small>${l.m}</small></button>`;
  }).join('');
}
function renderTables() {
  $('#tables').innerHTML = st.info.tables.map((t) =>
    `<button type="button" class="tile" data-t="${t.id}" aria-pressed="${t.id === st.table}">${esc(t.name)}</button>`).join('');
}
function renderHours() {
  const a = st.avail[st.date];
  if (!a) { $('#hours').innerHTML = '<p class="muted">Memuat…</p>'; return; }
  $('#hours').innerHTML = Array.from({ length: 24 }, (_, h) => {
    const s = slotStatus(st.date, st.table, h);
    const cls = s === 'booked' ? 'back' : s === 'past' ? 'past' : '';
    const dis = s !== 'free' ? 'disabled' : '';
    const label = s === 'booked' ? 'terisi' : s === 'past' ? 'lewat' : 'kosong';
    const r = rateAt(dayTs(st.date) + h * 3600), hh = r < +st.info.settings.price_per_hour;
    return `<button type="button" class="tile ${cls} ${hh ? 'hh' : ''}" data-h="${h}" ${dis} aria-pressed="${h === st.hour}"
      aria-label="Jam ${pad(h)}.00, ${label}, ${rp(r)} per jam">${pad(h)}<small>${kLabel(r)}</small></button>`;
  }).join('');
}
async function renderDurs() {
  if (st.hour == null) { $('#durs').innerHTML = ''; $('#dur-hint').classList.remove('hide'); return; }
  $('#dur-hint').classList.add('hide');
  const max = +st.info.settings.max_booking_hours || 8;
  if (st.hour + max > 24) await loadAvail(addDays(st.date, 1)).catch(() => {});
  let ok = true;
  const html = [];
  for (let n = 1; n <= max; n++) {
    if (ok && n > 1 && slotStatus(st.date, st.table, st.hour + n - 1) !== 'free') ok = false;
    html.push(`<button type="button" class="tile" data-n="${n}" ${ok ? '' : 'disabled'} aria-pressed="${n === st.hours}">${n}<small>jam</small></button>`);
  }
  $('#durs').innerHTML = html.join('');
  if (st.hours && $(`#durs [data-n="${st.hours}"]`)?.disabled) { st.hours = null; renderDurs(); }
}
function renderSummary() {
  const t = st.info.tables.find((x) => x.id === st.table);
  $('#s-table').textContent = t ? t.name : '–';
  if (st.hour != null) {
    const start = Date.UTC(+st.date.slice(0, 4), +st.date.slice(5, 7) - 1, +st.date.slice(8, 10)) / 1000 + st.hour * 3600;
    $('#s-time').textContent = st.hours ? `${fmtDate(start)}, ${fmtTime(start)}–${fmtTime(start + st.hours * 3600)}` : `${fmtDate(start)}, mulai ${fmtTime(start)}`;
  } else $('#s-time').textContent = '–';
  $('#s-total').textContent = rp(st.hours && st.hour != null ? price(dayTs(st.date) + st.hour * 3600, st.hours) : 0);
  $('#submit').disabled = !(st.table && st.hour != null && st.hours);
}
async function refresh() {
  renderHours(); renderSummary();
  try { await loadAvail(st.date); } catch (e) { toast(e.message, true); }
  renderHours(); await renderDurs(); renderSummary();
}

$('#days').addEventListener('click', (e) => {
  const b = e.target.closest('[data-d]'); if (!b) return;
  st.date = b.dataset.d; st.hour = null; st.hours = null; renderDays(); refresh();
});
$('#tables').addEventListener('click', (e) => {
  const b = e.target.closest('[data-t]'); if (!b) return;
  st.table = +b.dataset.t; st.hour = null; st.hours = null; renderTables(); refresh();
});
$('#hours').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-h]'); if (!b || b.disabled) return;
  st.hour = +b.dataset.h; st.hours = st.hours || 1; renderHours(); await renderDurs(); renderSummary();
});
$('#durs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-n]'); if (!b || b.disabled) return;
  st.hours = +b.dataset.n; renderDurs(); renderSummary();
});
$('#f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  if (!fd.get('name').trim()) return toast('Isi nama dulu', true);
  if (fd.get('phone').replace(/\D/g, '').length < 9) return toast('Isi nomor WhatsApp yang aktif', true);
  $('#submit').disabled = true;
  try {
    const r = await api('/bookings', { body: { name: fd.get('name'), phone: fd.get('phone'), note: fd.get('note'), table_id: st.table, date: st.date, hour: st.hour, hours: st.hours } });
    const t = st.info.tables.find((x) => x.id === st.table);
    $('#d-code').textContent = r.code;
    $('#d-detail').innerHTML = `<b>${esc(t.name)}</b> · ${fmtDate(r.start_ts)}, ${fmtTime(r.start_ts)}–${fmtTime(r.end_ts)} · <b class="num">${rp(r.total)}</b>`;
    $('#d-pay').textContent = r.payment_info;
    $('#d-exp').textContent = fmtDT(r.expires_at);
    $('#d-wa').href = waLink(r.whatsapp, `Halo Zi Mo, saya mau konfirmasi pembayaran booking ${r.code} a.n. ${fd.get('name')} (${t.name}, ${fmtDate(r.start_ts)} ${fmtTime(r.start_ts)}, ${rp(r.total)}). Bukti transfer terlampir.`);
    $('#d-cek').href = `/cek.html?code=${encodeURIComponent(r.code)}&phone=${encodeURIComponent(fd.get('phone'))}`;
    $('#form-view').classList.add('hide'); $('#done-view').classList.remove('hide');
    window.scrollTo({ top: 0 });
  } catch (err) {
    toast(err.message, true);
    st.avail = {}; st.hour = null; st.hours = null; refresh();
  } finally { $('#submit').disabled = false; renderSummary(); }
});

(async () => {
  try {
    st.info = await api('/public/info');
    st.table = st.info.tables[0]?.id ?? null;
    const S = st.info.settings;
    $('#rate').textContent = (+S.price_per_hour).toLocaleString('id-ID');
    if (+S.happy_price > 0) { $('#hh-note').innerHTML = `Happy hour <b class="num">${rp(S.happy_price)}</b>/jam setiap hari pukul ${pad(S.happy_start)}.00–${pad(S.happy_end)}.00.`; $('#hh-note').classList.remove('hide'); $('#lg-hh').classList.remove('hide'); }
    $('#hold').textContent = st.info.settings.hold_minutes;
    renderDays(); renderTables(); refresh();
  } catch (e) { toast('Gagal memuat jadwal: ' + e.message, true); }
})();
