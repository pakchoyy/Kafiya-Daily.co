import * as db from './db.js';
import { parseChat, normalizePhone, rupiah } from './parser.js';
import { sheetJPG, downloadBlob } from './jpg.js';
import { processLogo, logoSet, DEFAULT_LOGOS } from './logo.js';
import { labelHTML, fitLabel, sheetsHTML, testSheetHTML, printHTML, esc, PAPERS, layout, COD_SELF } from './label.js';
import { readAny } from './shopee.js';
import * as cloud from './cloud.js';

const COURIERS = ['Wahana', 'JNE', 'J&T', 'SiCepat', COD_SELF, 'Lainnya'];
const BACKUP_DAYS = 7;
// Nominal COD dari isian ("150.000", "150rb", "Rp 150,000") ke angka rupiah; 0 = bukan COD.
const toCod = (v) => { if (typeof v === 'number') return v; const t = String(v || '').toLowerCase(); const n = Number(t.replace(/[^\d]/g, '')) || 0; return /rb|ribu|k\b/.test(t) && n < 10000 ? n * 1000 : n; };
const cm = (mm) => (Math.round(mm) / 10).toLocaleString('id-ID', { maximumFractionDigits: 1 });
const APP_VERSION = 40; // naikkan bersama CACHE di sw.js
const app = document.getElementById('app');

let shop;
let draft = { items: [], manualOpen: false, chat: '', name: '', phone: '', address: '', courier: 'Wahana', other: '', save: true };
let session = null; // { ids, printed:Set, pending:[orders]|null }

const $ = (s, r = app) => r.querySelector(s);
const $$ = (s, r = app) => [...r.querySelectorAll(s)];
const fmtDate = (iso) => new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

let toastT;
// type: 'ok' | 'warn' | 'err'. Tanpa type, kalimat yang mengandung gagal/tidak dianggap peringatan.
function toast(msg, type) {
  type ||= /gagal|tidak|wajib|bukan|error/i.test(msg) ? 'warn' : 'ok';
  const t = document.getElementById('toast');
  const icon = { ok: '<path d="M20 6 9 17l-5-5"/>', warn: '<path d="M12 9v4M12 17h.01"/><circle cx="12" cy="12" r="10"/>', err: '<path d="M18 6 6 18M6 6l12 12"/>' }[type];
  t.className = `toast-${type}`;
  t.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${icon}</svg><span>${esc(msg)}</span>`;
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2800);
}

// Pengganti confirm(): dialog di tengah layar, mengembalikan Promise<boolean>.
function ask(title, msg, { ok = 'Ya', danger = false } = {}) {
  return new Promise((res) => {
    const o = document.createElement('div');
    o.className = 'overlay center';
    o.innerHTML = `<div class="dialog" role="alertdialog" aria-modal="true">
      <div class="dialog-ic ${danger ? 'danger' : ''}">${ic(danger ? 'trash' : 'printer', 22)}</div>
      <h3>${esc(title)}</h3>${msg ? `<p>${esc(msg)}</p>` : ''}
      <div class="row"><button class="btn ghost grow" data-a="0">Batal</button><button class="btn grow ${danger ? 'red' : ''}" data-a="1">${esc(ok)}</button></div></div>`;
    const done = (v) => { release(); o.remove(); res(v); };
    const release = trapFocus(o, () => done(false), true);
    o.addEventListener('click', (e) => { if (e.target === o) done(false); const a = e.target.closest('[data-a]'); if (a) done(a.dataset.a === '1'); });
    document.body.append(o);
    o.querySelector('[data-a="1"]').focus();
  });
}

// Ubah atau hapus satu pesanan. onDone dipanggil setelah tersimpan/terhapus.
function editOrder(o, onDone) {
  const w = !o.type.startsWith('shopee');
  modal(`<h2>Ubah pesanan ${w ? esc(o.courier) : 'Shopee'}</h2>
    ${w ? `<label class="f">Nama penerima</label><input type="text" id="en" value="${esc(o.name)}">
    <label class="f">No. HP</label><input type="tel" id="ep" value="${esc(o.phone)}">
    <label class="f">Alamat</label><textarea id="ea">${esc(o.address)}</textarea>
    <label class="f">Ekspedisi</label><input type="text" id="ec" value="${esc(o.courier)}">
    <label class="f">COD (kosongkan kalau bukan COD)</label><input type="text" id="ecod" inputmode="numeric" value="${o.cod ? esc(o.cod.toLocaleString('id-ID')) : ''}" placeholder="Contoh: 150.000">
    <div class="row" style="margin-top:12px"><input type="checkbox" id="epaid" ${o.paid ? 'checked' : ''}><label for="epaid">COD sudah dibayar (lunas)</label></div>` : ''}
    <label class="f">No. resi${w ? ' (catatan)' : ''}</label><input type="text" id="er" value="${esc(o.resi)}" autocapitalize="characters">
    <div class="row" style="margin-top:12px"><input type="checkbox" id="eprt" ${o.printed ? 'checked' : ''}><label for="eprt">Sudah dicetak</label></div>
    <button class="btn block" id="es">Simpan perubahan</button>
    <button class="btn danger block" id="ed">${ic('trash', 18)} Hapus pesanan</button>`, (m, close) => {
    $('#es', m).onclick = async () => {
      const v = { ...o, resi: $('#er', m).value.replace(/\s+/g, '').toUpperCase(), printed: $('#eprt', m).checked };
      if (w) Object.assign(v, { name: $('#en', m).value.trim(), phone: normalizePhone($('#ep', m).value) || $('#ep', m).value.trim(), address: $('#ea', m).value.trim(), courier: $('#ec', m).value.trim() || 'Wahana', cod: toCod($('#ecod', m).value), paid: $('#epaid', m).checked });
      if (w && v.courier === COD_SELF && !v.cod) return toast('Isi nominal COD untuk COD antar sendiri.');
      if (w ? !v.name || !v.address : !v.resi) return toast(w ? 'Nama dan alamat wajib diisi.' : 'No. resi wajib diisi.');
      await db.put('orders', v); close(); toast('Pesanan disimpan.'); onDone();
    };
    $('#ed', m).onclick = async () => {
      if (!await ask('Hapus pesanan ini?', `${o.name || o.resi || 'Pesanan'} akan dihapus permanen.`, { ok: 'Hapus', danger: true })) return;
      await db.del('orders', o.id); close(); toast('Pesanan dihapus.'); onDone();
    };
  });
}
// Judul baris: Shopee dikenali dari resinya, pesanan chat dari nama penerimanya.
const resiText = (o) => (o.type.startsWith('shopee') ? esc(o.resi || 'Resi belum terbaca') : esc(o.name));
const metaText = (o) => (o.type === 'shopee-img' ? 'Shopee · label asli' : o.type === 'shopee' ? 'Shopee' : `${esc(o.courier)}${o.cod ? ` · ${esc(rupiah(o.cod))}` : ''}`);
const orderBtns = (o) => `<button class="icon-btn" data-edit="${o.id}" aria-label="Ubah">${ic('edit', 18)}</button><button class="icon-btn" data-del="${o.id}" aria-label="Hapus">${ic('trash', 18)}</button>`;
function bindOrderBtns(orders, refresh) {
  $$('[data-edit]').forEach((b) => b.onclick = (e) => { e.preventDefault(); editOrder(orders.find((o) => o.id === Number(b.dataset.edit)), refresh); });
  $$('[data-del]').forEach((b) => b.onclick = async (e) => {
    e.preventDefault();
    const o = orders.find((x) => x.id === Number(b.dataset.del));
    if (!await ask('Hapus pesanan ini?', `${o.resi} akan dihapus permanen.`, { ok: 'Hapus', danger: true })) return;
    await db.del('orders', o.id); toast('Pesanan dihapus.'); refresh();
  });
}

// Dialog: Escape menutup, Tab berputar di dalam dialog, fokus kembali ke tombol asal setelah ditutup.
function trapFocus(o, onEscape, quiet) {
  const back = document.activeElement;
  const key = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); onEscape(); return; }
    if (e.key !== 'Tab') return;
    const f = [...o.querySelectorAll('button, input, select, textarea, a[href]')].filter((x) => !x.disabled && x.offsetParent);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f.at(-1).focus(); }
    else if (!e.shiftKey && document.activeElement === f.at(-1)) { e.preventDefault(); f[0].focus(); }
  };
  document.addEventListener('keydown', key);
  const release = () => { document.removeEventListener('keydown', key); back?.focus?.(); };
  return quiet ? release : () => { release(); o.remove(); };
}

function modal(html, mount) {
  const o = document.createElement('div');
  o.className = 'overlay';
  o.innerHTML = `<div class="sheet-modal">${html}</div>`;
  o.addEventListener('click', (e) => { if (e.target === o) close(); });
  const close = trapFocus(o, () => o.remove());
  document.body.append(o);
  o.querySelector('input, select, textarea, button')?.focus();
  mount?.(o, close);
}

async function saveShop(patch) { shop = { ...shop, ...patch }; await db.saveShop(shop); }

// ---------- kerangka ----------
const ICON = {
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  printer: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  chev: '<path d="M9 18l6-6-6-6"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  home: '<path d="M4 10.5 12 4l8 6.5V19a2 2 0 0 1-2 2h-3.5v-5.5h-5V21H6a2 2 0 0 1-2-2z"/>',
  bag: '<path d="M5.5 8h13l-.9 11.1a2 2 0 0 1-2 1.9H8.4a2 2 0 0 1-2-1.9z"/><path d="M9 11V7a3 3 0 0 1 6 0v4"/>',
  store: '<path d="M4 9l1.5-5h13L20 9M4 9v11h16V9M4 9h16M9 20v-6h6v6"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  truck: '<path d="M1 4h13v12H1zM14 8h4l4 4v4h-8"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
};
const ic = (n, sz = 22) => `<svg class="ic" width="${sz}" height="${sz}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;

// ---------- pasang PWA ----------
let installEvt = null;
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; $$('.install-slot').forEach((el) => { el.innerHTML = installCard(); bindInstall(); }); });
window.addEventListener('appinstalled', () => { installEvt = null; toast('Aplikasi terpasang di layar HP.'); $$('.install-slot').forEach((el) => { el.innerHTML = ''; }); });
function installCard() {
  if (isStandalone()) return '';
  return `<div class="install">
    <img src="icons/icon-192.png" alt="">
    <div class="grow"><b>Pasang di layar HP</b><div class="muted">${installEvt ? 'Buka seperti aplikasi, tetap jalan tanpa internet.' : 'Di Chrome: menu &#8942; &rarr; <b>Tambahkan ke layar utama</b> / <b>Instal aplikasi</b>.'}</div></div>
    ${installEvt ? `<button class="btn sm" id="install">${ic('download', 18)} Pasang</button>` : ''}
  </div>`;
}
function bindInstall() {
  const b = $('#install');
  if (b) b.onclick = async () => { installEvt.prompt(); await installEvt.userChoice; installEvt = null; render(); };
}

const EYEBROW = { Rekap: 'Penjualan dari pesanan tercatat', Pesanan: 'Semua pesanan', Katalog: 'Produk di toko online', 'Pesanan baru': 'Buat label', Cetak: 'Stiker · 7 × 5 cm', Pelanggan: 'Tersimpan di HP', Pengaturan: 'Toko & printer' };

function frame(title, body, { back = false, nav = 'pesanan', hero = false } = {}) {
  app.innerHTML = `<header class="top">
    ${back ? `<a class="hbtn" href="#/" aria-label="Kembali">${ic('back', 22)}</a>` : '<span class="hbtn"></span>'}
    <img class="brand" src="${esc(shop.logo || DEFAULT_LOGOS.full)}" alt="${esc(shop.name)}">
    <a class="hbtn" href="#/pengaturan" aria-label="Pengaturan">${ic('gear', 22)}</a>
  </header>
  <main>${hero ? '' : `<p class="eyebrow">${esc(EYEBROW[title] || '')}</p><h1 class="display">${esc(title)}</h1>`}${body}</main>
  <nav class="bottom">
    ${[['home', '', 'home', 'Beranda'], ['pesanan', 'pesanan', 'list', 'Pesanan'], ['baru', 'baru', 'plus', 'Baru'], ['rekap', 'rekap', 'chart', 'Rekap'], ['produk', 'produk', 'bag', 'Katalog']]
      .map(([k, h, i, l]) => k === 'baru'
        ? `<a href="#/baru" class="fab ${nav === k ? 'on' : ''}" aria-label="Pesanan baru"><span class="fab-in">${ic(i, 26)}</span></a>`
        : `<a href="#/${h}" class="${nav === k ? 'on' : ''}">${ic(i, 20)}<span>${l}</span></a>`).join('')}
  </nav>`;
  bindInstall();
}

// Backup sekali tekan: unduh file JSON berisi semua data.
async function doBackup() {
  await saveShop({ lastBackup: new Date().toISOString() });
  const blob = new Blob([JSON.stringify(await db.exportAll(), null, 1)], { type: 'application/json' });
  downloadBlob(blob, `kafiya-backup-${new Date().toISOString().slice(0, 10)}.json`);
  toast('Backup diunduh. Simpan file-nya di tempat aman.');
}

// Uang COD yang belum masuk, dari semua pesanan COD yang belum ditandai lunas.
function unpaidHTML(orders) {
  const due = orders.filter((o) => o.cod && !o.paid);
  if (!due.length) return '';
  return `<div class="recap row spread"><div><b class="due">${rupiah(due.reduce((a, o) => a + o.cod, 0))}</b><div class="muted">COD belum dibayar · ${due.length} pesanan</div></div><button class="btn ghost sm">Lihat</button></div>`;
}

// Rekap 7 hari terakhir: batang per hari, ditumpuk Wahana/ekspedisi dan Shopee.
function recapHTML(orders) {
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(Date.now() - (6 - i) * 864e5); return { k: dayKey(d), d, w: 0, s: 0 }; });
  const byKey = new Map(days.map((x) => [x.k, x]));
  for (const o of orders) { const x = byKey.get(dayKey(new Date(o.createdAt))); if (x) x[o.type.startsWith('shopee') ? 's' : 'w']++; }
  const week = orders.filter((o) => o.cod && byKey.has(dayKey(new Date(o.createdAt))));
  const codSum = week.reduce((a, o) => a + o.cod, 0), codN = week.length;
  const max = Math.max(1, ...days.map((x) => x.w + x.s)), tw = days.reduce((a, x) => a + x.w, 0), ts = days.reduce((a, x) => a + x.s, 0);
  return `<div class="recap"><div class="row spread"><b>7 hari terakhir</b><span class="muted">${tw + ts} paket</span></div>
    <div class="bars">${days.map((x) => `<div title="${x.w + x.s} paket"><span>${x.w + x.s || ''}</span>
      <div class="stack" style="height:${Math.round(((x.w + x.s) / max) * 56) + 2}px">${x.w ? `<i class="w" style="flex:${x.w}"></i>` : ''}${x.s ? `<i class="s" style="flex:${x.s}"></i>` : ''}</div>
      <span>${x.d.toLocaleDateString('id-ID', { weekday: 'short' }).slice(0, 3)}</span></div>`).join('')}</div>
    <div class="lg"><span class="lw">Wahana/ekspedisi ${tw}</span><span class="ls">Shopee ${ts}</span></div>
    ${codSum ? `<div class="muted" style="margin-top:8px">COD 7 hari: <b>${rupiah(codSum)}</b> dari ${codN} paket</div>` : ''}</div>`;
}


// ---------- Beranda (dashboard) ----------
const nilai = (o) => Number(o.total) || Number(o.cod) || 0;
async function viewDashboard() {
  const orders = await db.all('orders');
  const now = new Date(), d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const inDays = (o, n) => new Date(o.createdAt).getTime() >= d0 - (n - 1) * 864e5;
  const todo = orders.filter((o) => !o.printed).length;
  const today = orders.filter((o) => inDays(o, 1));
  const week = orders.filter((o) => inDays(o, 7));
  const due = orders.filter((o) => o.cod && !o.paid);
  const hour = now.getHours();
  const hi = hour < 11 ? 'Pagi' : hour < 15 ? 'Siang' : hour < 18 ? 'Sore' : 'Malam';
  frame('Beranda', `<section class="dash-hi">
      <p class="eyebrow">${now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
      <h1 class="display">${hi}, ${esc(shop.name || 'Kafiya Daily')}</h1>
    </section>
    <div class="tiles">
      <a class="tile pink" href="#/cetak"><span>Label belum dicetak</span><b>${todo}</b><em>${todo ? 'Cetak sekarang' : 'Beres semua'} ${ic('chev', 16)}</em></a>
      <a class="tile lime" href="#/pesanan"><span>Pesanan hari ini</span><b>${today.length}</b><em>Lihat pesanan ${ic('chev', 16)}</em></a>
      <div class="tile wide"><span>Nilai pesanan tercatat · 7 hari</span><b>${rupiah(week.reduce((a, o) => a + nilai(o), 0))}</b><em class="muted">${week.length} pesanan</em></div>
      ${due.length ? `<a class="tile lilac wide" href="#/pesanan" id="dueTile"><span>COD belum dibayar</span><b>${rupiah(due.reduce((a, o) => a + o.cod, 0))}</b><em>${due.length} pesanan ${ic('chev', 16)}</em></a>` : ''}
    </div>
    <div id="tokoDash"></div>
    <h2>Menu cepat</h2>
    <div class="quick">
      <a href="#/baru">${ic('plus', 22)}<span>Pesanan baru</span></a>
      <a href="#/cetak">${ic('printer', 22)}<span>Cetak label</span></a>
      <a href="#/produk">${ic('bag', 22)}<span>Katalog</span></a>
      <a href="#/pelanggan">${ic('users', 22)}<span>Pelanggan</span></a>
      <a href="${esc(TOKO_URL)}" target="_blank" rel="noopener">${ic('store', 22)}<span>Lihat toko</span></a>
      <a href="#/pengaturan">${ic('gear', 22)}<span>Pengaturan</span></a>
    </div>
    ${orders.length ? `<h2>Grafik paket</h2>${recapHTML(orders)}` : ''}
    <div class="install-slot">${installCard()}</div>`, { nav: 'home', hero: true });
  $('#dueTile')?.addEventListener('click', () => { listFilter.status = 'unpaid'; });
  tokoDash();
}

// Info dari toko online: pesanan baru yang belum diambil dan stok yang menipis. Diam saja kalau belum login.
async function tokoDash() {
  if (!cloud.configured()) return;
  try {
    if (!await cloud.currentUser()) return;
    const [fresh, list] = await Promise.all([cloud.listNewOrders(), cloud.listProducts({ all: true })]);
    const low = list.filter((p) => p.active && (p.stock || 0) <= 2).sort((a, b) => (a.stock || 0) - (b.stock || 0));
    const box = $('#tokoDash');
    if (!box) return;
    box.innerHTML = `${fresh.length ? `<a class="alertcard" href="#/baru">${ic('bag', 22)}<div class="grow"><b>${fresh.length} pesanan baru dari toko online</b><div class="muted">Ketuk untuk ambil dan buat labelnya.</div></div>${ic('chev', 18)}</a>` : ''}
      ${low.length ? `<h2>Stok menipis</h2><div class="lowlist">${low.slice(0, 5).map((p) => `<a href="#/produk" class="low">${p.thumb ? `<img src="${esc(p.thumb)}" alt="">` : '<span class="ph"></span>'}<span class="grow ell">${esc(p.name)}</span><b class="${p.stock ? '' : 'zero'}">${p.stock ? `sisa ${p.stock}` : 'habis'}</b></a>`).join('')}</div>` : ''}`;
  } catch (e) { console.error(e); }
}

// ---------- Keuangan: uang masuk dan tarik dana ----------
// Uang masuk = COD yang sudah lunas + nilai pesanan non-COD. Tarik dana dicatat di data toko (ikut backup).
const masuk = (o) => (o.cod ? (o.paid ? o.cod : 0) : Number(o.total) || 0);
const PURPOSES = ['Belanja stok', 'Ongkir', 'Kemasan', 'Pribadi', 'Lainnya'];
function tarikDana(after) {
  const today = dayKey(new Date());
  modal(`<h2>Tarik dana</h2>
    <label class="f" for="wn">Nominal</label><input type="text" id="wn" inputmode="numeric" placeholder="Misal 250.000">
    <label class="f">Untuk apa</label><div class="chips" style="margin:0;padding-left:0;padding-right:0">${PURPOSES.map((p, i) => `<button type="button" class="pill ${i ? '' : 'on'}" data-wp="${p}">${p}</button>`).join('')}</div>
    <label class="f" for="wt">Catatan (opsional)</label><input type="text" id="wt" placeholder="Misal: kain 3 roll">
    <label class="f" for="wd">Tanggal</label><input type="date" id="wd" value="${today}" max="${today}" style="width:100%;min-height:50px;padding:10px 14px;border:2px solid var(--edge);border-radius:12px;background:var(--card)">
    <button class="btn block" id="wsave">Simpan</button><button class="btn ghost block" id="wcancel">Batal</button>`, (o, close) => {
    let purpose = PURPOSES[0];
    $$('[data-wp]', o).forEach((b) => b.onclick = () => { purpose = b.dataset.wp; $$('[data-wp]', o).forEach((x) => x.classList.toggle('on', x === b)); });
    $('#wcancel', o).onclick = close;
    $('#wsave', o).onclick = async () => {
      const amount = toCod($('#wn', o).value);
      if (!amount) { toast('Isi nominal dana yang ditarik.'); $('#wn', o).focus(); return; }
      const w = { id: Date.now(), amount, purpose, note: $('#wt', o).value.trim(), date: $('#wd', o).value || today };
      await saveShop({ withdrawals: [...(shop.withdrawals || []), w] });
      close(); toast(`Tarik dana ${rupiah(amount)} untuk ${purpose.toLowerCase()} dicatat.`); after();
    };
  });
}
function financeHTML(all, from) {
  const ws = shop.withdrawals || [];
  const inAll = all.reduce((a, o) => a + masuk(o), 0), outAll = ws.reduce((a, w) => a + w.amount, 0);
  const inP = all.filter((o) => new Date(o.createdAt).getTime() >= from).reduce((a, o) => a + masuk(o), 0);
  const wsP = ws.filter((w) => new Date(`${w.date}T00:00`).getTime() >= from).sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  const outP = wsP.reduce((a, w) => a + w.amount, 0);
  const byP = new Map(); for (const w of wsP) byP.set(w.purpose, (byP.get(w.purpose) || 0) + w.amount);
  return `<div class="tile wide money"><span>Saldo tercatat</span><b>${rupiah(inAll - outAll)}</b><em class="muted">Uang masuk ${rupiah(inAll)} − ditarik ${rupiah(outAll)} (sepanjang waktu)</em>
      <button class="btn block" id="tarik" style="margin-top:12px">${ic('download', 18)} Tarik dana</button></div>
    <div class="tiles" style="margin-top:12px">
      <div class="tile lime"><span>Masuk</span><b class="sm">${rupiah(inP)}</b><em>periode ini</em></div>
      <div class="tile pink"><span>Ditarik</span><b class="sm">${rupiah(outP)}</b><em>${wsP.length} kali</em></div>
    </div>
    ${byP.size ? `<div class="recap" style="margin-top:12px">${[...byP].sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="hbar"><span>${esc(k)}</span><i style="--w:${Math.round((v / outP) * 100)}%"></i><b class="wide">${rupiah(v)}</b></div>`).join('')}</div>` : ''}
    ${wsP.length ? `<div class="wlist">${wsP.map((w) => `<div class="wrow"><div class="grow"><b>${rupiah(w.amount)}</b> · ${esc(w.purpose)}<div class="muted ell">${fmtDay(w.date)}${w.note ? ` · ${esc(w.note)}` : ''}</div></div><button class="icon-btn" data-wdel="${w.id}" aria-label="Hapus catatan ${esc(rupiah(w.amount))}">${ic('trash', 18)}</button></div>`).join('')}</div>`
      : '<p class="muted" style="margin:10px 2px 0">Belum ada tarik dana di periode ini.</p>'}
    <p class="muted" style="margin:8px 2px 0">Uang masuk dihitung dari COD yang sudah lunas dan nilai pesanan toko online. Pesanan Shopee tidak punya nilai, jadi tidak ikut.</p>`;
}

// ---------- Rekap penjualan ----------
// Semua angka dari pesanan yang tersimpan di HP ini. Nilai = total pesanan toko, atau nominal COD.
let rekapRange = 30;
async function viewRekap() {
  const all = await db.all('orders');
  const now = new Date(), d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const from = d0 - (rekapRange - 1) * 864e5;
  const os = all.filter((o) => new Date(o.createdAt).getTime() >= from);
  const sum = (xs) => xs.reduce((a, o) => a + nilai(o), 0);
  const cod = os.filter((o) => o.cod), paid = cod.filter((o) => o.paid);
  const unknown = os.filter((o) => !nilai(o)).length;
  // per minggu (8 minggu) untuk grafik
  const weeks = Array.from({ length: 8 }, (_, i) => { const end = d0 + 864e5 - (7 - i) * 7 * 864e5; return { start: end - 7 * 864e5, end, n: 0, v: 0 }; });
  for (const o of all) { const t = new Date(o.createdAt).getTime(); const w = weeks.find((x) => t >= x.start && t < x.end); if (w) { w.n++; w.v += nilai(o); } }
  const maxN = Math.max(1, ...weeks.map((w) => w.n));
  // ekspedisi
  const by = new Map();
  for (const o of os) { const k = o.type?.startsWith('shopee') ? 'Shopee' : o.courier || 'Wahana'; by.set(k, (by.get(k) || 0) + 1); }
  const couriers = [...by].sort((a, b) => b[1] - a[1]);
  // produk terlaris (hanya pesanan dari toko online yang menyimpan rincian barang)
  const prod = new Map();
  for (const o of os) for (const it of o.items || []) { const x = prod.get(it.name) || { n: 0, v: 0 }; x.n += Number(it.qty) || 0; x.v += (Number(it.qty) || 0) * (Number(it.price) || 0); prod.set(it.name, x); }
  const best = [...prod].sort((a, b) => b[1].n - a[1].n).slice(0, 5);
  frame('Rekap', `<div class="chips" style="margin-top:-8px">${[[7, '7 hari'], [30, '30 hari'], [90, '90 hari']].map(([v, l]) => `<button class="pill ${v === rekapRange ? 'on' : ''}" data-rr="${v}">${l}</button>`).join('')}</div>
    <h2>Keuangan</h2>${financeHTML(all, from)}
    <h2>Penjualan</h2>
    <div class="tiles">
      <div class="tile pink"><span>Pesanan</span><b>${os.length}</b><em>${rekapRange} hari terakhir</em></div>
      <div class="tile lime"><span>Rata-rata / hari</span><b>${(os.length / rekapRange).toLocaleString('id-ID', { maximumFractionDigits: 1 })}</b><em>pesanan</em></div>
      <div class="tile wide"><span>Nilai pesanan tercatat</span><b>${rupiah(sum(os))}</b><em class="muted">${unknown ? `${unknown} pesanan tanpa nilai (Shopee atau transfer lama) tidak ikut dihitung` : 'Semua pesanan punya nilai'}</em></div>
      ${cod.length ? `<div class="tile lilac wide"><span>COD</span><b>${rupiah(sum(paid))} <small>lunas</small></b><em>${rupiah(sum(cod) - sum(paid))} belum dibayar · ${cod.length - paid.length} pesanan</em></div>` : ''}
    </div>
    <h2>Pesanan per minggu</h2>
    <div class="recap"><div class="wbars">${weeks.map((w) => `<div><span>${w.n || ''}</span><i style="height:${Math.round((w.n / maxN) * 100)}%"></i><small>${new Date(w.start).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}</small></div>`).join('')}</div>
      <p class="muted" style="margin:8px 0 0">8 minggu terakhir, tanggal = awal minggu.</p></div>
    <h2>Ekspedisi</h2>
    ${couriers.length ? `<div class="recap">${couriers.map(([k, n]) => `<div class="hbar"><span>${esc(k)}</span><i style="--w:${Math.round((n / os.length) * 100)}%"></i><b>${n}</b></div>`).join('')}</div>` : '<div class="empty"><p>Belum ada pesanan di periode ini.</p></div>'}
    <h2>Produk terlaris</h2>
    ${best.length ? `<div class="recap">${best.map(([name, x], i) => `<div class="best"><b class="rk">${i + 1}</b><span class="grow ell">${esc(name)}</span><span class="muted">${x.n} pcs · ${rupiah(x.v)}</span></div>`).join('')}</div>`
      : '<div class="empty"><p>Belum ada data. Produk terlaris dihitung dari pesanan toko online yang diambil lewat Pesanan baru.</p></div>'}`, { nav: 'rekap' });
  $$('[data-rr]').forEach((b) => b.onclick = () => { rekapRange = Number(b.dataset.rr); viewRekap(); });
  $('#tarik').onclick = () => tarikDana(viewRekap);
  $$('[data-wdel]').forEach((b) => b.onclick = async () => {
    const w = (shop.withdrawals || []).find((x) => x.id === Number(b.dataset.wdel));
    if (!await ask('Hapus catatan tarik dana?', `${rupiah(w.amount)} untuk ${w.purpose.toLowerCase()} akan dihapus dari catatan.`, { ok: 'Hapus', danger: true })) return;
    await saveShop({ withdrawals: shop.withdrawals.filter((x) => x !== w) }); toast('Catatan dihapus.'); viewRekap();
  });
}

// ---------- Pesanan ----------
async function viewPesanan() {
  const orders = (await db.all('orders')).sort((a, b) => b.id - a.id);
  const days = shop.lastBackup ? (Date.now() - new Date(shop.lastBackup)) / 864e5 : Infinity;
  const remind = orders.length && days > BACKUP_DAYS
    ? `<div class="banner row spread"><span>${shop.lastBackup ? `Backup terakhir ${Math.floor(days)} hari lalu.` : 'Data belum pernah di-backup.'}</span><button class="btn sm" id="bknow">${ic('download', 16)} Backup</button></div>` : '';
  const todo = orders.filter((o) => !o.printed).length;
  const today = orders.filter((o) => new Date(o.createdAt).toDateString() === new Date().toDateString()).length;
  frame('Pesanan', `<section class="hero">
      <p class="eyebrow light">${new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' })} · Teman Outfit Harianmu</p>
      ${todo ? `<div class="hero-focus"><b>${todo}</b><h1 class="display" style="margin:6px 0 14px">label belum dicetak</h1></div>
      <div class="row"><a class="btn sand grow" href="#/cetak">${ic('printer', 18)} Cetak sekarang</a><a class="btn ghost" href="#/baru">${ic('plus', 18)} Baru</a></div>`
      : `<h1 class="display" style="margin:6px 0 14px">Semua label sudah dicetak.</h1>
      <a class="btn sand" href="#/baru">${ic('plus', 18)} Pesanan baru</a>`}
    </section>
    <div class="stats">
      <div><b>${orders.length - todo}</b><span>Sudah dicetak</span></div>
      <div><b>${today}</b><span>Hari ini</span></div>
      <div><b>${orders.length}</b><span>Total pesanan</span></div>
    </div>
    ${remind}
    <div id="unpaid">${unpaidHTML(orders)}</div>
    ${orders.length ? recapHTML(orders) : ''}
    <h2>Riwayat pesanan</h2>
    ${orders.length ? `<div class="filters">
      <label class="search">${ic('search', 18)}<input type="search" id="fq" placeholder="Cari nama, resi, alamat…" value="${esc(listFilter.q)}"></label>
      <div class="chips">${[['all', 'Semua'], ['today', 'Hari ini'], ['yday', 'Kemarin'], ['week', '7 hari'], ['day', listFilter.day ? fmtDay(listFilter.day) : 'Pilih tanggal']].map(([v, l]) => `<button class="pill ${listFilter.date === v ? 'on' : ''}" data-fd="${v}">${v === 'day' ? ic('calendar', 14) : ''}${esc(l)}</button>`).join('')}
        <input type="date" id="fday" value="${esc(listFilter.day)}" tabindex="-1" aria-hidden="true"></div>
      <div class="chips">${[['all', 'Semua status'], ['todo', 'Belum dicetak'], ['ship', 'Belum dikirim'], ['sent', 'Dikirim'], ['unpaid', 'COD belum bayar']].map(([v, l]) => `<button class="pill ${listFilter.status === v ? 'on' : ''}" data-fs="${v}">${l}</button>`).join('')}</div>
    </div>
    <div class="row spread" style="margin:10px 2px"><span class="muted" id="fcount"></span><span class="row" style="gap:6px"><button class="btn danger sm" id="delall">${ic('trash', 16)} Hapus semua</button><button class="btn ghost sm" id="selt">${sel.on ? 'Selesai' : 'Pilih'}</button></span></div>
    <div id="olist"></div>` : `<div class="empty">${ic('printer', 40)}<p>Belum ada pesanan.<br>Tekan “Pesanan baru” untuk mulai.</p></div>`}`, { hero: true });
  $('#bknow')?.addEventListener('click', async () => { await doBackup(); viewPesanan(); });
  // Kartu "COD belum dibayar": tombol Lihat menyaring riwayat ke COD yang belum lunas.
  const refreshUnpaid = () => {
    $('#unpaid').innerHTML = unpaidHTML(orders);
    $('#unpaid button')?.addEventListener('click', () => {
      listFilter.status = 'unpaid'; $$('[data-fs]').forEach((x) => x.classList.toggle('on', x.dataset.fs === 'unpaid')); draw();
      $('#olist').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };
  refreshUnpaid();
  if (!orders.length) return;
  const row = (o) => `<div class="item ${sel.on ? 'selmode' : ''}">${sel.on ? `<input type="checkbox" class="sel" data-sel="${o.id}" ${sel.ids.has(o.id) ? 'checked' : ''} aria-label="Pilih">` : ''}
      <span class="avatar ${o.type.startsWith('shopee') ? 'shopee' : o.type}">${o.type.startsWith('shopee') ? 'S' : esc((o.courier || 'W')[0])}</span>
      <a href="#/cetak?ids=${o.id}" class="grow" style="text-decoration:none;color:inherit;min-width:0">
        <div class="t ell">${resiText(o)}</div>
        <div class="muted ell">${metaText(o)} · ${fmtDate(o.createdAt)}</div>
      </a>
      ${orderBtns(o)}
      <div class="item-chips"><span class="chip st-${stage(o)}">${STAGE[stage(o)]}</span>${o.printed && !o.shipped ? `<button class="chip ship" data-ship="${o.id}">${ic('truck', 14)} Tandai dikirim</button>` : ''}${o.cod ? `<button class="chip cod ${o.paid ? 'paid' : ''}" data-pay="${o.id}" aria-label="Ubah status bayar COD ${esc(rupiah(o.cod))}">${o.paid ? 'COD lunas' : 'COD belum bayar'}</button>` : ''}</div>
    </div>`;
  // Saring tanpa render ulang seluruh halaman supaya kolom cari tetap fokus.
  const draw = () => {
    const list = filterOrders(orders, listFilter);
    $('#fcount').textContent = list.length === orders.length ? `${orders.length} pesanan` : `${list.length} dari ${orders.length} pesanan`;
    $('#olist').innerHTML = list.length ? list.map(row).join('') : '<div class="empty"><p>Tidak ada pesanan yang cocok.</p></div>';
    bindOrderBtns(list, viewPesanan);
    $$('[data-ship]').forEach((b) => b.onclick = async () => {
      const o = orders.find((x) => x.id === Number(b.dataset.ship));
      o.shipped = true; await db.put('orders', o);
      toast(`${o.name || o.resi || 'Pesanan'} ditandai dikirim.`); draw();
    });
    $$('[data-pay]').forEach((b) => b.onclick = async () => {
      const o = orders.find((x) => x.id === Number(b.dataset.pay));
      o.paid = !o.paid; await db.put('orders', o);
      toast(o.paid ? `COD ${rupiah(o.cod)} dari ${o.name} ditandai lunas.` : `${o.name}: COD kembali belum dibayar.`);
      draw(); refreshUnpaid();
    });
    $$('[data-sel]').forEach((c) => c.onchange = () => { const id = Number(c.dataset.sel); c.checked ? sel.ids.add(id) : sel.ids.delete(id); bar(); });
    bar();
  };
  // Mode pilih banyak: centang beberapa pesanan lalu cetak / tandai / hapus sekaligus.
  const bar = () => {
    document.querySelector('.selbar')?.remove();
    if (!sel.on) return;
    const el = document.createElement('div'); el.className = 'selbar';
    el.innerHTML = `<b>${sel.ids.size} dipilih</b><button class="btn" data-act="all">Semua</button><button class="btn" data-act="print" ${sel.ids.size ? '' : 'disabled'}>Cetak</button><button class="btn" data-act="done" ${sel.ids.size ? '' : 'disabled'}>Tandai</button><button class="btn red" data-act="del" ${sel.ids.size ? '' : 'disabled'} aria-label="Hapus">${ic('trash', 16)}</button>`;
    app.append(el);
    el.onclick = async (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      const chosen = orders.filter((o) => sel.ids.has(o.id));
      if (act === 'all') { filterOrders(orders, listFilter).forEach((o) => sel.ids.add(o.id)); draw(); }
      if (act === 'print') { const ids = chosen.map((o) => o.id); sel.on = false; sel.ids.clear(); location.hash = `#/cetak?ids=${ids.join(',')}`; }
      if (act === 'done') { for (const o of chosen) await db.put('orders', { ...o, printed: true }); toast(`${chosen.length} ditandai tercetak.`); sel.ids.clear(); viewPesanan(); }
      if (act === 'del' && await ask(`Hapus ${chosen.length} pesanan?`, 'Tidak bisa dibatalkan.', { ok: 'Hapus', danger: true })) {
        for (const o of chosen) await db.del('orders', o.id);
        toast(`${chosen.length} pesanan dihapus.`); sel.ids.clear(); sel.on = false; viewPesanan();
      }
    };
  };
  $('#delall').onclick = async () => {
    const list = filterOrders(orders, listFilter), every = list.length === orders.length;
    if (!await ask(every ? `Hapus semua ${orders.length} pesanan?` : `Hapus ${list.length} pesanan yang tampil?`, `${every ? 'Seluruh riwayat pesanan' : 'Pesanan sesuai filter sekarang'} dihapus permanen. Pelanggan tersimpan tidak ikut terhapus. Backup dulu kalau masih perlu.`, { ok: 'Hapus', danger: true })) return;
    for (const o of list) await db.del('orders', o.id);
    toast(`${list.length} pesanan dihapus.`); viewPesanan();
  };
  $('#selt').onclick = () => { sel.on = !sel.on; sel.ids.clear(); $('#selt').textContent = sel.on ? 'Selesai' : 'Pilih'; draw(); };
  $('#fq').oninput = (e) => { listFilter.q = e.target.value; draw(); };
  const pick = (attr, key) => $$(`[data-${attr}]`).forEach((b) => b.onclick = () => {
    if (attr === 'fd' && b.dataset.fd === 'day') { const d = $('#fday'); try { d.showPicker(); } catch { d.focus(); d.click(); } return; }
    listFilter[key] = b.dataset[attr];
    $$(`[data-${attr}]`).forEach((x) => x.classList.toggle('on', x === b)); draw();
  });
  pick('fd', 'date'); pick('fs', 'status');
  $('#fday').onchange = (e) => {
    listFilter.day = e.target.value; listFilter.date = e.target.value ? 'day' : 'all';
    $$('[data-fd]').forEach((x) => x.classList.toggle('on', x.dataset.fd === listFilter.date));
    const b = $('[data-fd="day"]'); b.innerHTML = `${ic('calendar', 14)}${esc(listFilter.day ? fmtDay(listFilter.day) : 'Pilih tanggal')}`; draw();
  };
  draw();
}

// Tahap pesanan: Baru (belum dicetak) → Dicetak → Dikirim → Lunas (khusus COD).
const STAGE = { new: 'Baru', printed: 'Dicetak', shipped: 'Dikirim', paid: 'Selesai' };
const stage = (o) => (o.cod && o.paid && o.shipped ? 'paid' : o.shipped ? 'shipped' : o.printed ? 'printed' : 'new');
const fmtDay = (k) => new Date(`${k}T00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
const sel = { on: false, ids: new Set() };
const listFilter = { q: '', date: 'all', day: '', status: 'all' };
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function filterOrders(orders, f) {
  const now = new Date(), today = dayKey(now), yday = dayKey(new Date(now - 864e5)), weekAgo = now - 7 * 864e5;
  const q = f.q.trim().toLowerCase();
  return orders.filter((o) => {
    const t = new Date(o.createdAt), k = dayKey(t);
    if (f.date === 'today' && k !== today) return false;
    if (f.date === 'yday' && k !== yday) return false;
    if (f.date === 'week' && t < weekAgo) return false;
    if (f.date === 'day' && f.day && k !== f.day) return false;
    if (f.status === 'todo' && o.printed) return false;
    if (f.status === 'done' && !o.printed) return false;
    if (f.status === 'ship' && !(o.printed && !o.shipped)) return false;
    if (f.status === 'sent' && !o.shipped) return false;
    if (f.status === 'unpaid' && !(o.cod && !o.paid)) return false;
    return !q || [o.resi, o.name, o.phone, o.address, o.courier].some((v) => String(v || '').toLowerCase().includes(q));
  });
}

// ---------- Pesanan baru ----------
// Satu halaman untuk semua: upload screenshot/PDF (dideteksi otomatis Shopee atau chat WA), atau isi manual.
// Hasilnya masuk daftar `draft.items` yang bisa diedit sebelum disimpan.
async function viewBaru() {
  const customers = (await db.all('customers')).sort((a, b) => a.name.localeCompare(b.name));
  const d = draft, items = d.items;
  const dupe = dupeChecker(await db.all('orders'), items);
  const courierSel = (i, val) => `<select data-i="${i}" data-k="courier">${COURIERS.filter((c) => c !== 'Lainnya').concat(val && !COURIERS.includes(val) ? [val] : []).map((c) => `<option ${val === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>`;
  const card = (it, i) => it.kind === 'shopee'
    ? `<div class="card item-card"><div class="row spread"><span class="chip">Shopee · label asli</span><button class="icon-btn" data-rm="${i}" aria-label="Buang">${ic('trash', 18)}</button></div>
        <img class="sp-thumb" src="${it.img}" alt="">
        <label class="f">No. resi</label><input type="text" data-i="${i}" data-k="resi" value="${esc(it.resi)}" placeholder="Tidak terbaca, isi manual" autocapitalize="characters">
        <div class="muted" style="margin-top:4px">Di kertas: 7 × ${cm(it.h)} cm</div>${dupe(it, i)}</div>`
    : `<div class="card item-card"><div class="row spread"><span class="chip">Pesanan ${i + 1} · ${it.web ? 'toko online' : 'chat'}</span><button class="icon-btn" data-rm="${i}" aria-label="Buang">${ic('trash', 18)}</button></div>
        ${it.web ? `<div class="muted" style="margin-top:6px">Dari toko: ${esc(it.web.items.map((x) => `${x.name}${x.size ? ` (${x.size})` : ''} x${x.qty}`).join(', '))} · ${esc(rupiah(it.web.total))}${it.web.note ? ` · Catatan: ${esc(it.web.note)}` : ''}</div>` : ''}
        <label class="f">Nama penerima</label><input type="text" data-i="${i}" data-k="name" value="${esc(it.name)}">
        <label class="f">No. HP</label><input type="tel" data-i="${i}" data-k="phone" value="${esc(it.phone)}" placeholder="Tidak ada di chat, isi kalau perlu">
        <label class="f">Alamat</label><textarea data-i="${i}" data-k="address" style="min-height:80px">${esc(it.address)}</textarea>
        <label class="f">Ekspedisi</label>${courierSel(i, it.courier)}
        <label class="f">COD (kosongkan kalau bukan COD)</label><input type="text" data-i="${i}" data-k="cod" inputmode="numeric" value="${it.cod ? esc(Number(it.cod).toLocaleString('id-ID')) : ''}" placeholder="Contoh: 150.000">${dupe(it, i)}</div>`;

  frame('Pesanan baru', `
    <div class="row"><button class="btn big grow" id="up">${ic('camera', 20)} Upload screenshot</button><button class="btn ghost big" id="pdf">${ic('file', 18)} PDF</button></div>
    <input type="file" id="upf" accept="image/*" multiple hidden>
    <input type="file" id="pdff" accept="application/pdf,.pdf" multiple hidden>
    <div id="tokobox"></div>
    <p class="muted" style="margin-top:8px">Bisa banyak sekaligus: <b>screenshot chat WhatsApp</b> jadi label Wahana, <b>screenshot atau PDF label Shopee</b> jadi label Shopee. PDF diambil dari folder file (misal Download), dan satu halaman berisi beberapa label juga bisa.</p>
    ${items.length ? `<div class="row spread" style="margin-top:20px"><h2 style="margin:0;border:0;flex:1">${items.length} pesanan siap</h2><button class="btn danger sm" id="reset">${ic('trash', 16)} Kosongkan semua</button></div>
    ${items.map(card).join('')}
    <div class="row" style="margin-top:12px"><button class="btn ghost grow" id="more">${ic('camera', 18)} Tambah screenshot</button><button class="btn ghost grow" id="morepdf">${ic('file', 18)} Tambah PDF</button></div>` : ''}
    <details class="manual" ${d.manualOpen ? 'open' : ''}><summary>${ic('plus', 18)} Tambah manual / tempel teks chat</summary>
      ${customers.length ? `<label class="f" for="cust">Pelanggan tersimpan</label>
        <select id="cust"><option value="">Pilih pelanggan</option>${customers.map((c) => `<option value="${c.id}">${esc(c.name)} · ${esc(c.phone)}</option>`).join('')}</select>` : ''}
      <label class="f" for="chat">Tempel teks chat</label>
      <textarea id="chat" placeholder="Nama, HP, dan alamat dari chat pembeli…">${esc(d.chat)}</textarea>
      <button class="btn alt block" id="tidy" style="margin-top:8px">Rapikan</button>
      <label class="f" for="name">Nama penerima</label><input type="text" id="name" value="${esc(d.name)}" autocomplete="off">
      <label class="f" for="phone">No. HP</label><input type="tel" id="phone" value="${esc(d.phone)}" inputmode="tel">
      <label class="f" for="address">Alamat</label><textarea id="address">${esc(d.address)}</textarea>
      <label class="f" for="courier">Ekspedisi</label>
      <select id="courier">${COURIERS.map((c) => `<option ${d.courier === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
      <input type="text" id="other" placeholder="Nama ekspedisi" value="${esc(d.other)}" style="margin-top:8px;${d.courier === 'Lainnya' ? '' : 'display:none'}">
      <label class="f" for="mcod">COD (kosongkan kalau bukan COD)</label><input type="text" id="mcod" inputmode="numeric" placeholder="Contoh: 150.000">
      <button class="btn ghost block" id="addm">${ic('plus', 18)} Tambahkan ke daftar</button>
    </details>
    ${items.length ? `<div class="row" style="margin-top:12px"><input type="checkbox" id="save" ${d.save ? 'checked' : ''}><label for="save">Simpan pelanggan (chat) untuk dipakai lagi</label></div>
    <button class="btn block big" id="go">${ic('printer', 20)} Simpan & cetak ${items.length} label</button>` : ''}`, { back: true, nav: 'baru' });

  // daftar hasil
  $$('[data-i][data-k]').forEach((el) => {
    el.oninput = el.onchange = () => { const k = el.dataset.k; items[el.dataset.i][k] = k === 'resi' ? el.value.replace(/\s+/g, '').toUpperCase() : k === 'cod' ? toCod(el.value) : el.value; };
  });
  $$('[data-rm]').forEach((b) => b.onclick = () => { items.splice(Number(b.dataset.rm), 1); viewBaru(); });
  $('#save')?.addEventListener('change', (e) => { d.save = e.target.checked; });
  $('#go')?.addEventListener('click', saveItems);

  // upload otomatis
  $('#up').onclick = () => $('#upf').click();
  $('#more')?.addEventListener('click', () => $('#upf').click());
  $('#pdf').onclick = () => $('#pdff').click();
  $('#morepdf')?.addEventListener('click', () => $('#pdff').click());
  $('#pdff').onchange = (e) => { const files = [...e.target.files]; e.target.value = ''; handleFiles(files); };
  // Tombol + di menu bawah: di halaman ini langsung menambah file ke daftar.
  $('nav .fab').onclick = (e) => { e.preventDefault(); $('#upf').click(); };
  $('#reset')?.addEventListener('click', async () => {
    if (!await ask('Kosongkan semua?', `${items.length} pesanan di daftar ini (belum disimpan) akan dibuang.`, { ok: 'Kosongkan', danger: true })) return;
    items.length = 0; viewBaru(); toast('Daftar dikosongkan.');
  });
  $('#upf').onchange = (e) => { const files = [...e.target.files]; e.target.value = ''; handleFiles(files); };
  bindManual(d, customers);
  tokoOrders();
  // File yang dibagikan dari aplikasi lain (Bagikan → Kafiya) disimpan service worker di cache.
  if (location.hash.includes('shared=1')) {
    history.replaceState(null, '', '#/baru');
    takeShared().then((files) => files.length && handleFiles(files));
  }
}

async function takeShared() {
  if (!('caches' in window)) return [];
  const c = await caches.open('kafiya-share'), keys = await c.keys(), files = [];
  for (const k of keys) {
    const r = await c.match(k);
    files.push(new File([await r.blob()], decodeURIComponent(r.headers.get('x-name') || 'file'), { type: r.headers.get('content-type') || '' }));
    await c.delete(k);
  }
  return files;
}

async function handleFiles(files) {
  if (!files.length) return;
  const items = draft.items;
  const prog = progress(files.length);
  {
    let n = 0, fail = 0;
    for (const [i, f] of files.entries()) {
      prog.file(i, f);
      try {
        const got = await readAny(f, (m) => prog.step(m));
        got.forEach((it) => { if (it.kind === 'wahana') it.courier = 'Wahana'; });
        items.push(...got); n += got.length;
      } catch (err) { fail++; console.error(err); }
    }
    prog.close();
    toast(fail ? `${n} terbaca, ${fail} file gagal dibaca.` : `${n} pesanan terbaca. Cek dulu ya.`, fail ? 'warn' : 'ok');
    viewBaru();
  }
}

// Isi manual / tempel teks chat, lalu tambahkan ke daftar.
function bindManual(d, customers) {
  const bind = (id, key) => { const el = $('#' + id); if (el) el.oninput = () => { d[key] = el.value; }; };
  ['chat', 'name', 'phone', 'address', 'other'].forEach((k) => bind(k, k));
  $('.manual').ontoggle = (e) => { d.manualOpen = e.target.open; };
  $('#courier').onchange = (e) => { d.courier = e.target.value; $('#other').style.display = d.courier === 'Lainnya' ? '' : 'none'; };
  $('#cust')?.addEventListener('change', (e) => {
    const c = customers.find((x) => x.id === Number(e.target.value));
    if (!c) return;
    Object.assign(d, { name: c.name, phone: c.phone, address: c.address });
    ['name', 'phone', 'address'].forEach((k) => { $('#' + k).value = d[k]; });
  });
  $('#tidy').onclick = () => {
    const r = parseChat(d.chat);
    if (!r.name && !r.phone && !r.address) return toast('Tidak ada yang bisa dirapikan.');
    Object.assign(d, r);
    ['name', 'phone', 'address'].forEach((k) => { $('#' + k).value = d[k]; });
    if (r.cod) $('#mcod').value = r.cod.toLocaleString('id-ID');
    toast(r.cod ? `Sudah dirapikan. COD ${rupiah(r.cod)} terbaca, periksa dulu ya.` : 'Sudah dirapikan. Periksa dulu ya.');
  };
  $('#addm').onclick = () => {
    if (!d.name.trim() || !d.address.trim()) return toast('Nama dan alamat wajib diisi.');
    const courier = d.courier === 'Lainnya' ? d.other.trim() || 'Lainnya' : d.courier;
    d.items.push({ kind: 'wahana', name: d.name.trim(), phone: d.phone.trim(), address: d.address.trim(), courier, cod: toCod($('#mcod').value) || d.cod || 0 });
    Object.assign(d, { chat: '', name: '', phone: '', address: '', manualOpen: false });
    toast('Ditambahkan ke daftar.'); viewBaru();
  };
}

// Jendela proses baca file: gambar kecil, "File 3 dari 7", langkah, dan bilah kemajuan.
function progress(total) {
  const o = document.createElement('div');
  o.className = 'overlay center';
  o.innerHTML = `<div class="dialog prog" role="status" aria-live="polite">
    <div class="prog-thumb"><img alt=""><span class="spin"></span></div>
    <h3 id="pt">Membaca file…</h3><p id="ps">Menyiapkan…</p>
    <div class="bar"><i id="pb"></i></div><div class="muted" id="pc"></div></div>`;
  document.body.append(o);
  let idx = 0, url;
  const pct = (sub) => { o.querySelector('#pb').style.width = `${Math.round(((idx + sub) / total) * 100)}%`; };
  return {
    file(i, f) {
      idx = i; pct(0);
      o.querySelector('#pt').textContent = total > 1 ? `File ${i + 1} dari ${total}` : 'Membaca file';
      o.querySelector('#pc').textContent = f.name;
      const img = o.querySelector('img');
      if (url) URL.revokeObjectURL(url);
      if (f.type.startsWith('image/')) { url = URL.createObjectURL(f); img.src = url; img.hidden = false; } else img.hidden = true;
    },
    step(msg) {
      const m = /(\d+)%/.exec(msg);
      o.querySelector('#ps').textContent = msg.replace(/\s*\d+%/, '');
      pct(m ? 0.2 + 0.8 * (Number(m[1]) / 100) : 0.1);
    },
    close() { if (url) URL.revokeObjectURL(url); o.remove(); },
  };
}

// Tandai pesanan yang mirip/dobel: resi Shopee sama, atau nama + alamat sama (riwayat maupun dalam daftar).
function dupeChecker(existing, items) {
  const keyOf = (x) => (x.kind === 'shopee' || x.type?.startsWith('shopee') ? `r:${(x.resi || '').toUpperCase()}` : `w:${(x.name || '').trim().toLowerCase()}|${(x.address || '').trim().toLowerCase()}`);
  const seen = new Map(existing.filter((o) => o.resi || o.name).map((o) => [keyOf(o), o]));
  const fn = (it, i) => {
    const k = keyOf(it);
    if (k === 'r:' || k === 'w:|') return '';
    const old = seen.get(k), twin = items.findIndex((x, j) => j < i && keyOf(x) === k);
    if (old) return `<div class="dupe">${ic('printer', 14)} Sudah pernah disimpan ${fmtDate(old.createdAt)}${old.printed ? ' (sudah dicetak)' : ''}</div>`;
    if (twin >= 0) return `<div class="dupe">Sama dengan pesanan ${twin + 1} di daftar ini</div>`;
    return '';
  };
  fn.count = () => items.filter((it, i) => fn(it, i)).length;
  return fn;
}

// Pesanan dari halaman toko (Firestore) yang belum diambil: tampil sebagai tombol di Pesanan baru.
async function tokoOrders() {
  if (!cloud.configured()) return;
  try {
    if (!await cloud.currentUser()) return;
    const taken = new Set(draft.items.filter((it) => it.web).map((it) => it.web.id));
    const fresh = (await cloud.listNewOrders()).filter((o) => !taken.has(o.id));
    const box = $('#tokobox');
    if (!box || !fresh.length) return;
    box.innerHTML = `<button class="btn alt block" id="ambil">${ic('download', 18)} Ambil ${fresh.length} pesanan dari toko online</button>`;
    $('#ambil').onclick = () => {
      for (const o of fresh) draft.items.push({ kind: 'wahana', name: o.name, phone: o.phone, address: o.address + (o.note ? ` (${o.note})` : ''), courier: o.pay === 'cod' ? COD_SELF : 'Wahana', cod: o.pay === 'cod' ? o.total : 0, web: o });
      toast(`${fresh.length} pesanan dari toko masuk daftar. Cek ekspedisi dan ongkirnya ya.`);
      viewBaru();
    };
  } catch (e) { console.error(e); }
}

async function saveItems() {
  const items = draft.items;
  if (!items.length) return toast('Belum ada pesanan.');
  const dn = dupeChecker(await db.all('orders'), items).count();
  if (dn && !await ask(`${dn} pesanan tampak dobel`, 'Pesanan bertanda kuning sudah pernah disimpan atau muncul dua kali. Tetap simpan semuanya?', { ok: 'Tetap simpan' })) return;
  const bad = items.findIndex((it) => (it.kind === 'wahana' ? !it.name?.trim() || !it.address?.trim() : false));
  if (bad >= 0) return toast(`Pesanan ${bad + 1}: nama dan alamat wajib diisi.`);
  const noCod = items.findIndex((it) => it.kind === 'wahana' && it.courier === COD_SELF && !toCod(it.cod));
  if (noCod >= 0) return toast(`Pesanan ${noCod + 1}: isi nominal COD untuk COD antar sendiri.`);
  const ids = [], cs = await db.all('customers'), now = new Date().toISOString();
  for (const it of items) {
    if (it.kind === 'shopee') {
      ids.push(await db.put('orders', { type: 'shopee-img', resi: it.resi || '', img: it.img, h: it.h, createdAt: now, printed: false }));
      continue;
    }
    const name = it.name.trim(), address = it.address.trim(), phone = normalizePhone(it.phone) || (it.phone || '').trim();
    ids.push(await db.put('orders', { type: 'wahana', name, phone, address, courier: it.courier || 'Wahana', cod: toCod(it.cod), total: it.web ? Number(it.web.total) || 0 : 0, items: it.web?.items || undefined, shipped: false, paid: false, resi: '', createdAt: now, printed: false }));
    if (draft.save) {
      const hit = cs.find((c) => (phone && c.phone === phone) || (!phone && c.name === name));
      await db.put('customers', { ...(hit || {}), name, phone, address });
    }
  }
  // Pesanan dari toko: tandai sudah diambil dan kurangi stok produknya.
  for (const it of items.filter((x) => x.web)) await cloud.markImported(it.web).catch((e) => { console.error(e); toast('Pesanan tersimpan, tapi status di toko online gagal diperbarui.', 'warn'); });
  draft.items = [];
  location.hash = `#/cetak?ids=${ids.join(',')}`;
}

// ---------- Cetak ----------
async function viewCetak(qs) {
  const ids = (qs.get('ids') || '').split(',').map(Number).filter(Boolean);
  if (!ids.length) return viewAntrian();
  if (!session || session.key !== ids.join(',')) session = { key: ids.join(','), pending: null };
  const orders = (await Promise.all(ids.map((i) => db.get('orders', i)))).filter(Boolean);
  if (!orders.length) return frame('Cetak', '<div class="empty">Pesanan tidak ditemukan.</div>', { back: true });

  const logos = await logoSet(shop);
  // Semua label sekaligus; jumlah lembar menyesuaikan. Tiap lembar selalu mulai dari atas.
  const pages = session.pending || paginate(orders);
  const pageOf = new Map(pages.flatMap((p, n) => p.orders.map((o) => [o.id, n + 1])));
  const paperName = (PAPERS[shop.paper] || PAPERS.A4).dialog;

  const status = session.pending ? `<div class="card confirm"><b>Sudah tercetak dengan benar?</b>
      <div class="muted">${orders.length} label akan ditandai “Dicetak”.</div>
      <div class="row" style="margin-top:10px"><button class="btn grow" id="confirm">Ya, tandai tercetak</button><button class="btn ghost" id="redo">Belum</button></div></div>` : '';

  frame('Cetak', `${status}
    <div class="sumcard">
      <div><b>${orders.length}</b><span>label</span></div>
      <div><b>${pages.length}</b><span>lembar ${esc(paperName)}</span></div>
    </div>
    <h2>Pratinjau</h2>
    <div class="preview" id="prev">${orders.map((o, i) => `<div class="pv"><span class="pv-cap">Label ${i + 1}${pages.length > 1 ? ` · lembar ${pageOf.get(o.id)}` : ''}</span>${labelHTML(o, shop, logos)}</div>`).join('')}</div>
    <div id="warn"></div>
    ${session.pending ? '' : `<button class="btn block" id="print">${ic('printer', 20)} Cetak ${orders.length} label${pages.length > 1 ? ` (${pages.length} lembar)` : ''}</button>
    <button class="btn ghost block" id="jpg">${ic('download', 18)} Unduh JPG${pages.length > 1 ? ` (${pages.length} file)` : ''}</button>`}
    <p class="muted" style="text-align:center">Pasang ${pages.length > 1 ? `${pages.length} lembar` : 'kertas'} stiker baru. Di dialog cetak pilih <b>${esc(paperName)}</b>, skala 100%, tanpa margin/header.</p>`, { back: true, nav: 'cetak' });

  const warn = $$('#prev .label.wahana, #prev .label.shopee').filter((l) => !fitLabel(l)).length;
  if (warn) $('#warn').innerHTML = '<div class="banner">Alamat/resi sangat panjang dan sudah dikecilkan semampunya. Periksa hasil cetak, atau persingkat alamat.</div>';

  $('#print')?.addEventListener('click', async () => {
    const bad = await printHTML(await sheetsHTML(pages, shop));
    if (bad) toast('Ada label dengan teks sangat panjang. Periksa hasil cetak.');
    session.pending = pages; viewCetak(qs);
  });
  $('#jpg')?.addEventListener('click', async () => {
    const b = $('#jpg'); b.disabled = true;
    const day = new Date().toISOString().slice(0, 10);
    for (const [n, pg] of pages.entries()) {
      b.textContent = `Membuat gambar ${n + 1}/${pages.length}…`;
      downloadBlob(await sheetJPG(pg, shop), `kafiya-label-${day}${pages.length > 1 ? `-lembar${n + 1}` : ''}.jpg`);
    }
    toast(`${pages.length} JPG diunduh. Cetak dengan ukuran asli / 100%.`);
    session.pending = pages; viewCetak(qs);
  });
  $('#redo')?.addEventListener('click', () => { session.pending = null; viewCetak(qs); });
  $('#confirm')?.addEventListener('click', async () => {
    for (const o of orders) await db.put('orders', { ...o, printed: true });
    session.pending = null; toast(`${orders.length} label ditandai tercetak.`);
    location.hash = '#/cetak';
  });
}

// Bagi label ke beberapa lembar; tiap lembar diisi dari atas sampai penuh.
function paginate(orders) {
  const pages = [];
  let rest = orders;
  while (rest.length) {
    const pg = layout(rest, shop);
    if (!pg.orders.length) { pg.orders = [rest[0]]; pg.ys = [0]; } // label lebih tinggi dari kertas: tetap cetak sendiri
    pages.push(pg); rest = rest.slice(pg.orders.length);
  }
  return pages;
}

// ---------- Antrian cetak (tab Cetak) ----------
async function viewAntrian() {
  const todo = (await db.all('orders')).filter((o) => !o.printed).sort((a, b) => a.id - b.id);
  frame('Cetak', `<p class="muted" style="margin-top:-8px">Label yang belum dicetak. Centang yang mau dicetak, lalu tekan tombol di bawah.</p>
    ${todo.length ? `<div class="row spread" style="margin:8px 0"><span class="muted">${todo.length} label menunggu</span><button class="btn ghost sm" id="all">Pilih semua</button></div>
    ${todo.map((o) => `<label class="item" style="cursor:pointer">
      <input type="checkbox" data-q="${o.id}" checked>
      <span class="avatar ${o.type.startsWith('shopee') ? 'shopee' : o.type}">${o.type.startsWith('shopee') ? 'S' : esc((o.courier || 'W')[0])}</span>
      <span class="grow"><span class="t" style="display:block">${resiText(o)}</span><span class="muted ell" style="display:block">${metaText(o)} · ${fmtDate(o.createdAt)}</span></span>
      ${orderBtns(o)}
    </label>`).join('')}
    <button class="btn block" id="go">${ic('printer', 20)} Lanjut ke cetak</button>`
    : `<div class="empty">${ic('printer', 40)}<p>Semua label sudah dicetak.<br>Pesanan baru akan muncul di sini.</p></div>
       <a class="btn ghost block" href="#/baru">${ic('plus', 18)} Pesanan baru</a>`}`, { nav: 'cetak' });
  bindOrderBtns(todo, viewAntrian);
  const boxes = $$('[data-q]');
  const upd = () => { const n = boxes.filter((b) => b.checked).length; const g = $('#go'); if (g) { g.disabled = !n; g.innerHTML = `${ic('printer', 20)} Lanjut cetak ${n} label`; } };
  boxes.forEach((b) => b.onchange = upd); upd();
  $('#all')?.addEventListener('click', () => { const on = !boxes.every((b) => b.checked); boxes.forEach((b) => { b.checked = on; }); upd(); });
  $('#go')?.addEventListener('click', () => { location.hash = `#/cetak?ids=${boxes.filter((b) => b.checked).map((b) => b.dataset.q).join(',')}`; });
}

// ---------- Pelanggan ----------
async function viewPelanggan() {
  const cs = (await db.all('customers')).sort((a, b) => a.name.localeCompare(b.name));
  frame('Pelanggan', cs.length ? cs.map((c) => `<div class="item" data-c="${c.id}" role="button" tabindex="0">
      <div class="grow"><div class="t">${esc(c.name)}</div><div class="muted">${esc(c.phone)} · ${esc(c.address).slice(0, 60)}</div></div>${ic('chev', 18)}</div>`).join('')
    : '<div class="empty">Belum ada pelanggan tersimpan.<br>Pelanggan tersimpan otomatis dari pesanan Wahana.</div>', { nav: 'pelanggan' });
  $$('[data-c]').forEach((el) => el.onclick = () => {
    const c = cs.find((x) => x.id === Number(el.dataset.c));
    modal(`<h2 style="margin-top:0">Pelanggan</h2>
      <label class="f">Nama</label><input type="text" id="cn" value="${esc(c.name)}">
      <label class="f">No. HP</label><input type="tel" id="cp" value="${esc(c.phone)}">
      <label class="f">Alamat</label><textarea id="ca">${esc(c.address)}</textarea>
      <button class="btn block" id="cs">Simpan</button>
      <button class="btn alt block" id="co">Buat pesanan Wahana</button>
      <button class="btn danger block" id="cd">Hapus pelanggan</button>`, (o, close) => {
      const read = () => ({ ...c, name: $('#cn', o).value.trim(), phone: normalizePhone($('#cp', o).value) || $('#cp', o).value.trim(), address: $('#ca', o).value.trim() });
      $('#cs', o).onclick = async () => { const v = read(); if (!v.name) return toast('Nama wajib diisi.'); await db.put('customers', v); close(); viewPelanggan(); };
      $('#co', o).onclick = () => { const v = read(); draft.items.push({ kind: 'wahana', name: v.name, phone: v.phone, address: v.address, courier: 'Wahana' }); close(); location.hash = '#/baru'; toast('Ditambahkan ke daftar pesanan.'); };
      $('#cd', o).onclick = async () => { if (await ask('Hapus pelanggan ini?', 'Label pesanan lama tidak berubah.', { ok: 'Hapus', danger: true })) { await db.del('customers', c.id); close(); viewPelanggan(); } };
    });
  });
}

// ---------- Pengaturan ----------
// ---------- Toko online (Firebase) ----------
const TOKO_URL = new URL('./', location.href.split('#')[0]).href;

async function tokoSettings() {
  const box = $('#tokoset');
  if (!box) return;
  if (!cloud.configured()) {
    box.innerHTML = `<p style="margin:0">Belum disambungkan ke Firebase.</p>
      <p class="muted">Langkah penyiapan ada di file <b>FIREBASE.md</b> di repo. Setelah konfigurasi dipasang, login dan kelola produk dari sini.</p>`;
    return;
  }
  const user = await cloud.currentUser().catch(() => null);
  if (!user) {
    box.innerHTML = `<p class="muted" style="margin-top:0">Login dengan akun pemilik untuk mengelola produk dan mengambil pesanan.</p>
      <label class="f" for="tem">Email</label><input type="text" id="tem" inputmode="email" autocomplete="username">
      <label class="f" for="tpw">Kata sandi</label><input type="password" id="tpw" autocomplete="current-password" style="width:100%;min-height:50px;padding:12px 14px;font-size:16px;border:1px solid var(--line);background:var(--card)">
      <button class="btn block" id="tlogin">Login</button>`;
    $('#tlogin').onclick = async () => {
      const b = $('#tlogin'); b.disabled = true; b.textContent = 'Masuk…';
      try { await cloud.login($('#tem').value.trim(), $('#tpw').value); toast('Login berhasil.'); tokoSettings(); }
      catch (e) { console.error(e); toast('Login gagal. Periksa email dan kata sandi.', 'err'); b.disabled = false; b.textContent = 'Login'; }
    };
    return;
  }
  const pub = await cloud.getShopPublic().catch(() => null);
  box.innerHTML = `<div class="muted" style="margin-top:0">Login sebagai <b>${esc(user.email)}</b></div>
    <a class="btn block" href="#/produk">${ic('list', 18)} Kelola produk</a>
    <a class="btn ghost block" href="${esc(TOKO_URL)}" target="_blank" rel="noopener">Buka halaman toko</a>
    <button class="btn ghost block" id="tshare">Salin link toko</button>
    <label class="f" for="tab">Deskripsi singkat di halaman toko</label><input type="text" id="tab" value="${esc(pub?.about || '')}" placeholder="Misal: Baju harian muslimah, ready stock">
    <label class="f" for="twa">Nomor WhatsApp penerima pesanan</label><input type="tel" id="twa" inputmode="tel" value="${esc(pub?.wa || shop.phone || '')}">
    <button class="btn alt block" id="tsave">Simpan info toko</button>
    <button class="btn ghost block" id="tout">Logout</button>`;
  $('#tsave').onclick = async () => {
    try { await cloud.saveShopPublic({ name: shop.name, wa: $('#twa').value.trim(), about: $('#tab').value.trim() }); toast('Info toko disimpan.'); }
    catch (e) { console.error(e); toast('Gagal menyimpan info toko.', 'err'); }
  };
  $('#tshare').onclick = async () => { try { await navigator.clipboard.writeText(TOKO_URL); toast('Link toko disalin.'); } catch { toast(TOKO_URL); } };
  $('#tout').onclick = async () => { await cloud.logout(); toast('Sudah logout.'); tokoSettings(); };
}

// Daftar produk toko online, untuk pemilik.
async function viewProduk() {
  frame('Katalog', '<p class="muted">Memuat produk…</p>', { nav: 'produk' });
  let user = null, list = [];
  try { user = cloud.configured() && await cloud.currentUser(); if (user) list = await cloud.listProducts({ all: true }); }
  catch (e) { console.error(e); return frame('Katalog', '<div class="empty"><p>Produk gagal dimuat. Periksa internet lalu coba lagi.</p><a class="btn block" href="#/produk">Coba lagi</a></div>', { nav: 'produk' }); }
  if (!user) return frame('Katalog', '<div class="empty"><p>Katalog tersimpan di toko online. Login dulu di Pengaturan → Toko online.</p><a class="btn block" href="#/pengaturan">Ke Pengaturan</a></div>', { nav: 'produk' });
  let f = 'all';
  const card = (p) => `<div class="kc ${p.active ? '' : 'off'}">
      <button class="kph" data-edit="${p.id}" aria-label="Ubah ${esc(p.name)}">${p.thumb ? `<img src="${p.thumb}" alt="">` : ic('camera', 28)}
        <span class="kst ${!p.active ? 'hid' : p.stock > 0 ? (p.stock <= 2 ? 'low' : '') : 'zero'}">${!p.active ? 'Disembunyikan' : p.stock > 0 ? (p.stock <= 2 ? 'Stok menipis' : 'Tampil') : 'Habis'}</span></button>
      <div class="kin"><b class="ell">${esc(p.name)}</b><span class="kpr">${rupiah(p.price)}</span>
        ${p.variants?.length ? `<div class="kvar">${p.variants.map((v) => `<span class="${v.stock ? '' : 'zero'}">${esc(v.name)} ${v.stock}</span>`).join('')}</div>` : `<div class="kst2"><button data-st="${p.id}" data-v="-1" aria-label="Kurangi stok ${esc(p.name)}">−</button><b>${p.stock || 0}</b><button data-st="${p.id}" data-v="1" aria-label="Tambah stok ${esc(p.name)}">+</button></div>`}
        <label class="ktg"><input type="checkbox" data-act="${p.id}" ${p.active ? 'checked' : ''}> Tampil di toko</label>
        <div class="kbtn"><button class="btn ghost sm" data-edit="${p.id}">${ic('edit', 16)} Edit</button><button class="btn danger sm" data-pdel="${p.id}" aria-label="Hapus ${esc(p.name)}">${ic('trash', 16)}</button></div></div></div>`;
  frame('Katalog', `<div class="row" style="gap:8px"><button class="btn grow" id="padd">${ic('plus', 20)} Tambah produk</button><a class="btn ghost" href="${esc(TOKO_URL)}" target="_blank" rel="noopener" aria-label="Lihat toko">${ic('store', 20)}</a></div>
    <div class="chips" id="kf">${[['all', `Semua ${list.length}`], ['on', `Tampil ${list.filter((p) => p.active).length}`], ['low', `Stok menipis ${list.filter((p) => p.active && (p.stock || 0) <= 2).length}`], ['off', `Disembunyikan ${list.filter((p) => !p.active).length}`]].map(([v, l]) => `<button class="pill ${v === f ? 'on' : ''}" data-kf="${v}">${l}</button>`).join('')}</div>
    <div class="kgrid" id="kg"></div>`, { nav: 'produk' });
  const draw = () => {
    const show = list.filter((p) => f === 'all' || (f === 'on' && p.active) || (f === 'off' && !p.active) || (f === 'low' && p.active && (p.stock || 0) <= 2));
    $('#kg').innerHTML = show.map(card).join('') || `<div class="empty" style="grid-column:1/-1"><p>${list.length ? 'Tidak ada produk di filter ini.' : 'Belum ada produk. Tekan “Tambah produk”, isi foto, nama, dan harga.'}</p></div>`;
    $$('[data-edit]').forEach((b) => b.onclick = () => editProduk(list.find((p) => p.id === b.dataset.edit), list));
    $$('[data-pdel]').forEach((b) => b.onclick = async () => {
      const p = list.find((x) => x.id === b.dataset.pdel);
      if (!await ask(`Hapus ${p.name}?`, 'Produk dan fotonya hilang dari toko online. Tidak bisa dibatalkan.', { ok: 'Hapus', danger: true })) return;
      try { await cloud.deleteProduct(p); list.splice(list.indexOf(p), 1); toast('Produk dihapus.'); draw(); }
      catch (e) { console.error(e); toast('Produk gagal dihapus. Periksa internet.', 'err'); }
    });
    $$('[data-st]').forEach((b) => b.onclick = async () => {
      const p = list.find((x) => x.id === b.dataset.st), old = p.stock || 0;
      p.stock = Math.max(0, old + Number(b.dataset.v)); if (p.stock === old) return;
      draw();
      try { await cloud.patchProduct(p.id, { stock: p.stock }); } catch (e) { console.error(e); p.stock = old; draw(); toast('Stok gagal disimpan. Periksa internet.', 'err'); }
    });
    $$('[data-act]').forEach((c) => c.onchange = async () => {
      const p = list.find((x) => x.id === c.dataset.act); p.active = c.checked; draw();
      try { await cloud.patchProduct(p.id, { active: p.active }); toast(p.active ? `${p.name} tampil di toko.` : `${p.name} disembunyikan dari toko.`); }
      catch (e) { console.error(e); p.active = !p.active; draw(); toast('Gagal disimpan. Periksa internet.', 'err'); }
    });
  };
  $('#padd').onclick = () => editProduk(null, list);
  $$('[data-kf]').forEach((b) => b.onclick = () => { f = b.dataset.kf; $$('[data-kf]').forEach((x) => x.classList.toggle('on', x === b)); draw(); });
  draw();
}

async function editProduk(p, list) {
  const cats = [...new Set(list.map((x) => x.category).filter(Boolean))];
  let photos = null; // null = foto tidak diubah
  const shown = p?.photoCount ? await cloud.getPhotos(p).catch(() => []) : [];
  modal(`<h2>${p ? 'Ubah produk' : 'Produk baru'}</h2>
    <label class="f">Foto (maks. 5, foto pertama jadi sampul)</label>
    <div class="pthumbs" id="pth"></div>
    <input type="file" id="pf" accept="image/*" multiple hidden>
    <button class="btn ghost block" id="pfb">${ic('camera', 18)} Pilih foto</button>
    <label class="f" for="pn">Nama produk</label><input type="text" id="pn" value="${esc(p?.name || '')}">
    <label class="f" for="pc">Kategori</label><input type="text" id="pc" list="pcl" value="${esc(p?.category || '')}" placeholder="Misal: Gamis"><datalist id="pcl">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
    <div class="row"><div class="grow"><label class="f" for="pp">Harga (Rp)</label><input type="text" id="pp" inputmode="numeric" value="${p?.price ? p.price.toLocaleString('id-ID') : ''}"></div>
    <div style="width:110px"><label class="f" for="ps">Stok</label><input type="number" id="ps" min="0" value="${p?.stock ?? 1}"></div></div>
    <label class="f">Varian (warna / motif), masing-masing punya stok</label>
    <div id="pvl" class="pvl"></div>
    <button class="btn ghost block" id="pva" type="button">${ic('plus', 18)} Tambah varian</button>
    <label class="f" for="pz">Ukuran (pisahkan dengan koma, kosongkan kalau all size)</label><input type="text" id="pz" value="${esc((p?.sizes || []).join(', '))}" placeholder="S, M, L, XL">
    <label class="f" for="pd">Deskripsi</label><textarea id="pd" placeholder="Bahan, ukuran badan, warna…">${esc(p?.desc || '')}</textarea>
    <div class="row" style="margin-top:12px"><input type="checkbox" id="pa" ${p?.active === false ? '' : 'checked'}><label for="pa">Tampilkan di toko</label></div>
    <button class="btn block" id="psave">Simpan produk</button>
    ${p ? `<button class="btn danger block" id="pdel">${ic('trash', 18)} Hapus produk</button>` : ''}`, (m, close) => {
    let vars = (p?.variants || []).map((v) => ({ ...v }));
    const drawVars = () => {
      $('#pvl', m).innerHTML = vars.map((v, i) => `<div class="pv-row"><input type="text" data-vn="${i}" value="${esc(v.name)}" placeholder="Misal: Hijau" aria-label="Nama varian ${i + 1}"><input type="number" min="0" data-vs="${i}" value="${v.stock}" aria-label="Stok varian ${i + 1}"><button class="icon-btn" type="button" data-vx="${i}" aria-label="Hapus varian ${i + 1}">${ic('trash', 16)}</button></div>`).join('');
      $$('[data-vn]', m).forEach((x) => x.oninput = () => { vars[x.dataset.vn].name = x.value; });
      $$('[data-vs]', m).forEach((x) => x.oninput = () => { vars[x.dataset.vs].stock = Math.max(0, Number(x.value) || 0); syncStock(); });
      $$('[data-vx]', m).forEach((x) => x.onclick = () => { vars.splice(Number(x.dataset.vx), 1); drawVars(); });
      syncStock();
    };
    const syncStock = () => { const s = $('#ps', m); s.disabled = vars.length > 0; if (vars.length) s.value = vars.reduce((a, v) => a + v.stock, 0); };
    drawVars();
    $('#pva', m).onclick = () => { vars.push({ name: '', stock: 1 }); drawVars(); $$('[data-vn]', m).at(-1).focus(); };
    const cur = () => photos || shown;
    const draw = () => {
      $('#pth', m).innerHTML = cur().map((src, i) => `<span><img src="${src}" alt="Foto ${i + 1}"><button class="icon-btn" data-px="${i}" aria-label="Hapus foto ${i + 1}">${ic('trash', 16)}</button></span>`).join('');
      $$('[data-px]', m).forEach((b) => b.onclick = () => { photos = cur().filter((_, j) => j !== Number(b.dataset.px)); draw(); });
    };
    draw();
    $('#pfb', m).onclick = () => $('#pf', m).click();
    $('#pf', m).onchange = async (e) => {
      const files = [...e.target.files].slice(0, 5 - cur().length); e.target.value = '';
      const b = $('#pfb', m); b.disabled = true;
      try {
        const add = [];
        for (const [i, f] of files.entries()) { b.textContent = `Mengecilkan foto ${i + 1}/${files.length}…`; add.push(await cloud.shrink(f)); }
        photos = [...cur(), ...add].slice(0, 5); draw();
      } catch (err) { console.error(err); toast('Foto gagal dibaca.', 'err'); }
      b.disabled = false; b.innerHTML = `${ic('camera', 18)} Pilih foto`;
    };
    $('#psave', m).onclick = async () => {
      const v = { ...(p || {}), name: $('#pn', m).value.trim(), category: $('#pc', m).value.trim(), price: toCod($('#pp', m).value),
        stock: Number($('#ps', m).value) || 0, sizes: $('#pz', m).value.split(',').map((x) => x.trim()).filter(Boolean),
        desc: $('#pd', m).value.trim(), active: $('#pa', m).checked };
      v.variants = vars.map((x) => ({ name: x.name.trim(), stock: x.stock })).filter((x) => x.name);
      if (v.variants.length) v.stock = v.variants.reduce((a, x) => a + x.stock, 0);
      if (!v.name || !v.price) return toast('Nama dan harga wajib diisi.');
      if (!p && !cur().length) return toast('Tambahkan minimal satu foto.');
      const b = $('#psave', m); b.disabled = true; b.textContent = 'Menyimpan…';
      try { await cloud.saveProduct(v, photos); close(); toast('Produk disimpan.'); viewProduk(); }
      catch (err) { console.error(err); toast('Gagal menyimpan produk. Periksa internet.', 'err'); b.disabled = false; b.textContent = 'Simpan produk'; }
    };
    $('#pdel', m)?.addEventListener('click', async () => {
      if (!await ask('Hapus produk ini?', `${p.name} hilang dari toko.`, { ok: 'Hapus', danger: true })) return;
      try { await cloud.deleteProduct(p); close(); toast('Produk dihapus.'); viewProduk(); }
      catch (err) { console.error(err); toast('Gagal menghapus produk.', 'err'); }
    });
  });
}

async function viewPengaturan() {
  const lb = shop.lastBackup ? fmtDate(shop.lastBackup) : 'belum pernah';
  const stepper = (k, labelA, labelB) => `<div class="row spread" style="margin-top:8px"><span>${labelA}</span>
    <div class="stepper"><button class="btn alt" data-st="${k}" data-d="-1" aria-label="${labelA} kurang">−</button><b id="v-${k}"></b><button class="btn alt" data-st="${k}" data-d="1" aria-label="${labelA} tambah">+</button></div></div>`;
  frame('Pengaturan', `
    <h2 style="margin-top:0">Data toko</h2><div class="card">
      <label class="f" for="sn" style="margin-top:0">Nama toko</label><input type="text" id="sn" value="${esc(shop.name)}">
      <label class="f" for="sp">No. HP pengirim (tercetak di label)</label><input type="tel" id="sp" value="${esc(shop.phone)}" inputmode="tel">
    </div>
    <h2>Tampilan</h2><div class="card">
      <div class="chips" style="margin:0;padding:0">${[['auto', 'Ikuti HP'], ['light', 'Terang'], ['dark', 'Gelap']].map(([v, l]) => `<button class="pill ${(shop.theme || 'auto') === v ? 'on' : ''}" data-theme="${v}">${l}</button>`).join('')}</div>
    </div>
    <h2>Logo</h2><div class="card">
      <div class="logo-prev"><img src="${esc(shop.logo || DEFAULT_LOGOS.full)}" alt="Logo"></div>
      <input type="file" id="lf" accept="image/*" hidden>
      <div class="row" style="margin-top:10px"><button class="btn alt grow" id="lb">${shop.logo ? 'Ganti logo' : 'Pakai logo sendiri'}</button>${shop.logo ? '<button class="btn danger" id="lx">Hapus</button>' : ''}</div>
      <div class="muted" style="margin-top:6px">${shop.logo ? 'Logo kustom dipakai.' : 'Logo Kafiya Daily bawaan dipakai.'} Logo baru: latar putih dihapus otomatis dan ruang kosong dipotong.</div>
      <div class="row" style="margin-top:12px"><input type="checkbox" id="bw" ${shop.bw ? 'checked' : ''}><label for="bw">Logo hitam-putih di label (hemat tinta)</label></div>
    </div>
    <h2>Kertas</h2><div class="card">
      <label class="f" for="pp" style="margin-top:0">Ukuran kertas stiker</label>
      <select id="pp">${Object.entries(PAPERS).map(([k, p]) => `<option value="${k}" ${shop.paper === k ? 'selected' : ''}>${p.name}</option>`).join('')}</select>
      <div class="row" style="margin-top:14px"><input type="checkbox" id="cl" ${shop.cutLines !== false ? 'checked' : ''}><label for="cl">Garis putus-putus bantu gunting</label></div>
      <div class="muted" style="margin-top:6px">Di dialog cetak HP, pilih ukuran kertas <b>${esc((PAPERS[shop.paper] || PAPERS.A4).dialog)}</b> dan skala 100%.</div>
    </div>
    <h2>Posisi cetak</h2><div class="card">
      ${stepper('dx', 'Kiri / kanan', '')}${stepper('dy', 'Atas / bawah', '')}
      <div class="muted" style="margin-top:8px">Per 1 mm. Plus = ke kanan / ke bawah. Cetak halaman tes di kertas biasa, lalu tumpuk ke stiker dan terawang ke lampu.</div>
      <button class="btn alt block" id="test">Cetak halaman tes</button>
    </div>
    <h2>Backup data</h2><div class="card">
      <div class="muted">Backup terakhir: ${lb}. Simpan file di tempat aman, karena berisi data pelanggan.</div>
      <button class="btn block" id="bk">Backup ke file</button>
      <input type="file" id="rf" accept="application/json,.json" hidden>
      <button class="btn ghost block" id="rs">Restore dari file</button>
    </div>
    <h2>Toko online</h2><div class="card" id="tokoset"><p class="muted" style="margin:0">Memuat…</p></div>
    <h2>Aplikasi</h2><div class="install-slot">${installCard() || '<div class="banner ok">Aplikasi sudah terpasang.</div>'}</div>
    <p class="muted" style="text-align:center">Semua data tersimpan di HP ini, tanpa server.<br>Versi ${APP_VERSION}</p>`, { nav: 'pengaturan' });

  const showSt = () => { $('#v-dx').textContent = `${shop.dx} mm`; $('#v-dy').textContent = `${shop.dy} mm`; };
  showSt();
  $('#sn').onchange = (e) => saveShop({ name: e.target.value.trim() || 'Kafiya Daily.co' });
  tokoSettings();
  $('#sp').onchange = (e) => saveShop({ phone: e.target.value.trim() });
  $('#bw').onchange = (e) => saveShop({ bw: e.target.checked });
  $$('[data-theme]').forEach((b) => b.onclick = async () => { await saveShop({ theme: b.dataset.theme }); applyTheme(); viewPengaturan(); });
  $('#pp').onchange = async (e) => { await saveShop({ paper: e.target.value }); viewPengaturan(); toast(`Kertas: ${PAPERS[e.target.value].name}`); };
  $('#cl').onchange = (e) => saveShop({ cutLines: e.target.checked });
  $$('[data-st]').forEach((b) => b.onclick = async () => {
    const k = b.dataset.st;
    await saveShop({ [k]: Math.max(-20, Math.min(20, shop[k] + Number(b.dataset.d))) });
    showSt();
  });
  $('#lb').onclick = () => $('#lf').click();
  $('#lf').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { await saveShop({ logo: await processLogo(f) }); viewPengaturan(); toast('Logo disimpan.'); }
    catch { toast('Gagal membaca gambar logo.'); }
  };
  $('#lx')?.addEventListener('click', async () => { await saveShop({ logo: null }); viewPengaturan(); });
  $('#test').onclick = () => printHTML(testSheetHTML(shop));
  $('#bk').onclick = async () => { await doBackup(); viewPengaturan(); };
  $('#rs').onclick = () => $('#rf').click();
  $('#rf').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!await ask('Ganti semua data?', `Data di HP ini akan diganti isi file: ${data.orders?.length ?? 0} pesanan, ${data.customers?.length ?? 0} pelanggan.`, { ok: 'Restore', danger: true })) return;
      await db.importAll(data);
      shop = await db.getShop();
      viewPengaturan(); toast('Data berhasil dipulihkan.');
    } catch (err) { toast(err.message || 'File backup tidak valid.'); }
  };
}

// ---------- router ----------
async function render() {
  document.getElementById('toast').classList.remove('show');
  document.querySelector('.selbar')?.remove(); sel.on = false; sel.ids.clear();
  const [path, q] = location.hash.slice(1).split('?');
  const qs = new URLSearchParams(q || '');
  try {
    if (path === '/baru') await viewBaru();
    else if (path === '/cetak') await viewCetak(qs);
    else if (path === '/pelanggan') await viewPelanggan();
    else if (path === '/pengaturan') await viewPengaturan();
    else if (path === '/produk') await viewProduk();
    else if (path === '/pesanan') await viewPesanan();
    else if (path === '/rekap') await viewRekap();
    else await viewDashboard();
    window.scrollTo(0, 0);
  } catch (e) {
    console.error(e);
    app.innerHTML = `<main><div class="empty"><p>Halaman ini gagal dibuka. Data pesanan tetap aman di HP.</p>
      <button class="btn block" onclick="location.reload()">Muat ulang</button>
      <a class="btn ghost block" href="#/">Kembali ke Beranda</a>
      <a class="btn ghost block" href="#/pengaturan">Backup data</a></div></main>`;
  }
}

function applyTheme() {
  const t = shop.theme || 'auto';
  if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = t;
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#23201D' : '#FAF9F7');
}

(async () => {
  shop = await db.getShop();
  applyTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
  window.addEventListener('hashchange', render);
  render();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    // Versi baru terpasang -> muat ulang sekali supaya HP tidak memakai file lama.
    const had = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (had) location.reload(); });
    navigator.serviceWorker.register('sw.js').then((r) => r.update()).catch(() => {});
  }
})();
