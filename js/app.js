import * as db from './db.js';
import { parseChat, normalizePhone } from './parser.js';
import { sheetJPG, downloadBlob } from './jpg.js';
import { processLogo, logoSet, DEFAULT_LOGOS } from './logo.js';
import { labelHTML, fitLabel, sheetsHTML, testSheetHTML, printHTML, esc, PAPERS, layout } from './label.js';
import { readAny } from './shopee.js';

const COURIERS = ['Wahana', 'JNE', 'J&T', 'SiCepat', 'Lainnya'];
const BACKUP_DAYS = 7;
const cm = (mm) => (Math.round(mm) / 10).toLocaleString('id-ID', { maximumFractionDigits: 1 });
const APP_VERSION = 27; // naikkan bersama CACHE di sw.js
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
    <label class="f">Ekspedisi</label><input type="text" id="ec" value="${esc(o.courier)}">` : ''}
    <label class="f">No. resi${w ? ' (catatan)' : ''}</label><input type="text" id="er" value="${esc(o.resi)}" autocapitalize="characters">
    <div class="row" style="margin-top:12px"><input type="checkbox" id="eprt" ${o.printed ? 'checked' : ''}><label for="eprt">Sudah dicetak</label></div>
    <button class="btn block" id="es">Simpan perubahan</button>
    <button class="btn danger block" id="ed">${ic('trash', 18)} Hapus pesanan</button>`, (m, close) => {
    $('#es', m).onclick = async () => {
      const v = { ...o, resi: $('#er', m).value.replace(/\s+/g, '').toUpperCase(), printed: $('#eprt', m).checked };
      if (w) Object.assign(v, { name: $('#en', m).value.trim(), phone: normalizePhone($('#ep', m).value) || $('#ep', m).value.trim(), address: $('#ea', m).value.trim(), courier: $('#ec', m).value.trim() || 'Wahana' });
      if (w ? !v.name || !v.address : !v.resi) return toast(w ? 'Nama dan alamat wajib diisi.' : 'No. resi wajib diisi.');
      await db.put('orders', v); close(); toast('Pesanan disimpan.'); onDone();
    };
    $('#ed', m).onclick = async () => {
      if (!await ask('Hapus pesanan ini?', `${o.resi} akan dihapus permanen.`, { ok: 'Hapus', danger: true })) return;
      await db.del('orders', o.id); close(); toast('Pesanan dihapus.'); onDone();
    };
  });
}
const resiText = (o) => (o.resi ? esc(o.resi) : '<span class="chip todo">Resi belum ada</span>');
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

const EYEBROW = { Pesanan: 'Kafiya Daily', 'Pesanan baru': 'Buat label', Cetak: 'Stiker · 7 × 5 cm', Pelanggan: 'Tersimpan di HP', Pengaturan: 'Toko & printer' };

function frame(title, body, { back = false, nav = 'pesanan', hero = false } = {}) {
  app.innerHTML = `<header class="top">
    ${back ? `<a class="hbtn" href="#/" aria-label="Kembali">${ic('back', 22)}</a>` : '<span class="hbtn"></span>'}
    <img class="brand" src="${esc(shop.logo || DEFAULT_LOGOS.full)}" alt="${esc(shop.name)}">
    <span class="hbtn"></span>
  </header>
  <main>${hero ? '' : `<p class="eyebrow">${esc(EYEBROW[title] || '')}</p><h1 class="display">${esc(title)}</h1>`}${body}</main>
  <nav class="bottom">
    ${[['pesanan', '', 'list', 'Pesanan'], ['cetak', 'cetak', 'printer', 'Cetak'], ['baru', 'baru', 'plus', 'Baru'], ['pelanggan', 'pelanggan', 'users', 'Pelanggan'], ['pengaturan', 'pengaturan', 'gear', 'Atur']]
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

// Rekap 7 hari terakhir: batang per hari, ditumpuk Wahana/ekspedisi dan Shopee.
function recapHTML(orders) {
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(Date.now() - (6 - i) * 864e5); return { k: dayKey(d), d, w: 0, s: 0 }; });
  const byKey = new Map(days.map((x) => [x.k, x]));
  for (const o of orders) { const x = byKey.get(dayKey(new Date(o.createdAt))); if (x) x[o.type.startsWith('shopee') ? 's' : 'w']++; }
  const max = Math.max(1, ...days.map((x) => x.w + x.s)), tw = days.reduce((a, x) => a + x.w, 0), ts = days.reduce((a, x) => a + x.s, 0);
  return `<div class="recap"><div class="row spread"><b>7 hari terakhir</b><span class="muted">${tw + ts} paket</span></div>
    <div class="bars">${days.map((x) => `<div title="${x.w + x.s} paket"><span>${x.w + x.s || ''}</span>
      <div class="stack" style="height:${Math.round(((x.w + x.s) / max) * 56) + 2}px">${x.w ? `<i class="w" style="flex:${x.w}"></i>` : ''}${x.s ? `<i class="s" style="flex:${x.s}"></i>` : ''}</div>
      <span>${x.d.toLocaleDateString('id-ID', { weekday: 'short' }).slice(0, 3)}</span></div>`).join('')}</div>
    <div class="lg"><span class="lw">Wahana/ekspedisi ${tw}</span><span class="ls">Shopee ${ts}</span></div></div>`;
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
    <div class="install-slot">${installCard()}</div>
    ${remind}
    ${orders.length ? recapHTML(orders) : ''}
    <h2>Riwayat pesanan</h2>
    ${orders.length ? `<div class="filters">
      <label class="search">${ic('search', 18)}<input type="search" id="fq" placeholder="Cari nama, resi, alamat…" value="${esc(listFilter.q)}"></label>
      <div class="chips">${[['all', 'Semua'], ['today', 'Hari ini'], ['yday', 'Kemarin'], ['week', '7 hari'], ['day', listFilter.day ? fmtDay(listFilter.day) : 'Pilih tanggal']].map(([v, l]) => `<button class="pill ${listFilter.date === v ? 'on' : ''}" data-fd="${v}">${v === 'day' ? ic('calendar', 14) : ''}${esc(l)}</button>`).join('')}
        <input type="date" id="fday" value="${esc(listFilter.day)}" tabindex="-1" aria-hidden="true"></div>
      <div class="chips">${[['all', 'Semua status'], ['todo', 'Belum dicetak'], ['done', 'Sudah dicetak']].map(([v, l]) => `<button class="pill ${listFilter.status === v ? 'on' : ''}" data-fs="${v}">${l}</button>`).join('')}</div>
    </div>
    <div class="row spread" style="margin:10px 2px"><span class="muted" id="fcount"></span><button class="btn ghost sm" id="selt">${sel.on ? 'Selesai' : 'Pilih'}</button></div>
    <div id="olist"></div>` : `<div class="empty">${ic('printer', 40)}<p>Belum ada pesanan.<br>Tekan “Pesanan baru” untuk mulai.</p></div>`}`, { hero: true });
  $('#bknow')?.addEventListener('click', async () => { await doBackup(); viewPesanan(); });
  if (!orders.length) return;
  const row = (o) => `<div class="item ${sel.on ? 'selmode' : ''}">${sel.on ? `<input type="checkbox" class="sel" data-sel="${o.id}" ${sel.ids.has(o.id) ? 'checked' : ''} aria-label="Pilih">` : ''}
      <span class="avatar ${o.type.startsWith('shopee') ? 'shopee' : o.type}">${o.type.startsWith('shopee') ? 'S' : esc((o.courier || 'W')[0])}</span>
      <a href="#/cetak?ids=${o.id}" class="grow" style="text-decoration:none;color:inherit;min-width:0">
        <div class="t">${resiText(o)}</div>
        <div class="muted ell">${o.type === 'shopee-img' ? 'Shopee · label asli' : o.type === 'shopee' ? 'Shopee' : `${esc(o.courier)} · ${esc(o.name)}`} · ${fmtDate(o.createdAt)}</div>
      </a>
      <span class="chip ${o.printed ? 'ok' : 'todo'}">${o.printed ? 'Dicetak' : 'Belum'}</span>
      ${orderBtns(o)}
    </div>`;
  // Saring tanpa render ulang seluruh halaman supaya kolom cari tetap fokus.
  const draw = () => {
    const list = filterOrders(orders, listFilter);
    $('#fcount').textContent = list.length === orders.length ? `${orders.length} pesanan` : `${list.length} dari ${orders.length} pesanan`;
    $('#olist').innerHTML = list.length ? list.map(row).join('') : '<div class="empty"><p>Tidak ada pesanan yang cocok.</p></div>';
    bindOrderBtns(list, viewPesanan);
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
    : `<div class="card item-card"><div class="row spread"><span class="chip">Pesanan ${i + 1} · chat</span><button class="icon-btn" data-rm="${i}" aria-label="Buang">${ic('trash', 18)}</button></div>
        <label class="f">Nama penerima</label><input type="text" data-i="${i}" data-k="name" value="${esc(it.name)}">
        <label class="f">No. HP</label><input type="tel" data-i="${i}" data-k="phone" value="${esc(it.phone)}" placeholder="Tidak ada di chat, isi kalau perlu">
        <label class="f">Alamat</label><textarea data-i="${i}" data-k="address" style="min-height:80px">${esc(it.address)}</textarea>
        <label class="f">Ekspedisi</label>${courierSel(i, it.courier)}${dupe(it, i)}</div>`;

  frame('Pesanan baru', `
    <div class="row"><button class="btn big grow" id="up">${ic('camera', 20)} Upload screenshot</button><button class="btn ghost big" id="pdf">${ic('file', 18)} PDF</button></div>
    <input type="file" id="upf" accept="image/*" multiple hidden>
    <input type="file" id="pdff" accept="application/pdf,.pdf" multiple hidden>
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
      <button class="btn ghost block" id="addm">${ic('plus', 18)} Tambahkan ke daftar</button>
    </details>
    ${items.length ? `<div class="row" style="margin-top:12px"><input type="checkbox" id="save" ${d.save ? 'checked' : ''}><label for="save">Simpan pelanggan (chat) untuk dipakai lagi</label></div>
    <button class="btn block big" id="go">${ic('printer', 20)} Simpan & cetak ${items.length} label</button>` : ''}`, { back: true, nav: 'baru' });

  // daftar hasil
  $$('[data-i][data-k]').forEach((el) => {
    el.oninput = el.onchange = () => { items[el.dataset.i][el.dataset.k] = el.dataset.k === 'resi' ? el.value.replace(/\s+/g, '').toUpperCase() : el.value; };
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
    toast('Sudah dirapikan. Periksa dulu ya.');
  };
  $('#addm').onclick = () => {
    if (!d.name.trim() || !d.address.trim()) return toast('Nama dan alamat wajib diisi.');
    const courier = d.courier === 'Lainnya' ? d.other.trim() || 'Lainnya' : d.courier;
    d.items.push({ kind: 'wahana', name: d.name.trim(), phone: d.phone.trim(), address: d.address.trim(), courier });
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

async function saveItems() {
  const items = draft.items;
  if (!items.length) return toast('Belum ada pesanan.');
  const dn = dupeChecker(await db.all('orders'), items).count();
  if (dn && !await ask(`${dn} pesanan tampak dobel`, 'Pesanan bertanda kuning sudah pernah disimpan atau muncul dua kali. Tetap simpan semuanya?', { ok: 'Tetap simpan' })) return;
  const bad = items.findIndex((it) => (it.kind === 'wahana' ? !it.name?.trim() || !it.address?.trim() : false));
  if (bad >= 0) return toast(`Pesanan ${bad + 1}: nama dan alamat wajib diisi.`);
  const ids = [], cs = await db.all('customers'), now = new Date().toISOString();
  for (const it of items) {
    if (it.kind === 'shopee') {
      ids.push(await db.put('orders', { type: 'shopee-img', resi: it.resi || '', img: it.img, h: it.h, createdAt: now, printed: false }));
      continue;
    }
    const name = it.name.trim(), address = it.address.trim(), phone = normalizePhone(it.phone) || (it.phone || '').trim();
    ids.push(await db.put('orders', { type: 'wahana', name, phone, address, courier: it.courier || 'Wahana', resi: '', createdAt: now, printed: false }));
    if (draft.save) {
      const hit = cs.find((c) => (phone && c.phone === phone) || (!phone && c.name === name));
      await db.put('customers', { ...(hit || {}), name, phone, address });
    }
  }
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
      <span class="grow"><span class="t" style="display:block">${resiText(o)}</span><span class="muted ell" style="display:block">${o.type === 'shopee-img' ? 'Shopee · label asli' : o.type === 'shopee' ? 'Shopee' : `${esc(o.courier)} · ${esc(o.name)}`} · ${fmtDate(o.createdAt)}</span></span>
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
    <h2>Aplikasi</h2><div class="install-slot">${installCard() || '<div class="banner ok">Aplikasi sudah terpasang.</div>'}</div>
    <p class="muted" style="text-align:center">Semua data tersimpan di HP ini, tanpa server.<br>Versi ${APP_VERSION}</p>`, { nav: 'pengaturan' });

  const showSt = () => { $('#v-dx').textContent = `${shop.dx} mm`; $('#v-dy').textContent = `${shop.dy} mm`; };
  showSt();
  $('#sn').onchange = (e) => saveShop({ name: e.target.value.trim() || 'Kafiya Daily.co' });
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
    else await viewPesanan();
    window.scrollTo(0, 0);
  } catch (e) {
    console.error(e);
    app.innerHTML = `<main><div class="empty"><p>Halaman ini gagal dibuka. Data pesanan tetap aman di HP.</p>
      <button class="btn block" onclick="location.reload()">Muat ulang</button>
      <a class="btn ghost block" href="#/">Kembali ke Pesanan</a>
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
