# Menyambungkan toko online ke Firebase (paket gratis, tanpa kartu)

Toko online (`/toko/`) dan menu **Produk** di aplikasi memakai Firebase: Firestore untuk data, Authentication
untuk login pemilik. Foto produk dikecilkan di HP lalu disimpan di Firestore, jadi **Storage tidak dipakai**
dan tidak perlu paket Blaze.

## 1. Buat project

1. Buka https://console.firebase.google.com, login dengan akun Google.
2. **Create a project** → nama `kafiya-daily` → Google Analytics boleh dimatikan → **Create project**.

## 2. Firestore

1. Menu kiri **Build → Firestore Database → Create database**.
2. Pilih lokasi **asia-southeast2 (Jakarta)** → mode **Production** → **Create**.
3. Buka tab **Rules**, hapus isinya, tempel isi file `firestore.rules` dari repo ini.
4. Ganti `EMAIL_PEMILIK` dengan email akun pemilik (langkah 3), lalu **Publish**.

## 3. Login pemilik

1. **Build → Authentication → Get started** → pilih **Email/Password** → aktifkan → **Save**.
2. Tab **Users → Add user**: isi email dan kata sandi pemilik. Email ini harus sama dengan yang di Rules.
3. Tab **Settings → Authorized domains → Add domain**: `kafiya-daily.vercel.app`.

## 4. Konfigurasi web

1. Ikon roda gigi → **Project settings** → bagian **Your apps** → ikon **Web (`</>`)**.
2. Nama aplikasi `kafiya` → **Register app** (Firebase Hosting tidak perlu dicentang).
3. Salin isi `firebaseConfig` (apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId).
4. Tempel ke `js/firebase-config.js`, contoh:

   ```js
   export const firebaseConfig = {
     apiKey: '...',
     authDomain: 'kafiya-daily.firebaseapp.com',
     projectId: 'kafiya-daily',
     storageBucket: 'kafiya-daily.appspot.com',
     messagingSenderId: '...',
     appId: '...',
   };
   ```

   Nilai ini memang dipakai di browser dan aman disimpan di repo. Yang menjaga data adalah Rules di langkah 2.

## 5. Mulai pakai

1. Aplikasi → **Atur → Toko online** → login dengan email dan kata sandi pemilik.
2. **Simpan info toko** (deskripsi dan nomor WhatsApp penerima pesanan).
3. **Kelola produk** → tambah produk dengan foto, harga, ukuran, stok.
4. Bagikan link toko: `https://kafiya-daily.vercel.app/toko/`.
5. Pesanan pembeli muncul di **Pesanan baru → Ambil n pesanan dari toko online**. Setelah disimpan,
   stok produk berkurang otomatis.

## Batas paket gratis (Spark)

- 1 GB data Firestore: cukup untuk ratusan produk (tiap foto ±150 KB).
- 50.000 baca dan 20.000 tulis per hari. Satu kunjungan katalog ± jumlah produk + 1 baca.
- Kalau melewati batas, Firestore berhenti melayani sampai hari berikutnya; tidak ada tagihan.

## Uji lokal tanpa project sungguhan

`npx firebase-tools emulators:start --only firestore,auth --project demo-kafiya`
(port Firestore 8181, Auth 9099), lalu buka aplikasi dengan `?emu=1`.
