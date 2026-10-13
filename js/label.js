// Pembuat label 7 × 5 cm dan lembar A4 (kolom tengah, slot 1–5 dari atas).
import { logoSrc } from './logo.js';

export const LABEL_W = 70, LABEL_H = 50, SLOTS = 5;
export const COL_X = 70;                                   // kolom tengah dimulai di 7 cm
export const TOP = (297 - SLOTS * LABEL_H) / 2;            // sisa atas/bawah ±2,3 cm
export const slotTop = (slot) => TOP + (slot - 1) * LABEL_H;

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const courierName = (o) => (o.courier || 'Wahana').toUpperCase();

export function labelHTML(order, shop, logo) {
  const logoEl = logo
    ? `<img class="lb-logo" src="${logo}" alt="">`
    : `<span class="lb-logo-txt">${esc(shop.name || 'Kafiya Daily')}</span>`;
  if (order.type === 'shopee') {
    return `<div class="label shopee">
      <div class="lb-logo-wrap">${logoEl}</div>
      <div class="lb-resi" data-max="20">${esc(order.resi)}</div>
    </div>`;
  }
  const w = order.weight ? `${esc(order.weight)} kg` : '';
  return `<div class="label wahana">
    <div class="lb-head">${logoEl}<span class="lb-exp">${esc(courierName(order))}</span></div>
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
  const logo = await logoSrc(shop);
  return chunks.map((ch) => `<section class="sheet" style="--dx:${shop.dx}mm;--dy:${shop.dy}mm">${
    ch.orders.map((o, i) => `<div class="slot" style="top:${slotTop(ch.slots[i])}mm">${labelHTML(o, shop, logo)}</div>`).join('')
  }</section>`).join('');
}

export function testSheetHTML(shop) {
  const cells = Array.from({ length: SLOTS }, (_, i) => `<div class="slot test" style="top:${slotTop(i + 1)}mm">
    <div class="label testbox"><i class="h"></i><i class="v"></i><b>Slot ${i + 1}</b><span>70 × 50 mm</span></div></div>`).join('');
  return `<section class="sheet" style="--dx:${shop.dx}mm;--dy:${shop.dy}mm">${cells}</section>`;
}

// Cetak lewat #print-root; fitLabel dijalankan saat elemen sudah ada di DOM (di luar layar).
export function printHTML(html) {
  const root = document.getElementById('print-root');
  root.innerHTML = html;
  const bad = [...root.querySelectorAll('.label.wahana, .label.shopee')].filter((l) => !fitLabel(l)).length;
  window.print();
  return bad;
}
