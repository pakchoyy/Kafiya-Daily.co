// OCR di HP pakai Tesseract.js (gratis, tanpa API key; gambar tidak dikirim ke server).
// Pustaka dan data bahasa (~5 MB) diunduh sekali saat pertama dipakai, lalu di-cache.
const SRC = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
let loading;

function loadLib() {
  if (window.Tesseract) return Promise.resolve();
  loading ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = SRC; s.onload = res;
    s.onerror = () => { loading = null; rej(new Error('Gagal memuat OCR. Perlu internet saat pertama kali.')); };
    document.head.append(s);
  });
  return loading;
}

// Siapkan gambar: teks berwarna (mis. resi merah) dan mode gelap jadi teks gelap di latar putih.
export async function prepare(file) {
  const bmp = await createImageBitmap(file);
  const sc = Math.min(2, Math.max(1, 1600 / bmp.width));
  const w = Math.round(bmp.width * sc), h = Math.round(bmp.height * sc);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h), px = d.data;
  let sum = 0;
  for (let i = 0; i < px.length; i += 4) { const v = Math.max(px[i], px[i + 1], px[i + 2]); px[i] = v; sum += v; }
  const dark = sum / (px.length / 4) < 128;
  for (let i = 0; i < px.length; i += 4) {
    let v = dark ? 255 - px[i] : px[i];
    v = Math.max(0, Math.min(255, (v - 128) * 1.6 + 128));
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  ctx.putImageData(d, 0, 0);
  return c;
}

let worker;
async function getWorker() {
  await loadLib();
  if (!worker) {
    worker = window.Tesseract.createWorker('ind+eng', 1, { logger: (m) => m.status === 'recognizing text' && progressCb?.(Math.round(m.progress * 100)) })
      .then(async (w) => { await w.setParameters({ tessedit_pageseg_mode: '11' }); return w; }) // 11 = teks tersebar, cocok untuk screenshot
      .catch((e) => { worker = null; throw e; });
  }
  return worker;
}
let progressCb;

export async function readImage(file, onProgress) {
  const w = await getWorker();
  progressCb = onProgress;
  const { data } = await w.recognize(await prepare(file));
  return data.text;
}
