// Olah logo: hapus latar putih, potong ruang kosong, kecilkan; plus versi hitam-putih.
const load = (src) => new Promise((res, rej) => {
  const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src;
});
const toDataURL = (file) => new Promise((res, rej) => {
  const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file);
});

export async function processLogo(file) {
  const img = await load(await toDataURL(file));
  const sc = Math.min(1, 600 / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * sc)), h = Math.max(1, Math.round(img.height * sc));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h), px = d.data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, m = Math.min(px[i], px[i + 1], px[i + 2]);
    if (m >= 245) px[i + 3] = 0;
    else if (m >= 225) px[i + 3] = Math.round(px[i + 3] * (245 - m) / 20);
    if (px[i + 3] > 10) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  }
  if (x1 < 0) throw new Error('Logo kosong.');
  ctx.putImageData(d, 0, 0);
  const o = document.createElement('canvas'); o.width = x1 - x0 + 1; o.height = y1 - y0 + 1;
  o.getContext('2d').drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
  return o.toDataURL('image/png');
}

const bwCache = new Map();
export async function toBW(dataUrl) {
  if (bwCache.has(dataUrl)) return bwCache.get(dataUrl);
  const img = await load(dataUrl);
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height), px = d.data;
  for (let i = 0; i < px.length; i += 4) {
    const lum = 0.3 * px[i] + 0.59 * px[i + 1] + 0.11 * px[i + 2];
    px[i] = px[i + 1] = px[i + 2] = 0;
    if (lum >= 200) px[i + 3] = 0;
  }
  ctx.putImageData(d, 0, 0);
  const out = c.toDataURL('image/png');
  bwCache.set(dataUrl, out);
  return out;
}

// Logo bawaan Kafiya Daily dipakai kalau pemilik belum mengunggah logo sendiri.
export const DEFAULT_LOGOS = { mark: 'assets/logo-mark.png', full: 'assets/logo-full.png' };

export async function logoSet(shop) {
  const pick = async (src) => (shop.bw ? toBW(src) : src);
  if (shop.logo) { const l = await pick(shop.logo); return { mark: l, full: l }; }
  return { mark: await pick(DEFAULT_LOGOS.mark), full: await pick(DEFAULT_LOGOS.full) };
}
