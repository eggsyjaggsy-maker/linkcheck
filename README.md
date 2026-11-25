# LinkVault — Aplikasi Web Cek Nama Website / Link Tertutup

Aplikasi Web (responsif & siap dipasang sebagai PWA di Android) untuk memverifikasi apakah satu atau banyak link termasuk dalam daftar nama website rahasia yang diunggah oleh **Master**.

## Fitur Utama

1. **Web App & Mobile/Android Friendly (PWA)**
   - Antarmuka responsif untuk browser desktop maupun Android Chrome (dapat ditambahkan ke Layar Utama Android via *Add to Home screen*).
2. **Daftar Master Tertutup (Tidak Dapat Dibuka Pengguna)**
   - Daftar disimpan di server menggunakan SQLite (`data/app.db`) berdasarkan **nama website** tanpa ekstensi domain (`.com`, `.co.id`, `.xyz`, dll.) agar tetap cocok walaupun ekstensi domain berubah.
   - Tidak ada endpoint maupun tampilan yang memperlihatkan isi daftar Master kepada pengguna biasa.
   - Akses unggah, tambah, dan hapus daftar hanya terbuka melalui **Panel Master** dengan autentikasi password (`HttpOnly` signed session cookie).
3. **Search Bar Cek 1 Link (Indikator Merah / Hijau)**
   - Pengguna dapat memasukkan link lengkap (misal `https://www.contohsite.co.id/promo`) maupun nama website langsung (`contohsite`). Sistem mengekstrak nama website lalu mencocokkannya dengan daftar Master.
   - **Merah (`Bagian dari List`)**: Nama website ditemukan dalam daftar Master.
   - **Hijau (`Bukan Bagian dari List`)**: Nama website tidak ada dalam daftar Master.
4. **Cek Banyak Link Sekaligus (Batch)**
   - Format yang didukung:
     - **1 link / nama website per baris** (dipisah Enter), atau
     - **Dipisahkan koma (`,`) atau titik koma (`;`)**, atau
     - **Upload file `.txt` / `.csv` 1 kolom** (header `link`/`url`/`website`/`nama` dan baris `#` diabaikan otomatis).
   - Dilengkapi ringkasan jumlah, filter status, salin clipboard, dan unduh hasil cek (CSV).

## Cara Menjalankan

Prasyarat: **Node.js >= 22** (tidak memerlukan instalasi dependency eksternal).

```bash
# Opsional: atur password Master (default: master123)
set MASTER_PASSWORD=password-rahasia-anda

# Jalankan server
node src/server.js
```

Buka di browser: `http://localhost:3000`.

## Menjalankan Pengujian Otomatis

```bash
node --test test/*.test.js
```
