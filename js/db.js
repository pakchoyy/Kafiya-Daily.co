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
  name: 'Kafiya Daily', phone: '', logo: null, bw: false,
  dx: 0, dy: 0, nextSlot: 1, lastBackup: null, paper: 'A4', cutLines: true,
};

export const getShop = async () => ({ ...DEFAULT_SHOP, ...((await run('kv', 'readonly', (s) => s.get('shop'))) || {}) });
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
