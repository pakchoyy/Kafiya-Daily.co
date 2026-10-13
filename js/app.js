import * as db from './db.js';
import { parseChat, normalizePhone } from './parser.js';
import { sheetJPG, downloadBlob } from './jpg.js';
import { processLogo, logoSet, DEFAULT_LOGOS } from './logo.js';
import { labelHTML, fitLabel, sheetsHTML, testSheetHTML, printHTML, esc, PAPERS, paper, layout, usedMM, labelH } from './label.js';
import { readAny } from './shopee.js';

const COURIERS = ['Wahana', 'JNE', 'J&T', 'SiCepat', 'Lainnya'];
const BACKUP_DAYS = 7;
const cm = (mm) => (Math.round(mm) / 10).toLocaleString('id-ID', { maximumFractionDigits: 1 });
const APP_VERSION = 20; // naikkan bersama CACHE di sw.js
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
      <div><b>${cm(paper(shop).cap - usedMM(shop))}<small> cm</small></b><span>Sisa kertas</span></div>
    </div>
    <div class="install-slot">${installCard()}</div>
    ${remind}
    <h2>Riwayat pesanan</h2>
    ${orders.length ? orders.map((o) => `<div class="item">
      <span class="avatar ${o.type.startsWith('shopee') ? 'shopee' : o.type}">${o.type.startsWith('shopee') ? 'S' : esc((o.courier || 'W')[0])}</span>
      <a href="#/cetak?ids=${o.id}" class="grow" style="text-decoration:none;color:inherit;min-width:0">
        <div class="t">${resiText(o)}</div>
        <div class="muted ell">${o.type === 'shopee-img' ? 'Shopee · label asli' : o.type === 'shopee' ? 'Shopee' : `${esc(o.courier)} · ${esc(o.name)}`} · ${fmtDate(o.createdAt)}</div>
      </a>
      <span class="chip ${o.printed ? 'ok' : 'todo'}">${o.printed ? 'Dicetak' : 'Belum'}</span>
      ${orderBtns(o)}
    </div>`).join('') : `<div class="empty">${ic('printer', 40)}<p>Belum ada pesanan.<br>Tekan “Pesanan baru” untuk mulai.</p></div>`}`, { hero: true });
  bindOrderBtns(orders, viewPesanan);
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
    ${items.length ? `<h2>${items.length} pesanan siap</h2>${items.map(card).join('')}` : ''}
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
    <div class="row" style="margin-top:14px"><button class="btn ghost grow" id="save1">Simpan</button><button class="btn grow" id="go">${ic('printer', 18)} Simpan & cetak</button></div>
    <p class="muted" style="text-align:center;margin-top:8px">“Simpan” untuk lanjut tambah pesanan; labelnya menunggu di tab Cetak.</p>` : ''}`, { back: true, nav: 'baru' });

  // daftar hasil
  $$('[data-i][data-k]').forEach((el) => {
    el.oninput = el.onchange = () => { items[el.dataset.i][el.dataset.k] = el.dataset.k === 'resi' ? el.value.replace(/\s+/g, '').toUpperCase() : el.value; };
  });
  $$('[data-rm]').forEach((b) => b.onclick = () => { items.splice(Number(b.dataset.rm), 1); viewBaru(); });
  $('#save')?.addEventListener('change', (e) => { d.save = e.target.checked; });
  $('#go')?.addEventListener('click', () => saveItems(true));
  $('#save1')?.addEventListener('click', () => saveItems(false));

  // upload otomatis
  $('#up').onclick = () => $('#upf').click();
  $('#upf').onchange = async (e) => {
    const files = [...e.target.files]; e.target.value = '';
    if (!files.length) return;
    const btn = $('#up'); btn.disabled = true;
    let n = 0;
    try {
      for (const [i, f] of files.entries()) {
        const tag = files.length > 1 ? ` (${i + 1}/${files.length})` : '';
        btn.textContent = `Membuka${tag}…`;
        const got = await readAny(f, (m) => { btn.textContent = `${m}${tag}`; });
        got.forEach((it) => { if (it.kind === 'wahana') it.courier = 'Wahana'; });
        items.push(...got); n += got.length;
      }
      toast(`${n} pesanan terbaca. Cek dulu ya.`);
    } catch (err) { toast(err.message || 'Gagal membaca file.'); }
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
  if (!session || session.key !== ids.join(',')) session = { key: ids.join(','), printed: new Set(), pending: null };
  const orders = (await Promise.all(ids.map((i) => db.get('orders', i)))).filter(Boolean);
  if (!orders.length) return frame('Cetak', '<div class="empty">Pesanan tidak ditemukan.</div>', { back: true });

  const remaining = orders.filter((o) => !session.printed.has(o.id));
  const logos = await logoSet(shop);
  const g = paper(shop), used = usedMM(shop), pend = session.pending;
  const plan = pend || layout(remaining, used, shop);
  const posOf = new Map(plan.orders.map((o, i) => [o.id, plan.ys[i]]));
  const who = (o) => (o.type.startsWith('shopee') ? o.resi || 'Shopee' : o.name);
  const left = g.cap - used;

  // Gambar kolom kertas: bagian terpakai, label yang akan dicetak, dan sisa kosong (skala tinggi).
  const pct = (mm) => `${(mm / g.cap) * 100}%`;
  const colmap = `<div class="colmap">
    ${used ? `<div class="seg used" style="top:0;height:${pct(used)}"><span>Terpakai ${cm(used)} cm</span></div>` : ''}
    ${plan.orders.map((o, i) => `<div class="seg print" style="top:${pct(plan.ys[i])};height:${pct(labelH(o))}"><span class="ell">${esc(who(o))}</span></div>`).join('')}
  </div>`;

  let status = '';
  if (pend) {
    status = `<div class="card"><b>Sudah tercetak dengan benar?</b>
      <div class="muted">${pend.orders.length} label. Posisi kertas baru dicatat setelah kamu konfirmasi.</div>
      <div class="row" style="margin-top:10px"><button class="btn grow" id="confirm">Ya, tandai tercetak</button><button class="btn ghost" id="redo">Belum</button></div></div>`;
  } else if (!remaining.length) {
    status = `<div class="banner ok">Semua label sudah dicetak.</div>`;
  } else if (!plan.orders.length) {
    status = `<div class="banner">Sisa kertas (${cm(left)} cm) tidak cukup untuk label berikutnya. Ganti dengan stiker baru, lalu tekan “Kertas baru”.</div>`;
  } else if (session.printed.size && used === 0) {
    status = `<div class="banner">Kertas sebelumnya sudah penuh. Pasang stiker baru, lalu tekan “Lanjut cetak”. Sisa ${remaining.length} label.</div>`;
  }

  frame('Cetak', `${status}
    <details class="slotbox" ${session.showMap ? 'open' : ''}>
      <summary><span>${ic('printer', 18)}</span><span class="grow"><b>${used ? `Mulai dari ${cm(used)} cm` : 'Kertas baru, mulai dari atas'}</b><br><span class="muted">Sisa ${cm(left)} dari ${cm(g.cap)} cm di kolom tengah</span></span><span class="btn ghost sm">Ubah</span></summary>
      <div class="row" style="margin-top:14px;align-items:flex-start;gap:16px">
        ${colmap}
        <div class="grow">
          <div class="muted">Bagian kolom yang sudah terpakai (dari atas):</div>
          <div class="stepper" style="margin-top:8px"><button class="btn alt" data-u="-5" aria-label="Kurangi">−</button><b>${cm(used)} cm</b><button class="btn alt" data-u="5" aria-label="Tambah">+</button></div>
          <div class="row" style="margin-top:8px;flex-wrap:wrap;gap:6px">${[0, 50, 100, 150, 200, 250].filter((v) => v < g.cap).map((v) => `<button class="btn ghost sm" data-uset="${v}">${cm(v)}</button>`).join('')}</div>
          <div class="muted" style="margin-top:10px">Ukur dari tepi atas stiker sampai bekas potongan terakhir, atau pilih kelipatan 5 cm.</div>
        </div>
      </div>
    </details>
    <h2>Pratinjau (${orders.length} label)</h2>
    <div class="preview" id="prev">${orders.map((o) => `<div class="pv"><span class="pv-cap">${posOf.has(o.id) ? `Mulai ${cm(posOf.get(o.id))} cm dari atas` : session.printed.has(o.id) ? 'Sudah dicetak' : 'Lembar berikutnya'}</span>${labelHTML(o, shop, logos)}</div>`).join('')}</div>
    <div id="warn"></div>
    ${plan.orders.length && !pend ? `<div class="card" style="margin-top:12px">${plan.orders.length} label dicetak di kertas ini${remaining.length > plan.orders.length ? `, sisa ${remaining.length - plan.orders.length} di kertas berikutnya` : ''}.</div>
    ${used ? `<div class="banner" style="margin-top:4px">Kertas ini sudah terpakai ${cm(used)} cm, jadi label akan mulai dari tengah. Kalau kamu memasang <b>kertas baru</b>, pilih “Kertas baru”.</div>
    <div class="row"><button class="btn grow" id="printnew">${ic('printer', 18)} Kertas baru (dari atas)</button><button class="btn ghost grow" id="print">Lanjut di sisa kertas</button></div>`
    : `<button class="btn block" id="print">${ic('printer', 20)} ${session.printed.size ? 'Lanjut cetak' : 'Cetak'} ${plan.orders.length} label</button>`}
    <button class="btn ghost block" id="jpg">${ic('download', 18)} Unduh JPG</button>`
    : remaining.length && !pend ? `<button class="btn block" id="printnew">${ic('printer', 20)} Kertas baru, cetak dari atas</button>` : ''}
    <button class="btn ghost block" id="newsheet">Kertas baru, mulai dari atas</button>
    <p class="muted" style="text-align:center">Di dialog cetak pilih ${esc((PAPERS[shop.paper] || PAPERS.A4).dialog)}, skala 100%, tanpa margin/header. JPG: cetak dengan ukuran asli.</p>`, { back: true, nav: 'cetak' });

  const warn = $$('#prev .label.wahana, #prev .label.shopee').filter((l) => !fitLabel(l)).length;
  if (warn) $('#warn').innerHTML = '<div class="banner">Alamat/resi sangat panjang dan sudah dikecilkan semampunya. Periksa hasil cetak, atau persingkat alamat.</div>';

  const setUsed = async (v) => { await saveShop({ used: Math.max(0, Math.min(g.cap, v)) }); session.pending = null; session.showMap = true; viewCetak(qs); };
  $('.slotbox').ontoggle = (e) => { session.showMap = e.target.open; };
  $$('[data-u]').forEach((b) => b.onclick = () => setUsed(used + Number(b.dataset.u)));
  $$('[data-uset]').forEach((b) => b.onclick = () => setUsed(Number(b.dataset.uset)));
  $('#newsheet').onclick = async () => { await saveShop({ used: 0 }); session.pending = null; session.showMap = false; viewCetak(qs); toast('Kertas baru, mulai dari atas.'); };
  $('#printnew')?.addEventListener('click', async () => {
    await saveShop({ used: 0 });
    const fresh = layout(remaining, 0, shop);
    await printHTML(await sheetsHTML([fresh], shop));
    session.pending = fresh; viewCetak(qs);
  });
  $('#print')?.addEventListener('click', async () => {
    const bad = await printHTML(await sheetsHTML([plan], shop));
    if (bad) toast('Ada label dengan teks sangat panjang — periksa hasil cetak.');
    session.pending = plan; viewCetak(qs);
  });
  $('#jpg')?.addEventListener('click', async () => {
    const b = $('#jpg'); b.disabled = true; b.textContent = 'Membuat gambar…';
    const blob = await sheetJPG(plan, shop);
    downloadBlob(blob, `kafiya-label-${new Date().toISOString().slice(0, 10)}.jpg`);
    toast('JPG diunduh. Cetak dengan ukuran asli / 100%.');
    session.pending = plan; viewCetak(qs);
  });
  $('#redo')?.addEventListener('click', () => { session.pending = null; viewCetak(qs); });
  $('#confirm')?.addEventListener('click', async () => {
    for (const o of pend.orders) { session.printed.add(o.id); await db.put('orders', { ...o, printed: true }); }
    // Sisa kurang dari 2 cm dianggap habis.
    await saveShop({ used: g.cap - pend.end < 20 ? 0 : pend.end });
    session.pending = null; viewCetak(qs);
  });
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
