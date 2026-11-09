// Halaman toko untuk pembeli: katalog → keranjang → pesan via WhatsApp (pesanan juga tercatat di Firestore).
import { configured, listProducts, getPhotos, getShopPublic, createOrder } from '../js/cloud.js';
import { esc } from '../js/label.js';
import { rupiah, normalizePhone } from '../js/parser.js';

const main = document.getElementById('shop');
const bar = document.getElementById('cartbar');
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const CART_KEY = 'kafiya-cart';
const FORM_KEY = 'kafiya-buyer';

let products = [], shop = null, cat = 'Semua', q = '';
let cart = load(CART_KEY, []);
const photoCache = new Map();

function load(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }
function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* mode privat: keranjang hanya selama halaman terbuka */ } }

let toastT;
function toast(msg) {
  const t = document.getElementById('toast');
  t.className = 'toast-ok'; t.innerHTML = `<span>${esc(msg)}</span>`;
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600);
}

function sheet(html, mount) {
  const o = document.createElement('div');
  o.className = 'overlay';
  o.innerHTML = `<div class="sheet-modal" role="dialog" aria-modal="true">${html}</div>`;
  const back = document.activeElement;
  const close = () => { document.removeEventListener('keydown', key); o.remove(); back?.focus?.(); };
  const key = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', key);
  o.addEventListener('click', (e) => { if (e.target === o) close(); });
  document.body.append(o);
  o.querySelector('button, input, textarea')?.focus();
  mount(o, close);
}

// ---------- katalog ----------
async function start() {
  if (!configured()) { main.innerHTML = '<div class="empty"><p>Toko belum dibuka.</p></div>'; return; }
  try {
    [products, shop] = await Promise.all([listProducts(), getShopPublic()]);
  } catch (e) {
    console.error(e);
    main.innerHTML = '<div class="empty"><p>Katalog gagal dimuat. Periksa internet lalu coba lagi.</p><button class="btn block" id="retry">Coba lagi</button></div>';
    $('#retry').onclick = () => { main.innerHTML = '<p class="muted" style="text-align:center;padding:40px 0">Memuat katalog…</p>'; start(); };
    return;
  }
  cart = cart.filter((c) => products.some((p) => p.id === c.id));
  render(); drawBar();
}

function render() {
  const cats = ['Semua', ...new Set(products.map((p) => p.category).filter(Boolean))];
  const list = products.filter((p) => (cat === 'Semua' || p.category === cat) && (!q || `${p.name} ${p.category} ${p.desc}`.toLowerCase().includes(q.toLowerCase())));
  main.innerHTML = `<section class="intro"><h1 class="display" style="margin:0">${esc(shop?.name || 'Kafiya Daily')}</h1>
      ${shop?.about ? `<p class="muted">${esc(shop.about)}</p>` : ''}</section>
    <label class="search"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input type="search" id="q" placeholder="Cari baju…" value="${esc(q)}"></label>
    ${cats.length > 2 ? `<div class="chips">${cats.map((c) => `<button class="pill ${c === cat ? 'on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div>` : ''}
    <div class="grid">${list.map((p) => `<button class="pcard ${p.stock > 0 ? '' : 'out'}" data-p="${p.id}">
      <span class="ph">${p.thumb ? `<img src="${p.thumb}" alt="" loading="lazy">` : ''}</span>
      <span class="tx"><span class="nm">${esc(p.name)}</span><span class="pr">${rupiah(p.price)}</span>${p.stock > 0 ? '' : '<span class="soldout">Stok habis</span>'}</span></button>`).join('')}</div>
    ${list.length ? '' : `<div class="empty"><p>${products.length ? 'Tidak ada produk yang cocok.' : 'Belum ada produk. Cek lagi nanti ya.'}</p></div>`}`;
  $('#q').oninput = (e) => { q = e.target.value; const pos = e.target.selectionStart; render(); const i = $('#q'); i.focus(); i.setSelectionRange(pos, pos); };
  $$('[data-cat]').forEach((b) => b.onclick = () => { cat = b.dataset.cat; render(); });
  $$('[data-p]').forEach((b) => b.onclick = () => openProduct(products.find((p) => p.id === b.dataset.p)));
}

async function openProduct(p) {
  let size = p.sizes?.length === 1 ? p.sizes[0] : '', qty = 1;
  sheet(`<div class="gallery" id="gal">${p.thumb ? `<img src="${p.thumb}" alt="${esc(p.name)}">` : ''}</div>
    <h2 style="margin:0;border:0;padding:0;font-size:20px;text-transform:none;letter-spacing:0;color:var(--text)">${esc(p.name)}</h2>
    <div class="price-lg">${rupiah(p.price)}</div>
    ${p.desc ? `<p style="white-space:pre-line;margin:0 0 10px">${esc(p.desc)}</p>` : ''}
    ${p.sizes?.length ? `<label class="f">Ukuran</label><div class="sizes">${p.sizes.map((s) => `<button class="pill ${s === size ? 'on' : ''}" data-size="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : ''}
    ${p.stock > 0 ? `<label class="f">Jumlah</label><div class="qty"><button data-q="-1" aria-label="Kurangi">−</button><b id="qn">1</b><button data-q="1" aria-label="Tambah">+</button><span class="muted">stok ${p.stock}</span></div>
    <button class="btn block big" id="add">Masukkan keranjang</button>` : '<div class="banner">Stok habis. Tanyakan ketersediaan lewat WhatsApp.</div>'}`, async (o, close) => {
    $$('[data-size]', o).forEach((b) => b.onclick = () => { size = b.dataset.size; $$('[data-size]', o).forEach((x) => x.classList.toggle('on', x === b)); });
    $$('[data-q]', o).forEach((b) => b.onclick = () => { qty = Math.min(p.stock, Math.max(1, qty + Number(b.dataset.q))); $('#qn', o).textContent = qty; });
    $('#add', o)?.addEventListener('click', () => {
      if (p.sizes?.length && !size) return toast('Pilih ukuran dulu ya.');
      const hit = cart.find((c) => c.id === p.id && c.size === size);
      if (hit) hit.qty = Math.min(p.stock, hit.qty + qty); else cart.push({ id: p.id, size, qty });
      save(CART_KEY, cart); drawBar(); close(); toast('Masuk keranjang.');
    });
    if (p.photoCount) {
      const pics = photoCache.get(p.id) || await getPhotos(p).catch(() => []);
      photoCache.set(p.id, pics);
      if (pics.length && o.isConnected) $('#gal', o).innerHTML = pics.map((src) => `<img src="${src}" alt="${esc(p.name)}">`).join('');
    }
  });
}

// ---------- keranjang & pesan ----------
const lines = () => cart.map((c) => ({ ...c, p: products.find((p) => p.id === c.id) })).filter((c) => c.p);
const total = () => lines().reduce((a, c) => a + c.p.price * c.qty, 0);

function drawBar() {
  const n = cart.reduce((a, c) => a + c.qty, 0);
  bar.hidden = !n;
  bar.innerHTML = `<span>Keranjang · ${n} barang</span><b>${rupiah(total())}</b>`;
}
bar.onclick = () => openCart();

function openCart() {
  const buyer = load(FORM_KEY, { name: '', phone: '', address: '', pay: 'transfer', note: '' });
  sheet(`<h2 style="margin-top:0">Keranjang</h2><div id="lines"></div>
    <div class="total-row"><span>Total</span><span id="tot"></span></div>
    <p class="muted" style="margin:0">Belum termasuk ongkir. Ongkir dikonfirmasi lewat WhatsApp.</p>
    <h2>Data penerima</h2>
    <label class="f" for="bn">Nama penerima</label><input type="text" id="bn" autocomplete="name" value="${esc(buyer.name)}">
    <label class="f" for="bp">No. HP / WhatsApp</label><input type="tel" id="bp" autocomplete="tel" inputmode="tel" value="${esc(buyer.phone)}">
    <label class="f" for="ba">Alamat lengkap</label><textarea id="ba" autocomplete="street-address" placeholder="Jalan, RT/RW, desa, kecamatan, kota">${esc(buyer.address)}</textarea>
    <label class="f">Pembayaran</label>
    <div class="paypick"><label><input type="radio" name="pay" value="transfer" ${buyer.pay !== 'cod' ? 'checked' : ''}> Transfer</label><label><input type="radio" name="pay" value="cod" ${buyer.pay === 'cod' ? 'checked' : ''}> COD</label></div>
    <label class="f" for="bt">Catatan (opsional)</label><input type="text" id="bt" value="${esc(buyer.note)}" placeholder="Misal: warna kedua kalau habis">
    <button class="btn block big" id="send">Pesan via WhatsApp</button>`, (o, close) => {
    const draw = () => {
      const ls = lines();
      $('#lines', o).innerHTML = ls.length ? ls.map((c, i) => `<div class="citem">${c.p.thumb ? `<img src="${c.p.thumb}" alt="">` : '<span style="width:54px"></span>'}
        <div class="grow"><b class="ell" style="display:block">${esc(c.p.name)}</b><span class="muted">${c.size ? `Ukuran ${esc(c.size)} · ` : ''}${rupiah(c.p.price)}</span>
        <div class="qty" style="margin-top:4px"><button data-d="${i}" data-v="-1" aria-label="Kurangi">−</button><b>${c.qty}</b><button data-d="${i}" data-v="1" aria-label="Tambah">+</button></div></div></div>`).join('') : '<p class="muted">Keranjang kosong.</p>';
      $('#tot', o).textContent = rupiah(total());
      $$('[data-d]', o).forEach((b) => b.onclick = () => {
        const c = cart[Number(b.dataset.d)], p = products.find((x) => x.id === c.id);
        c.qty = Math.min(p?.stock || 0, c.qty + Number(b.dataset.v));
        if (c.qty <= 0) cart.splice(Number(b.dataset.d), 1);
        save(CART_KEY, cart); drawBar(); draw();
        if (!cart.length) close();
      });
    };
    draw();
    $('#send', o).onclick = async () => {
      const b = { name: $('#bn', o).value.trim(), phone: $('#bp', o).value.trim(), address: $('#ba', o).value.trim(), pay: $('input[name=pay]:checked', o).value, note: $('#bt', o).value.trim() };
      save(FORM_KEY, b);
      if (!b.name || !b.address || !b.phone) return toast('Isi nama, no. HP, dan alamat dulu ya.');
      if (!lines().length) return toast('Keranjang masih kosong.');
      const btn = $('#send', o); btn.disabled = true; btn.textContent = 'Mengirim…';
      const items = lines().map((c) => ({ id: c.id, name: c.p.name, size: c.size, qty: c.qty, price: c.p.price }));
      const order = { name: b.name, phone: normalizePhone(b.phone) || b.phone, address: b.address, pay: b.pay, note: b.note, items, total: total() };
      try { await createOrder(order); } catch (e) { console.error(e); } // WhatsApp tetap terkirim walau pencatatan gagal
      const wa = waNumber(shop?.wa);
      const url = `https://wa.me/${wa}?text=${encodeURIComponent(waText(order))}`;
      cart = []; save(CART_KEY, cart); drawBar(); close();
      main.insertAdjacentHTML('afterbegin', `<div class="banner ok">Pesanan tercatat. Kalau WhatsApp tidak terbuka, <a href="${url}">ketuk di sini</a>.</div>`);
      location.href = url;
    };
  });
}

const waNumber = (n) => { const d = String(n || '').replace(/\D/g, ''); return d.startsWith('0') ? `62${d.slice(1)}` : d; };

// Format pesan sengaja memakai label "Nama:", "HP:", "Alamat:", "COD" supaya bisa ditempel ke aplikasi cetak.
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

start();
