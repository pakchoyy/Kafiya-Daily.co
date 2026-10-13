# Kafiya Daily — Cetak Resi

Aplikasi web kecil (PWA, tanpa server) untuk mencetak label alamat/resi **7 × 5 cm** ke stiker A4
dari HP Android. Rincian ada di PRD.

- **Mode Wahana**: tempel chat WhatsApp → dirapikan jadi nama/HP/alamat → ekspedisi, resi, berat → label lengkap.
- **Mode Shopee**: tempel daftar resi (satu per baris) → label logo + resi besar.
- Slot 1–5 di kolom tengah A4, otomatis lanjut/minta ganti kertas; geser posisi cetak per 1 mm; halaman tes cetak.
- Data (IndexedDB) hanya di HP; backup/restore ke file JSON; jalan offline setelah dipasang.

## Menjalankan

Tanpa build, tanpa dependensi.

```
npm start      # http://localhost:8080
npm test       # uji perapi alamat
```

## Deploy (Cloudflare Pages)

Hubungkan repo, **build command kosong**, **output directory** `/` (root). File `_headers` sudah mengatur
`no-cache` untuk halaman dan skrip supaya versi baru langsung terbit; service worker mengambil
halaman dari jaringan dulu, cache hanya cadangan saat offline.

## Struktur

| File | Isi |
| --- | --- |
| `js/app.js` | Halaman dan alur (Pesanan, Pesanan baru, Cetak, Pelanggan, Pengaturan) |
| `js/label.js` | Template label, geometri lembar A4, pengecil huruf otomatis, cetak |
| `js/parser.js` | Perapi chat WhatsApp dan daftar resi |
| `js/logo.js` | Hapus latar putih, potong, versi hitam-putih |
| `js/db.js` | IndexedDB, ekspor/impor backup |
| `sw.js`, `manifest.webmanifest` | PWA |

## Geometri cetak

A4 `@page` margin 0. Label 70 × 50 mm di kolom tengah (x = 70 mm); lima slot mulai y = 23,5 mm.
Geser kiri/kanan dan atas/bawah (±20 mm, per 1 mm) disimpan di Pengaturan. Di dialog cetak Android pilih
**A4, skala 100%, tanpa margin/header**. Uji dulu dengan halaman tes di kertas biasa.

## Belum ada / perlu dijawab (lihat PRD)

No. HP toko, ekspedisi lain, hasil uji di
printer WiFi sebenarnya, contoh resi asli, dan konfirmasi ukuran label final.
