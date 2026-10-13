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

import { parseChatOcr } from '../js/parser.js';

test('screenshot WhatsApp asli: abaikan obrolan, ambil an. dan baris alamat', () => {
  const raw = '14:03\n0,1KB/d + = = GD\n) SILVYAOS\nOX\n_—— me\nAlamat nya mba 0431 7\nMba kelebihan total 100 RB 3 pcs sama ongki\n6rb jadi 106 , kembalian 10rb tak taruh dalam\npaket ya\n04.32 V/\nOkeee mba\n08.06\nMargoasri rt 09/rw 05, mundu , tulung , klaten\n08.06\nan. SILVYANI LENDY ANGGRENI\n08.07\nKetik pesan\nv © O';
  const r = parseChatOcr(raw);
  assert.equal(r.name, 'Silvyani Lendy Anggreni');
  assert.equal(r.phone, '');
  assert.equal(r.address, 'Margoasri rt 09/rw 05, mundu, tulung, klaten');
});

test('tempel teks dengan an. juga dikenali', () => {
  assert.equal(parseChat('Margoasri rt 09/rw 05, Klaten\nan. Silvyani').name, 'Silvyani');
});

import { code128, PATTERNS } from '../js/barcode.js';

test('Code128: semua pola 11 modul (stop 13) dan bisa didekode kembali', () => {
  PATTERNS.forEach((p, i) => assert.equal([...p].reduce((a, b) => a + Number(b), 0), i === 106 ? 13 : 11));
  const w = code128('SPXID06896190292A');
  const syms = []; for (let i = 0; i < w.length - 7; i += 6) syms.push(PATTERNS.indexOf(w.slice(i, i + 6)));
  assert.equal(syms[0], 104);
  const data = syms.slice(1, -1);
  assert.equal(String.fromCharCode(...data.map((v) => v + 32)), 'SPXID06896190292A');
  const check = [104, ...data].reduce((s, v, i) => s + v * (i || 1), 0) % 103;
  assert.equal(syms.at(-1), check);
  assert.equal(new Set(PATTERNS).size, 107);
});
