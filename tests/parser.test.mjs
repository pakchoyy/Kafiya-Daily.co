import test from 'node:test';
import assert from 'node:assert/strict';
import { parseChat, parseResiList, normalizePhone } from '../js/parser.js';

test('normalizePhone', () => {
  assert.equal(normalizePhone('+62 812-3456-7890'), '081234567890');
  assert.equal(normalizePhone('6281234567890'), '081234567890');
  assert.equal(normalizePhone('0812 3456 7890'), '081234567890');
});

test('chat berlabel', () => {
  const r = parseChat('Nama: siti aminah\nNo HP: 0812-3456-7890\nAlamat: Jl. Mawar No 5 RT 02/03\nKel. Sukamaju, Kec. Cibeunying\nBandung 40123');
  assert.equal(r.name, 'Siti Aminah');
  assert.equal(r.phone, '081234567890');
  assert.equal(r.address, 'Jl. Mawar No 5 RT 02/03, Kel. Sukamaju, Kec. Cibeunying, Bandung 40123');
});

test('chat bebas banyak baris dengan prefix WhatsApp', () => {
  const r = parseChat('[12/10/26 10.30] Siti: Dewi Lestari\n+62 857 1234 5678\nJl. Melati 3, Depok');
  assert.equal(r.name, 'Dewi Lestari');
  assert.equal(r.phone, '085712345678');
  assert.equal(r.address, 'Jl. Melati 3, Depok');
});

test('satu baris', () => {
  const r = parseChat('Rina 081234567890 Jl. Kenanga 7 Bekasi');
  assert.equal(r.name, 'Rina');
  assert.equal(r.phone, '081234567890');
  assert.equal(r.address, 'Jl. Kenanga 7 Bekasi');
});

test('daftar resi', () => {
  const r = parseResiList('spx123456789\n spx123456789 \n\nab1');
  assert.deepEqual(r.map((x) => [x.resi, x.dup, x.odd]), [['SPX123456789', false, false], ['SPX123456789', true, false], ['AB1', false, true]]);
});

import { cleanOcr, extractResi } from '../js/parser.js';

test('OCR WhatsApp dibersihkan lalu dirapikan', () => {
  const raw = 'Hari ini\nNama: Dewi Lestari 10.21\nHp: 0857 1234 5678 10.21 ✓✓\nAlamat: Jl. Melati 3, Depok 10.22\n10.22\nKetik pesan';
  const r = parseChat(cleanOcr(raw));
  assert.equal(r.name, 'Dewi Lestari');
  assert.equal(r.phone, '085712345678');
  assert.equal(r.address, 'Jl. Melati 3, Depok');
});

test('ambil resi dari teks OCR', () => {
  assert.deepEqual(extractResi('No. Resi: SPXID0412345678\nspxid0412345679 HP 081234567890\nTotal 125000'), ['SPXID0412345678', 'SPXID0412345679']);
});

test('resi SPX berakhiran huruf', () => {
  assert.deepEqual(extractResi('SPX Hemat No. Resi\nSPXID06770099194A\nSPX Express Magetan Hub (3.12km)'), ['SPXID06770099194A']);
});
