// Gambar lembar A4 (300 dpi) berisi label di slotnya, lalu unduh sebagai JPG.
// Digambar langsung ke canvas supaya tidak perlu pustaka tambahan.
import { logoSet } from './logo.js';
import { LABEL_W, LABEL_H, slotTop, paper, cutLines } from './label.js';

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

function drawLabel(ctx, o, shop, img) {
  const P = 2.5, W = LABEL_W - 2 * P;
  ctx.fillStyle = '#000'; ctx.strokeStyle = '#000'; ctx.lineWidth = 0.3; ctx.textBaseline = 'alphabetic';
  if (o.type === 'shopee') {
    drawImgFit(ctx, img.full, P, 6, W, 15, true);
    fitLine(ctx, o.resi, LABEL_W / 2, 33, W, 20, 8, true, 'center');
    return;
  }
  // kepala: logo + nama toko, ekspedisi di kanan, garis bawah
  const lw = drawImgFit(ctx, img.mark, P, P, 14, 8.5, false);
  font(ctx, 11, true); ctx.textAlign = 'right'; const courier = (o.courier || 'Wahana').toUpperCase();
  ctx.fillText(courier, LABEL_W - P, P + 6); const cw = ctx.measureText(courier).width; ctx.textAlign = 'left';
  fitLine(ctx, shop.name || '', P + lw + 1.5, P + 5.5, W - lw - cw - 4, 8, 6, true);
  ctx.beginPath(); ctx.moveTo(P, 12); ctx.lineTo(LABEL_W - P, 12); ctx.stroke();
  if (o.resi) fitLine(ctx, o.resi, LABEL_W / 2, 18.5, W, 15, 8, true, 'center');
  else { font(ctx, 8, false); ctx.fillText('No. resi:', P, 18.5); ctx.beginPath(); ctx.moveTo(P + 13, 18.8); ctx.lineTo(LABEL_W - P, 18.8); ctx.stroke(); }
  // penerima
  font(ctx, 10, true); ctx.fillText(o.name, P, 23.5, W);
  const nw = Math.min(W, ctx.measureText(o.name).width);
  if (o.phone) { font(ctx, 10, false); ctx.fillText(` · ${o.phone}`, P + nw, 23.5, Math.max(0, W - nw)); }
  // alamat: kecilkan sampai muat
  const top = 25, bottom = LABEL_H - P - 4;
  let pt = 8, lines;
  for (; ; pt -= 0.25) {
    font(ctx, pt, false); lines = wrap(ctx, o.address, W);
    if (lines.length * pt * PT * 1.15 <= bottom - top || pt <= 5.5) break;
  }
  const lh = pt * PT * 1.15;
  lines.forEach((l, i) => { if (top + (i + 1) * lh <= bottom + 0.5) ctx.fillText(l, P, top + (i + 1) * lh - lh * 0.2); });
  // kaki: pengirim dan berat
  ctx.beginPath(); ctx.moveTo(P, bottom + 0.8); ctx.lineTo(LABEL_W - P, bottom + 0.8); ctx.stroke();
  font(ctx, 6.5, true); ctx.textAlign = 'right'; const wt = o.weight ? `${o.weight} kg` : '';
  ctx.fillText(wt, LABEL_W - P, LABEL_H - P - 0.6); const ww = ctx.measureText(wt).width; ctx.textAlign = 'left';
  font(ctx, 6.5, false);
  ctx.fillText(`Dari: ${shop.name}${shop.phone ? ` · ${shop.phone}` : ''}`, P, LABEL_H - P - 0.6, W - ww - 2);
}

// chunk: { slots:[...], orders:[...] } — sama dengan yang dipakai saat cetak.
export async function sheetJPG(chunk, shop) {
  const logos = await logoSet(shop);
  const img = { mark: await loadImg(logos.mark), full: await loadImg(logos.full) };
  const c = document.createElement('canvas');
  const g = paper(shop);
  c.width = Math.round(g.w * K); c.height = Math.round(g.h * K);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.scale(K, K);
  if (shop.cutLines !== false) {
    ctx.save(); ctx.strokeStyle = '#9a9a9a'; ctx.lineWidth = 0.2; ctx.setLineDash([1.5, 1]);
    for (const l of cutLines(shop)) { ctx.beginPath(); ctx.moveTo(l.x1, l.y1); ctx.lineTo(l.x2, l.y2); ctx.stroke(); }
    ctx.restore();
  }
  chunk.orders.forEach((o, i) => {
    ctx.save();
    ctx.translate(g.colX + shop.dx, slotTop(chunk.slots[i], shop) + shop.dy);
    ctx.beginPath(); ctx.rect(0, 0, LABEL_W, LABEL_H); ctx.clip();
    drawLabel(ctx, o, shop, img);
    ctx.restore();
  });
  return new Promise((res) => c.toBlob(res, 'image/jpeg', 0.92));
}

export function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
