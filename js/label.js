// Pembuat label 7 × 5 cm dan lembar A4 (kolom tengah, slot 1–5 dari atas).
import { logoSet } from './logo.js';

export const LABEL_W = 70, LABEL_H = 50, SLOTS = 5;
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
  return { ...p, colX: (p.w - LABEL_W) / 2, top: ((p.sheetH || p.h) - SLOTS * LABEL_H) / 2 };
}
export const slotTop = (slot, shop) => paper(shop).top + (slot - 1) * LABEL_H;

// Garis putus-putus bantu gunting: dua garis tegak sepanjang kertas di tepi kolom,
// dan garis mendatar di batas tiap slot. Posisi dalam mm (sudah termasuk geser).
export function cutLines(shop) {
  const g = paper(shop), x = g.colX + shop.dx, y0 = g.top + shop.dy;
  const v = [x, x + LABEL_W].map((xx) => ({ x1: xx, y1: 0, x2: xx, y2: g.sheetH || g.h }));
  const h = Array.from({ length: SLOTS + 1 }, (_, i) => y0 + i * LABEL_H).map((yy) => ({ x1: x - 8, y1: yy, x2: x + LABEL_W + 8, y2: yy }));
  return [...v, ...h];
}
const cutSVG = (shop) => {
  const g = paper(shop);
  return `<svg class="cuts" width="${g.w}mm" height="${g.h}mm" viewBox="0 0 ${g.w} ${g.h}">${cutLines(shop)
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

export function labelHTML(order, shop, logos) {
  if (order.type === 'shopee') {
    return `<div class="label shopee">
      <div class="lb-logo-wrap"><img class="lb-logo" src="${logos.full}" alt=""></div>
      <div class="lb-resi" data-max="20">${esc(order.resi)}</div>
    </div>`;
  }
  const w = order.weight ? `${esc(order.weight)} kg` : '';
  return `<div class="label wahana">
    <div class="lb-head"><span class="lb-id"><img class="lb-logo" src="${logos.mark}" alt=""><span class="lb-name">${esc(shop.name)}</span></span><span class="lb-exp">${esc(courierName(order))}</span></div>
    <div class="lb-resi" data-max="15">${esc(order.resi)}</div>
    <div class="lb-to"><b>${esc(order.name)}</b>${order.phone ? ` &middot; ${esc(order.phone)}` : ''}</div>
    <div class="lb-addr">${esc(order.address)}</div>
    <div class="lb-from"><span>Dari: ${esc(shop.name)}${shop.phone ? ` &middot; ${esc(shop.phone)}` : ''}</span><span>${w}</span></div>
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
  const r = el.querySelector('.lb-resi');
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
  return chunks.map((ch) => `<section class="sheet" style="--dx:${shop.dx}mm;--dy:${shop.dy}mm;--col:${left}mm">${shop.cutLines !== false ? cutSVG(shop) : ''}${
    ch.orders.map((o, i) => `<div class="slot" style="top:${slotTop(ch.slots[i], shop)}mm">${labelHTML(o, shop, logos)}</div>`).join('')
  }</section>`).join('');
}

export function testSheetHTML(shop) {
  setPageSize(shop);
  const cells = Array.from({ length: SLOTS }, (_, i) => `<div class="slot test" style="top:${slotTop(i + 1, shop)}mm">
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
