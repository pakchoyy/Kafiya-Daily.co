# Tindak lanjut audit 001 · 13 Oktober 2026

Disetujui pemilik: semua nomor (1–12). Nomor 6: dikurangi sesuai usulan. Versi aplikasi 25.

| No | Hasil | Bukti |
| --- | --- | --- |
| 1 | `--muted` #948A80 → #72675D | 5,0:1 di latar krem, 5,5:1 di kartu, 4,6:1 di latar beranda |
| 2 | Tombol pasir #86705D dengan teks putih; mode gelap pasir #B8A08B dengan teks gelap; tombol merah mode gelap teks gelap | 4,7:1 (terang), 7,0:1 (gelap) |
| 3 | Dialog dan jendela: Escape menutup, Tab berputar di dalam, fokus kembali ke tombol asal | Uji: dialog hapus fokus di "Hapus", Tab tetap di dialog, Escape menutup tanpa menghapus; jendela ubah fokus di isian nama, Escape menutup |
| 4 | Semua em dash di teks diganti | Judul halaman jadi "Kafiya Daily: Cetak Resi"; pencarian `—` di HTML/JS/manifest kosong |
| 5 | Chip filter dan tombol ✎/🗑 jadi 44 px | Diukur di browser: 44 × 44 |
| 6 | Kapital berjarak lebar hanya di judul bagian, eyebrow, dan tombol; label isian, angka ringkasan, chip status, keterangan pratinjau, dan menu bawah pakai huruf biasa | `label.f` text-transform: none |
| 7 | Beranda dibuka dengan "n label belum dicetak" + Cetak sekarang; kalau kosong "Semua label sudah dicetak" + Pesanan baru; slogan jadi baris kecil; angka ringkasan "Belum dicetak" diganti "Sudah dicetak" agar tidak dobel | Dicek visual terang dan gelap |
| 8 | Garis fokus 2 px untuk tombol, isian, dan kolom cari (`:focus-visible`) | |
| 9 | Batang Shopee di rekap pakai rose logo #C89B87 | |
| 10 | Panah di tombol beranda dihapus | |
| 11 | Label: "Thanks for your order ☺" | Pratinjau, cetak, dan JPG memakai teks yang sama |
| 12 | Halaman gagal dibuka: pesan + Muat ulang, Kembali ke Pesanan, Backup data | |

Diperiksa di Chromium 390 px, mode terang dan gelap, tanpa error console. `npm test` 11 lulus.
