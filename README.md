# Kafiya Daily — Cetak Resi

Aplikasi web (PWA, tanpa server) untuk mencetak label pengiriman ke kertas stiker dari HP Android.
Semua data tersimpan di HP (IndexedDB); tidak ada akun dan tidak ada server.

## Fitur

- **Pesanan baru otomatis**: upload (atau *Bagikan* dari aplikasi lain) screenshot / PDF, bisa banyak sekaligus.
  - Screenshot chat WhatsApp → OCR di HP (Tesseract.js) → nama, HP, alamat → label Wahana/ekspedisi.
  - PDF / screenshot label Shopee → kotak label dipotong otomatis, diputar, resi dibaca dari barcode/QR → label Shopee asli.
  - Isi manual / tempel teks chat juga bisa. Pesanan dobel diberi tanda.
- **Cetak**: kolom 7 cm di tengah kertas (A4, F4, atau F4 lewat setelan printer *Indian Legal*), label ditumpuk dari atas,
  jumlah lembar menyesuaikan, garis bantu gunting di sekeliling label. Bisa juga unduh JPG per lembar.
- **Riwayat**: cari, filter tanggal dan status, pilih banyak (cetak / tandai / hapus), rekap 7 hari.
- **Pengaturan**: data toko, logo, kertas, geser posisi cetak per 1 mm, halaman tes, mode gelap, backup/restore JSON.

## Menjalankan

Tanpa build dan tanpa dependensi.

```
npm start      # http://localhost:8080
npm test       # uji perapi alamat, pembaca resi, barcode
```

## Deploy

Vercel atau Cloudflare Pages sebagai situs statis: tanpa build command, output directory root (`vercel.json` sudah
mengatur ini untuk Vercel). Pustaka besar (Tesseract.js, pdf.js, jsQR) dimuat dari jsDelivr hanya saat dibutuhkan,
lalu di-cache oleh service worker. Setiap rilis: naikkan `APP_VERSION` di `js/app.js` dan `CACHE` di `sw.js` bersamaan.

## Struktur

| File | Isi |
| --- | --- |
| `js/app.js` | Halaman dan alur (Pesanan, Pesanan baru, Cetak, Pelanggan, Atur) |
| `js/label.js` | Template label, tata letak di kertas, garis gunting, cetak |
| `js/jpg.js` | Lembar cetak sebagai JPG (canvas) |
| `js/shopee.js` | Deteksi jenis file, potong & putar label Shopee, baca resi |
| `js/ocr.js` | OCR (Tesseract.js) dan pembaca barcode bawaan browser |
| `js/parser.js` | Perapi chat WhatsApp dan pengambil no. resi |
| `js/barcode.js` | Barcode Code 128 tanpa pustaka |
| `js/logo.js` | Olah logo (hapus latar putih, versi hitam-putih) |
| `js/db.js` | IndexedDB, ekspor/impor backup |
| `sw.js`, `manifest.webmanifest` | PWA, cache offline, *share target* |

## Catatan cetak

Di dialog cetak Android pilih ukuran kertas yang sama dengan di Atur, skala 100%, tanpa margin/header.
Uji dulu dengan *halaman tes* di kertas biasa, lalu atur geser posisi bila perlu.
