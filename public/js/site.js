// Footer bersama + tombol WhatsApp melayang untuk halaman publik
import { api, esc } from './common.js';

const foot = document.getElementById('foot');
const yr = new Date().getFullYear();
function render(s = {}) {
  const wa = s.whatsapp ? `https://wa.me/${s.whatsapp}` : '#';
  const waTxt = s.whatsapp ? '+' + s.whatsapp.replace(/^62(\d{3})(\d{4})(\d+)$/, '62 $1-$2-$3') : '';
  if (foot) foot.innerHTML = `<div class="wrap foot-grid">
    <div><img src="/assets/logo-520.webp" alt="Zi Mo Mahjong" width="520" height="282" class="foot-logo">
      <p>${esc(s.tagline || 'Mahjong lounge · buka 24 jam')}</p></div>
    <div><h4>Alamat</h4><p>${esc(s.address || '')}${s.maps_url ? `<br><a href="${esc(s.maps_url)}" rel="noopener" target="_blank">Petunjuk arah</a>` : ''}</p>
      <h4>Jam buka</h4><p>Setiap hari, 24 jam</p></div>
    <div><h4>Kontak</h4><p>${s.whatsapp ? `WhatsApp <a href="${wa}" rel="noopener" target="_blank">${esc(waTxt)}</a><br>` : ''}${s.instagram ? `Instagram <a href="https://instagram.com/${esc(s.instagram)}" rel="noopener" target="_blank">@${esc(s.instagram)}</a>` : ''}</p>
      <h4>Menu</h4><p><a href="/booking.html">Booking meja</a> · <a href="/cek.html">Cek booking</a> · <a href="/skor.html">Hitung poin</a></p></div>
  </div><div class="wrap foot-base">© ${yr} ${esc(s.business_name || 'Zi Mo Mahjong')}</div>`;
  if (s.whatsapp && !document.querySelector('.wa-float')) {
    const a = document.createElement('a');
    a.className = 'wa-float'; a.href = wa; a.target = '_blank'; a.rel = 'noopener'; a.setAttribute('aria-label', 'Chat WhatsApp Zi Mo');
    a.innerHTML = '<svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true"><path fill="currentColor" d="M16 3a13 13 0 0 0-11.2 19.6L3 29l6.6-1.7A13 13 0 1 0 16 3zm0 23.6c-2 0-4-.6-5.6-1.6l-.4-.2-3.9 1 1-3.8-.3-.4A10.6 10.6 0 1 1 16 26.6zm5.8-7.9c-.3-.2-1.9-.9-2.2-1-.3-.1-.5-.2-.7.2l-1 1.2c-.2.2-.4.2-.7.1a8.7 8.7 0 0 1-4.3-3.8c-.3-.6.3-.5.9-1.7.1-.2 0-.4 0-.6l-1-2.4c-.3-.6-.5-.5-.7-.5h-.6c-.2 0-.6.1-.9.4-.3.3-1.2 1.1-1.2 2.8s1.2 3.3 1.4 3.5c.2.2 2.4 3.7 5.8 5.1 2.2.9 3 1 4.1.8.7-.1 1.9-.8 2.2-1.5.3-.8.3-1.4.2-1.5-.1-.2-.3-.3-.6-.4z"/></svg><span>Chat kami</span>';
    document.body.append(a);
  }
}
render();
api('/public/info').then((r) => render(r.settings)).catch(() => {});
