import { api, toast, $, $$, esc } from './common.js';

const WIND = ['東', '南', '西', '北'];
let room = null, mode = null, sel = { w: null, f: null }, tai = 0, poll = null;
const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString('id-ID');
const sign = (n) => (n > 0 ? '+' : '') + fmt(n);

function recent() { try { return JSON.parse(localStorage.getItem('zimo-rooms') || '[]'); } catch { return []; } }
function remember(code, name) {
  try { const r = recent().filter((x) => x.code !== code); r.unshift({ code, name }); localStorage.setItem('zimo-rooms', JSON.stringify(r.slice(0, 5))); } catch {}
}

function showStart() {
  $('#v-start').classList.remove('hide'); $('#v-room').classList.add('hide');
  const r = recent();
  $('#recent').innerHTML = r.length ? '<p class="muted" style="margin:14px 0 0;font-size:.85rem">Room terakhir:</p>' +
    r.map((x) => `<a class="pill" href="?room=${x.code}">${esc(x.code)} · ${esc(x.name)}</a>`).join('') : '';
}
$('#f-new').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    const r = await api('/rooms', { body: { name: f.name.value, players: [0, 1, 2, 3].map((i) => f['p' + i].value),
      config: { base: f.base.value, per_tai: f.per_tai.value, zimo_mult: f.zimo_mult.value, tembak_mult: f.tembak_mult.value, start: f.start.value } } });
    location.search = '?room=' + r.code;
  } catch (err) { toast(err.message, true); }
});
$('#f-join').addEventListener('submit', (e) => {
  e.preventDefault();
  const c = e.target.code.value.trim().toUpperCase();
  if (c.length !== 5) return toast('Kode room terdiri dari 5 karakter', true);
  location.search = '?room=' + c;
});

// ---------- room ----------
function deltasPreview() {
  const c = room.config, d = [0, 0, 0, 0];
  if (mode === 'adjust') return $$('#adj input').map((i) => Number(i.value) || 0);
  if (mode === 'draw' || sel.w == null) return d;
  const A = c.base + tai * c.per_tai;
  if (mode === 'zimo') for (let i = 0; i < 4; i++) { if (i !== sel.w) { d[i] -= A * c.zimo_mult; d[sel.w] += A * c.zimo_mult; } }
  if (mode === 'tembak' && sel.f != null) { d[sel.f] -= A * c.tembak_mult; d[sel.w] += A * c.tembak_mult; }
  return d;
}
function render() {
  $('#r-code').textContent = room.code; $('#s-code').textContent = room.code; $('#r-name').textContent = room.name;
  const max = Math.max(...room.totals);
  const last = room.rounds[room.rounds.length - 1];
  const picking = mode === 'zimo' || mode === 'tembak';
  $('#felt').classList.toggle('picking', picking);
  $('#seats').innerHTML = room.players.map((p, i) => {
    const t = room.totals[i];
    const cls = ['seat', room.rounds.length && t === max && t > (room.config.start || 0) ? 'lead' : '', sel.w === i ? 'sel-w' : '', sel.f === i ? 'sel-f' : ''].join(' ');
    const dis = mode === 'tembak' && sel.w != null && sel.f == null && i === sel.w ? 'disabled' : '';
    return `<button type="button" class="${cls}" data-i="${i}" ${picking ? '' : 'tabindex="-1"'} ${dis}>
      <span class="wind" aria-hidden="true">${WIND[i]}</span>
      <div class="nm">${esc(p)}</div>
      <div class="pts ${t < 0 ? 'neg' : ''}">${fmt(t)}</div>
      <div class="last">${last && last.deltas[i] ? sign(last.deltas[i]) + ' ronde ' + last.n : ''}</div></button>`;
  }).join('');
  // hint
  let hint = '';
  if (mode === 'zimo') hint = sel.w == null ? 'Ketuk pemain yang zimo.' : '';
  if (mode === 'tembak') hint = sel.w == null ? 'Ketuk pemain yang menang.' : sel.f == null ? 'Sekarang ketuk pemain yang membuang ubin.' : '';
  $('#pick-hint').textContent = hint;
  // panel
  const showPanel = mode && (mode === 'draw' || mode === 'adjust' || (mode === 'zimo' && sel.w != null) || (mode === 'tembak' && sel.w != null && sel.f != null));
  $('#panel').classList.toggle('hide', !showPanel);
  $('#p-tai').classList.toggle('hide', !(mode === 'zimo' || mode === 'tembak'));
  $('#p-adj').classList.toggle('hide', mode !== 'adjust');
  if (showPanel) {
    $('#p-title').textContent = mode === 'zimo' ? `${room.players[sel.w]} zimo` : mode === 'tembak' ? `${room.players[sel.w]} menang dari ${room.players[sel.f]}`
      : mode === 'draw' ? 'Seri, tidak ada yang menang' : 'Penyesuaian manual';
    $('#tai').textContent = tai;
    const d = deltasPreview();
    $('#preview').innerHTML = d.map((x, i) => `<span>${esc(room.players[i])}<br><b style="color:${x < 0 ? 'var(--red)' : x > 0 ? 'var(--ok)' : 'inherit'}">${sign(x)}</b></span>`).join('');
  }
  $$('#actions .btn').forEach((b) => b.setAttribute('aria-pressed', b.dataset.type === mode));
  const finished = room.status !== 'active';
  $('#actions').classList.toggle('hide', finished);
  $('#b-undo').disabled = finished || !room.rounds.length;
  $('#b-finish').textContent = finished ? 'Lanjut main' : 'Selesai main';
  // riwayat
  const label = (r) => r.type === 'zimo' ? `${room.players[r.winner]} zimo` + (r.tai ? ` · ${r.tai} tai` : '')
    : r.type === 'tembak' ? `${room.players[r.winner]} ← ${room.players[r.from_player]}` + (r.tai ? ` · ${r.tai} tai` : '')
    : r.type === 'draw' ? 'Seri' : 'Manual' + (r.note ? ` · ${r.note}` : '');
  $('#hist').innerHTML = `<thead><tr><th>#</th><th>Ronde</th>${room.players.map((p) => `<th>${esc(p.slice(0, 8))}</th>`).join('')}</tr></thead><tbody>` +
    (room.rounds.length ? [...room.rounds].reverse().map((r) => `<tr><td>${r.n}</td><td>${esc(label(r))}</td>${r.deltas.map((x) => `<td class="${x < 0 ? 'neg' : x > 0 ? 'pos' : ''}">${x ? sign(x) : '·'}</td>`).join('')}</tr>`).join('')
      : `<tr><td colspan="6" style="text-align:left;font-family:var(--serif)" class="muted">Belum ada ronde. Pilih Zimo, Tembak, Seri, atau Manual di atas setelah satu ronde selesai.</td></tr>`) + '</tbody>';
}
function resetInput() { mode = null; sel = { w: null, f: null }; tai = 0; }

$('#actions').addEventListener('click', (e) => {
  const b = e.target.closest('[data-type]'); if (!b) return;
  const t = b.dataset.type;
  resetInput(); if (mode !== t) mode = t;
  if (t === 'adjust') $('#adj').innerHTML = room.players.map((p) => `<label><span class="muted" style="font-size:.8rem">${esc(p)}</span><input type="number" step="any" value="0"></label>`).join('');
  render();
});
$('#adj').addEventListener('input', render);
$('#seats').addEventListener('click', (e) => {
  const s = e.target.closest('[data-i]'); if (!s || s.disabled) return;
  const i = +s.dataset.i;
  if (mode === 'zimo') sel.w = sel.w === i ? null : i;
  else if (mode === 'tembak') {
    if (sel.w == null) sel.w = i;
    else if (sel.f == null && i !== sel.w) sel.f = i;
    else if (i === sel.w) { sel.w = null; sel.f = null; }
    else sel.f = i;
  } else return;
  render();
});
$('#p-tai').addEventListener('click', (e) => {
  const b = e.target.closest('[data-d]'); if (!b) return;
  tai = Math.max(0, Math.min(99, tai + +b.dataset.d)); render();
});
$('#b-cancel').addEventListener('click', () => { resetInput(); render(); });
$('#b-save').addEventListener('click', async () => {
  const body = { type: mode, winner: sel.w, from: sel.f, tai };
  if (mode === 'adjust') { body.deltas = deltasPreview(); if (body.deltas.every((x) => !x)) return toast('Isi minimal satu angka', true); }
  $('#b-save').disabled = true;
  try { room = await api(`/rooms/${room.code}/rounds`, { body }); resetInput(); render(); toast('Ronde ' + room.rounds.length + ' tersimpan'); }
  catch (e) { toast(e.message, true); } finally { $('#b-save').disabled = false; }
});
$('#b-undo').addEventListener('click', async () => {
  if (!confirm('Hapus ronde terakhir?')) return;
  try { room = await api(`/rooms/${room.code}/undo`, { method: 'POST' }); render(); toast('Ronde terakhir dihapus'); } catch (e) { toast(e.message, true); }
});
$('#b-finish').addEventListener('click', async () => {
  try { room = await api(`/rooms/${room.code}`, { method: 'PATCH', body: { status: room.status === 'active' ? 'finished' : 'active' } }); resetInput(); render(); } catch (e) { toast(e.message, true); }
});
$('#b-share').addEventListener('click', () => {
  const s = $('#share'); s.classList.toggle('hide');
  if (!s.classList.contains('hide') && !$('#qr').children.length && window.QRCode)
    new window.QRCode($('#qr'), { text: location.origin + '/skor.html?room=' + room.code, width: 180, height: 180, colorDark: '#003a2b' });
});
$('#b-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(location.origin + '/skor.html?room=' + room.code); toast('Link disalin'); } catch { toast('Salin manual: ' + location.href); }
});
$('#b-edit').addEventListener('click', () => {
  const f = $('#f-edit'); f.classList.toggle('hide');
  $('#e-players').innerHTML = room.players.map((p, i) => `<label class="f"><span>${WIND[i]}</span><input name="p${i}" value="${esc(p)}" maxlength="24"></label>`).join('');
  for (const k of ['base', 'per_tai', 'zimo_mult', 'tembak_mult']) f[k].value = room.config[k];
});
$('#f-edit').addEventListener('submit', async (e) => {
  e.preventDefault(); const f = e.target;
  try {
    room = await api(`/rooms/${room.code}`, { method: 'PATCH', body: { players: [0, 1, 2, 3].map((i) => f['p' + i].value),
      config: { base: f.base.value, per_tai: f.per_tai.value, zimo_mult: f.zimo_mult.value, tembak_mult: f.tembak_mult.value } } });
    f.classList.add('hide'); render(); toast('Pengaturan disimpan');
  } catch (err) { toast(err.message, true); }
});

async function openRoom(code) {
  try {
    room = await api('/rooms/' + encodeURIComponent(code));
    remember(room.code, room.name);
    $('#v-start').classList.add('hide'); $('#v-room').classList.remove('hide');
    render();
    clearInterval(poll);
    poll = setInterval(async () => {
      if (document.hidden || mode) return;
      try { const r = await api('/rooms/' + room.code); if (r.updated_at !== room.updated_at || r.rounds.length !== room.rounds.length) { room = r; render(); } } catch {}
    }, 3000);
  } catch (e) { toast(e.message, true); showStart(); }
}
const code = new URLSearchParams(location.search).get('room');
if (code) openRoom(code.toUpperCase()); else showStart();
