// IndexedDB tipis: kv (pengaturan toko), customers, orders.
const NAME = 'kafiya-daily';
let dbp;

function open() {
  dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open(NAME, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('kv');
      d.createObjectStore('customers', { keyPath: 'id', autoIncrement: true });
      d.createObjectStore('orders', { keyPath: 'id', autoIncrement: true });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}

async function run(store, mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => res(req && req.result);
    t.onerror = t.onabort = () => rej(t.error);
  });
}

export const DEFAULT_SHOP = {
  name: 'Kafiya Daily.co', phone: '081226123571', logo: null, bw: false,
  dx: 0, dy: 0, used: null, lastBackup: null, paper: 'A4', cutLines: true,
};

export async function getShop() {
  const s = { ...DEFAULT_SHOP, ...((await run('kv', 'readonly', (st) => st.get('shop'))) || {}) };
  // Data lama: nama bawaan lama dan HP kosong diganti bawaan baru.
  if (s.name === 'Kafiya Daily') s.name = DEFAULT_SHOP.name;
  if (!s.phone) s.phone = DEFAULT_SHOP.phone;
  // Dulu posisi disimpan sebagai nomor slot 5 cm; sekarang dalam mm dari atas kolom.
  if (s.used == null) s.used = ((s.nextSlot || 1) - 1) * 50;
  return s;
}
export const saveShop = (shop) => run('kv', 'readwrite', (s) => s.put(shop, 'shop'));

export const all = (store) => run(store, 'readonly', (s) => s.getAll());
export const get = (store, id) => run(store, 'readonly', (s) => s.get(id));
export const put = (store, v) => run(store, 'readwrite', (s) => s.put(v));
export const del = (store, id) => run(store, 'readwrite', (s) => s.delete(id));

export async function exportAll() {
  return {
    app: 'kafiya-daily', version: 1, exportedAt: new Date().toISOString(),
    shop: await getShop(), customers: await all('customers'), orders: await all('orders'),
  };
}

export async function importAll(data) {
  if (!data || data.app !== 'kafiya-daily' || !Array.isArray(data.orders) || !Array.isArray(data.customers)) {
    throw new Error('File bukan backup Kafiya Daily.');
  }
  const db = await open();
  await new Promise((res, rej) => {
    const t = db.transaction(['kv', 'customers', 'orders'], 'readwrite');
    t.objectStore('kv').put({ ...DEFAULT_SHOP, ...data.shop }, 'shop');
    for (const n of ['customers', 'orders']) {
      const s = t.objectStore(n);
      s.clear();
      data[n].forEach((v) => s.put(v));
    }
    t.oncomplete = res;
    t.onerror = t.onabort = () => rej(t.error);
  });
}
