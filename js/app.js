import * as db from './db.js';
import { parseChat, normalizePhone } from './parser.js';
import { sheetJPG, downloadBlob } from './jpg.js';
import { processLogo, logoSet, DEFAULT_LOGOS } from './logo.js';
import { labelHTML, fitLabel, sheetsHTML, testSheetHTML, printHTML, esc, PAPERS, layout } from './label.js';
import { readAny } from './shopee.js';

const COURIERS = ['Wahana', 'JNE', 'J&T', 'SiCepat', 'Lainnya'];
const BACKUP_DAYS = 7;
const cm = (mm) => (Math.round(mm) / 10).toLocaleString('id-ID', { maximumFractionDigits: 1 });
const APP_VERSION = 22; // naikkan bersama CACHE di sw.js
const app = document.getElementById('app');

let shop;
let draft = { items: [], manualOpen: false, chat: '', name: '', phone: '', address: '', courier: 'Wahana', other: '', resi: '', weight: '1', save: true, resiList: '' };
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
    const done = (v) => { o.remove(); res(v); };
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
    <div class="row"><div class="grow"><label class="f">Ekspedisi</label><input type="text" id="ec" value="${esc(o.courier)}"></div>
    <div style="width:110px"><label class="f">Berat (kg)</label><input type="number" id="ew" step="0.1" value="${esc(o.weight)}"></div></div>` : ''}
    <label class="f">No. resi${w ? ' (catatan)' : ''}</label><input type="text" id="er" value="${esc(o.resi)}" autocapitalize="characters">
    <div class="row" style="margin-top:12px"><input type="checkbox" id="eprt" ${o.printed ? 'checked' : ''}><label for="eprt">Sudah dicetak</label></div>
    <button class="btn block" id="es">Simpan perubahan</button>
    <button class="btn danger block" id="ed">${ic('trash', 18)} Hapus pesanan</button>`, (m, close) => {
    $('#es', m).onclick = async () => {
      const v = { ...o, resi: $('#er', m).value.replace(/\s+/g, '').toUpperCase(), printed: $('#eprt', m).checked };
      if (w) Object.assign(v, { name: $('#en', m).value.trim(), phone: normalizePhone($('#ep', m).value) || $('#ep', m).value.trim(), address: $('#ea', m).value.trim(), courier: $('#ec', m).value.trim() || 'Wahana', weight: $('#ew', m).value.trim() });
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

function modal(html, mount) {
  const o = document.createElement('div');
  o.className = 'overlay';
  o.innerHTML = `<div class="sheet-modal">${html}</div>`;
  o.addEventListener('click', (e) => { if (e.target === o) o.remove(); });
  document.body.append(o);
  mount?.(o, () => o.remove());
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

// ---------- Pesanan ----------
async function viewPesanan() {
  const orders = (await db.all('orders')).sort((a, b) => b.id - a.id);
  const days = shop.lastBackup ? (Date.now() - new Date(shop.lastBackup)) / 864e5 : Infinity;
  const remind = orders.length && days > BACKUP_DAYS
    ? `<div class="banner">${shop.lastBackup ? `Backup terakhir ${Math.floor(days)} hari lalu.` : 'Data belum pernah di-backup.'} <a href="#/pengaturan">Backup sekarang</a></div>` : '';
  const todo = orders.filter((o) => !o.printed).length;
  const today = orders.filter((o) => new Date(o.createdAt).toDateString() === new Date().toDateString()).length;
  frame('Pesanan', `<section class="hero">
      <p class="eyebrow light">${new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
      <h1 class="display xl">Teman Outfit<br>Harianmu.</h1>
      <p class="eyebrow light">Cetak resi rapi, tanpa tulis tangan</p>
      <a class="btn sand" href="#/baru">Pesanan baru ${ic('chev', 16)}</a>
    </section>
    <div class="stats">
      <div><b>${todo}</b><span>Belum dicetak</span></div>
      <div><b>${today}</b><span>Hari ini</span></div>
      <div><b>${orders.length}</b><span>Total pesanan</span></div>
    </div>
    <div class="install-slot">${installCard()}</div>
    ${remind}
    <h2>Riwayat pesanan</h2>
    ${orders.length ? `<div class="filters">
      <label class="search">${ic('search', 18)}<input type="search" id="fq" placeholder="Cari nama, resi, alamat…" value="${esc(listFilter.q)}"></label>
      <div class="chips">${[['all', 'Semua'], ['today', 'Hari ini'], ['yday', 'Kemarin'], ['week', '7 hari'], ['day', listFilter.day ? fmtDay(listFilter.day) : 'Pilih tanggal']].map(([v, l]) => `<button class="pill ${listFilter.date === v ? 'on' : ''}" data-fd="${v}">${v === 'day' ? ic('calendar', 14) : ''}${esc(l)}</button>`).join('')}
        <input type="date" id="fday" value="${esc(listFilter.day)}" tabindex="-1" aria-hidden="true"></div>
      <div class="chips">${[['all', 'Semua status'], ['todo', 'Belum dicetak'], ['done', 'Sudah dicetak']].map(([v, l]) => `<button class="pill ${listFilter.status === v ? 'on' : ''}" data-fs="${v}">${l}</button>`).join('')}</div>
    </div>
    <div class="muted" id="fcount" style="margin:10px 2px"></div>
    <div id="olist"></div>` : `<div class="empty">${ic('printer', 40)}<p>Belum ada pesanan.<br>Tekan “Pesanan baru” untuk mulai.</p></div>`}`, { hero: true });
  if (!orders.length) return;
  const row = (o) => `<div class="item">
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
  };
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
  const courierSel = (i, val) => `<select data-i="${i}" data-k="courier">${COURIERS.filter((c) => c !== 'Lainnya').concat(val && !COURIERS.includes(val) ? [val] : []).map((c) => `<option ${val === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>`;
  const card = (it, i) => it.kind === 'shopee'
    ? `<div class="card item-card"><div class="row spread"><span class="chip">Shopee · label asli</span><button class="icon-btn" data-rm="${i}" aria-label="Buang">${ic('trash', 18)}</button></div>
        <img class="sp-thumb" src="${it.img}" alt="">
        <label class="f">No. resi</label><input type="text" data-i="${i}" data-k="resi" value="${esc(it.resi)}" placeholder="Tidak terbaca, isi manual" autocapitalize="characters">
        <div class="muted" style="margin-top:4px">Di kertas: 7 × ${cm(it.h)} cm</div></div>`
    : `<div class="card item-card"><div class="row spread"><span class="chip">Pesanan ${i + 1} · chat</span><button class="icon-btn" data-rm="${i}" aria-label="Buang">${ic('trash', 18)}</button></div>
        <label class="f">Nama penerima</label><input type="text" data-i="${i}" data-k="name" value="${esc(it.name)}">
        <label class="f">No. HP</label><input type="tel" data-i="${i}" data-k="phone" value="${esc(it.phone)}" placeholder="Tidak ada di chat, isi kalau perlu">
        <label class="f">Alamat</label><textarea data-i="${i}" data-k="address" style="min-height:80px">${esc(it.address)}</textarea>
        <label class="f">Ekspedisi</label>${courierSel(i, it.courier)}</div>`;

  frame('Pesanan baru', `
    <button class="btn block big" id="up">${ic('download', 20)} Upload screenshot / PDF</button>
    <input type="file" id="upf" accept="image/*,application/pdf" multiple hidden>
    <p class="muted" style="margin-top:8px">Bisa campur dan banyak sekaligus: <b>screenshot chat WhatsApp</b> jadi label Wahana, <b>PDF / screenshot label Shopee</b> jadi label Shopee. Tinggal cek hasilnya.</p>
    ${items.length ? `<div class="row spread" style="margin-top:20px"><h2 style="margin:0;border:0;flex:1">${items.length} pesanan siap</h2><button class="btn danger sm" id="reset">${ic('trash', 16)} Kosongkan semua</button></div>
    ${items.map(card).join('')}
    <button class="btn ghost block" id="more">${ic('plus', 18)} Tambah file lagi</button>` : ''}
    <details class="manual" ${d.manualOpen ? 'open' : ''}><summary>${ic('plus', 18)} Tambah manual / tempel teks chat</summary>
      ${customers.length ? `<label class="f" for="cust">Pelanggan tersimpan</label>
        <select id="cust"><option value="">— pilih —</option>${customers.map((c) => `<option value="${c.id}">${esc(c.name)} · ${esc(c.phone)}</option>`).join('')}</select>` : ''}
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
  $('#go')?.addEventListener('click', () => saveItems(true));

  // upload otomatis
  $('#up').onclick = () => $('#upf').click();
  $('#more')?.addEventListener('click', () => $('#upf').click());
  // Tombol + di menu bawah: di halaman ini langsung menambah file ke daftar.
  $('nav .fab').onclick = (e) => { e.preventDefault(); $('#upf').click(); };
  $('#reset')?.addEventListener('click', async () => {
    if (!await ask('Kosongkan daftar?', `${items.length} pesanan yang belum disimpan akan dibuang.`, { ok: 'Reset', danger: true })) return;
    items.length = 0; viewBaru(); toast('Daftar dikosongkan.');
  });
  $('#upf').onchange = async (e) => {
    const files = [...e.target.files]; e.target.value = '';
    if (!files.length) return;
    const prog = progress(files.length);
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
  };

  // isi manual
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
    items.push({ kind: 'wahana', name: d.name.trim(), phone: d.phone.trim(), address: d.address.trim(), courier });
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

async function saveItems(print) {
  const items = draft.items;
  if (!items.length) return toast('Belum ada pesanan.');
  const bad = items.findIndex((it) => (it.kind === 'wahana' ? !it.name?.trim() || !it.address?.trim() : false));
  if (bad >= 0) return toast(`Pesanan ${bad + 1}: nama dan alamat wajib diisi.`);
  const ids = [], cs = await db.all('customers'), now = new Date().toISOString();
  for (const it of items) {
    if (it.kind === 'shopee') {
      ids.push(await db.put('orders', { type: 'shopee-img', resi: it.resi || '', img: it.img, h: it.h, createdAt: now, printed: false }));
      continue;
    }
    const name = it.name.trim(), address = it.address.trim(), phone = normalizePhone(it.phone) || (it.phone || '').trim();
    ids.push(await db.put('orders', { type: 'wahana', name, phone, address, courier: it.courier || 'Wahana', resi: '', weight: '', createdAt: now, printed: false }));
    if (draft.save) {
      const hit = cs.find((c) => (phone && c.phone === phone) || (!phone && c.name === name));
      await db.put('customers', { ...(hit || {}), name, phone, address });
    }
  }
  draft.items = [];
  afterSave(ids, print);
}

// Setelah simpan: langsung ke cetak, atau tetap di form untuk menambah pesanan lagi.
async function afterSave(ids, print) {
  if (print) { location.hash = `#/cetak?ids=${ids.join(',')}`; return; }
  const waiting = (await db.all('orders')).filter((o) => !o.printed).length;
  toast(`${ids.length > 1 ? `${ids.length} pesanan` : 'Pesanan'} disimpan. ${waiting} label menunggu di tab Cetak.`);
  await viewBaru(); window.scrollTo(0, 0);
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
    if (bad) toast('Ada label dengan teks sangat panjang — periksa hasil cetak.');
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
    const pg = layout(rest, 0, shop);
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
      $('#co', o).onclick = () => { const v = read(); Object.assign(draft, { mode: 'wahana', name: v.name, phone: v.phone, address: v.address }); close(); location.hash = '#/baru'; };
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
      <div class="muted">Backup terakhir: ${lb}. Simpan file di tempat aman — berisi data pelanggan.</div>
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
  $('#bk').onclick = async () => {
    await saveShop({ lastBackup: new Date().toISOString() });
    const blob = new Blob([JSON.stringify(await db.exportAll(), null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `kafiya-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    viewPengaturan(); toast('Backup diunduh.');
  };
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
    app.innerHTML = '<main><div class="empty">Terjadi masalah saat membuka halaman.<br><a href="#/">Kembali ke Pesanan</a></div></main>';
  }
}

(async () => {
  shop = await db.getShop();
  window.addEventListener('hashchange', render);
  render();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    // Versi baru terpasang -> muat ulang sekali supaya HP tidak memakai file lama.
    const had = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (had) location.reload(); });
    navigator.serviceWorker.register('sw.js').then((r) => r.update()).catch(() => {});
  }
})();
