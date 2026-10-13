import * as db from './db.js';
import { parseChat, parseResiList, normalizePhone, cleanOcr, extractResi } from './parser.js';
import { readImage } from './ocr.js';
import { sheetJPG, downloadBlob } from './jpg.js';
import { processLogo, logoSet, DEFAULT_LOGOS } from './logo.js';
import { labelHTML, fitLabel, sheetsHTML, testSheetHTML, printHTML, esc, SLOTS } from './label.js';

const COURIERS = ['Wahana', 'JNE', 'J&T', 'SiCepat', 'Lainnya'];
const BACKUP_DAYS = 7;
const app = document.getElementById('app');

let shop;
let draft = { mode: 'wahana', chat: '', name: '', phone: '', address: '', courier: 'Wahana', other: '', resi: '', weight: '1', save: true, resiList: '' };
let session = null; // { ids, printed:Set, pending:[orders]|null }

const $ = (s, r = app) => r.querySelector(s);
const $$ = (s, r = app) => [...r.querySelectorAll(s)];
const fmtDate = (iso) => new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

let toastT;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600);
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

const EYEBROW = { Pesanan: 'Kafiya Daily', 'Pesanan baru': 'Buat label', Cetak: 'Stiker A4 · 7 × 5 cm', Pelanggan: 'Tersimpan di HP', Pengaturan: 'Toko & printer' };

function frame(title, body, { back = false, nav = 'pesanan', hero = false } = {}) {
  app.innerHTML = `<header class="top">
    ${back ? `<a class="hbtn" href="#/" aria-label="Kembali">${ic('back', 22)}</a>` : '<span class="hbtn"></span>'}
    <img class="brand" src="${esc(shop.logo || DEFAULT_LOGOS.full)}" alt="${esc(shop.name)}">
    <a class="hbtn" href="#/baru" aria-label="Pesanan baru">${ic('plus', 22)}</a>
  </header>
  <main>${hero ? '' : `<p class="eyebrow">${esc(EYEBROW[title] || '')}</p><h1 class="display">${esc(title)}</h1>`}${body}</main>
  <nav class="bottom">
    ${[['pesanan', '', 'list', 'Pesanan'], ['cetak', 'cetak', 'printer', 'Cetak'], ['pelanggan', 'pelanggan', 'users', 'Pelanggan'], ['pengaturan', 'pengaturan', 'gear', 'Pengaturan']]
      .map(([k, h, i, l]) => `<a href="#/${h}" class="${nav === k ? 'on' : ''}">${ic(i, 20)}<span>${l}</span></a>`).join('')}
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
      <div><b>0${shop.nextSlot}<small>/05</small></b><span>Slot berikutnya</span></div>
    </div>
    <div class="install-slot">${installCard()}</div>
    ${remind}
    <h2>Riwayat pesanan</h2>
    ${orders.length ? orders.map((o) => `<div class="item">
      <span class="avatar ${o.type}">${o.type === 'shopee' ? 'S' : esc((o.courier || 'W')[0])}</span>
      <a href="#/cetak?ids=${o.id}" class="grow" style="text-decoration:none;color:inherit;min-width:0">
        <div class="t">${esc(o.resi)}</div>
        <div class="muted ell">${o.type === 'shopee' ? 'Shopee' : `${esc(o.courier)} · ${esc(o.name)}`} · ${fmtDate(o.createdAt)}</div>
      </a>
      <span class="chip ${o.printed ? 'ok' : 'todo'}">${o.printed ? 'Dicetak' : 'Belum'}</span>
      <button class="icon-btn" data-del="${o.id}" aria-label="Hapus">${ic('trash', 18)}</button>
    </div>`).join('') : `<div class="empty">${ic('printer', 40)}<p>Belum ada pesanan.<br>Tekan “Pesanan baru” untuk mulai.</p></div>`}`, { hero: true });
  $$('[data-del]').forEach((b) => b.onclick = async () => {
    if (confirm('Hapus pesanan ini?')) { await db.del('orders', Number(b.dataset.del)); viewPesanan(); }
  });
}

// ---------- Pesanan baru ----------
async function viewBaru() {
  const customers = (await db.all('customers')).sort((a, b) => a.name.localeCompare(b.name));
  const d = draft;
  const wahana = `
    ${customers.length ? `<label class="f" for="cust">Pelanggan tersimpan</label>
      <select id="cust"><option value="">— pilih —</option>${customers.map((c) => `<option value="${c.id}">${esc(c.name)} · ${esc(c.phone)}</option>`).join('')}</select>` : ''}
    <button class="btn block" id="shot">${ic('camera', 18)} Upload screenshot chat</button>
    <input type="file" id="shotf" accept="image/*" hidden>
    <label class="f" for="chat">Atau tempel teks chat WhatsApp</label>
    <textarea id="chat" placeholder="Nama, HP, dan alamat dari chat pembeli…">${esc(d.chat)}</textarea>
    <button class="btn alt block" id="tidy" style="margin-top:8px">Rapikan</button>
    <h2>Periksa & koreksi</h2>
    <label class="f" for="name">Nama penerima</label><input type="text" id="name" value="${esc(d.name)}" autocomplete="off">
    <label class="f" for="phone">No. HP</label><input type="tel" id="phone" value="${esc(d.phone)}" inputmode="tel">
    <label class="f" for="address">Alamat</label><textarea id="address">${esc(d.address)}</textarea>
    <div class="row" style="margin-top:12px"><input type="checkbox" id="save" ${d.save ? 'checked' : ''}><label for="save">Simpan pelanggan ini</label></div>
    <h2>Pengiriman</h2>
    <label class="f" for="courier">Ekspedisi</label>
    <select id="courier">${COURIERS.map((c) => `<option ${d.courier === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
    <input type="text" id="other" placeholder="Nama ekspedisi" value="${esc(d.other)}" style="margin-top:8px;${d.courier === 'Lainnya' ? '' : 'display:none'}">
    <div class="row"><div class="grow"><label class="f" for="resi">No. resi</label><input type="text" id="resi" value="${esc(d.resi)}" autocapitalize="characters" autocomplete="off"></div>
    <div style="width:110px"><label class="f" for="weight">Berat (kg)</label><input type="number" id="weight" value="${esc(d.weight)}" step="0.1" min="0" inputmode="decimal"></div></div>
    <button class="btn block" id="go">Simpan & lanjut cetak</button>`;
  const shopee = `
    <label class="f" for="resilist">Tempel daftar resi (satu per baris)</label>
    <textarea id="resilist" style="min-height:140px;font-variant-numeric:tabular-nums" autocapitalize="characters">${esc(d.resiList)}</textarea>
    <button class="btn ghost block" id="shot" style="margin-top:8px">${ic('camera', 18)} Upload screenshot resi</button>
    <input type="file" id="shotf" accept="image/*" multiple hidden>
    <div id="resisum"></div>
    <button class="btn block" id="go">Simpan & lanjut cetak</button>`;
  frame('Pesanan baru', `<div class="tabs"><button data-m="wahana" class="${d.mode === 'wahana' ? 'on' : ''}">Wahana</button><button data-m="shopee" class="${d.mode === 'shopee' ? 'on' : ''}">Shopee</button></div>
    ${d.mode === 'wahana' ? wahana : shopee}`, { back: true });

  $$('.tabs button').forEach((b) => b.onclick = () => { d.mode = b.dataset.m; viewBaru(); });
  const bind = (id, key, fn) => { const el = $('#' + id); if (el) el.oninput = () => { d[key] = el.type === 'checkbox' ? el.checked : el.value; fn?.(); }; };

  if (d.mode === 'wahana') {
    ['chat', 'name', 'phone', 'address', 'resi', 'weight'].forEach((k) => bind(k, k));
    bind('save', 'save');
    bind('other', 'other');
    $('#courier').onchange = (e) => { d.courier = e.target.value; $('#other').style.display = d.courier === 'Lainnya' ? '' : 'none'; };
    $('#cust')?.addEventListener('change', (e) => {
      const c = customers.find((x) => x.id === Number(e.target.value));
      if (!c) return;
      Object.assign(d, { name: c.name, phone: c.phone, address: c.address });
      ['name', 'phone', 'address'].forEach((k) => { $('#' + k).value = d[k]; });
    });
    ocrButton(async (files) => {
      const t = cleanOcr((await ocrAll(files)).join('\n'));
      if (!t) return toast('Tidak ada teks terbaca.');
      d.chat = t; $('#chat').value = t; $('#tidy').click();
    });
    $('#tidy').onclick = () => {
      const r = parseChat(d.chat);
      if (!r.name && !r.phone && !r.address) return toast('Tidak ada yang bisa dirapikan.');
      Object.assign(d, r);
      ['name', 'phone', 'address'].forEach((k) => { $('#' + k).value = d[k]; });
      toast('Sudah dirapikan. Periksa dulu ya.');
    };
    $('#go').onclick = saveWahana;
  } else {
    const sum = () => {
      const items = parseResiList(d.resiList);
      const dups = items.filter((i) => i.dup).length, odd = items.filter((i) => i.odd && !i.dup).length;
      $('#resisum').innerHTML = items.length ? `<div class="card" style="margin-top:12px">
        <b>${items.length} label</b> · ${slotText(items.length)}
        ${dups ? `<div class="chip todo" style="margin-top:6px">${dups} resi dobel akan diabaikan</div>` : ''}
        ${odd ? `<div class="chip todo" style="margin-top:6px">${odd} resi tampak tidak biasa — periksa</div>` : ''}
        <div class="muted" style="margin-top:8px;font-variant-numeric:tabular-nums">${items.map((i, n) => `${n + 1}. ${esc(i.resi)}${i.dup ? ' (dobel)' : ''}`).join('<br>')}</div></div>` : '';
    };
    bind('resilist', 'resiList', sum); sum();
    ocrButton(async (files) => {
      const found = extractResi((await ocrAll(files)).join('\n'));
      if (!found.length) return toast('Tidak ada nomor resi terbaca.');
      d.resiList = [d.resiList.trim(), ...found].filter(Boolean).join('\n');
      $('#resilist').value = d.resiList; sum();
      toast(`${found.length} resi ditambahkan. Periksa dulu ya.`);
    });
    $('#go').onclick = saveShopee;
  }
}

// Tombol "screenshot": pilih gambar, OCR di HP, lalu serahkan teksnya ke handler.
function ocrButton(handle) {
  const btn = $('#shot'), input = $('#shotf'), label = btn.innerHTML;
  btn.onclick = () => input.click();
  input.onchange = async () => {
    const files = [...input.files]; input.value = '';
    if (!files.length) return;
    btn.disabled = true;
    try { await handle(files, btn); }
    catch (e) { toast(e.message || 'Gagal membaca gambar.'); }
    finally { btn.disabled = false; btn.innerHTML = label; }
  };
}
async function ocrAll(files) {
  const btn = $('#shot'), texts = [];
  for (const [i, f] of files.entries()) {
    texts.push(await readImage(f, (p) => { btn.textContent = `Membaca${files.length > 1 ? ` ${i + 1}/${files.length}` : ''}… ${p}%`; }));
  }
  return texts;
}

function slotText(n) {
  const free = SLOTS - shop.nextSlot + 1;
  const sheets = n <= free ? 1 : 1 + Math.ceil((n - free) / SLOTS);
  return `mulai slot ${shop.nextSlot}, ${sheets} lembar`;
}

async function saveWahana() {
  const d = draft;
  const courier = d.courier === 'Lainnya' ? d.other.trim() || 'Lainnya' : d.courier;
  const name = d.name.trim(), address = d.address.trim(), resi = d.resi.replace(/\s+/g, '').toUpperCase();
  if (!name || !address || !resi) return toast('Nama, alamat, dan no. resi wajib diisi.');
  const phone = normalizePhone(d.phone) || d.phone.trim();
  const id = await db.put('orders', { type: 'wahana', name, phone, address, courier, resi, weight: d.weight.trim(), createdAt: new Date().toISOString(), printed: false });
  if (d.save) {
    const cs = await db.all('customers');
    const hit = cs.find((c) => (phone && c.phone === phone) || (!phone && c.name === name));
    await db.put('customers', { ...(hit || {}), name, phone, address });
  }
  Object.assign(draft, { chat: '', name: '', phone: '', address: '', resi: '', other: '' });
  location.hash = `#/cetak?ids=${id}`;
}

async function saveShopee() {
  const items = parseResiList(draft.resiList).filter((i) => !i.dup);
  if (!items.length) return toast('Isi minimal satu resi.');
  const ids = [];
  for (const i of items) ids.push(await db.put('orders', { type: 'shopee', resi: i.resi, createdAt: new Date().toISOString(), printed: false }));
  draft.resiList = '';
  location.hash = `#/cetak?ids=${ids.join(',')}`;
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
  const next = shop.nextSlot;
  const free = SLOTS - next + 1;
  const chunk = remaining.slice(0, free);
  const slotBtns = Array.from({ length: SLOTS }, (_, i) => {
    const n = i + 1, cls = n < next ? 'used' : n === next ? 'next' : '';
    return `<button data-slot="${n}" class="${cls}">${n}<small>${n < next ? 'terpakai' : n === next ? 'berikutnya' : 'kosong'}</small></button>`;
  }).join('');

  const pend = session.pending;
  let status = '';
  if (pend) {
    status = `<div class="card"><b>Sudah tercetak dengan benar?</b>
      <div class="muted">${pend.length} label di slot ${next}–${next + pend.length - 1}. Slot baru dicatat setelah kamu konfirmasi.</div>
      <div class="row" style="margin-top:10px"><button class="btn grow" id="confirm">Ya, tandai tercetak</button><button class="btn ghost" id="redo">Belum</button></div></div>`;
  } else if (!remaining.length) {
    status = `<div class="banner ok">Semua label sudah dicetak.</div>`;
  } else if (session.printed.size && next === 1) {
    status = `<div class="banner">Slot lembar sebelumnya habis. Ganti dengan stiker baru, lalu tekan “Lanjut cetak”. Sisa ${remaining.length} label.</div>`;
  }

  frame('Cetak', `${status}
    <h2 style="margin-top:0">Pratinjau (${orders.length} label)</h2>
    <div class="preview" id="prev">${orders.slice(0, 2).map((o) => labelHTML(o, shop, logos)).join('')}</div>
    ${orders.length > 2 ? `<div class="muted" style="text-align:center">+ ${orders.length - 2} label lainnya</div>` : ''}
    <div id="warn"></div>
    <h2>Slot kertas</h2>
    <div class="slots">${slotBtns}</div>
    <div class="muted" style="margin-top:6px">Ketuk slot untuk mengganti slot berikutnya.</div>
    ${remaining.length && !pend ? `<div class="card" style="margin-top:12px">${chunk.length} label dicetak di lembar ini (slot ${next}–${next + chunk.length - 1})${remaining.length > chunk.length ? `, sisa ${remaining.length - chunk.length} di lembar berikutnya` : ''}.</div>
    <button class="btn block" id="print">${ic('printer', 20)} ${session.printed.size ? 'Lanjut cetak' : 'Cetak'} ${chunk.length} label</button>
    <button class="btn ghost block" id="jpg">${ic('download', 18)} Unduh JPG (A4)</button>` : ''}
    <button class="btn ghost block" id="newsheet">Lembar baru, mulai dari slot 1</button>
    <p class="muted" style="text-align:center">Di dialog cetak pilih A4, skala 100%, tanpa margin/header. JPG: cetak di A4 dengan ukuran asli.</p>`, { back: true, nav: 'cetak' });

  const warn = $$('#prev .label').filter((l) => !fitLabel(l)).length;
  if (warn) $('#warn').innerHTML = '<div class="banner">Alamat/resi sangat panjang dan sudah dikecilkan semampunya. Periksa hasil cetak, atau persingkat alamat.</div>';

  $$('[data-slot]').forEach((b) => b.onclick = async () => { await saveShop({ nextSlot: Number(b.dataset.slot) }); session.pending = null; viewCetak(qs); });
  $('#newsheet').onclick = async () => { await saveShop({ nextSlot: 1 }); session.pending = null; viewCetak(qs); };
  $('#print')?.addEventListener('click', async () => {
    const slots = chunk.map((_, i) => next + i);
    const bad = await printHTML(await sheetsHTML([{ slots, orders: chunk }], shop));
    if (bad) toast('Ada label dengan teks sangat panjang — periksa hasil cetak.');
    session.pending = chunk; viewCetak(qs);
  });
  $('#jpg')?.addEventListener('click', async () => {
    const b = $('#jpg'); b.disabled = true; b.textContent = 'Membuat gambar…';
    const blob = await sheetJPG({ slots: chunk.map((_, i) => next + i), orders: chunk }, shop);
    downloadBlob(blob, `kafiya-label-${new Date().toISOString().slice(0, 10)}-slot${next}.jpg`);
    toast('JPG diunduh. Cetak di A4 dengan ukuran asli / 100%.');
    session.pending = chunk; viewCetak(qs);
  });
  $('#redo')?.addEventListener('click', () => { session.pending = null; viewCetak(qs); });
  $('#confirm')?.addEventListener('click', async () => {
    for (const o of pend) { session.printed.add(o.id); await db.put('orders', { ...o, printed: true }); }
    const n = next + pend.length;
    await saveShop({ nextSlot: n > SLOTS ? 1 : n });
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
      <span class="avatar ${o.type}">${o.type === 'shopee' ? 'S' : esc((o.courier || 'W')[0])}</span>
      <span class="grow"><span class="t" style="display:block">${esc(o.resi)}</span><span class="muted ell" style="display:block">${o.type === 'shopee' ? 'Shopee' : `${esc(o.courier)} · ${esc(o.name)}`} · ${fmtDate(o.createdAt)}</span></span>
    </label>`).join('')}
    <button class="btn block" id="go">${ic('printer', 20)} Lanjut ke cetak</button>`
    : `<div class="empty">${ic('printer', 40)}<p>Semua label sudah dicetak.<br>Pesanan baru akan muncul di sini.</p></div>
       <a class="btn ghost block" href="#/baru">${ic('plus', 18)} Pesanan baru</a>`}`, { nav: 'cetak' });
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
      $('#cd', o).onclick = async () => { if (confirm('Hapus pelanggan ini? Label lama tidak berubah.')) { await db.del('customers', c.id); close(); viewPelanggan(); } };
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
    <p class="muted" style="text-align:center">Semua data tersimpan di HP ini, tanpa server.</p>`, { nav: 'pengaturan' });

  const showSt = () => { $('#v-dx').textContent = `${shop.dx} mm`; $('#v-dy').textContent = `${shop.dy} mm`; };
  showSt();
  $('#sn').onchange = (e) => saveShop({ name: e.target.value.trim() || 'Kafiya Daily' });
  $('#sp').onchange = (e) => saveShop({ phone: e.target.value.trim() });
  $('#bw').onchange = (e) => saveShop({ bw: e.target.checked });
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
      if (!confirm(`Restore akan MENGGANTI semua data di HP ini dengan isi file (${data.orders?.length ?? 0} pesanan, ${data.customers?.length ?? 0} pelanggan). Lanjut?`)) return;
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
