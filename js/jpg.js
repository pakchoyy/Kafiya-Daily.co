// Gambar satu lembar kertas (300 dpi) berisi label di posisinya, lalu unduh sebagai JPG.
// Digambar langsung ke canvas supaya tidak perlu pustaka tambahan.
import { logoSet } from './logo.js';
import { drawBarcode } from './barcode.js';
import { LABEL_W, LABEL_H, labelH, paper, cutLines, boxesOf, THANKS, codText, courierTag } from './label.js';

const K = 300 / 25.4;        // piksel per mm
const PT = 0.3528;           // mm per pt
const FONT = 'Arial, Helvetica, sans-serif';

const loadImg = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
const font = (ctx, pt, bold) => { ctx.font = `${bold ? 'bold ' : ''}${pt * PT}px ${FONT}`; };

// Tulis satu baris, kecilkan sampai muat lebar.
function fitLine(ctx, text, x, y, maxW, pt, minPt, bold, align = 'left') {
  for (; pt > minPt; pt -= 0.5) { font(ctx, pt, bold); if (ctx.measureText(text).width <= maxW) break; }
  ctx.textAlign = align; ctx.fillText(text, x, y, maxW); ctx.textAlign = 'left';
}

function wrap(ctx, text, maxW) {
  const lines = []; let line = '';
  for (const w of text.split(/\s+/)) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

function drawImgFit(ctx, img, x, y, maxW, maxH, center) {
  if (!img) return 0;
  const s = Math.min(maxW / img.width, maxH / img.height);
  const w = img.width * s, h = img.height * s;
  ctx.drawImage(img, center ? x + (maxW - w) / 2 : x, y + (maxH - h) / 2, w, h);
  return w;
}

function drawFoot(ctx, y, W, P) {
  ctx.beginPath(); ctx.moveTo(P, y); ctx.lineTo(P + W, y); ctx.stroke();
  ctx.font = `italic ${7.5 * PT}px ${FONT}`; ctx.textAlign = 'center';
  ctx.fillText(THANKS, LABEL_W / 2, y + 3.3); ctx.textAlign = 'left';
}

function drawLabel(ctx, o, shop, img) {
  if (o.type === 'shopee-img') { drawImgFit(ctx, img.own, 1, 1, LABEL_W - 2, o.h - 2, true); return; }
  const P = 4.5, W = LABEL_W - 2 * P; // sisi kiri-kanan; atas-bawah tetap 2.5
  ctx.fillStyle = '#000'; ctx.strokeStyle = '#000'; ctx.lineWidth = 0.3; ctx.textBaseline = 'alphabetic';
  if (o.type === 'shopee') {
    drawImgFit(ctx, img.full, P, 3, W, 11, true);
    drawBarcode(ctx, o.resi, (LABEL_W - 52) / 2, 16, 52, 11);
    fitLine(ctx, o.resi, LABEL_W / 2, 34, W, 17, 8, true, 'center');
    drawFoot(ctx, 37, W, P);
    return;
  }
  // bingkai membulat
  ctx.lineWidth = 0.35; ctx.beginPath(); ctx.roundRect(1.4, 1.4, LABEL_W - 2.8, LABEL_H - 2.8, 3); ctx.stroke(); ctx.lineWidth = 0.3;
  // kepala: logo + nama & HP toko, tag kurir (bukan Wahana) di kanan, garis putus-putus
  const lw = drawImgFit(ctx, img.mark, P, 3, 11, 7.5, false);
  const tag = courierTag(o); let cw = 0;
  if (tag) {
    font(ctx, 8, true); cw = ctx.measureText(tag).width + 3.2;
    ctx.beginPath(); ctx.roundRect(LABEL_W - P - cw, 4.6, cw, 4.4, 2); ctx.stroke();
    ctx.textAlign = 'center'; ctx.fillText(tag, LABEL_W - P - cw / 2, 7.9); ctx.textAlign = 'left';
  }
  fitLine(ctx, shop.name || '', P + lw + 1.5, shop.phone ? 7 : 8.3, W - lw - cw - 3, 9, 6, true);
  if (shop.phone) { font(ctx, 7, false); ctx.fillText(shop.phone, P + lw + 1.5, 10.2); }
  ctx.save(); ctx.lineWidth = 0.25; ctx.setLineDash([0.8, 0.6]); ctx.beginPath(); ctx.moveTo(P, 12.4); ctx.lineTo(LABEL_W - P, 12.4); ctx.stroke(); ctx.restore();
  // penerima
  font(ctx, 6, true); ctx.fillText('U N T U K', P, 16);
  font(ctx, 12, true); const ph = o.phone ? (font(ctx, 9, false), ctx.measureText(o.phone).width + 1.8) : 0;
  font(ctx, 12, true); ctx.fillText(o.name, P, 20.6, W - ph);
  if (o.phone) { const nw = Math.min(W - ph, ctx.measureText(o.name).width); font(ctx, 9, false); ctx.fillText(o.phone, P + nw + 1.8, 20.6); }
  // alamat: kecilkan sampai muat di atas kaki
  const footY = LABEL_H - 6.6, top = 21.6, codH = o.cod ? 6 : 0, bottom = footY - 0.8 - codH;
  let pt = 8, lines;
  for (; ; pt -= 0.25) {
    font(ctx, pt, false); lines = wrap(ctx, o.address, W);
    if (lines.length * pt * PT * 1.15 <= bottom - top || pt <= 5.5) break;
  }
  const lh = pt * PT * 1.15;
  lines.forEach((l, i) => { if (top + (i + 1) * lh <= bottom + 0.5) ctx.fillText(l, P, top + (i + 1) * lh - lh * 0.2); });
  if (o.cod) {
    ctx.beginPath(); ctx.roundRect(P, footY - codH - 0.4, W, codH - 0.6, 1.6); ctx.fill();
    ctx.fillStyle = '#fff'; font(ctx, 11, true); ctx.textAlign = 'center';
    ctx.fillText(codText(o), LABEL_W / 2, footY - 2.2, W - 2); ctx.textAlign = 'left'; ctx.fillStyle = '#000';
  }
  ctx.font = `italic ${7.5 * PT}px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText(THANKS, LABEL_W / 2, footY + 3.4); ctx.textAlign = 'left';
}

// chunk: { orders:[...], ys:[...] }, sama dengan yang dipakai saat cetak.
export async function sheetJPG(chunk, shop) {
  const logos = await logoSet(shop);
  const img = { mark: await loadImg(logos.mark), full: await loadImg(logos.full) };
  const owns = await Promise.all(chunk.orders.map((o) => (o.img ? loadImg(o.img) : null)));
  const c = document.createElement('canvas');
  const g = paper(shop);
  c.width = Math.round(g.w * K); c.height = Math.round(g.h * K);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.scale(K, K);
  if (shop.cutLines !== false) {
    ctx.save(); ctx.strokeStyle = '#9a9a9a'; ctx.lineWidth = 0.2; ctx.setLineDash([1.5, 1]);
    for (const l of cutLines(shop, boxesOf(chunk))) { ctx.beginPath(); ctx.moveTo(l.x1, l.y1); ctx.lineTo(l.x2, l.y2); ctx.stroke(); }
    ctx.restore();
  }
  chunk.orders.forEach((o, i) => {
    ctx.save();
    ctx.translate(g.colX + shop.dx, g.top + chunk.ys[i] + shop.dy);
    ctx.beginPath(); ctx.rect(0, 0, LABEL_W, labelH(o)); ctx.clip();
    drawLabel(ctx, o, shop, { ...img, own: owns[i] });
    ctx.restore();
  });
  return new Promise((res) => c.toBlob(res, 'image/jpeg', 0.92));
}

export function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
