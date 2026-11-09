// Penghubung ke Firebase (Firestore + Auth, paket gratis Spark) untuk toko online.
// Pustaka Firebase dimuat dari gstatic hanya saat fitur toko dipakai, jadi aplikasi cetak tetap ringan.
//
// Koleksi:
//   config/shop       nama toko + nomor WhatsApp (dibaca halaman toko)
//   products/{id}     produk + foto kecil (thumb); urut lewat `sort`
//   photos/{id}_{n}   foto besar produk, satu dokumen per foto (batas dokumen Firestore 1 MB)
//   orders/{id}       pesanan dari halaman toko; dibuat pembeli, dibaca pemilik
import { firebaseConfig } from './firebase-config.js';

const V = '10.12.2';
const SDK = `https://www.gstatic.com/firebasejs/${V}`;
let ready;

// Emulator lokal untuk uji: buka dengan ?emu=1 (tersimpan di sessionStorage).
const useEmu = () => {
  try {
    if (new URLSearchParams(location.search).has('emu')) sessionStorage.setItem('kafiya-emu', '1');
    return sessionStorage.getItem('kafiya-emu') === '1';
  } catch { return false; }
};

export const configured = () => !!firebaseConfig?.apiKey || useEmu();

export function fb() {
  if (!configured()) return Promise.reject(new Error('Toko online belum disambungkan ke Firebase.'));
  ready ||= (async () => {
    const [app, fs, au] = await Promise.all([import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-firestore.js`), import(`${SDK}/firebase-auth.js`)]);
    const a = app.initializeApp(useEmu() ? { apiKey: 'demo', projectId: 'demo-kafiya', authDomain: 'localhost' } : firebaseConfig);
    const db = fs.getFirestore(a), auth = au.getAuth(a);
    if (useEmu()) { fs.connectFirestoreEmulator(db, '127.0.0.1', 8181); au.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true }); }
    return { fs, au, db, auth };
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

// ---------- akun pemilik ----------
export async function login(email, password) { const { au, auth } = await fb(); return (await au.signInWithEmailAndPassword(auth, email, password)).user; }
export async function logout() { const { au, auth } = await fb(); await au.signOut(auth); }
export async function currentUser() {
  const { au, auth } = await fb();
  await auth.authStateReady?.();
  return auth.currentUser || new Promise((res) => { const off = au.onAuthStateChanged(auth, (u) => { off(); res(u); }); });
}

// ---------- toko ----------
export async function getShopPublic() {
  const { fs, db } = await fb();
  const s = await fs.getDoc(fs.doc(db, 'config', 'shop'));
  return s.exists() ? s.data() : null;
}
export async function saveShopPublic(data) {
  const { fs, db } = await fb();
  await fs.setDoc(fs.doc(db, 'config', 'shop'), { name: data.name || '', wa: data.wa || '', about: data.about || '' });
}

// ---------- produk ----------
const toProduct = (d) => ({ id: d.id, ...d.data() });

export async function listProducts({ all = false } = {}) {
  const { fs, db } = await fb();
  const q = all ? fs.collection(db, 'products') : fs.query(fs.collection(db, 'products'), fs.where('active', '==', true));
  return (await fs.getDocs(q)).docs.map(toProduct).sort((a, b) => (b.sort || 0) - (a.sort || 0));
}

export async function getPhotos(p) {
  const { fs, db } = await fb();
  const snaps = await Promise.all(Array.from({ length: p.photoCount || 0 }, (_, i) => fs.getDoc(fs.doc(db, 'photos', `${p.id}_${i}`))));
  return snaps.filter((s) => s.exists()).map((s) => s.data().data);
}

// photos: array dataURL (sudah dikecilkan) atau null kalau foto tidak berubah.
export async function saveProduct(p, photos) {
  const { fs, db } = await fb();
  const ref = p.id ? fs.doc(db, 'products', p.id) : fs.doc(fs.collection(db, 'products'));
  const data = {
    name: p.name, category: p.category || '', desc: p.desc || '', price: Number(p.price) || 0,
    sizes: p.sizes || [], stock: Math.max(0, Number(p.stock) || 0), active: p.active !== false,
    sort: p.sort || Date.now(), updatedAt: Date.now(),
  };
  if (photos) {
    const old = p.photoCount || 0;
    for (const [i, src] of photos.entries()) await fs.setDoc(fs.doc(db, 'photos', `${ref.id}_${i}`), { data: src });
    for (let i = photos.length; i < old; i++) await fs.deleteDoc(fs.doc(db, 'photos', `${ref.id}_${i}`));
    Object.assign(data, { photoCount: photos.length, thumb: photos[0] ? await shrink(photos[0], 360, 30e3) : '' });
  }
  await fs.setDoc(ref, data, { merge: true });
  return ref.id;
}

export async function deleteProduct(p) {
  const { fs, db } = await fb();
  for (let i = 0; i < (p.photoCount || 0); i++) await fs.deleteDoc(fs.doc(db, 'photos', `${p.id}_${i}`));
  await fs.deleteDoc(fs.doc(db, 'products', p.id));
}

// ---------- pesanan dari toko ----------
export async function createOrder(o) {
  const { fs, db } = await fb();
  const ref = await fs.addDoc(fs.collection(db, 'orders'), { ...o, imported: false, createdAt: Date.now() });
  return ref.id;
}

export async function listNewOrders() {
  const { fs, db } = await fb();
  const q = fs.query(fs.collection(db, 'orders'), fs.where('imported', '==', false));
  return (await fs.getDocs(q)).docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.createdAt - b.createdAt);
}

// Tandai sudah diambil ke aplikasi cetak, dan kurangi stok produk yang dipesan.
export async function markImported(order) {
  const { fs, db } = await fb();
  const batch = fs.writeBatch(db);
  batch.update(fs.doc(db, 'orders', order.id), { imported: true });
  const qty = new Map();
  for (const it of order.items || []) qty.set(it.id, (qty.get(it.id) || 0) + (Number(it.qty) || 0));
  for (const [id, n] of qty) {
    const snap = await fs.getDoc(fs.doc(db, 'products', id));
    if (snap.exists()) batch.update(snap.ref, { stock: Math.max(0, (snap.data().stock || 0) - n) });
  }
  await batch.commit();
}

// ---------- foto ----------
const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

// Kecilkan gambar ke sisi terpanjang `max` px dan ukuran di bawah `limit` byte (WebP, turunkan kualitas bila perlu).
export async function shrink(src, max = 1000, limit = 180e3) {
  const img = await loadImg(typeof src === 'string' ? src : URL.createObjectURL(src));
  let side = max, out = '';
  for (let tries = 0; tries < 8; tries++) {
    const k = Math.min(1, side / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
    for (const q of [0.8, 0.7, 0.6, 0.5]) {
      out = c.toDataURL('image/webp', q);
      if (!out.startsWith('data:image/webp')) out = c.toDataURL('image/jpeg', q);
      if (out.length * 0.75 <= limit) return out;
    }
    side = Math.round(side * 0.8);
  }
  return out;
}
