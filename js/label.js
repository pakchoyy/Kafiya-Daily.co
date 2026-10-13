// Pembuat label 7 × 5 cm dan lembar A4 (kolom tengah, slot 1–5 dari atas).
import { logoSet } from './logo.js';

export const LABEL_W = 70, LABEL_H = 50;
const MIN_MARGIN = 10; // mm atas/bawah yang biasanya tidak bisa dicetak printer
// h = ukuran halaman yang dikirim ke printer; sheetH = tinggi kertas fisik untuk menghitung posisi label.
// F4IL: kertas F4 dicetak dengan setelan "Indian Legal" (21,5 × 34,5 cm) untuk printer tanpa pilihan F4.
export const PAPERS = {
  A4: { w: 210, h: 297, name: 'A4 (21 × 29,7 cm)', dialog: 'A4' },
  F4: { w: 215, h: 330, name: 'F4 / Folio (21,5 × 33 cm)', dialog: 'F4 / Folio' },
  F4IL: { w: 215, h: 345, sheetH: 330, name: 'F4, printer pakai setelan Indian Legal', dialog: 'Indian Legal' },
};
// Kolom label di tengah kertas, lima slot di tengah tinggi kertas fisik.
export function paper(shop) {
  const p = PAPERS[shop?.paper] || PAPERS.A4;
  const sheetH = p.sheetH || p.h, slots = Math.floor((sheetH - 2 * MIN_MARGIN) / LABEL_H); // A4 = 5, F4 = 6
  return { ...p, slots, colX: (p.w - LABEL_W) / 2, top: (sheetH - slots * LABEL_H) / 2 };
}
export const slotsFor = (shop) => paper(shop).slots;
export const slotTop = (slot, shop) => paper(shop).top + (slot - 1) * LABEL_H;

// Garis putus-putus bantu gunting, hanya mengelilingi label yang dicetak kali ini
// (sisa kertas tetap bersih untuk dipakai lagi). Posisi dalam mm, sudah termasuk geser.
export function cutLines(shop, slots) {
  const g = paper(shop), x = g.colX + shop.dx, out = [];
  for (const s of new Set(slots)) {
    const y = g.top + shop.dy + (s - 1) * LABEL_H;
    out.push({ x1: x, y1: y, x2: x + LABEL_W, y2: y }, { x1: x, y1: y + LABEL_H, x2: x + LABEL_W, y2: y + LABEL_H },
      { x1: x, y1: y, x2: x, y2: y + LABEL_H }, { x1: x + LABEL_W, y1: y, x2: x + LABEL_W, y2: y + LABEL_H });
  }
  return out;
}
const cutSVG = (shop, slots) => {
  const g = paper(shop);
  return `<svg class="cuts" width="${g.w}mm" height="${g.h}mm" viewBox="0 0 ${g.w} ${g.h}">${cutLines(shop, slots)
    .map((l) => `<line x1="${l.x1}" y1="${l.y1}" x2="${l.x2}" y2="${l.y2}"/>`).join('')}</svg>`;
};
// Ukuran halaman cetak mengikuti kertas yang dipilih.
export function setPageSize(shop) {
  const g = paper(shop);
  let el = document.getElementById('page-size');
  if (!el) { el = document.createElement('style'); el.id = 'page-size'; document.head.append(el); }
  el.textContent = `@page { size: ${g.w}mm ${g.h}mm; margin: 0; } .sheet { width: ${g.w}mm; height: ${g.h - 1}mm; } #print-root { width: ${g.w}mm; }`;
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const courierName = (o) => (o.courier || 'Wahana').toUpperCase();

export const THANKS = 'Thanks for order \u263A\uFE0E';
export const fromLine = (shop) => `${shop.name}${shop.phone ? ` (${shop.phone})` : ''}`;

export function labelHTML(order, shop, logos) {
  if (order.type === 'shopee') {
    return `<div class="label shopee">
      <div class="lb-logo-wrap"><img class="lb-logo" src="${logos.full}" alt=""></div>
      <div class="lb-resi" data-max="20">${esc(order.resi)}</div>
      <div class="lb-foot">${THANKS}</div>
    </div>`;
  }
  return `<div class="label wahana">
    <div class="lb-head"><span class="lb-id"><img class="lb-logo" src="${logos.mark}" alt=""><span class="lb-name">${esc(shop.name)}</span></span><span class="lb-exp">${esc(courierName(order))}</span></div>
    <div class="lb-row"><b>Dari :</b> ${esc(fromLine(shop))}</div>
    <div class="lb-row"><b>Untuk :</b></div>
    <div class="lb-to"><b>${esc(order.name)}</b>${order.phone ? ` &middot; ${esc(order.phone)}` : ''}</div>
    <div class="lb-addr">${esc(order.address)}</div>
    <div class="lb-foot">${THANKS}</div>
  </div>`;
}

// Kecilkan huruf supaya muat. Mengembalikan false kalau sudah mentok dan masih meluap.
export function fitLabel(el) {
  let ok = true;
  const a = el.querySelector('.lb-addr');
  if (a) {
    let s = 8;
    a.style.fontSize = s + 'pt';
    while (a.scrollHeight > a.clientHeight + 0.5 && s > 5.5) a.style.fontSize = (s -= 0.25) + 'pt';
    if (a.scrollHeight > a.clientHeight + 0.5) ok = false;
  }
  const r = el.querySelector('.lb-resi:not(.blank)');
  if (r) {
    let s = Number(r.dataset.max);
    r.style.fontSize = s + 'pt';
    while (r.scrollWidth > r.clientWidth + 0.5 && s > 8) r.style.fontSize = (s -= 0.5) + 'pt';
    if (r.scrollWidth > r.clientWidth + 0.5) ok = false;
  }
  return ok;
}

// chunks: [{ slots:[n..], orders:[...] }] -> satu .sheet A4 per chunk
export async function sheetsHTML(chunks, shop) {
  const logos = await logoSet(shop);
  setPageSize(shop);
  const left = paper(shop).colX;
  return chunks.map((ch) => `<section class="sheet" style="--dx:${shop.dx}mm;--dy:${shop.dy}mm;--col:${left}mm">${shop.cutLines !== false ? cutSVG(shop, ch.slots) : ''}${
    ch.orders.map((o, i) => `<div class="slot" style="top:${slotTop(ch.slots[i], shop)}mm">${labelHTML(o, shop, logos)}</div>`).join('')
  }</section>`).join('');
}

export function testSheetHTML(shop) {
  setPageSize(shop);
  const cells = Array.from({ length: slotsFor(shop) }, (_, i) => `<div class="slot test" style="top:${slotTop(i + 1, shop)}mm">
    <div class="label testbox"><i class="h"></i><i class="v"></i><b>Slot ${i + 1}</b><span>70 × 50 mm</span></div></div>`).join('');
  return `<section class="sheet" style="--dx:${shop.dx}mm;--dy:${shop.dy}mm;--col:${paper(shop).colX}mm">${cells}</section>`;
}

// Cetak lewat #print-root; fitLabel dijalankan saat elemen sudah ada di DOM (di luar layar).
export async function printHTML(html) {
  const root = document.getElementById('print-root');
  root.innerHTML = html;
  // Tunggu logo selesai dimuat, kalau tidak bisa hilang dari hasil cetak.
  await Promise.all([...root.querySelectorAll('img')].map((i) => i.decode().catch(() => {})));
  const bad = [...root.querySelectorAll('.label.wahana, .label.shopee')].filter((l) => !fitLabel(l)).length;
  window.print();
  return bad;
}
