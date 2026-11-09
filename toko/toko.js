// Toko Kafiya Daily untuk pembeli: beranda → detail produk → keranjang → pesan via WhatsApp.
// Halaman: #/ (beranda), #/p/<id> (detail), #/favorit, #/keranjang. Pesanan juga dicatat di Firestore.
import { configured, listProducts, getPhotos, getShopPublic, createOrder } from '../js/cloud.js';
import { esc } from '../js/label.js';
import { rupiah, normalizePhone } from '../js/parser.js';

const view = document.getElementById('view');
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const KEY = { cart: 'kafiya-cart', fav: 'kafiya-fav', buyer: 'kafiya-buyer' };

let products = [], shop = null, cat = 'Semua', q = '';
let cart = load(KEY.cart, []), fav = new Set(load(KEY.fav, []));
const photoCache = new Map();

function load(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }
function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* mode privat: data hanya selama halaman terbuka */ } }

let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg;
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2400);
}

const I = {
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  grid: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/></svg>',
  bag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 8h13l-.9 11.1a2 2 0 0 1-2 1.9H8.4a2 2 0 0 1-2-1.9z"/><path d="M9 11V7a3 3 0 0 1 6 0v4"/></svg>',
  heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-8.5-5.1-8.5-11.2A4.6 4.6 0 0 1 12 6.6a4.6 4.6 0 0 1 8.5 2.7c0 6.1-8.5 11.2-8.5 11.2z"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  wa: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 11.6a8.5 8.5 0 0 1-12.5 7.5L3.5 20.5l1.4-4.3a8.5 8.5 0 1 1 15.6-4.6z"/><path d="M9 8.5c0 3.5 2.6 6.4 6 6.6l1-1.6-2-1-.9.9a4 4 0 0 1-2.1-2.1l.9-.9-1-2z"/></svg>',
};

// ---------- data ----------
async function start() {
  if (!configured()) { view.innerHTML = '<div class="empty"><p>Toko belum dibuka.</p></div>'; return; }
  try {
    [products, shop] = await Promise.all([listProducts(), getShopPublic()]);
  } catch (e) {
    console.error(e);
    view.innerHTML = '<div class="empty"><p>Katalog gagal dimuat. Periksa internet lalu coba lagi.</p><button class="primary" id="retry" style="max-width:240px;margin:12px auto 0">Coba lagi</button></div>';
    $('#retry').onclick = () => { view.innerHTML = '<p class="loading">Memuat katalog…</p>'; start(); };
    return;
  }
  cart = cart.filter((c) => products.some((p) => p.id === c.id));
  window.addEventListener('hashchange', route);
  route();
}

const lines = () => cart.map((c) => ({ ...c, p: products.find((p) => p.id === c.id) })).filter((c) => c.p);
const total = () => lines().reduce((a, c) => a + c.p.price * c.qty, 0);
const count = () => cart.reduce((a, c) => a + c.qty, 0);
function badge() { const n = count(), b = $('#badge'); b.hidden = !n; b.textContent = n; }

function route() {
  const h = location.hash.slice(1) || '/';
  const tab = h.startsWith('/favorit') ? 'fav' : h.startsWith('/keranjang') ? 'cart' : 'home';
  $$('.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  document.body.classList.remove('detail');
  badge();
  if (h.startsWith('/p/')) return detail(decodeURIComponent(h.slice(3)));
  if (h.startsWith('/favorit')) return favorites();
  if (h.startsWith('/keranjang')) return cartPage();
  home();
  window.scrollTo(0, 0);
}

// ---------- komponen ----------
const card = (p) => `<div class="pc ${p.stock > 0 ? '' : 'out'}"><a href="#/p/${encodeURIComponent(p.id)}">
    <span class="ph">${p.thumb ? `<img src="${p.thumb}" alt="" loading="lazy">` : ''}${p.stock > 0 ? '' : '<span class="so">Stok habis</span>'}</span>
    <span class="nm">${esc(p.name)}</span><span class="pr">${rupiah(p.price)}</span></a>
    <button class="heart ${fav.has(p.id) ? 'on' : ''}" data-fav="${esc(p.id)}" aria-label="${fav.has(p.id) ? 'Hapus dari' : 'Simpan ke'} favorit ${esc(p.name)}" aria-pressed="${fav.has(p.id)}">${I.heart}</button></div>`;

function bindHearts(root, after) {
  $$('[data-fav]', root).forEach((b) => b.onclick = (e) => {
    e.preventDefault(); e.stopPropagation();
    const id = b.dataset.fav;
    fav.has(id) ? fav.delete(id) : fav.add(id);
    save(KEY.fav, [...fav]);
    b.classList.toggle('on', fav.has(id)); b.setAttribute('aria-pressed', fav.has(id));
    toast(fav.has(id) ? 'Disimpan ke favorit.' : 'Dihapus dari favorit.');
    after?.();
  });
}

// ---------- beranda ----------
function home() {
  const cats = [...new Set(products.map((p) => p.category).filter(Boolean))];
  const newest = products.find((p) => p.thumb && p.stock > 0) || products[0];
  view.innerHTML = `${newest ? `<section class="hero">
      <div class="tx"><span class="eb">Baru drop</span><h1>${esc(newest.name)}</h1>
        <p>${esc(shop?.about || 'Teman outfit harianmu.')}</p>
        <a class="cta" href="#/p/${encodeURIComponent(newest.id)}">Cek sekarang ${I.arrow}</a></div>
      <div class="ph">${newest.thumb ? `<img src="${newest.thumb}" alt="">` : ''}</div></section>` : ''}
    ${cats.length > 1 ? `<div class="sec"><h2>Kategori</h2></div>
    <div class="cats">${['Semua', ...cats].map((c) => {
      const pic = c === 'Semua' ? '' : products.find((p) => p.category === c && p.thumb)?.thumb;
      return `<button class="cat ${c === cat ? 'on' : ''}" data-cat="${esc(c)}"><span class="ring">${pic ? `<img src="${pic}" alt="">` : I.grid}</span>${esc(c)}</button>`;
    }).join('')}</div>` : ''}
    <label class="search">${I.search}<input type="search" id="q" placeholder="Cari baju…" value="${esc(q)}" aria-label="Cari produk"></label>
    <div class="sec"><h2 id="gt"></h2><span class="count" id="gc"></span></div>
    <div class="grid" id="grid"></div>`;
  const draw = () => {
    const list = products.filter((p) => (cat === 'Semua' || p.category === cat) && (!q || `${p.name} ${p.category} ${p.desc}`.toLowerCase().includes(q.toLowerCase())));
    $('#gt').textContent = cat === 'Semua' ? 'Semua item' : cat;
    $('#gc').textContent = `${list.length}`;
    $('#grid').innerHTML = list.map(card).join('') || `<div class="empty" style="grid-column:1/-1">${products.length ? 'Tidak ada produk yang cocok.' : 'Belum ada produk. Cek lagi nanti ya.'}</div>`;
    bindHearts($('#grid'));
  };
  $('#q').oninput = (e) => { q = e.target.value; draw(); };
  $$('[data-cat]').forEach((b) => b.onclick = () => { cat = b.dataset.cat; $$('[data-cat]').forEach((x) => x.classList.toggle('on', x === b)); draw(); });
  draw();
}

// ---------- detail ----------
async function detail(id) {
  const p = products.find((x) => x.id === id);
  if (!p) { view.innerHTML = '<div class="empty"><p>Produk tidak ditemukan.</p><a class="cta" href="#/">Kembali ke beranda</a></div>'; return; }
  document.body.classList.add('detail');
  window.scrollTo(0, 0);
  let size = p.sizes?.length === 1 ? p.sizes[0] : '', qty = 1;
  const pics = () => photoCache.get(p.id) || (p.thumb ? [p.thumb] : []);
  view.innerHTML = `<div class="dtop"><div class="slides" id="sl"></div><div class="dots" id="dots"></div>
      <a class="back" href="#/" aria-label="Kembali">${I.back}</a>
      <button class="heart ${fav.has(p.id) ? 'on' : ''}" data-fav="${esc(p.id)}" aria-label="Simpan ke favorit" aria-pressed="${fav.has(p.id)}">${I.heart}</button></div>
    <div class="thumbs" id="th"></div>
    <div class="dinfo">${p.category ? `<div class="cat-l">${esc(p.category)}</div>` : ''}<h1>${esc(p.name)}</h1><div class="pr">${rupiah(p.price)}</div>
      ${p.desc ? `<p class="desc">${esc(p.desc)}</p>` : ''}
      ${p.sizes?.length ? `<span class="lbl">Ukuran</span><div class="sizes">${p.sizes.map((s) => `<button class="sz ${s === size ? 'on' : ''}" data-size="${esc(s)}" aria-pressed="${s === size}">${esc(s)}</button>`).join('')}</div>` : ''}
      ${p.stock > 0 ? `<span class="lbl">Jumlah</span><div class="stepper"><button data-q="-1" aria-label="Kurangi">−</button><b id="qn">1</b><button data-q="1" aria-label="Tambah">+</button></div> <span class="muted">stok ${p.stock}</span>`
        : '<p class="note">Stok sedang habis. Tanyakan ketersediaan lewat WhatsApp.</p>'}</div>
    <div class="buybar"><span class="tot"><small>Harga</small><b>${rupiah(p.price)}</b></span>
      ${p.stock > 0 ? '<button class="primary" id="add">Masukkan keranjang</button>' : `<a class="primary" href="https://wa.me/${waNumber(shop?.wa)}?text=${encodeURIComponent(`Halo, ${p.name} ada stok lagi?`)}">${I.wa} Tanya stok</a>`}</div>`;
  const drawPics = () => {
    const list = pics();
    $('#sl').innerHTML = list.map((src, i) => `<img src="${src}" alt="${esc(p.name)} foto ${i + 1}">`).join('');
    $('#dots').innerHTML = list.length > 1 ? list.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('') : '';
    $('#th').innerHTML = list.length > 1 ? list.map((src, i) => `<button class="${i ? '' : 'on'}" data-go="${i}" aria-label="Foto ${i + 1}"><img src="${src}" alt=""></button>`).join('') : '';
    $$('[data-go]').forEach((b) => b.onclick = () => $('#sl').scrollTo({ left: $('#sl').clientWidth * Number(b.dataset.go), behavior: 'smooth' }));
  };
  $('#sl').addEventListener('scroll', () => {
    const i = Math.round($('#sl').scrollLeft / $('#sl').clientWidth);
    $$('#dots i').forEach((d, j) => d.classList.toggle('on', j === i));
    $$('#th button').forEach((d, j) => d.classList.toggle('on', j === i));
  }, { passive: true });
  drawPics();
  bindHearts(view);
  $$('[data-size]').forEach((b) => b.onclick = () => { size = b.dataset.size; $$('[data-size]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); }); });
  $$('[data-q]').forEach((b) => b.onclick = () => { qty = Math.min(p.stock, Math.max(1, qty + Number(b.dataset.q))); $('#qn').textContent = qty; });
  $('#add')?.addEventListener('click', () => {
    if (p.sizes?.length && !size) { toast('Pilih ukuran dulu ya.'); $('.sizes')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    const hit = cart.find((c) => c.id === p.id && c.size === size);
    if (hit) hit.qty = Math.min(p.stock, hit.qty + qty); else cart.push({ id: p.id, size, qty });
    save(KEY.cart, cart); badge(); toast(`Masuk keranjang (${count()} barang).`);
  });
  if (p.photoCount && !photoCache.has(p.id)) {
    const got = await getPhotos(p).catch(() => []);
    if (got.length) { photoCache.set(p.id, got); if (location.hash === `#/p/${encodeURIComponent(p.id)}`) drawPics(); }
  }
}

// ---------- favorit ----------
function favorites() {
  const list = products.filter((p) => fav.has(p.id));
  view.innerHTML = `<h1 class="page-h">Favorit</h1>
    <div class="grid" id="grid">${list.map(card).join('') || '<div class="empty" style="grid-column:1/-1">Belum ada favorit. Ketuk ikon hati di produk yang kamu suka.</div>'}</div>`;
  bindHearts(view, favorites);
}

// ---------- keranjang & pesan ----------
function cartPage() {
  const ls = lines();
  if (!ls.length) { view.innerHTML = `<h1 class="page-h">Keranjang</h1><div class="empty"><p>Keranjang masih kosong.</p><a class="cta" href="#/">Mulai belanja ${I.arrow}</a></div>`; return; }
  const b = load(KEY.buyer, { name: '', phone: '', address: '', pay: 'transfer', note: '' });
  document.body.classList.add('detail');
  view.innerHTML = `<h1 class="page-h">Keranjang</h1>
    <div id="lines"></div>
    <form class="box" id="form" novalidate>
      <label for="bn">Nama penerima</label><input type="text" id="bn" autocomplete="name" value="${esc(b.name)}" required>
      <label for="bp">No. HP / WhatsApp</label><input type="tel" id="bp" autocomplete="tel" inputmode="tel" value="${esc(b.phone)}" required>
      <label for="ba">Alamat lengkap</label><textarea id="ba" autocomplete="street-address" placeholder="Jalan, RT/RW, desa, kecamatan, kota" required>${esc(b.address)}</textarea>
      <label>Pembayaran</label>
      <div class="pay"><label><input type="radio" name="pay" value="transfer" ${b.pay !== 'cod' ? 'checked' : ''}> Transfer</label><label><input type="radio" name="pay" value="cod" ${b.pay === 'cod' ? 'checked' : ''}> COD</label></div>
      <label for="bt">Catatan (opsional)</label><input type="text" id="bt" value="${esc(b.note)}" placeholder="Misal: warna kedua kalau habis">
      <div class="sum"><span class="muted">Ongkir</span><span class="muted">dikonfirmasi lewat WhatsApp</span></div>
    </form>
    <div class="buybar"><span class="tot"><small>Total (${count()} barang)</small><b id="tot"></b></span><button class="primary" id="send">${I.wa} Pesan via WhatsApp</button></div>`;
  const draw = () => {
    const cur = lines();
    if (!cur.length) return cartPage();
    $('#lines').innerHTML = cur.map((c, i) => `<div class="ci">${c.p.thumb ? `<img src="${c.p.thumb}" alt="">` : '<span style="width:72px"></span>'}
      <div class="grow"><a class="nm" href="#/p/${encodeURIComponent(c.id)}" style="text-decoration:none">${esc(c.p.name)}</a><span class="muted">${c.size ? `Ukuran ${esc(c.size)}` : 'All size'}</span>
      <div class="row"><b>${rupiah(c.p.price * c.qty)}</b><div class="stepper"><button data-d="${i}" data-v="-1" aria-label="Kurangi">−</button><b>${c.qty}</b><button data-d="${i}" data-v="1" aria-label="Tambah">+</button></div></div></div></div>`).join('');
    $('#tot').textContent = rupiah(total());
    $('.tot small').textContent = `Total (${count()} barang)`;
    $$('[data-d]').forEach((btn) => btn.onclick = () => {
      const c = cart[Number(btn.dataset.d)], p = products.find((x) => x.id === c.id);
      c.qty = Math.min(p?.stock || 0, c.qty + Number(btn.dataset.v));
      if (c.qty <= 0) cart.splice(Number(btn.dataset.d), 1);
      save(KEY.cart, cart); badge(); draw();
    });
  };
  draw();
  $('#send').onclick = async () => {
    const v = { name: $('#bn').value.trim(), phone: $('#bp').value.trim(), address: $('#ba').value.trim(), pay: $('input[name=pay]:checked').value, note: $('#bt').value.trim() };
    save(KEY.buyer, v);
    const miss = [['bn', v.name], ['bp', v.phone], ['ba', v.address]].find(([, x]) => !x);
    if (miss) { toast('Isi nama, no. HP, dan alamat dulu ya.'); $(`#${miss[0]}`).focus(); return; }
    const btn = $('#send'); btn.disabled = true; btn.textContent = 'Mengirim…';
    const items = lines().map((c) => ({ id: c.id, name: c.p.name, size: c.size, qty: c.qty, price: c.p.price }));
    const order = { name: v.name, phone: normalizePhone(v.phone) || v.phone, address: v.address, pay: v.pay, note: v.note, items, total: total() };
    try { await createOrder(order); } catch (e) { console.error(e); } // WhatsApp tetap terbuka walau pencatatan gagal
    const url = `https://wa.me/${waNumber(shop?.wa)}?text=${encodeURIComponent(waText(order))}`;
    cart = []; save(KEY.cart, cart); badge();
    view.innerHTML = `<div class="empty"><h1 class="page-h">Pesanan terkirim</h1><p>Lanjutkan di WhatsApp untuk konfirmasi ongkir dan pembayaran.</p>
      <a class="primary" href="${url}" style="max-width:280px;margin:16px auto 0">${I.wa} Buka WhatsApp</a><p><a href="#/">Kembali belanja</a></p></div>`;
    document.body.classList.remove('detail');
    location.href = url;
  };
}

// Nomor toko bawaan dipakai kalau Info toko belum disimpan di admin.
const WA_DEFAULT = '081226123571';
const waNumber = (n) => { const d = String(n || '').replace(/\D/g, '') || WA_DEFAULT; return d.startsWith('0') ? `62${d.slice(1)}` : d; };

// Pesan memakai label "Nama:", "HP:", "Alamat:", "COD" supaya bisa ditempel ke aplikasi cetak.
function waText(o) {
  return [
    `Halo ${shop?.name || 'Kafiya Daily'}, saya mau pesan:`,
    ...o.items.map((it, i) => `${i + 1}. ${it.name}${it.size ? ` (${it.size})` : ''} x${it.qty} = ${rupiah(it.price * it.qty)}`),
    `Total: ${rupiah(o.total)} (belum ongkir)`,
    '',
    `Nama: ${o.name}`,
    `HP: ${o.phone}`,
    `Alamat: ${o.address}`,
    o.pay === 'cod' ? `Pembayaran: COD ${rupiah(o.total)}` : 'Pembayaran: Transfer',
    o.note ? `Catatan: ${o.note}` : '',
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
}

badge();
start();
