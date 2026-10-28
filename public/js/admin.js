import { api, rp, pad, toast, $, $$, esc, fmtDate, fmtTime, fmtDT, fmtShort, todayIso, addDays, wibNow, STATUS, METHOD, waLink } from './common.js';

let me = null, timer = null;
const ROLE = { superadmin: 'Superadmin', admin: 'Admin', kasir: 'Kasir' };
const isAdmin = () => me && (me.role === 'admin' || me.role === 'superadmin');
const isSuper = () => me && me.role === 'superadmin';
const main = () => $('#main');
const dur = (sec) => { sec = Math.max(0, Math.floor(sec)); return `${Math.floor(sec / 3600)}:${pad(Math.floor(sec / 60) % 60)}:${pad(sec % 60)}`; };

const VIEWS = [
  { id: 'pos', label: 'Kasir & meja', show: () => true, render: viewPos },
  { id: 'booking', label: 'Booking', show: () => true, render: viewBooking },
  { id: 'transaksi', label: 'Transaksi', show: () => true, render: viewOrders },
  { id: 'laporan', label: 'Laporan', show: () => true, render: viewReport },
  { id: 'menu', label: 'Menu F&B', show: isAdmin, render: viewMenu },
  { id: 'pengguna', label: 'Pengguna', show: isSuper, render: viewUsers },
  { id: 'pengaturan', label: 'Pengaturan', show: isSuper, render: viewSettings },
  { id: 'log', label: 'Log aktivitas', show: isSuper, render: viewAudit },
];

// ---------- dialog ----------
function openDlg(html) { $('#dlg-body').innerHTML = html; const d = $('#dlg'); if (!d.open) d.showModal(); return $('#dlg-body'); }
function closeDlg() { $('#dlg').close(); }
$('#dlg').addEventListener('close', () => { const v = (location.hash.slice(1) || 'pos').split('?')[0]; if (v === 'pos') route(); });

// ---------- auth ----------
async function boot() {
  try { me = (await api('/auth/me')).user; } catch { me = null; }
  if (me) return startApp();
  const s = await api('/setup').catch(() => ({ needsSetup: false }));
  showAuth(s);
}
function showAuth(s) {
  $('#app').classList.add('hide'); $('#auth').classList.remove('hide');
  const f = $('#f-login');
  f.dataset.setup = s.needsSetup ? '1' : '';
  $('#auth-title').textContent = s.needsSetup ? 'Setup pertama' : 'Masuk staf';
  $('#setup-note').classList.toggle('hide', !s.needsSetup);
  $('#l-name').classList.toggle('hide', !s.needsSetup);
  $('#l-key').classList.toggle('hide', !(s.needsSetup && s.needsKey));
  $('#b-login').textContent = s.needsSetup ? 'Buat akun Superadmin' : 'Masuk';
  f.password.autocomplete = s.needsSetup ? 'new-password' : 'current-password';
}
$('#f-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    if (f.dataset.setup) {
      await api('/setup', { body: { name: f.name.value, username: f.username.value, password: f.password.value, key: f.key.value } });
      toast('Akun Superadmin dibuat');
    }
    me = (await api('/auth/login', { body: { username: f.username.value, password: f.password.value } })).user;
    f.reset(); startApp();
  } catch (err) { toast(err.message, true); }
});
$('#b-logout').addEventListener('click', async () => { await api('/auth/logout', { method: 'POST' }).catch(() => {}); me = null; location.hash = ''; boot(); });
$('#b-pass').addEventListener('click', () => {
  $('#me').open = false;
  const b = openDlg(`<h2>Ganti password</h2><form id="fp">
    <label class="f"><span>Password lama</span><input name="old" type="password" required autocomplete="current-password"></label>
    <label class="f"><span>Password baru (min. 8 karakter)</span><input name="password" type="password" minlength="8" required autocomplete="new-password"></label>
    <button class="btn">Simpan password</button></form>`);
  $('#fp', b).addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/auth/password', { body: { old: e.target.old.value, password: e.target.password.value } }); toast('Password diganti'); closeDlg(); }
    catch (err) { toast(err.message, true); }
  });
});

function startApp() {
  $('#auth').classList.add('hide'); $('#app').classList.remove('hide');
  $('#me-name').textContent = me.name; $('#me-role').textContent = ROLE[me.role];
  $('#me-av').textContent = (me.name || '?').trim().charAt(0).toUpperCase();
  $('#nav').innerHTML = VIEWS.filter((v) => v.show()).map((v) => `<a href="#${v.id}" data-v="${v.id}">${v.label}</a>`).join('');
  route();
}
window.addEventListener('hashchange', route);
document.addEventListener('click', (e) => { if (!e.target.closest('#me')) $('#me').open = false; });
async function route() {
  if (!me) return;
  clearInterval(timer);
  const id = (location.hash.slice(1) || 'pos').split('?')[0];
  const v = VIEWS.find((x) => x.id === id && x.show()) || VIEWS[0];
  $$('#nav a').forEach((a) => a.toggleAttribute('aria-current', a.dataset.v === v.id));
  $('#me').open = false;
  try { await v.render(); stackTables(); $('#nav a[aria-current]')?.scrollIntoView({ block: 'nearest', inline: 'center' }); } catch (e) {
    if (e.status === 401) { me = null; return boot(); }
    main().innerHTML = `<div class="panel"><p>${esc(e.message)}</p></div>`;
  }
}

// Di layar kecil, tabel ditampilkan sebagai kartu: setiap sel diberi label dari judul kolomnya.
function stackTables(root = document) {
  $$('table.t', root).forEach((t) => {
    const heads = $$('thead th', t).map((th) => th.textContent.trim());
    if (!heads.length) return;
    t.classList.add('stack');
    $$('tbody tr', t).forEach((tr) => $$('td', tr).forEach((td, i) => {
      if (td.colSpan > 1) td.classList.add('full');
      else if (heads[i]) td.dataset.label = heads[i];
      else td.classList.add('act');
    }));
  });
}

// =====================================================================
// POS
// =====================================================================
let posData = null;
async function viewPos() {
  posData = await api('/admin/pos');
  const offset = wibNow() - posData.now; // selisih jam lokal vs server
  main().innerHTML = `
    <div class="row"><h1 class="grow">Kasir & meja</h1><button class="btn jade" id="b-fnb">Jual F&B tanpa meja</button></div>
    <p class="muted">Ketuk meja untuk mulai main, tambah pesanan, atau bayar.</p>
    <div class="tables" style="margin-top:18px">${posData.tables.map(tableCard).join('')}</div>
    <div class="panel" style="margin-top:24px" id="shift"></div>`;
  $$('.tcard').forEach((c) => c.addEventListener('click', () => tableDialog(+c.dataset.id)));
  $('#b-fnb').addEventListener('click', () => fnbDialog());
  const tick = () => $$('[data-start]').forEach((el) => (el.textContent = dur(wibNow() - offset - +el.dataset.start)));
  tick(); timer = setInterval(tick, 1000);
  shiftSummary();
}
function tableCard(t) {
  const s = t.session;
  const next = t.upcoming[0];
  const nextHtml = next ? `<div class="next">Berikutnya: <b>${fmtTime(next.start_ts)}</b> ${esc(next.customer_name)} (${next.hours} jam)${next.status === 'pending' ? ' · belum bayar' : ''}</div>` : '';
  if (s) return `<button class="tcard busy" data-id="${t.id}"><span class="tn">${esc(t.name)}</span>
    <span class="timer" data-start="${s.started_at}">0:00:00</span>
    <span class="sub">${esc(s.customer_name)} · mulai ${fmtTime(s.started_at)}</span>
    <span class="sub">Tagihan saat ini <b class="mono">${rp(s.bill.amount + (s.fnb_total || 0))}</b></span>${nextHtml}</button>`;
  return `<button class="tcard" data-id="${t.id}"><span class="tn">${esc(t.name)}</span><span class="sub" style="font-size:1rem">Kosong</span>${nextHtml}</button>`;
}
async function shiftSummary() {
  try {
    const r = await api('/admin/reports/shift');
    $('#shift').innerHTML = `<h2>${me.role === 'kasir' ? 'Penjualan saya hari ini' : 'Penjualan hari ini'}</h2>
      <div class="row" style="gap:28px"><div><div class="muted">Total</div><b class="mono" style="font-size:1.3rem">${rp(r.totals.total)}</b></div>
      <div><div class="muted">Transaksi</div><b class="mono">${r.totals.n}</b></div>
      ${r.byMethod.map((m) => `<div><div class="muted">${METHOD[m.method] || m.method}</div><b class="mono">${rp(m.total)}</b></div>`).join('')}</div>`;
  } catch { $('#shift').remove(); }
}
function tableDialog(id) {
  const t = posData.tables.find((x) => x.id === id);
  if (t.session) return sessionDialog(t);
  const ups = t.upcoming;
  const b = openDlg(`<h2>${esc(t.name)}: mulai main</h2>
    ${ups.length ? `<p class="muted" style="margin-bottom:6px">Booking hari ini di meja ini:</p>
      ${ups.map((u) => `<div class="row panel" style="margin-bottom:8px;padding:12px"><div class="grow"><b>${esc(u.customer_name)}</b> · ${fmtTime(u.start_ts)}–${fmtTime(u.end_ts)}
        <span class="pill ${u.paid ? 'paid' : 'pending'}">${u.paid ? 'Lunas' : 'Belum bayar'}</span><div class="muted mono" style="font-size:.8rem">${u.code}</div></div>
        <button class="btn small jade" data-b="${u.id}">Mulai booking ini</button></div>`).join('')}<hr style="border:0;border-top:1px dashed var(--line);margin:16px 0">` : ''}
    <form id="fw"><label class="f"><span>Walk-in, nama pelanggan</span><input name="name" placeholder="Walk-in" maxlength="80"></label>
    <label class="row" style="font-size:.9rem;margin-bottom:12px;gap:8px"><input type="checkbox" name="force" style="width:auto"> Tetap mulai walaupun ada booking sebentar lagi</label>
    <button class="btn block">Mulai main sekarang</button></form>`);
  $$('[data-b]', b).forEach((x) => x.addEventListener('click', async () => {
    try { await api('/admin/sessions', { body: { table_id: id, booking_id: +x.dataset.b } }); toast('Timer dimulai'); closeDlg(); } catch (e) { toast(e.message, true); }
  }));
  $('#fw', b).addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/admin/sessions', { body: { table_id: id, customer_name: e.target.name.value, force: e.target.force.checked } }); toast('Timer dimulai'); closeDlg(); }
    catch (err) { toast(err.message, true); }
  });
}
async function sessionDialog(t) {
  const s = t.session;
  const { bill, order } = await api(`/admin/sessions/${s.id}/bill`);
  const fnb = order.items.filter((i) => i.item_type === 'menu');
  const fnbTotal = fnb.reduce((a, i) => a + i.total, 0);
  let method = 'cash';
  const b = openDlg(`<h2>${esc(t.name)} · ${esc(s.customer_name)}</h2>
    <p class="muted">Mulai ${fmtTime(s.started_at)} · berjalan ${Math.floor(bill.minutes / 60)} jam ${bill.minutes % 60} menit · ditagih <b>${bill.hours} jam</b></p>
    <h3 style="margin-top:14px">Tambah pesanan</h3>
    <div class="menu-grid">${posData.menu.map((m) => `<button type="button" class="tile" data-m="${m.id}">${esc(m.name)}<b>${rp(m.price)}</b></button>`).join('')}</div>
    <table class="lines"><tbody>
      <tr><td>${esc(bill.label)}</td><td></td><td class="r">${rp(bill.amount)}</td></tr>
      ${fnb.map((i) => `<tr><td>${esc(i.name)}</td><td class="qty"><button type="button" data-rm="${i.id}" aria-label="Kurangi ${esc(i.name)}">−</button> ${i.qty}</td><td class="r">${rp(i.total)}</td></tr>`).join('')}
    </tbody></table>
    ${isAdmin() ? `<label class="f" style="max-width:220px"><span>Diskon (Rp)</span><input id="disc" type="number" min="0" step="1000" value="0"></label>` : ''}
    <div class="sumrow"><span>Total</span><span id="tot">${rp(bill.amount + fnbTotal)}</span></div>
    <div class="methods">${Object.entries(METHOD).map(([k, v]) => `<button type="button" class="tile" data-pm="${k}" aria-pressed="${k === method}">${v}</button>`).join('')}</div>
    <button class="btn block" id="b-pay">Selesai main & bayar</button>
    ${isAdmin() ? `<p style="margin:14px 0 0"><button class="link" style="color:var(--red)" id="b-cxl">Batalkan sesi (salah mulai)</button></p>` : ''}`);
  $$('[data-m]', b).forEach((x) => x.addEventListener('click', async () => {
    try { await api(`/admin/sessions/${s.id}/items`, { body: { menu_id: +x.dataset.m, qty: 1 } }); await refreshSession(t.id); } catch (e) { toast(e.message, true); }
  }));
  $$('[data-rm]', b).forEach((x) => x.addEventListener('click', async () => {
    try { await api(`/admin/sessions/${s.id}/items/${x.dataset.rm}/remove`, { method: 'POST' }); await refreshSession(t.id); } catch (e) { toast(e.message, true); }
  }));
  $$('[data-pm]', b).forEach((x) => x.addEventListener('click', () => { method = x.dataset.pm; $$('[data-pm]', b).forEach((y) => y.setAttribute('aria-pressed', y === x)); }));
  $('#disc', b)?.addEventListener('input', (e) => { $('#tot', b).textContent = rp(Math.max(0, bill.amount + fnbTotal - (+e.target.value || 0))); });
  $('#b-pay', b).addEventListener('click', async () => {
    try {
      const r = await api(`/admin/sessions/${s.id}/checkout`, { body: { payment_method: method, discount: +($('#disc', b)?.value || 0) } });
      toast('Pembayaran tersimpan · ' + r.order.no); receiptDialog(r.order);
    } catch (e) { toast(e.message, true); }
  });
  $('#b-cxl', b)?.addEventListener('click', async () => {
    const reason = prompt('Alasan membatalkan sesi ini?'); if (!reason) return;
    try { await api(`/admin/sessions/${s.id}/cancel`, { body: { reason } }); toast('Sesi dibatalkan'); closeDlg(); } catch (e) { toast(e.message, true); }
  });
}
async function refreshSession(tableId) {
  posData = await api('/admin/pos');
  const t = posData.tables.find((x) => x.id === tableId);
  if (t?.session) sessionDialog(t); else closeDlg();
}
function fnbDialog() {
  const cart = new Map(); let method = 'cash';
  const b = openDlg(`<h2>Jual F&B tanpa meja</h2>
    <div class="menu-grid">${posData.menu.map((m) => `<button type="button" class="tile" data-m="${m.id}">${esc(m.name)}<b>${rp(m.price)}</b></button>`).join('')}</div>
    <table class="lines"><tbody id="cart"></tbody></table>
    <label class="f"><span>Nama pelanggan (opsional)</span><input id="cn" maxlength="80"></label>
    ${isAdmin() ? `<label class="f" style="max-width:220px"><span>Diskon (Rp)</span><input id="disc" type="number" min="0" step="1000" value="0"></label>` : ''}
    <div class="sumrow"><span>Total</span><span id="tot">Rp0</span></div>
    <div class="methods">${Object.entries(METHOD).map(([k, v]) => `<button type="button" class="tile" data-pm="${k}" aria-pressed="${k === method}">${v}</button>`).join('')}</div>
    <button class="btn block" id="b-pay">Bayar</button>`);
  const draw = () => {
    const rows = [...cart.entries()].map(([id, q]) => { const m = posData.menu.find((x) => x.id === id); return { m, q }; });
    $('#cart', b).innerHTML = rows.length ? rows.map(({ m, q }) => `<tr><td>${esc(m.name)}</td><td class="qty"><button type="button" data-rm="${m.id}">−</button> ${q}</td><td class="r">${rp(m.price * q)}</td></tr>`).join('')
      : '<tr><td class="muted">Ketuk menu di atas untuk menambah.</td></tr>';
    const tot = rows.reduce((a, r) => a + r.m.price * r.q, 0) - (+($('#disc', b)?.value || 0));
    $('#tot', b).textContent = rp(Math.max(0, tot));
    $$('[data-rm]', b).forEach((x) => x.addEventListener('click', () => { const id = +x.dataset.rm; const q = cart.get(id) - 1; q > 0 ? cart.set(id, q) : cart.delete(id); draw(); }));
  };
  $$('[data-m]', b).forEach((x) => x.addEventListener('click', () => { const id = +x.dataset.m; cart.set(id, (cart.get(id) || 0) + 1); draw(); }));
  $$('[data-pm]', b).forEach((x) => x.addEventListener('click', () => { method = x.dataset.pm; $$('[data-pm]', b).forEach((y) => y.setAttribute('aria-pressed', y === x)); }));
  $('#disc', b)?.addEventListener('input', draw);
  $('#b-pay', b).addEventListener('click', async () => {
    if (!cart.size) return toast('Keranjang masih kosong', true);
    try {
      const r = await api('/admin/orders', { body: { items: [...cart].map(([menu_id, qty]) => ({ menu_id, qty })), payment_method: method, customer_name: $('#cn', b).value, discount: +($('#disc', b)?.value || 0) } });
      toast('Pembayaran tersimpan · ' + r.order.no); receiptDialog(r.order);
    } catch (e) { toast(e.message, true); }
  });
  draw();
}

// ---------- struk ----------
function receiptHtml(o) {
  const s = posData?.settings || {};
  return `<div class="c"><b>${esc(s.business_name || 'Zi Mo Mahjong')}</b><br>${esc(s.address || '')}</div><hr>
    ${esc(o.no)}<br>${fmtDT(o.paid_at || o.created_at)} · ${esc(o.cashier_name || '')}<br>${esc(o.customer_name || '')}<hr>
    <table>${o.items.map((i) => `<tr><td>${i.qty > 1 ? i.qty + 'x ' : ''}${esc(i.name)}</td><td class="r">${rp(i.total)}</td></tr>`).join('')}</table><hr>
    <table>${o.discount ? `<tr><td>Subtotal</td><td class="r">${rp(o.subtotal)}</td></tr><tr><td>Diskon</td><td class="r">-${rp(o.discount)}</td></tr>` : ''}
    <tr><td><b>TOTAL</b></td><td class="r"><b>${rp(o.total)}</b></td></tr><tr><td>${METHOD[o.payment_method] || ''}</td><td></td></tr></table>
    ${o.status === 'void' ? '<hr><b>VOID</b> ' + esc(o.void_reason || '') : ''}<hr><div class="c">${esc(s.receipt_footer || '')}</div>`;
}
function receiptDialog(o) {
  const b = openDlg(`<h2>Struk ${esc(o.no || '')} <span class="pill ${o.status}">${STATUS[o.status] || o.status}</span></h2>
    <div class="panel mono" style="font-size:.85rem;max-width:340px">${receiptHtml(o).replace(/<hr>/g, '<hr style="border:0;border-top:1px dashed #999">')}</div>
    <div class="row" style="margin-top:14px"><button class="btn jade" id="b-print">Cetak struk</button>
    ${isSuper() && o.status === 'paid' ? '<button class="btn ghost" id="b-void">Void transaksi</button>' : ''}</div>
    ${o.status === 'void' ? `<p class="warn" style="margin-top:12px">Di-void oleh ${esc(o.voided_by_name || '-')} ${o.voided_at ? fmtDT(o.voided_at) : ''}: ${esc(o.void_reason || '')}</p>` : ''}`);
  $('#b-print', b).addEventListener('click', () => { $('#print').innerHTML = receiptHtml(o); window.print(); });
  $('#b-void', b)?.addEventListener('click', () => voidDialog(o));
}
function voidDialog(o) {
  const b = openDlg(`<h2>Void ${esc(o.no)}</h2>
    <p>Transaksi <b class="mono">${rp(o.total)}</b> akan dikeluarkan dari pendapatan. Datanya tetap tersimpan dan tercatat di log aktivitas beserta alasannya.</p>
    <form id="fv"><label class="f"><span>Alasan void</span><input name="reason" required minlength="3" maxlength="200" placeholder="contoh: salah input metode bayar"></label>
    <button class="btn">Void transaksi</button></form>`);
  $('#fv', b).addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api(`/admin/orders/${o.id}/void`, { body: { reason: e.target.reason.value } }); toast('Transaksi di-void'); closeDlg(); route(); }
    catch (err) { toast(err.message, true); }
  });
}

// =====================================================================
// Booking
// =====================================================================
async function viewBooking() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const date = q.get('d') || todayIso();
  const [{ bookings }, info] = await Promise.all([api('/admin/bookings?from=' + date), api('/public/info')]);
  main().innerHTML = `
    <div class="row"><h1 class="grow">Booking</h1><button class="btn" id="b-new">Tambah booking</button></div>
    <div class="bar">
      <button class="btn ghost small" data-nav="-1" aria-label="Hari sebelumnya">‹</button>
      <label class="f"><span>Tanggal</span><input type="date" id="bd" value="${date}"></label>
      <button class="btn ghost small" data-nav="1" aria-label="Hari berikutnya">›</button>
      <button class="btn ghost small" data-nav="0">Hari ini</button>
      <span class="muted">${fmtDate(Date.parse(date + 'T00:00:00Z') / 1000)} · ${bookings.filter((b) => ['pending', 'confirmed', 'completed'].includes(b.status)).length} booking</span>
    </div>
    <div class="panel scroll"><table class="t"><thead><tr><th>Jam</th><th>Meja</th><th>Pelanggan</th><th>Kode</th><th class="r">Total</th><th>Status</th><th></th></tr></thead>
    <tbody>${bookings.length ? bookings.map((b) => `<tr>
      <td class="mono">${fmtTime(b.start_ts)}–${fmtTime(b.end_ts)}</td><td>${esc(b.table_name)}</td>
      <td>${esc(b.customer_name)}<div class="muted" style="font-size:.8rem">${b.phone !== '-' ? `<a href="${waLink(b.phone, 'Halo ' + b.customer_name + ', ')}" target="_blank" rel="noopener">+${esc(b.phone)}</a>` : ''} ${b.source === 'online' ? '· online' : '· staf'}</div>
        ${b.note ? `<div class="muted" style="font-size:.8rem;white-space:pre-line">${esc(b.note)}</div>` : ''}</td>
      <td class="mono" style="font-size:.85rem">${b.code}</td><td class="r mono">${rp(b.total)}</td>
      <td><span class="pill ${b.status}">${STATUS[b.status]}</span> ${b.paid ? '<span class="pill paid">Lunas</span>' : ''}
        ${b.status === 'pending' && b.expires_at ? `<div class="muted" style="font-size:.78rem">batas bayar ${fmtTime(b.expires_at)}</div>` : ''}</td>
      <td style="white-space:nowrap">${bookingActions(b)}</td></tr>`).join('') : '<tr><td colspan="7" class="muted">Belum ada booking di tanggal ini.</td></tr>'}</tbody></table></div>`;
  const go = (d) => { location.hash = '#booking?d=' + d; };
  $('#bd').addEventListener('change', (e) => go(e.target.value));
  $$('[data-nav]').forEach((x) => x.addEventListener('click', () => go(x.dataset.nav === '0' ? todayIso() : addDays(date, +x.dataset.nav))));
  $('#b-new').addEventListener('click', () => newBookingDialog(info, date));
  $$('[data-act]').forEach((x) => x.addEventListener('click', () => bookingAction(x.dataset.act, bookings.find((b) => b.id === +x.dataset.id), info)));
}
function bookingActions(b) {
  const a = [];
  const active = ['pending', 'confirmed', 'expired'].includes(b.status);
  if (active && !b.paid) a.push(`<button class="btn small" data-act="pay" data-id="${b.id}">Konfirmasi bayar</button>`);
  if (['pending', 'confirmed'].includes(b.status)) {
    a.push(`<button class="btn small ghost" data-act="resch" data-id="${b.id}">Ganti jadwal</button>`);
    a.push(`<button class="btn small ghost" data-act="noshow" data-id="${b.id}">Tidak datang</button>`);
    if (isAdmin()) a.push(`<button class="btn small ghost" data-act="cancel" data-id="${b.id}">Batalkan</button>`);
  }
  return `<div class="row" style="gap:6px">${a.join('')}</div>`;
}
function bookingAction(act, b, info) {
  if (act === 'pay') {
    let m = 'transfer';
    const d = openDlg(`<h2>Konfirmasi pembayaran</h2><p><b>${esc(b.customer_name)}</b> · ${esc(b.table_name)} · ${fmtDate(b.start_ts)} ${fmtTime(b.start_ts)} · <b class="mono">${rp(b.total)}</b></p>
      <p class="muted">Pastikan dana sudah masuk sebelum konfirmasi. Pembayaran ini langsung tercatat sebagai pendapatan.</p>
      <div class="methods">${Object.entries(METHOD).map(([k, v]) => `<button type="button" class="tile" data-pm="${k}" aria-pressed="${k === m}">${v}</button>`).join('')}</div>
      <button class="btn block" id="ok">Tandai lunas</button>`);
    $$('[data-pm]', d).forEach((x) => x.addEventListener('click', () => { m = x.dataset.pm; $$('[data-pm]', d).forEach((y) => y.setAttribute('aria-pressed', y === x)); }));
    $('#ok', d).addEventListener('click', async () => { try { await api(`/admin/bookings/${b.id}/confirm`, { body: { method: m } }); toast('Booking lunas'); closeDlg(); route(); } catch (e) { toast(e.message, true); } });
  }
  if (act === 'resch') {
    const sh = new Date(b.start_ts * 1000).getUTCHours();
    const d = openDlg(`<h2>Ganti jadwal ${esc(b.code)}</h2><form id="fr">
      <label class="f"><span>Tanggal</span><input type="date" name="date" value="${new Date(b.start_ts * 1000).toISOString().slice(0, 10)}" required></label>
      <label class="f"><span>Meja</span><select name="table_id">${info.tables.map((t) => `<option value="${t.id}" ${t.id === b.table_id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
      <label class="f"><span>Jam mulai</span><select name="hour">${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === sh ? 'selected' : ''}>${pad(h)}.00</option>`).join('')}</select></label>
      <button class="btn">Simpan jadwal baru</button></form>`);
    $('#fr', d).addEventListener('submit', async (e) => {
      e.preventDefault(); const f = e.target;
      try {
        const r = await api(`/admin/bookings/${b.id}/reschedule`, { body: { date: f.date.value, hour: +f.hour.value, table_id: +f.table_id.value } });
        toast(r.extra_due > 0 ? `Jadwal diganti. Selisih ${rp(r.extra_due)} otomatis ditagih saat checkout.` : 'Jadwal diganti'); closeDlg(); route();
      }
      catch (err) { toast(err.message, true); }
    });
  }
  if (act === 'cancel') {
    const reason = prompt(`Batalkan booking ${b.code}? Tulis alasannya:`); if (!reason) return;
    api(`/admin/bookings/${b.id}/cancel`, { body: { reason } }).then(() => { toast('Booking dibatalkan'); route(); }).catch((e) => toast(e.message, true));
  }
  if (act === 'noshow') {
    if (!confirm(`Tandai ${b.customer_name} tidak datang?`)) return;
    api(`/admin/bookings/${b.id}/noshow`, { method: 'POST' }).then(() => { toast('Ditandai tidak datang'); route(); }).catch((e) => toast(e.message, true));
  }
}
function newBookingDialog(info, date) {
  const d = openDlg(`<h2>Tambah booking</h2><p class="muted">Untuk pesanan lewat telepon/WhatsApp. Pelanggan yang datang langsung cukup dimulai dari menu Kasir & meja.</p>
    <form id="fn">
    <label class="f"><span>Nama</span><input name="name" required maxlength="80"></label>
    <label class="f"><span>Nomor WhatsApp</span><input name="phone" type="tel"></label>
    <div class="grid2"><label class="f"><span>Tanggal</span><input type="date" name="date" value="${date}" required></label>
    <label class="f"><span>Meja</span><select name="table_id">${info.tables.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></label>
    <label class="f"><span>Jam mulai</span><select name="hour">${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === 19 ? 'selected' : ''}>${pad(h)}.00</option>`).join('')}</select></label>
    <label class="f"><span>Durasi (jam)</span><input name="hours" type="number" min="1" max="24" value="3" required></label></div>
    <label class="f"><span>Pembayaran</span><select name="paid_method"><option value="">Belum bayar</option>${Object.entries(METHOD).map(([k, v]) => `<option value="${k}">Sudah bayar · ${v}</option>`).join('')}</select></label>
    <label class="f"><span>Catatan</span><input name="note" maxlength="300"></label>
    <button class="btn">Simpan booking</button></form>`);
  $('#fn', d).addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target;
    try {
      const r = await api('/admin/bookings', { body: { name: f.name.value, phone: f.phone.value, date: f.date.value, table_id: +f.table_id.value, hour: +f.hour.value, hours: +f.hours.value, paid_method: f.paid_method.value || undefined, note: f.note.value } });
      toast('Booking ' + r.code + ' tersimpan'); closeDlg(); location.hash = '#booking?d=' + f.date.value; route();
    } catch (err) { toast(err.message, true); }
  });
}

// =====================================================================
// Transaksi
// =====================================================================
async function viewOrders() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const from = q.get('from') || todayIso(), to = q.get('to') || from;
  const { orders } = await api(`/admin/orders?from=${from}&to=${to}`);
  const paid = orders.filter((o) => o.status === 'paid');
  main().innerHTML = `<h1>Transaksi</h1>
    ${isAdmin() ? `<div class="bar"><label class="f"><span>Dari</span><input type="date" id="of" value="${from}"></label>
      <label class="f"><span>Sampai</span><input type="date" id="ot" value="${to}"></label><button class="btn small jade" id="og">Tampilkan</button></div>`
      : '<p class="muted">Transaksi yang kamu proses hari ini.</p>'}
    <p><b class="mono">${paid.length}</b> transaksi lunas · <b class="mono">${rp(paid.reduce((a, o) => a + o.total, 0))}</b>
      ${orders.length - paid.length ? ` · <span class="muted">${orders.length - paid.length} void</span>` : ''}</p>
    <div class="panel scroll"><table class="t"><thead><tr><th>No</th><th>Waktu</th><th>Pelanggan</th><th>Metode</th><th>Kasir</th><th class="r">Total</th><th>Status</th></tr></thead>
    <tbody>${orders.length ? orders.map((o) => `<tr class="click ${o.status === 'void' ? 'void' : ''}" data-id="${o.id}"><td class="mono">${esc(o.no)}</td><td class="mono">${fmtDT(o.paid_at || o.created_at)}</td>
      <td>${esc(o.customer_name || '')}</td><td>${METHOD[o.payment_method] || ''}</td><td>${esc(o.cashier_name || '')}</td><td class="r mono">${rp(o.total)}</td>
      <td><span class="pill ${o.status}">${STATUS[o.status]}</span></td></tr>`).join('') : '<tr><td colspan="7" class="muted">Belum ada transaksi di rentang ini.</td></tr>'}</tbody></table></div>`;
  $('#og')?.addEventListener('click', () => { location.hash = `#transaksi?from=${$('#of').value}&to=${$('#ot').value}`; });
  $$('tr[data-id]').forEach((tr) => tr.addEventListener('click', async () => {
    try { if (!posData) posData = await api('/admin/pos'); receiptDialog((await api('/admin/orders/' + tr.dataset.id)).order); } catch (e) { toast(e.message, true); }
  }));
}

// =====================================================================
// Laporan
// =====================================================================
async function viewReport() {
  if (!isAdmin()) {
    const r = await api('/admin/reports/shift');
    main().innerHTML = `<h1>Laporan shift saya</h1><p class="muted">${fmtDate(r.from)}</p>${reportBody(r, true)}`;
    return;
  }
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const t = todayIso();
  const from = q.get('from') || t.slice(0, 8) + '01', to = q.get('to') || t;
  const r = await api(`/admin/reports?from=${from}&to=${to}`);
  main().innerHTML = `<h1>Laporan keuangan</h1>
    <div class="bar">
      <label class="f"><span>Dari</span><input type="date" id="rf" value="${from}"></label>
      <label class="f"><span>Sampai</span><input type="date" id="rt" value="${to}"></label>
      <button class="btn small jade" id="rg">Tampilkan</button>
      <button class="btn small ghost" data-p="today">Hari ini</button><button class="btn small ghost" data-p="7">7 hari</button>
      <button class="btn small ghost" data-p="month">Bulan ini</button><button class="btn small ghost" data-p="last">Bulan lalu</button>
      <a class="btn small" href="/api/admin/reports/export?from=${from}&to=${to}">Unduh CSV (Excel)</a>
    </div>${reportBody(r)}`;
  const go = (f, tt) => { location.hash = `#laporan?from=${f}&to=${tt}`; };
  $('#rg').addEventListener('click', () => go($('#rf').value, $('#rt').value));
  $$('[data-p]').forEach((b) => b.addEventListener('click', () => {
    const p = b.dataset.p;
    if (p === 'today') go(t, t);
    if (p === '7') go(addDays(t, -6), t);
    if (p === 'month') go(t.slice(0, 8) + '01', t);
    if (p === 'last') { const first = t.slice(0, 8) + '01'; const lastEnd = addDays(first, -1); go(lastEnd.slice(0, 8) + '01', lastEnd); }
  }));
}
function reportBody(r, shift = false) {
  const meja = r.byCategory.find((c) => c.cat === 'Meja')?.total || 0;
  const fnb = r.byCategory.filter((c) => c.cat !== 'Meja').reduce((a, c) => a + c.total, 0);
  const maxDay = Math.max(1, ...r.byDay.map((d) => d.total));
  const maxCat = Math.max(1, ...r.byCategory.map((c) => c.total));
  return `<div class="kpis">
      <div class="kpi"><div class="l">Pendapatan bersih</div><div class="v">${rp(r.totals.total)}</div></div>
      <div class="kpi"><div class="l">Sewa meja</div><div class="v">${rp(meja)}</div></div>
      <div class="kpi"><div class="l">F&B</div><div class="v">${rp(fnb)}</div></div>
      <div class="kpi"><div class="l">Transaksi</div><div class="v">${r.totals.n}</div></div>
      ${shift ? '' : `<div class="kpi"><div class="l">Jam meja terpakai</div><div class="v">${r.tableHours.h}</div></div>`}
      ${r.totals.discount ? `<div class="kpi"><div class="l">Total diskon</div><div class="v">${rp(r.totals.discount)}</div></div>` : ''}
    </div>
    ${r.byDay.length > 1 ? `<div class="panel"><h2>Per hari</h2><div class="bars">${r.byDay.map((d) => `<div style="height:${(d.total / maxDay) * 100}%" title="${d.date}: ${rp(d.total)}"></div>`).join('')}</div>
      <div class="bars-x">${r.byDay.map((d) => `<span>${+d.date.slice(8)}</span>`).join('')}</div></div>` : ''}
    <div class="grid2" style="margin-top:16px">
      <div class="panel"><h2>Metode bayar</h2>${r.byMethod.length ? `<table class="t">${r.byMethod.map((m) => `<tr><td>${METHOD[m.method] || m.method}</td><td class="r mono">${m.n}×</td><td class="r mono">${rp(m.total)}</td></tr>`).join('')}</table>` : '<p class="muted">Belum ada data.</p>'}</div>
      <div class="panel"><h2>Kategori</h2>${r.byCategory.map((c) => `<div class="hbar"><span>${esc(c.cat)}</span><i style="width:${(c.total / maxCat) * 100}%"></i><span class="mono">${rp(c.total)}</span></div>`).join('') || '<p class="muted">Belum ada data.</p>'}</div>
      <div class="panel"><h2>Menu terlaris</h2>${r.topItems.length ? `<table class="t">${r.topItems.map((i) => `<tr><td>${esc(i.name)}</td><td class="r mono">${i.qty}</td><td class="r mono">${rp(i.total)}</td></tr>`).join('')}</table>` : '<p class="muted">Belum ada penjualan F&B.</p>'}</div>
      <div class="panel"><h2>Per kasir</h2>${r.byCashier.length ? `<table class="t">${r.byCashier.map((c) => `<tr><td>${esc(c.name || '-')}</td><td class="r mono">${c.n}×</td><td class="r mono">${rp(c.total)}</td></tr>`).join('')}</table>` : '<p class="muted">Belum ada data.</p>'}
        ${r.voids.n ? `<p class="warn" style="margin-top:12px">${r.voids.n} transaksi di-void (${rp(r.voids.total)}), tidak dihitung di pendapatan. Detail ada di menu Transaksi & Log aktivitas.</p>` : ''}</div>
    </div>`;
}

// =====================================================================
// Menu
// =====================================================================
async function viewMenu() {
  const { menu } = await api('/admin/menu');
  main().innerHTML = `<h1>Menu F&B</h1>
    <form class="panel bar" id="fm" style="margin-top:14px">
      <label class="f grow"><span>Nama</span><input name="name" required maxlength="80" style="width:100%"></label>
      <label class="f"><span>Kategori</span><input name="category" list="cats" value="Minuman" maxlength="40"></label>
      <label class="f"><span>Harga</span><input name="price" type="number" min="0" step="500" required></label>
      <button class="btn">Tambah menu</button>
      <datalist id="cats">${[...new Set(menu.map((m) => m.category))].map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
    </form>
    <div class="panel scroll" style="margin-top:16px"><table class="t"><thead><tr><th>Nama</th><th>Kategori</th><th class="r">Harga</th><th>Status</th><th></th></tr></thead><tbody>
    ${menu.map((m) => `<tr data-id="${m.id}"><td><input value="${esc(m.name)}" data-k="name"></td><td><input value="${esc(m.category)}" data-k="category" list="cats"></td>
      <td><input type="number" value="${m.price}" data-k="price" style="max-width:130px;text-align:right"></td>
      <td><span class="pill ${m.active ? 'paid' : 'void'}">${m.active ? 'Dijual' : 'Disembunyikan'}</span></td>
      <td style="white-space:nowrap"><button class="btn small jade" data-save>Simpan</button> <button class="btn small ghost" data-tog>${m.active ? 'Sembunyikan' : 'Jual lagi'}</button></td></tr>`).join('')}
    </tbody></table></div>`;
  $('#fm').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target;
    try { await api('/admin/menu', { body: { name: f.name.value, category: f.category.value, price: +f.price.value } }); toast('Menu ditambahkan'); route(); } catch (err) { toast(err.message, true); }
  });
  $$('tr[data-id]').forEach((tr) => {
    const id = tr.dataset.id, m = menu.find((x) => x.id === +id);
    $('[data-save]', tr).addEventListener('click', async () => {
      const body = {}; $$('[data-k]', tr).forEach((i) => (body[i.dataset.k] = i.dataset.k === 'price' ? +i.value : i.value));
      try { await api('/admin/menu/' + id, { method: 'PATCH', body }); toast('Menu disimpan'); } catch (e) { toast(e.message, true); }
    });
    $('[data-tog]', tr).addEventListener('click', async () => {
      try { await api('/admin/menu/' + id, { method: 'PATCH', body: { active: !m.active } }); route(); } catch (e) { toast(e.message, true); }
    });
  });
}

// =====================================================================
// Pengguna
// =====================================================================
async function viewUsers() {
  const { users } = await api('/admin/users');
  main().innerHTML = `<h1>Pengguna</h1>
    <div class="panel" style="margin-top:14px"><h2>Hak akses</h2>
      <table class="t"><tr><td><b>Superadmin</b></td><td>Semua fitur: laporan lengkap, void transaksi, kelola pengguna, harga & pengaturan, log aktivitas.</td></tr>
      <tr><td><b>Admin</b></td><td>Kasir, booking (termasuk batal), laporan, menu, diskon. Tidak bisa void atau mengubah pengaturan.</td></tr>
      <tr><td><b>Kasir</b></td><td>Kasir & meja, booking, dan transaksi miliknya sendiri hari ini.</td></tr></table></div>
    <form class="panel bar" id="fu">
      <label class="f"><span>Nama</span><input name="name" required maxlength="80"></label>
      <label class="f"><span>Username</span><input name="username" required autocapitalize="none"></label>
      <label class="f"><span>Password awal</span><input name="password" type="text" minlength="8" required autocomplete="off"></label>
      <label class="f"><span>Role</span><select name="role"><option value="kasir">Kasir</option><option value="admin">Admin</option><option value="superadmin">Superadmin</option></select></label>
      <button class="btn">Tambah pengguna</button></form>
    <div class="panel scroll"><table class="t"><thead><tr><th>Nama</th><th>Username</th><th>Role</th><th>Status</th><th></th></tr></thead><tbody>
    ${users.map((u) => `<tr data-id="${u.id}"><td>${esc(u.name)}</td><td class="mono">${esc(u.username)}</td>
      <td><select data-role ${u.id === me.id ? 'disabled' : ''}>${Object.entries(ROLE).map(([k, v]) => `<option value="${k}" ${k === u.role ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
      <td><span class="pill ${u.active ? 'paid' : 'void'}">${u.active ? 'Aktif' : 'Nonaktif'}</span></td>
      <td style="white-space:nowrap"><button class="btn small ghost" data-reset>Reset password</button>
      ${u.id !== me.id ? `<button class="btn small ghost" data-tog>${u.active ? 'Nonaktifkan' : 'Aktifkan'}</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
  $('#fu').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target;
    try { await api('/admin/users', { body: { name: f.name.value, username: f.username.value, password: f.password.value, role: f.role.value } }); toast('Pengguna ditambahkan'); route(); } catch (err) { toast(err.message, true); }
  });
  $$('tr[data-id]').forEach((tr) => {
    const id = tr.dataset.id, u = users.find((x) => x.id === +id);
    $('[data-role]', tr).addEventListener('change', async (e) => { try { await api('/admin/users/' + id, { method: 'PATCH', body: { role: e.target.value } }); toast('Role diubah'); } catch (err) { toast(err.message, true); route(); } });
    $('[data-reset]', tr).addEventListener('click', async () => {
      const p = prompt(`Password baru untuk ${u.username} (min. 8 karakter):`); if (!p) return;
      try { await api('/admin/users/' + id, { method: 'PATCH', body: { password: p } }); toast('Password direset'); } catch (err) { toast(err.message, true); }
    });
    $('[data-tog]', tr)?.addEventListener('click', async () => { try { await api('/admin/users/' + id, { method: 'PATCH', body: { active: !u.active } }); route(); } catch (err) { toast(err.message, true); } });
  });
}

// =====================================================================
// Pengaturan
// =====================================================================
async function viewSettings() {
  const { settings: s, tables } = await api('/admin/settings');
  const F = (k, label, type = 'text', hint = '') => `<label class="f"><span>${label}</span>${type === 'area'
    ? `<textarea name="${k}">${esc(s[k])}</textarea>` : `<input name="${k}" type="${type}" value="${esc(s[k])}">`}${hint ? `<small>${hint}</small>` : ''}</label>`;
  main().innerHTML = `<h1>Pengaturan</h1>
    <form id="fs" style="margin-top:14px">
      <div class="panel"><h2>Harga meja</h2><div class="grid2">
        ${F('price_per_hour', 'Harga normal per jam (Rp)', 'number')}
        ${F('happy_price', 'Harga happy hour per jam (Rp)', 'number', 'Isi 0 untuk mematikan happy hour.')}
        ${F('happy_start', 'Happy hour mulai jam (0–23)', 'number', 'Contoh 10 = mulai pukul 10.00.')}
        ${F('happy_end', 'Happy hour selesai jam (0–24)', 'number', 'Contoh 17 = berakhir pukul 17.00. Jam yang dimulai sebelum 17.00 kena harga happy hour.')}
        ${F('grace_minutes', 'Toleransi menit sebelum dihitung jam berikutnya', 'number', 'Contoh 5: main 1 jam 4 menit tetap dihitung 1 jam.')}
        ${F('package_hours', 'Paket: jumlah jam', 'number')}
        ${F('package_price', 'Paket: harga (Rp)', 'number', 'Isi 0 kalau tidak ada paket.')}
      </div></div>
      <div class="panel"><h2>Booking online</h2><div class="grid2">
        ${F('hold_minutes', 'Batas waktu bayar (menit)', 'number', 'Booking yang belum dibayar akan dilepas setelah waktu ini.')}
        ${F('max_booking_hours', 'Maksimal durasi per booking (jam)', 'number')}
        ${F('max_days_ahead', 'Bisa booking berapa hari ke depan', 'number')}
      </div>${F('payment_info', 'Instruksi pembayaran (rekening / QRIS)', 'area')}</div>
      <div class="panel"><h2>Info usaha</h2><div class="grid2">
        ${F('business_name', 'Nama usaha')}${F('tagline', 'Tagline di beranda')}
        ${F('whatsapp', 'Nomor WhatsApp (format 62…)')}${F('instagram', 'Instagram (tanpa @)')}
        ${F('address', 'Alamat')}${F('maps_url', 'Link Google Maps', 'url')}
      </div>${F('receipt_footer', 'Teks bawah struk')}</div>
      <p style="margin-top:16px"><button class="btn">Simpan pengaturan</button></p>
    </form>
    <div class="panel" style="margin-top:16px"><h2>Meja</h2>
      <table class="t">${tables.map((t) => `<tr data-id="${t.id}"><td><input value="${esc(t.name)}" data-name></td>
        <td><span class="pill ${t.active ? 'paid' : 'void'}">${t.active ? 'Aktif' : 'Nonaktif'}</span></td>
        <td style="white-space:nowrap"><button class="btn small jade" data-save>Simpan</button> <button class="btn small ghost" data-tog>${t.active ? 'Nonaktifkan' : 'Aktifkan'}</button></td></tr>`).join('')}</table>
      <form class="bar" id="ft"><label class="f"><span>Meja baru</span><input name="name" placeholder="Meja 4"></label><button class="btn small">Tambah meja</button></form></div>`;
  $('#fs').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    try { await api('/admin/settings', { method: 'PUT', body }); toast('Pengaturan disimpan'); } catch (err) { toast(err.message, true); }
  });
  $('#ft').addEventListener('submit', async (e) => { e.preventDefault(); try { await api('/admin/tables', { body: { name: e.target.name.value } }); route(); } catch (err) { toast(err.message, true); } });
  $$('tr[data-id]').forEach((tr) => {
    const t = tables.find((x) => x.id === +tr.dataset.id);
    $('[data-save]', tr).addEventListener('click', async () => { try { await api('/admin/tables/' + t.id, { method: 'PATCH', body: { name: $('[data-name]', tr).value } }); toast('Meja disimpan'); } catch (e) { toast(e.message, true); } });
    $('[data-tog]', tr).addEventListener('click', async () => { try { await api('/admin/tables/' + t.id, { method: 'PATCH', body: { active: !t.active } }); route(); } catch (e) { toast(e.message, true); } });
  });
}

// =====================================================================
// Log aktivitas
// =====================================================================
const ACT = { login: 'Login', setup_superadmin: 'Setup akun pemilik', booking_create_online: 'Booking online baru', booking_create_staff: 'Booking oleh staf',
  booking_confirm_paid: 'Konfirmasi bayar booking', booking_cancel: 'Batalkan booking', booking_reschedule: 'Ganti jadwal (staf)',
  booking_reschedule_customer: 'Ganti jadwal (pelanggan)', booking_no_show: 'Tidak datang', session_start: 'Mulai main', session_checkout: 'Bayar meja',
  session_cancel: 'Batalkan sesi', order_create: 'Jual F&B', order_void: 'VOID transaksi', report_export: 'Unduh laporan', menu_create: 'Tambah menu',
  menu_update: 'Ubah menu', user_create: 'Tambah pengguna', user_update: 'Ubah pengguna', change_password: 'Ganti password', settings_update: 'Ubah pengaturan',
  table_create: 'Tambah meja', table_update: 'Ubah meja' };
async function viewAudit() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const off = +(q.get('o') || 0);
  const { log } = await api('/admin/audit?limit=100&offset=' + off);
  main().innerHTML = `<h1>Log aktivitas</h1><p class="muted">Semua perubahan penting tercatat di sini dan tidak bisa dihapus dari aplikasi.</p>
    <div class="panel scroll"><table class="t"><thead><tr><th>Waktu</th><th>Oleh</th><th>Aksi</th><th>Detail</th></tr></thead><tbody>
    ${log.map((l) => `<tr><td class="mono" style="white-space:nowrap">${fmtDT(l.ts)}</td><td>${esc(l.user_name || '')}</td>
      <td>${l.action === 'order_void' ? '<b style="color:var(--red)">' + ACT[l.action] + '</b>' : esc(ACT[l.action] || l.action)} <span class="muted mono" style="font-size:.8rem">${esc(l.entity_id || '')}</span></td>
      <td class="mono" style="font-size:.78rem;max-width:420px;word-break:break-word">${esc(l.detail || '')}</td></tr>`).join('')}</tbody></table></div>
    <div class="row" style="margin-top:12px">${off ? `<a class="btn small ghost" href="#log?o=${Math.max(0, off - 100)}">Lebih baru</a>` : ''}${log.length === 100 ? `<a class="btn small ghost" href="#log?o=${off + 100}">Lebih lama</a>` : ''}</div>`;
}

boot();
