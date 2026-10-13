// Label asli Shopee dari PDF atau screenshot: potong otomatis kotak labelnya, lalu baca no. resi.
import { readBarcodes, readImage } from './ocr.js';
import { extractResi, isKnownResi, parseChatOcr } from './parser.js';
import { LABEL_W } from './label.js';

const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/';
const JSQR = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';

let qrLoading;
function loadJsQR() {
  if (window.jsQR) return Promise.resolve(window.jsQR);
  qrLoading ||= new Promise((res) => {
    const s = document.createElement('script'); s.src = JSQR;
    s.onload = () => res(window.jsQR); s.onerror = () => { qrLoading = null; res(null); };
    document.head.append(s);
  });
  return qrLoading;
}
// QR di label Shopee berisi no. resi; jsQR jalan di semua browser (BarcodeDetector hanya sebagian).
async function readQR(c) {
  const jsQR = await loadJsQR();
  if (!jsQR) return '';
  const tries = [c];
  // QR biasanya di kanan bawah; potongan kecil lebih mudah dibaca.
  const q = document.createElement('canvas'); q.width = Math.round(c.width / 2); q.height = Math.round(c.height / 2);
  q.getContext('2d').drawImage(c, c.width / 2, c.height / 2, q.width, q.height, 0, 0, q.width, q.height);
  tries.push(q);
  for (const t of tries) {
    const d = t.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, t.width, t.height);
    const r = jsQR(d.data, t.width, t.height);
    if (r?.data) return r.data.trim().toUpperCase();
  }
  return '';
}
const IMG_PAD = 1; // mm ruang putih di sekeliling gambar label

let pdfLoading;
function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  pdfLoading ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = PDFJS + 'pdf.min.js';
    s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js'; res(window.pdfjsLib); };
    s.onerror = () => { pdfLoading = null; rej(new Error('Gagal memuat pembaca PDF. Perlu internet saat pertama kali.')); };
    document.head.append(s);
  });
  return pdfLoading;
}

// File (PDF/gambar) -> daftar canvas; satu halaman PDF = satu canvas.
async function toCanvases(file) {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    const lib = await loadPdfJs();
    const pdf = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
    const out = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const vp0 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: Math.min(4, 2000 / vp0.width) });
      const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      out.push(c);
    }
    return out;
  }
  const bmp = await createImageBitmap(file);
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0);
  return [c];
}

// Cari kotak label: area kertas putih dulu (screenshot bisa berlatar gelap), lalu garis tepi tegak
// yang panjang di kiri dan kanan. Kalau tidak ketemu, pakai batas tinta di area kertas.
function findLabelBox(gray, W, H) {
  const g = (x, y) => gray[y * W + x];
  // Rentang true terpanjang; celah pendek (garis tepi label yang gelap) tidak memutus rentang.
  const longestRun = (arr, gap = 12) => {
    let best = [0, -1], s = -1, e = -1, miss = 0;
    for (let i = 0; i <= arr.length + gap; i++) {
      if (i < arr.length && arr[i]) { if (s < 0) s = i; e = i; miss = 0; continue; }
      if (s >= 0 && ++miss > gap) { if (e - s > best[1] - best[0]) best = [s, e]; s = -1; miss = 0; }
    }
    return best;
  };
  const rowLight = Array.from({ length: H }, (_, y) => { let n = 0; for (let x = 0; x < W; x += 2) if (g(x, y) > 200) n++; return n / (W / 2) > 0.3; });
  let [py0, py1] = longestRun(rowLight);
  const colLight = Array.from({ length: W }, (_, x) => { let n = 0; for (let y = py0; y <= py1; y += 2) if (g(x, y) > 200) n++; return n / ((py1 - py0 + 1) / 2) > 0.3; });
  let [px0, px1] = longestRun(colLight);
  if (px1 <= px0 || py1 <= py0) return null;
  // lebarkan sedikit supaya garis tepi label di pinggir area putih ikut masuk
  const pad = 12;
  px0 = Math.max(0, px0 - pad); px1 = Math.min(W - 1, px1 + pad); py0 = Math.max(0, py0 - pad); py1 = Math.min(H - 1, py1 + pad);
  // Garis tegak terpanjang per kolom. Garis tipis hasil perbesaran bisa abu-abu dan putus sedikit,
  // jadi ambang 160 dan celah sampai 3 px masih dianggap satu garis.
  const runs = [];
  for (let x = px0; x <= px1; x++) {
    let s = -1, e = -1, miss = 0, best = [0, -1];
    for (let y = py0; y <= py1 + 4; y++) {
      if (y <= py1 && g(x, y) < 160) { if (s < 0) s = y; e = y; miss = 0; continue; }
      if (s >= 0 && ++miss > 3) { if (e - s > best[1] - best[0]) best = [s, e]; s = -1; miss = 0; }
    }
    runs.push({ x, s: best[0], e: best[1], len: best[1] - best[0] });
  }
  const maxLen = Math.max(...runs.map((r) => r.len));
  const cands = runs.filter((r) => r.len >= maxLen * 0.6);
  if (maxLen >= (py1 - py0) * 0.25 && cands.length) {
    const xs = cands.map((r) => r.x);
    if (Math.max(...xs) - Math.min(...xs) > (px1 - px0) * 0.4) {
      return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...cands.map((r) => r.s)), y1: Math.max(...cands.map((r) => r.e)) };
    }
  }
  let x0 = px1, x1 = px0, y0 = py1, y1 = py0;
  for (let y = py0; y <= py1; y += 2) for (let x = px0; x <= px1; x += 2) if (g(x, y) < 110) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return x1 > x0 ? { x0, x1, y0, y1 } : null;
}

function crop(c) {
  const W = c.width, H = c.height, d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  const gray = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) gray[i] = (d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 3;
  const b = findLabelBox(gray, W, H) || { x0: 0, y0: 0, x1: W - 1, y1: H - 1 };
  const p = 3, x0 = Math.max(0, b.x0 - p), y0 = Math.max(0, b.y0 - p), x1 = Math.min(W - 1, b.x1 + p), y1 = Math.min(H - 1, b.y1 + p);
  const o = document.createElement('canvas'); o.width = x1 - x0 + 1; o.height = y1 - y0 + 1;
  o.getContext('2d').drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
  return o;
}

// Putar 90° searah jarum jam: label Shopee yang lebar jadi tegak, supaya di kolom 7 cm isinya ±30% lebih besar.
function rotate(c) {
  const o = document.createElement('canvas'); o.width = c.height; o.height = c.width;
  const ctx = o.getContext('2d'); ctx.translate(o.width, 0); ctx.rotate(Math.PI / 2); ctx.drawImage(c, 0, 0);
  return o;
}

async function resiOf(c, file) {
  let resi = extractResi((await readBarcodes(file || c)).join('\n'))[0] || extractResi(await readQR(c))[0];
  if (!resi) { const blob = await new Promise((r) => c.toBlob(r, 'image/png')); resi = extractResi(await readImage(blob))[0] || ''; }
  return resi;
}

function labelItem(page, resi) {
  const c = rotate(crop(page));
  const w = LABEL_W - 2 * IMG_PAD;
  return { kind: 'shopee', img: c.toDataURL('image/png'), h: Math.round((w * c.height / c.width + 2 * IMG_PAD) * 10) / 10, resi };
}

// Kembalikan [{ kind:'shopee', img, h, resi }] untuk tiap label di file. h = tinggi label (mm) pada lebar 7 cm.
async function readShopeeLabels(file, onStep) {
  const out = [];
  for (const page of await toCanvases(file)) {
    onStep?.('Membaca resi…');
    const c = crop(page);
    out.push(labelItem(page, await resiOf(c)));
  }
  return out;
}

// Satu tombol untuk semua: PDF = label Shopee; gambar dengan QR/barcode/kata kunci resi = label Shopee;
// selain itu dianggap screenshot chat WhatsApp -> pesanan Wahana.
export async function readAny(file, onStep) {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return readShopeeLabels(file, onStep);
  const [page] = await toCanvases(file);
  onStep?.('Mencari barcode…');
  const codes = extractResi([...(await readBarcodes(file)), await readQR(page)].join('\n')).filter(isKnownResi);
  if (codes.length) return [labelItem(page, codes[0])];
  onStep?.('Membaca teks…');
  const text = await readImage(file, (p) => onStep?.(`Membaca teks ${p}%`));
  const resi = extractResi(text).filter(isKnownResi);
  if (resi.length && /shopee|spx|no\.?\s*resi|pengirim|penerima/i.test(text)) return [labelItem(page, resi[0])];
  return [{ kind: 'wahana', ...parseChatOcr(text) }];
}
